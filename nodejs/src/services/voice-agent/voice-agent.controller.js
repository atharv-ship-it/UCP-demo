import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getProductsDb } from '../../data/db.js'
import { getModelConfig, getModelsInfo, hasModel } from './core/config/index.js'
import {
  validateMessage,
  validateSessionToken
} from './core/helpers/validation.js'
import {
  incrementExchangeCount,
  setModelFocus,
  recordInterestSignal
} from './core/helpers/session-state.js'
import {
  logConversationMessage,
  logError as logPosthogError,
  logSecurityEvent,
  logSessionConfig,
  logSessionCreated,
  logTokenUsage,
  logToolExecutionCompleted,
  logToolExecutionError,
  logToolExecutionStarted,
  registerSession
} from './services/posthog-logger.js'
import {
  addConversationMessage,
  getConversationHistory,
  getConversationTokenEstimate,
  pruneConversationHistory
} from './services/redis-cache.js'
import {
  getTotalSummary,
  logRequestContext,
  logUsage
} from './services/token-monitor.js'
import {
  executeToolCall,
  getSessionConfig
} from './webrtc-tools-service.js'
import { buildModelEnrichedPrompt } from './config/prompts.js'
import { validSessions } from './voice-agent.helper.js'
import {
  calculateEMI,
  getEMICalculatorConfig
} from './services/finance-service.js'
import { evaluateNudge } from './services/nudge-engine.js'

// Debug logging flag - set VOICE_AGENT_DEBUG=true in .env to enable
const DEBUG = process.env.VOICE_AGENT_DEBUG === 'true'

const log = (...args) => {
  if (DEBUG) console.log('[BYD VOICE AGENT]', ...args)
}

const logWarn = (...args) => {
  if (DEBUG) console.warn('[BYD VOICE AGENT]', ...args)
}

const logError = (...args) => {
  // Always log errors
  console.error('[BYD VOICE AGENT]', ...args)
}

// Tool execution timeout wrapper (30 seconds default)
const TOOL_TIMEOUT_MS = 30000

const executeWithTimeout = async (
  toolName,
  toolArgs,
  modelConfig,
  timeoutMs = TOOL_TIMEOUT_MS
) => {
  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(
      () =>
        reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })

  try {
    return await Promise.race([
      executeToolCall(toolName, toolArgs, modelConfig),
      timeoutPromise
    ])
  } catch (error) {
    if (error.message.includes('timed out')) {
      logError(`[VOICE AGENT] Tool timeout: ${toolName}`)
      return {
        success: false,
        error: 'timeout',
        context: 'Let me get that information for you... one moment please.',
        should_retry: true
      }
    }
    throw error
  }
}

export const publicPath =
  process.env.NODE_ENV === 'production'
    ? path.join(process.cwd(), 'public')
    : path.join(__dirname, '../../../public')

// Get token usage stats
export const getTokenUsage = (_req, res) => {
  const summary = getTotalSummary()
  res.json({
    status: 'success',
    usage: summary,
    timestamp: new Date().toISOString()
  })
}

// Log context debug data to file (for debugging token growth)
export const logContextDebug = (req, res) => {
  try {
    const { session_token, turn_number, context_data } = req.body

    if (!session_token) {
      return res.status(400).json({ error: 'Missing session_token' })
    }

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs', 'context-debug')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    // Create/append to session log file
    const timestamp = Date.now()
    const sessionShort = session_token.substring(0, 8)
    const filename = `session-${sessionShort}-${timestamp}.log`
    const filepath = path.join(logsDir, filename)

    // Check if we already have a log file for this session
    const existingFiles = fs
      .readdirSync(logsDir)
      .filter(f => f.includes(sessionShort))
    const logFile =
      existingFiles.length > 0 ? path.join(logsDir, existingFiles[0]) : filepath

    // Format the log entry
    const logEntry = `
${'█'.repeat(80)}
📜 TURN ${turn_number} - CONTEXT DEBUG LOG
${'█'.repeat(80)}
Timestamp: ${new Date().toISOString()}
Session: ${session_token}

${'-'.repeat(80)}
SYSTEM PROMPT (${context_data.systemPromptTokens || 0} tokens):
${'-'.repeat(80)}
${
  context_data.systemPrompt
    ? context_data.systemPrompt.substring(0, 1000) +
      (context_data.systemPrompt.length > 1000 ? '\n... [truncated]' : '')
    : 'N/A'
}

${'-'.repeat(80)}
TOOL DEFINITIONS (~${context_data.toolDefinitionsTokens || 0} tokens)
${'-'.repeat(80)}

${'-'.repeat(80)}
CONVERSATION TURNS (${context_data.turns?.length || 0} turns):
${'-'.repeat(80)}
${(context_data.turns || [])
  .map(
    (turn, i) => `
TURN ${i}: ${turn.role?.toUpperCase()} (${turn.type})
Tokens: ~${turn.tokens} | Chars: ${turn.contentLength}
Content:
${
  typeof turn.content === 'string'
    ? turn.content
    : JSON.stringify(turn.content, null, 2)
}
`
  )
  .join('\n' + '-'.repeat(40) + '\n')}

${'-'.repeat(80)}
TOTALS:
${'-'.repeat(80)}
System Prompt: ~${context_data.systemPromptTokens || 0} tokens
Tool Definitions: ~${context_data.toolDefinitionsTokens || 0} tokens
Conversation: ~${(context_data.turns || []).reduce(
      (s, t) => s + (t.tokens || 0),
      0
    )} tokens
ESTIMATED TOTAL: ~${context_data.totalTokens || 0} tokens

OpenAI Reported:
  Input Tokens: ${context_data.openaiUsage?.input_tokens || 'N/A'}
  Output Tokens: ${context_data.openaiUsage?.output_tokens || 'N/A'}
  Cached Tokens: ${context_data.openaiUsage?.input_token_details
    ?.cached_tokens || 'N/A'}

${'█'.repeat(80)}

`

    // Append to log file
    fs.appendFileSync(logFile, logEntry, 'utf8')

    console.log(
      `[CONTEXT DEBUG] 📝 Logged turn ${turn_number} to ${path.basename(
        logFile
      )}`
    )

    res.json({
      status: 'success',
      log_file: path.basename(logFile),
      turn: turn_number
    })
  } catch (err) {
    logError('[VOICE AGENT] Error logging context debug:', err)
    res.status(500).json({ error: err.message })
  }
}

// Report token usage from client
export const reportUsage = (req, res) => {
  try {
    const { session_token, usage, context } = req.body

    if (!session_token || !validSessions.has(session_token)) {
      logWarn('[VOICE AGENT] Invalid session token for usage report')
      return res.status(401).json({ error: 'Invalid session' })
    }

    if (!usage || typeof usage !== 'object') {
      logWarn('[VOICE AGENT] Invalid usage data')
      return res.status(400).json({ error: 'Invalid usage data' })
    }

    logUsage(session_token, usage, context || {})

    // PostHog: Log token usage
    logTokenUsage(session_token, {
      inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
      outputTokens: usage.output_tokens || usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      audioInputTokens: usage.input_token_details?.audio_tokens || 0,
      audioOutputTokens: usage.output_token_details?.audio_tokens || 0,
      cachedTokens: usage.input_token_details?.cached_tokens || 0,
      context: context?.toolName || context?.type || 'usage_report'
    })

    res.json({ status: 'success' })
  } catch (err) {
    logError('[VOICE AGENT] Error logging usage:', err)
    res.status(500).json({ error: err.message })
  }
}

// Store conversation message
export const storeConversationMessage = async (req, res) => {
  try {
    const { session_token, message } = req.body

    const sessionValidation = validateSessionToken(session_token, validSessions)
    if (!sessionValidation.isValid) {
      logWarn('[VOICE AGENT] Invalid session token for conversation message')
      return res.status(401).json({ error: sessionValidation.error })
    }

    const messageValidation = validateMessage(message)
    if (!messageValidation.isValid) {
      logWarn('[VOICE AGENT] Invalid message:', messageValidation.error)
      return res.status(400).json({ error: messageValidation.error })
    }

    const success = await addConversationMessage(session_token, message)
    if (!success) {
      return res.status(500).json({ error: 'Failed to store message' })
    }

    // PostHog: Log conversation message
    logConversationMessage(session_token, {
      role: message.role,
      content: message.content
    })

    const tokenEstimate = await getConversationTokenEstimate(session_token)
    res.json({ status: 'success', token_estimate: tokenEstimate })
  } catch (err) {
    logError('[VOICE AGENT] Error storing conversation message:', err)
    logPosthogError(req.body?.session_token, {
      category: 'conversation',
      endpoint: '/conversation/message',
      method: 'POST',
      error: err.message,
      errorStack: err.stack
    })
    res.status(500).json({ error: err.message })
  }
}

// Get conversation history
export const getConversationHistoryHandler = async (req, res) => {
  try {
    const { session_token, limit } = req.query

    if (!session_token || !validSessions.has(session_token)) {
      logWarn('[VOICE AGENT] Invalid session token for conversation history')
      return res.status(401).json({ error: 'Invalid session' })
    }

    const history = await getConversationHistory(
      session_token,
      parseInt(limit) || 20
    )
    const tokenEstimate = await getConversationTokenEstimate(session_token)

    res.json({
      status: 'success',
      messages: history,
      message_count: history.length,
      token_estimate: tokenEstimate
    })
  } catch (err) {
    logError('[VOICE AGENT] Error retrieving conversation history:', err)
    res.status(500).json({ error: err.message })
  }
}

// Prune conversation history
export const pruneConversationHandler = async (req, res) => {
  try {
    const { session_token, max_tokens } = req.body

    if (!session_token || !validSessions.has(session_token)) {
      logWarn('[VOICE AGENT] Invalid session token for conversation pruning')
      return res.status(401).json({ error: 'Invalid session' })
    }

    const pruned = await pruneConversationHistory(
      session_token,
      max_tokens || 4000
    )
    const tokenEstimate = await getConversationTokenEstimate(session_token)
    const history = await getConversationHistory(session_token)

    res.json({
      status: 'success',
      messages_pruned: pruned,
      messages_remaining: history.length,
      token_estimate: tokenEstimate
    })
  } catch (err) {
    logError('[VOICE AGENT] Error pruning conversation:', err)
    res.status(500).json({ error: err.message })
  }
}

// Create WebRTC session
// Exchange SDP for WebRTC connection with OpenAI
export const exchangeRealtimeSdp = async (req, res) => {
  try {
    const { sdp, client_secret, session_token } = req.body

    if (!sdp || !client_secret || !session_token) {
      return res.status(400).json({
        error: 'Missing required fields: sdp, client_secret, session_token'
      })
    }

    const validation = validateSessionToken(session_token, validSessions)
    if (!validation.isValid) {
      return res.status(401).json({ error: validation.error })
    }

    log('[VOICE AGENT] Exchanging SDP for unified session')

    const response = await fetch('https://api.openai.com/v1/realtime', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client_secret}`,
        'Content-Type': 'application/sdp'
      },
      body: sdp
    })

    if (!response.ok) {
      const error = await response.text()
      logError('[VOICE AGENT] OpenAI SDP exchange failed:', error)
      return res.status(response.status).json({ error: 'SDP exchange failed' })
    }

    const answerSdp = await response.text()
    log(`[VOICE AGENT] SDP exchange successful`)

    res.json({ sdp: answerSdp })
  } catch (err) {
    logError('[VOICE AGENT] Error exchanging SDP:', err)
    res.status(500).json({ error: err.message })
  }
}

export const createSession = async (req, res) => {
  try {
    const { voice: requestedVoice, model_id: initialModelId } = req.query
    const ip = req.ip || req.connection.remoteAddress || 'unknown'

    // Check if initial model is specified from data-id attribute
    if (initialModelId) {
      log(
        `[VOICE AGENT] Creating session with initial model: ${initialModelId} - IP: ${ip}`
      )
    } else {
      log(
        '[VOICE AGENT] Creating unified multi-model WebRTC session - IP: ' + ip
      )
    }

    // Voice selection: male = 'echo', female/default = 'marin'
    const selectedVoice = requestedVoice === 'male' ? 'echo' : 'marin'
    console.log(`[VOICE AGENT] Creating session with voice: ${selectedVoice}`)

    const sessionConfig = getSessionConfig(selectedVoice)

    const response = await fetch(
      'https://api.openai.com/v1/realtime/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-realtime-2025-08-28',
          voice: selectedVoice,
          modalities: sessionConfig.modalities || ['text', 'audio'],
          input_audio_format: sessionConfig.input_audio_format || 'pcm16',
          output_audio_format: sessionConfig.output_audio_format || 'pcm16',
          instructions: sessionConfig.instructions,
          tools: sessionConfig.tools,
          turn_detection: sessionConfig.turn_detection,
          input_audio_transcription: sessionConfig.input_audio_transcription,
          temperature: sessionConfig.temperature || 0.8,
          max_response_output_tokens: sessionConfig.max_response_output_tokens,
          truncation: 'auto'
        })
      }
    )

    if (!response.ok) {
      const err = await response.text()
      logError('[VOICE AGENT] OpenAI session error:', err)
      throw new Error('Failed to create OpenAI session')
    }

    const data = await response.json()

    const sessionToken = crypto.randomBytes(32).toString('hex')
    validSessions.set(sessionToken, {
      createdAt: Date.now(),
      ip: ip,
      currentModelId: initialModelId || null // Set initial model if provided
    })

    const sessionModelId = 'unified'
    const sessionModelName = 'Multi-Model Agent'

    log(`[VOICE AGENT] Session created with model: ${sessionModelId}`)

    // PostHog: Register session
    registerSession(sessionToken, {
      modelId: sessionModelId,
      modelName: sessionModelName,
      ip: ip
    })

    logSessionCreated(sessionToken, {
      modelId: sessionModelId,
      modelName: sessionModelName,
      voice: selectedVoice,
      toolsCount: sessionConfig.tools?.length || 0,
      ip: ip
    })

    logSessionConfig(sessionToken, sessionConfig)

    if (data.usage) {
      logUsage(sessionToken, data.usage, { usage: data.usage })
      logTokenUsage(sessionToken, {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        context: 'session_creation'
      })
    }

    res.json({
      client_secret: data.client_secret,
      session_config: {
        instructions: sessionConfig.instructions,
        tool_names: sessionConfig.tools.map(t => t.name),
        turn_detection: sessionConfig.turn_detection,
        input_audio_transcription: sessionConfig.input_audio_transcription,
        model: {
          id: sessionModelId,
          name: sessionModelName
        }
      },
      session_token: sessionToken,
      model: {
        id: sessionModelId,
        name: sessionModelName
      }
    })
  } catch (err) {
    logError('[VOICE AGENT] Error creating session:', err)
    res.status(500).json({ error: err.message })
  }
}

// Execute tool calls from WebRTC client
export const executeTools = async (req, res) => {
  const startTime = Date.now()
  try {
    const {
      tool_name,
      tool_args,
      call_id,
      session_token,
      model_id: bodyModelId
    } = req.body

    // For unified routes: modelId comes from body or session tracks currentModelId
    const requestModelId = bodyModelId

    log(`[VOICE AGENT] ===== TOOL REQUEST RECEIVED =====`)
    log(`[VOICE AGENT] Model (Body): ${bodyModelId || 'none'}`)
    log(`[VOICE AGENT] Tool: ${tool_name}`)
    log(`[VOICE AGENT] Call ID: ${call_id}`)

    if (!session_token || !validSessions.has(session_token)) {
      logWarn('[VOICE AGENT] SECURITY: Invalid or missing session token')
      logSecurityEvent(session_token || 'unknown', {
        type: 'invalid_session',
        ip: req.ip,
        details: { requestModelId, tool_name }
      })
      return res.status(401).json({ error: 'Invalid session' })
    }

    const sessionData = validSessions.get(session_token)

    // Get active model ID from session (supports dynamic switching)
    const activeModelId = requestModelId || sessionData.currentModelId

    // NEW: Handle detect_model_intent tool (model selection/switching)
    if (tool_name === 'detect_model_intent') {
      log(
        '[VOICE AGENT] Executing detect_model_intent (no model config needed)'
      )

      const allowedTools = [
        'detect_model_intent',
        'show_products',
        'show_journey_media',
        'search_local_knowledge',
        'search_vehicle_knowledge',
        'search_vehicle_images',
        'get_ev_charging_stations',
        'get_customer_reviews',
        'get_competitor_comparison',
        'get_booking_slots',
        'book_test_drive',
        'validate_phone_number',
        'get_showroom_locations',
        'enrich_with_media',
        'show_promotional_offer',
        'show_emi_calculator',
        'show_car_configurator'
      ]

      if (!allowedTools.includes(tool_name)) {
        logWarn(`[VOICE AGENT] SECURITY: Blocked unknown tool: ${tool_name}`)
        logSecurityEvent(session_token, {
          type: 'invalid_tool',
          ip: req.ip,
          details: { tool_name, allowedTools }
        })
        return res.status(400).json({ error: 'Invalid tool' })
      }

      if (!tool_args || typeof tool_args !== 'object') {
        logWarn('[VOICE AGENT] Invalid tool arguments')
        return res.status(400).json({ error: 'Invalid tool arguments' })
      }

      logToolExecutionStarted(session_token, {
        toolName: tool_name,
        callId: call_id,
        args: tool_args
      })

      const execStart = Date.now()
      const result = await executeToolCall(tool_name, tool_args, null) // No modelConfig for detection

      // If model was detected, update session AND build enriched prompt
      if (result.model_id) {
        sessionData.currentModelId = result.model_id
        validSessions.set(session_token, sessionData)
        log(`[VOICE AGENT] Session model updated to: ${result.model_id}`)

        // BUILD MODEL-ENRICHED PROMPT for session.update
        try {
          const modelConfig = getModelConfig(result.model_id)
          if (modelConfig) {
            const enrichedPrompt = buildModelEnrichedPrompt(modelConfig)

            // Add session update data to result (client will send session.update event)
            result.session_update = {
              instructions: enrichedPrompt
            }
            result.send_session_update = true

            log('[VOICE AGENT] Built model-enriched prompt for session.update')
            log(
              `[VOICE AGENT] Prompt length: ${enrichedPrompt.length} characters`
            )
          } else {
            logWarn(
              `[VOICE AGENT] Could not load config for model: ${result.model_id}`
            )
          }
        } catch (error) {
          logPosthogError('session_update_build_failed', {
            session_token,
            model_id: result.model_id,
            error: error.message
          })
          log(`[VOICE AGENT] Failed to build enriched prompt: ${error.message}`)
          // Continue without session update - non-critical error
        }
      }

      const execDuration = Date.now() - execStart

      log(`[VOICE AGENT] Tool execution completed in ${execDuration}ms`)
      log(`[VOICE AGENT] Result:`, result)

      logToolExecutionCompleted(session_token, {
        toolName: tool_name,
        callId: call_id,
        duration: execDuration,
        success: result?.success !== false
      })

      return res.json({ result })
    }

    // Handle show_products — smart query: specific model, series, tier, or 1-per-tier default
    if (tool_name === 'show_products') {
      log('[VOICE AGENT] Executing show_products (UCP product catalog)')
      try {
        const db = getProductsDb()
        const { filter_series, model_id, limit } = tool_args || {}

        let rows = []

        // Priority 1: specific model ID requested (e.g. "sl25kcv", "el22kcv")
        if (model_id) {
          const idLower = model_id.toLowerCase().replace(/[\s-]/g, '')
          rows = db.prepare('SELECT * FROM products WHERE LOWER(REPLACE(id,\'-\',\'\')) = ? LIMIT 1').all(idLower)
          // Fallback: partial match
          if (!rows.length) {
            rows = db.prepare('SELECT * FROM products WHERE LOWER(id) LIKE ? ORDER BY rating DESC LIMIT 1').all(`%${idLower}%`)
          }
        }

        // Priority 2: series filter
        if (!rows.length && filter_series && filter_series !== 'all') {
          const seriesMap = {
            signature: 'dave lennox signature collection',
            elite: 'elite series',
            merit: 'merit series'
          }
          const seriesName = seriesMap[filter_series.toLowerCase()] || filter_series
          const maxCards = limit || 4
          rows = db.prepare('SELECT * FROM products WHERE LOWER(series) LIKE ? ORDER BY rating DESC LIMIT ?').all(`%${seriesName.toLowerCase()}%`, maxCards)
          // Fallback: partial series name match
          if (!rows.length) {
            rows = db.prepare('SELECT * FROM products WHERE LOWER(series) LIKE ? ORDER BY rating DESC LIMIT ?').all(`%${filter_series.toLowerCase()}%`, maxCards)
          }
        }

        // Priority 3: default — 1 best product per price tier ($$$$, $$$, $$, $)
        if (!rows.length) {
          rows = ['$$$$', '$$$', '$$', '$'].flatMap(tier =>
            db.prepare('SELECT * FROM products WHERE price_display = ? ORDER BY rating DESC LIMIT 1').all(tier)
          )
        }

        const cards = rows.map(p => ({
          id: p.id,
          title: p.title,
          series: p.series,
          image_url: `/assets/${p.id}.png`,
          price_display: p.price_display,
          seer: p.seer,
          seer2: p.seer2,
          noise: p.noise,
          energy_star: p.energy_star,
          rating: p.rating,
          reviews: p.reviews,
          features: p.features ? JSON.parse(p.features).slice(0, 3) : [],
          description: p.description
        }))

        return res.json({
          result: {
            success: true,
            cards,
            has_cards: true,
            source: 'ucp_products'
          }
        })
      } catch (err) {
        logError('[VOICE AGENT] show_products error:', err)
        return res.json({
          result: { success: false, cards: [], has_cards: false, error: err.message }
        })
      }
    }

    // Handle show_journey_media — return curated videos or reviews for the current journey stage
    if (tool_name === 'show_journey_media') {
      const { stage, type } = tool_args || {}

      const JOURNEY_MEDIA = {
        awareness: {
          videos: [
            { title: 'Lennox Central Air Conditioner - What You Should Know', url: 'https://www.youtube.com/watch?v=IV275LGcN1o', videoId: 'IV275LGcN1o' },
            { title: 'Lennox Two-Stage Air Conditioning Technology', url: 'https://www.youtube.com/watch?v=mvKssP2gz1g', videoId: 'mvKssP2gz1g' },
            { title: 'Developing a Professional Technician', url: 'https://www.youtube.com/watch?v=OK-SgQB-h9w', videoId: 'OK-SgQB-h9w' }
          ],
          reviews: [
            { text: 'Lennox has the highest efficiency ratings of any major HVAC company, which means higher long-term energy savings for you. Many units have silent operation, and the company offers a great selection of AC types, including split systems and ductless units.', source: "Today's Homeowner - Lennox Air Conditioner Review" },
            { text: 'Lennox is an outstanding option if you\'re installing a new AC in your home. It\'s one of the most highly recommended HVAC brands due to average pricing and well-above-average efficiency ratings, including up to 28.0 SEER/25.8 SEER2.', source: "Today's Homeowner - Lennox Air Conditioner Review" },
            { text: 'Many Lennox models qualify for Energy Star certification, with strong durability, reliability, advanced features like smart home integration and variable-speed compressors, plus extended warranties on high-end models.', source: 'The Furnace Outlet - Is Lennox a Good AC Brand?' }
          ]
        },
        consideration: {
          videos: [
            { title: 'Know before you buy! Lennox Air Conditioning System Review', url: 'https://www.youtube.com/watch?v=S4jcOubV3Vw', videoId: 'S4jcOubV3Vw' },
            { title: 'Lennox AC Reviews: Your Guide to the Best Options', url: 'https://www.youtube.com/watch?v=oNJ960Lp5vU', videoId: 'oNJ960Lp5vU' },
            { title: 'Carrier Vs Lennox AC: Which Is More Efficient & Reliable?', url: 'https://www.youtube.com/watch?v=WXoUJQEhGEA', videoId: 'WXoUJQEhGEA' }
          ],
          reviews: [
            { text: 'Lennox air conditioner reviews are largely positive and often mention durability and reliability. Lennox is known for producing units that operate quietly, which is especially important during nighttime, though the higher-quality build usually comes with a higher initial cost.', source: 'Harp Home Services - Are Lennox HVAC Systems Worth It?' },
            { text: 'I purchased the Merit Series ML17XP1 Heat Pump April 19th 2024. Cost me $9k installed. The outside unit shakes badly, but the cooling power with great efficiency is excellent. Lennox manufactures the most efficient air conditioners.', source: "YouTube review comment on 'Know before you buy! Lennox Air Conditioning System Review'" },
            { text: 'Lennox AC units are on the more expensive side, but long-term energy savings and reliability justify the cost for many homeowners.', source: 'The Furnace Outlet - Is Lennox a Good AC Brand?' }
          ]
        },
        high_end_comfort: {
          videos: [
            { title: 'Lennox Variable Speed Air Conditioner Review – XP25', url: 'https://www.youtube.com/watch?v=uz9nCexIagI', videoId: 'uz9nCexIagI' },
            { title: 'Lennox AC Reviews: Your Guide to the Best Options', url: 'https://www.youtube.com/watch?v=oNJ960Lp5vU', videoId: 'oNJ960Lp5vU' },
            { title: 'Lennox Two-Stage Air Conditioning Technology', url: 'https://www.youtube.com/watch?v=mvKssP2gz1g', videoId: 'mvKssP2gz1g' }
          ],
          reviews: [
            { text: "If you're a 'Rolls-Royce' buyer who values quiet, precision comfort, and doesn't mind the premium cost — Lennox is a great choice. Set 72°, stay 72°. The units are whisper-quiet, even at 118°, and the build quality still looks great after 6 Phoenix summers.", source: 'Fire & Air AZ - Lennox Variable Speed Air Conditioner Review (After Using)' },
            { text: "Lennox advertises 'the most precise comfort money can buy.' I agree. If I set 72°, my house is 72°. Not 73, not 71. Always spot on — even during an 118° Phoenix heatwave. The cabinets are still solid, and parts are readily available in Phoenix.", source: 'Fire & Air AZ - Lennox Variable Speed Air Conditioner Review (After Using)' },
            { text: 'Lennox AC reviews are largely positive and mention durability, reliability, quiet operation, and advanced features like variable-speed compressors, making them a strong fit for comfort-focused buyers.', source: 'The Furnace Outlet - Is Lennox a Good AC Brand?' }
          ]
        },
        decision: {
          videos: [
            { title: 'Lennox Elite AC Clean & Review @atlasacrepair', url: 'https://www.youtube.com/watch?v=iDxIKR5xgtY', videoId: 'iDxIKR5xgtY' },
            { title: 'A Full HVAC Install, In ONE Day (Complete Lennox System)', url: 'https://www.youtube.com/watch?v=3iXiLgYaoDE', videoId: '3iXiLgYaoDE' },
            { title: 'Lennox Central Air Conditioner - What You Should Know', url: 'https://www.youtube.com/watch?v=IV275LGcN1o', videoId: 'IV275LGcN1o' }
          ],
          reviews: [
            { text: 'Reliable for years! My last Lennox furnace lasted 30 years! This new one is very quiet and works great!', source: 'Lennox ML13KC1 Product Review (Lennox.com)' },
            { text: 'Lennox has an A+ rating with the Better Business Bureau. We recommend Lennox as a good option for most homeowners, especially if you\'re installing a new AC. The units are relatively affordable, very efficient, and many operate in near‑silent mode.', source: "Today's Homeowner - Lennox Air Conditioner Review" },
            { text: 'Lennox air conditioner reviews are largely positive and mention durability, reliability, and quiet operation, which makes them a strong choice for homeowners who want long-term performance and comfort.', source: 'Harp Home Services - Are Lennox HVAC Systems Worth It?' }
          ]
        },
        post_purchase: {
          videos: [
            { title: 'Lennox Elite AC Clean & Review @atlasacrepair', url: 'https://www.youtube.com/watch?v=iDxIKR5xgtY', videoId: 'iDxIKR5xgtY' },
            { title: 'Lennox Variable Speed Air Conditioner Review – XP25', url: 'https://www.youtube.com/watch?v=uz9nCexIagI', videoId: 'uz9nCexIagI' }
          ],
          reviews: [
            { text: 'After 6 brutal Phoenix summers, the precise comfort, whisper-quiet operation, and build quality of Lennox\'s variable-speed systems are undeniable. The cabinets still look great, and parts are readily available in Phoenix-area supply houses.', source: 'Fire & Air AZ - Lennox Variable Speed Air Conditioner Review (After Using)' },
            { text: "If I set 72°, my house is 72°. Always spot on — even during 118° heat. The proprietary thermostat and hub are the Achilles' heel; they're expensive, fragile, and required. But the comfort and efficiency more than make up for it.", source: 'Fire & Air AZ - Lennox Variable Speed Air Conditioner Review (After Using)' },
            { text: 'Lennox AC units are impressive machines for long-term ownership. The long-term energy savings, solid build quality, and quiet operation justify the premium if you plan to stay in your home for many years.', source: "Today's Homeowner - Lennox Air Conditioner Review" }
          ]
        }
      }

      const stageData = JOURNEY_MEDIA[stage]
      if (!stageData) {
        return res.json({ result: { success: false, has_media: false } })
      }

      if (type === 'videos') {
        return res.json({
          result: {
            success: true,
            has_media: true,
            youtube_references: stageData.videos.map(v => ({ ...v, thumbnail_url: `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg` }))
          }
        })
      }

      if (type === 'reviews') {
        return res.json({
          result: {
            success: true,
            has_media: true,
            show_reviews: true,
            reviews: stageData.reviews
          }
        })
      }

      return res.json({ result: { success: false, has_media: false } })
    }

    // For all other tools, validate model exists
    if (!activeModelId) {
      logWarn('[VOICE AGENT] No model selected for tool execution')
      return res.status(400).json({
        error:
          'No model selected. Please specify which Lennox model you want to know about first.',
        availableModels: getModelsInfo().map(m => m.id)
      })
    }

    if (!hasModel(activeModelId)) {
      logWarn(`[VOICE AGENT] Model not found: ${activeModelId}`)
      return res.status(404).json({
        error: `Model '${activeModelId}' not found`,
        availableModels: getModelsInfo().map(m => m.id)
      })
    }

    const modelConfig = getModelConfig(activeModelId)
    log(`[VOICE AGENT] Executing tool for ${modelConfig.name}...`)

    const allowedTools = [
      'detect_model_intent',
      'show_journey_media',
      'search_local_knowledge',
      'search_vehicle_knowledge',
      'search_vehicle_images',
      'get_ev_charging_stations',
      'get_customer_reviews',
      'get_competitor_comparison',
      'get_booking_slots',
      'validate_phone_number',
      'book_test_drive',
      'get_showroom_locations',
      'enrich_with_media',
      'show_promotional_offer',
      'show_emi_calculator',
      'show_car_configurator'
    ]

    if (!allowedTools.includes(tool_name)) {
      logWarn(`[VOICE AGENT] SECURITY: Blocked unknown tool: ${tool_name}`)
      logSecurityEvent(session_token, {
        type: 'invalid_tool',
        ip: req.ip,
        details: { tool_name, allowedTools }
      })
      return res.status(400).json({ error: 'Invalid tool' })
    }

    if (!tool_args || typeof tool_args !== 'object') {
      logWarn('[VOICE AGENT] Invalid tool arguments')
      return res.status(400).json({ error: 'Invalid tool arguments' })
    }

    log(`[VOICE AGENT] Executing tool for ${modelConfig.name}...`)

    // PostHog: Log tool execution started
    logToolExecutionStarted(session_token, {
      toolName: tool_name,
      callId: call_id,
      args: tool_args
    })

    const execStart = Date.now()

    // Execute with timeout wrapper
    let result = await executeWithTimeout(tool_name, tool_args, modelConfig)

    // Retry once on timeout
    if (result.should_retry) {
      log(`[VOICE AGENT] Retrying ${tool_name} after timeout`)
      result = await executeWithTimeout(tool_name, tool_args, modelConfig)

      if (result.should_retry) {
        // Second timeout - return fallback response
        result = {
          success: false,
          context:
            "I'm having a bit of trouble getting that information right now. Can I help you with something else, or would you like to try that question again?",
          error: 'double_timeout'
        }
      }
    }

    const execDuration = Date.now() - execStart
    const totalDuration = Date.now() - startTime

    // Process session state for nudges (non-blocking)
    try {
      const userQuery = tool_args?.query || tool_args?.user_message || ''

      // Increment exchange count
      await incrementExchangeCount(session_token)

      // Track model focus if this is a model-specific tool
      if (activeModelId && tool_name !== 'detect_model_intent') {
        await setModelFocus(session_token, activeModelId)
      }

      // Record interest signals if detected
      // Basic interest detection from keywords
      const interestKeywords = [
        'love',
        'amazing',
        'great',
        'perfect',
        'interested',
        'want',
        'need'
      ]
      if (interestKeywords.some(kw => userQuery.toLowerCase().includes(kw))) {
        await recordInterestSignal(session_token, 'interest_detected')
      }
    } catch (stateError) {
      // Non-blocking - don't fail tool execution for state tracking errors
      logError(
        '[VOICE AGENT] Session state tracking error:',
        stateError.message
      )
    }

    log(`[VOICE AGENT] Tool execution completed in ${execDuration}ms`)
    log(`[VOICE AGENT] Result success:`, result?.success)
    log(`[VOICE AGENT] Result has context:`, !!result?.context)
    log(`[VOICE AGENT] Context length:`, result?.context?.length || 0, 'chars')
    log(`[VOICE AGENT] ===== TOOL RESPONSE SENT (${totalDuration}ms) =====`)

    // PostHog: Log tool execution completed
    logToolExecutionCompleted(session_token, {
      toolName: tool_name,
      callId: call_id,
      durationMs: totalDuration,
      success: result?.success,
      resultType: tool_name,
      contextLength: result?.context?.length || 0,
      hasMedia: result?.has_media || false,
      hasImages: !!result?.images?.length,
      imagesCount: result?.images?.length || 0,
      hasVideos: !!result?.youtube_references?.length,
      videosCount: result?.youtube_references?.length || 0,
      hasReviews: result?.show_reviews || false,
      reviewsCount: result?.reviews?.length || 0,
      hasComparison: result?.has_comparison || false,
      hasPricing: result?.has_pricing || false,
      hasLocations: result?.has_locations || false,
      hasBooking: result?.has_booking || result?.has_booking_slots || false
    })

    // Log request context to session log file
    logRequestContext(session_token, {
      type: 'TOOL_EXECUTION',
      endpoint: `/byd/${activeModelId}/tools`,
      method: 'POST',
      tool_name,
      duration: totalDuration,
      status: 'success',
      details: {
        call_id,
        args: tool_args,
        result_success: result?.success,
        context_length: result?.context?.length || 0
      }
    })

    res.json({ call_id, result })
  } catch (err) {
    const duration = Date.now() - startTime
    logError(`[VOICE AGENT] ===== TOOL EXECUTION FAILED (${duration}ms) =====`)
    logError('[VOICE AGENT] Error:', err.message)
    logError('[VOICE AGENT] Stack:', err.stack)

    // PostHog: Log tool execution error
    const { tool_name, call_id, session_token } = req.body
    if (session_token) {
      logToolExecutionError(session_token, {
        toolName: tool_name,
        callId: call_id,
        durationMs: duration,
        error: err.message,
        errorStack: err.stack
      })
    }

    res.status(500).json({ error: err.message })
  }
}

// Text-based evaluation endpoint - simulates voice agent for evaluation purposes
// Uses same system prompt and tools but returns text responses via Chat Completions API
export const evaluateTextResponse = async (req, res) => {
  const startTime = Date.now()
  try {
    const {
      question,
      market = 'UAE',
      conversationHistory = [],
      model_id
    } = req.body

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' })
    }

    // Support unified evaluation (no model) or model-specific evaluation
    let modelConfig = null
    if (model_id) {
      if (!hasModel(model_id)) {
        return res.status(404).json({
          error: `Model '${model_id}' not found`,
          availableModels: getModelsInfo().map(m => m.id)
        })
      }
      modelConfig = getModelConfig(model_id)
    }

    const sessionConfig = getSessionConfig()

    // Convert voice agent tools to Chat Completions format
    const chatTools = sessionConfig.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))

    // Build messages with conversation history for multi-turn support
    const messages = [{ role: 'system', content: sessionConfig.instructions }]

    // Add conversation history if provided (for turn-by-turn evaluation)
    if (conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })
      })
    }

    // Add current user question
    messages.push({ role: 'user', content: question })

    // Call OpenAI Chat Completions with tool support
    const openaiResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages,
          tools: chatTools,
          tool_choice: 'auto',
          temperature: 0.8,
          max_tokens: 800
        })
      }
    )

    if (!openaiResponse.ok) {
      const err = await openaiResponse.text()
      console.error('[VOICE AGENT EVAL] OpenAI error:', err)
      throw new Error('Failed to call OpenAI')
    }

    const data = await openaiResponse.json()
    let response = data.choices[0]?.message
    let toolResults = []

    // Handle tool calls if any
    if (response?.tool_calls?.length > 0) {
      const toolCallMessages = [...messages, response]

      // Execute each tool call
      // eslint-disable-next-line no-unused-vars
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}')

        log(`[VOICE AGENT EVAL] Executing tool: ${toolName}`)

        const result = await executeToolCall(toolName, toolArgs, modelConfig)
        toolResults.push({
          name: toolName,
          args: toolArgs,
          result: result
        })

        // Add tool result to messages
        toolCallMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result?.context || JSON.stringify(result)
        })
      }

      // Get final response after tool execution
      const finalResponse = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: toolCallMessages,
            temperature: 0.8,
            max_tokens: 800
          })
        }
      )

      if (!finalResponse.ok) {
        const err = await finalResponse.text()
        console.error('[VOICE AGENT EVAL] OpenAI final response error:', err)
        throw new Error('Failed to get final response from OpenAI')
      }

      const finalData = await finalResponse.json()
      response = finalData.choices[0]?.message
    }

    const latencyMs = Date.now() - startTime
    const content = response?.content || ''

    log(`[VOICE AGENT EVAL] Response generated in ${latencyMs}ms`)

    res.json({
      success: true,
      response: content,
      toolsCalled: toolResults.map(t => t.name),
      toolsUsed: toolResults.map(t => t.name),
      toolResults,
      metrics: {
        latencyMs,
        model_id: model_id || 'unified',
        market,
        toolCallsCount: toolResults.length
      }
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error(`[VOICE AGENT EVAL] Error (${duration}ms):`, err.message)
    res.status(500).json({ error: err.message })
  }
}

// EMI Calculator - Get config with slider ranges
export const getEMIConfig = async (req, res) => {
  try {
    const { model_id, variant } = req.query

    if (!model_id) {
      return res.status(400).json({ error: 'model_id is required' })
    }

    console.log('[EMI_CALC] Config request:', { model_id, variant })

    const result = getEMICalculatorConfig(model_id, variant)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result)
  } catch (err) {
    console.error('[EMI_CALC] Config error:', err.message)
    res.status(500).json({ error: err.message })
  }
}

// Nudge decision endpoint - receives persona payload, returns LLM-generated nudge
export const handleNudge = async (req, res) => {
  try {
    const payload = req.body

    if (!payload || !payload.primary_persona || !payload.current_section) {
      return res.status(400).json({ should_nudge: false, reason: 'invalid_payload' })
    }

    // Model ID from payload (sent by observer) or URL param, fallback to byd-shark-6
    const modelId = payload.model_id || req.params.modelId || 'byd-shark-6'
    const sessionKey = `nudge:${req.ip}:${modelId}`

    // Load model config for vehicle context
    const modelConfig = getModelConfig(modelId)
    if (!modelConfig) {
      console.warn(`[VOICE AGENT] Nudge: model config not found for ${modelId}`)
      return res.json({ should_nudge: false, reason: 'model_not_found' })
    }

    // Fetch conversation history if session_token provided by observer
    let conversationHistory = null
    if (payload.session_token) {
      try {
        conversationHistory = await getConversationHistory(payload.session_token, 5)
      } catch (err) {
        console.warn('[VOICE AGENT] Could not fetch conversation history for nudge:', err.message)
      }
    }

    const decision = await evaluateNudge(payload, sessionKey, modelConfig, conversationHistory)

    return res.json(decision)
  } catch (err) {
    console.error('[VOICE AGENT] Nudge evaluation error:', err.message)
    return res.json({ should_nudge: false, reason: 'error' })
  }
}

// EMI Calculator - Calculate EMI based on slider inputs
export const calculateEMIHandler = async (req, res) => {
  try {
    const {
      model_id,
      variant,
      downpayment_percent = 20,
      tenure_years = 5,
      interest_rate = 5
    } = req.body

    if (!model_id) {
      return res.status(400).json({ error: 'model_id is required' })
    }

    console.log('[EMI_CALC] Calculate request:', {
      model_id,
      variant,
      downpayment_percent,
      tenure_years,
      interest_rate
    })

    const result = await calculateEMI({
      model_id,
      variant,
      downpayment_percent: Number(downpayment_percent),
      tenure_years: Number(tenure_years),
      interest_rate: Number(interest_rate)
    })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result)
  } catch (err) {
    console.error('[EMI_CALC] Calculate error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
