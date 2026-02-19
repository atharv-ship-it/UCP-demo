/**
 * Swirl AI Nudge + Voice Agent Plugin - WebRTC Dynamic Version
 * Real-time AI voice interaction with WebRTC + Simple Clean UI
 * Version: 2.0.0 - WebRTC Dynamic
 */

; (function () {
  'use strict'

  // ===================================================
  // DYNAMIC CONFIGURATION FROM MASTER DIV
  // ===================================================

  // 1. Check if master DIV exists
  const masterDiv = document.querySelector('#swirl-ai-nva')
  if (!masterDiv) {
    console.log('[Swirl AI] Master DIV #swirl-ai-nva not found. Plugin will not load.')
    return // Exit plugin if master DIV not present
  }

  // 2. Extract data attributes from master DIV
  const modelId = masterDiv.getAttribute('data-id') || '' // Optional for unified agent
  const nudgeTrigger = masterDiv.getAttribute('data-nudge-trigger') || ''
  const sendPrompt = masterDiv.getAttribute('data-send-prompt') || 'true'
  const defaultPromptText = masterDiv.getAttribute('data-default-prompt') || 'Ask Lennox AI'
  const voiceType = masterDiv.getAttribute('data-voice') || '' // 'male' or empty for female default

  // 3. NEW: Model ID is now optional - unified agent supports multi-model
  const isUnifiedAgent = !modelId
  if (isUnifiedAgent) {
    console.log('[Swirl AI] 🌟 Loading unified multi-model agent (no specific model ID)')
  } else {
    console.log('[Swirl AI] Loading single-model agent:', modelId)
  }

  // 4. Set global variables for easy access across the plugin
  window.SWIRL_CONFIG = {
    MODEL_ID: modelId || null, // null for unified agent
    NUDGE_TRIGGER: nudgeTrigger,
    ENABLE_PROMPT_AUTO_SEND: sendPrompt === 'true',
    DEFAULT_PROMPT_TEXT: defaultPromptText,
    VOICE: voiceType, // 'male' = male voice, empty = female (default)
    IS_UNIFIED: isUnifiedAgent // Flag to track unified vs single-model mode
  }

  console.log('[Swirl AI] 🚀 Dynamic configuration loaded:', window.SWIRL_CONFIG)

  // ===================================================
  // CONFIGURATION
  // ===================================================

  const LOCAL = document.querySelector('script[src="plugin/swirl-embed.js"]') ? true : false
  const BASE_URL = 'http://localhost:3000/' // Lennox UCP backend
  const TRIGGER_BASE_PATH = LOCAL ? '../triggers/' : 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/triggers/'

  const CONFIG = {
    // Lennox voice-agent routes
    sessionUrl: (() => {
      const params = new URLSearchParams()
      if (window.SWIRL_CONFIG.VOICE) params.append('voice', window.SWIRL_CONFIG.VOICE)
      if (window.SWIRL_CONFIG.MODEL_ID) params.append('model_id', window.SWIRL_CONFIG.MODEL_ID)
      const queryString = params.toString()
      return `${BASE_URL}voice-agent/session${queryString ? `?${queryString}` : ''}`
    })(),
    toolsUrl: `${BASE_URL}voice-agent/tools`,
    contextDebugUrl: `${BASE_URL}voice-agent/context-debug`,
    realtimeUrl: `${BASE_URL}voice-agent/realtime`,

    iconGifPath: 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/ai-nudge-animation.gif',

    // 🎬 Voice Agent Video States (4 states)
    voiceVideoStates: {
      default: 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/va-default-state.mp4',
      listening: 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/va-listening-state.mp4',
      thinking: 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/va-thinking-state.mp4',
      speaking: 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/va-speaking-state.mp4'
    },

    initDelay: 500,

    // 🎯 Simple Trigger System Settings (Dynamic)
    defaultPromptText: window.SWIRL_CONFIG.DEFAULT_PROMPT_TEXT,
    enablePageTriggers: !!window.SWIRL_CONFIG.NUDGE_TRIGGER, // Enable only if trigger file specified
    triggerJsUrl: window.SWIRL_CONFIG.NUDGE_TRIGGER ? `${TRIGGER_BASE_PATH}${window.SWIRL_CONFIG.NUDGE_TRIGGER}` : '',
    thinkingAnimationDuration: 400,

    // 🎯 AI Greeting Settings (Dynamic)
    enablePromptAutoSend: window.SWIRL_CONFIG.ENABLE_PROMPT_AUTO_SEND,
    defaultGreeting: "How can I help you?",

    // 🖼️ S3 Assets URL for production
    s3AssetsUrl: 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets'
  }

  // Fallback prompts in case trigger system fails to load
  const FALLBACK_PROMPTS = [
    window.SWIRL_CONFIG.DEFAULT_PROMPT_TEXT
  ]

  // Loading status filler phrases
  const FILLER_PHRASES = [
    "Let me look that up for you...",
    // "Good question, let me check...",
    "One moment while I find that information...",
    "Let me see what I can find...",
    // "Great question! Let me get those details..."
  ]

  // ===================================================
  // STATE VARIABLES
  // ===================================================

  let initialized = false
  let modalOpen = false
  let scrollPosition = 0

  // 🎯 Global persona variable (accessible by trigger JS)
  window.SWIRL_ACTIVE_PERSONA = 'PERFORMANCE'

  // Conversation turn state (for clearing old responses)
  let currentConversationTurn = 0
  let isFirstEventInTurn = true

  // YouTube Video Modal state
  let youtubePlayer = null
  let youtubeAPIReady = false
  let currentVideoData = []
  let currentVideoIndex = 0
  let videoSwiper = null
  let updateProgressInterval = null
  let isInitializingPlayer = false
  let playerInitTimeout = null

  // Image Modal state
  let currentImageData = []
  let currentImageIndex = 0
  let imageSwiper = null

  // WebRTC state
  let peerConnection = null
  let dataChannel = null
  let localStream = null
  let remoteAudioEl = null
  let isConnected = false
  let sessionConfig = null
  let sessionToken = null
  let userMutedMic = false
  let isAISpeaking = false
  let currentModelId = null // NEW: Tracks active model in unified multi-model agent
  let isListening = false
  let pendingMessageAfterCancel = null // Message to send after response cancellation
  let isAIGreeting = false // Flag to track AI greeting phase (prevents mic feedback loop)
  let pendingMediaEnrichment = null // Media from enrich_with_media tool - rendered after AI response
  let lastShownLennoxCards = [] // Track currently displayed product cards for voice selection
  let lastMentionedCard = null // Last card the AI confirmed — set when user picks one, cleared after checkout card shown
  let orderCompleted = false // Set true after payment — blocks any further product cards appearing
  let currentInputMode = 'voice' // Global state: 'voice' or 'text'
  let hasRealMicrophone = false // Flag to track if user has real mic (not silent track)

  // Test mode - enabled via ?test URL parameter for debugging
  const urlParams = new URLSearchParams(window.location.search)
  const isTestMode = urlParams.has('test')
  console.log('[Swirl AI] URL params:', window.location.search, '| isTestMode:', isTestMode)
  if (isTestMode) {
    console.log('[Swirl AI] 🧪 TEST MODE ENABLED - Session ID will be displayed for debugging')
  }

  // Interaction detection (for sliders/carousels)
  let interactionDebounce = null

  // Audio visualization
  let audioContext = null
  let analyser = null
  let animationFrameId = null

  // Remote audio analyzer (for detecting when AI stops speaking)
  let remoteAudioContext = null
  let remoteAudioAnalyser = null

  // Text streaming state
  let transcriptQueue = []
  let displayedText = ''
  let fullTranscript = ''
  let currentAssistantMessage = ''
  let syncInterval = null
  let firstTranscriptTime = null
  let audioPlayStartTime = null
  let isAudioPlaying = false

  // Sync constants
  const TEXT_DELAY_MS = 300
  const SYNC_INTERVAL_MS = 30

  // ===================================================
  // LOAD EXTERNAL LIBRARIES & CSS
  // ===================================================

  function loadPluginCSS() {
    console.log('[Swirl AI] Loading plugin CSS...')
    const pluginCSS = document.createElement('link')
    pluginCSS.rel = 'stylesheet'
    pluginCSS.href = 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/style.min.css'
    document.head.appendChild(pluginCSS)

    console.log('[Swirl AI] ✅ Plugin CSS injected')
  }

  function loadSwiperLibrary() {
    return new Promise((resolve, reject) => {
      if (typeof Swiper !== 'undefined') {
        console.log('[Swirl AI] Swiper already loaded')
        resolve()
        return
      }

      console.log('[Swirl AI] Loading Swiper library...')

      const swiperCSS = document.createElement('link')
      swiperCSS.rel = 'stylesheet'
      swiperCSS.href = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css'
      document.head.appendChild(swiperCSS)

      const swiperJS = document.createElement('script')
      swiperJS.src = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js'
      swiperJS.onload = () => {
        console.log('[Swirl AI] ✅ Swiper library loaded successfully')
        resolve()
      }
      swiperJS.onerror = () => {
        console.error('[Swirl AI] ❌ Failed to load Swiper library')
        reject(new Error('Failed to load Swiper'))
      }
      document.head.appendChild(swiperJS)
    })
  }

  function loadMarkedLibrary() {
    return new Promise((resolve, reject) => {
      if (typeof marked !== 'undefined') {
        console.log('[Swirl AI] Marked already loaded')
        resolve()
        return
      }

      console.log('[Swirl AI] Loading Marked library...')
      const markedJS = document.createElement('script')
      markedJS.src = 'https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js'
      markedJS.onload = () => {
        console.log('[Swirl AI] ✅ Marked library loaded successfully')
        resolve()
      }
      markedJS.onerror = () => {
        console.error('[Swirl AI] ❌ Failed to load Marked library')
        reject(new Error('Failed to load Marked'))
      }
      document.head.appendChild(markedJS)
    })
  }

  function loadYouTubeAPI() {
    return new Promise((resolve, reject) => {
      if (typeof YT !== 'undefined' && YT.Player) {
        console.log('[Swirl AI] YouTube API already loaded')
        youtubeAPIReady = true
        resolve()
        return
      }

      console.log('[Swirl AI] Loading YouTube IFrame API...')

      // YouTube API requires window callback
      window.onYouTubeIframeAPIReady = () => {
        console.log('[Swirl AI] ✅ YouTube API loaded successfully')
        youtubeAPIReady = true
        resolve()
      }

      const ytScript = document.createElement('script')
      ytScript.src = 'https://www.youtube.com/iframe_api'
      ytScript.onerror = () => {
        console.error('[Swirl AI] ❌ Failed to load YouTube API')
        reject(new Error('Failed to load YouTube API'))
      }
      document.head.appendChild(ytScript)
    })
  }

  // ===================================================
  // INITIALIZATION
  // ===================================================

  async function init() {
    console.log('[Swirl AI] Initializing Nudge Plugin (WebRTC Dynamic Version)...')

    if (initialized) {
      console.log('[Swirl AI] Already initialized, skipping...')
      return
    }

    // Inject plugin CSS
    loadPluginCSS()

    try {
      // Pre-load libraries
      await Promise.all([loadSwiperLibrary(), loadMarkedLibrary()])

      // Build and inject floating nudge with default prompt
      buildFloatingNudge()

      // Initialize page-specific triggers (will load prompts from trigger JS)
      if (CONFIG.enablePageTriggers) {
        await loadPageTriggers()
      }

      // Listen for nudge events from nudge-observer.js
      window.addEventListener('swirl:nudge', (e) => {
        const decision = e.detail
        if (decision?.should_nudge && decision?.message) {
          updatePrompt(decision.message)
        }
      })

      window.addEventListener('swirl:send-prompt', (e) => {
        const { prompt } = e.detail || {}
        if (prompt) {
          pendingPromptToSend = prompt
          openModal()
        }
      })

      // Show initial prompt (will show default "Ask Lennox AI")
      showPromptWithAnimation()

      // Create hidden audio element for remote audio
      remoteAudioEl = document.createElement('audio')
      remoteAudioEl.autoplay = true
      document.body.appendChild(remoteAudioEl)

      // Setup audio sync listeners
      setupAudioSyncListeners()

      // Setup viewport resize listener for modal height adjustment (mobile URL bar)
      window.addEventListener('resize', () => {
        if (modalOpen) {
          setModalDynamicHeight()
        }
      })

      // Also listen to orientationchange event on mobile
      window.addEventListener('orientationchange', () => {
        if (modalOpen) {
          setTimeout(setModalDynamicHeight, 100)
        }
      })

      initialized = true
      console.log('[Swirl AI] ✅ Nudge Plugin Initialized Successfully (WebRTC Dynamic Mode)')

      // Append Posthog script for analytics
      appendPosthogScript()
    } catch (error) {
      console.error('[Swirl AI] ❌ Initialization Error:', error)
    }
  }

  function appendPosthogScript() {
    const scriptEl = document.createElement('script');
    scriptEl.type = 'text/javascript';
    scriptEl.text = `
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
        posthog.init('phc_js7ivtV0gIdOYvGlKin9bJbVuHbT823I8kZntiBYPfU', {
            api_host: 'https://us.i.posthog.com',
            person_profiles: 'always',
            // Session Replay - Full Recording
            session_recording: {
                maskAllInputs: false,
                maskInputOptions: {
                    password: true
                },
                recordCrossOriginIframes: true,
            },
            capture_pageview: true,
            capture_pageleave: true,
            loaded: (posthogInstance) => {
                posthogInstance.register({
                    nva_model: '${window.SWIRL_CONFIG.MODEL_ID}',
                    nva_org: 'lennox',
                    nva_source: 'frontend'
                });
                // Start session recording immediately
                posthogInstance.startSessionRecording();
                window.SWIRL_POSTHOG_READY = true;
            },
        })
    `;
    document.head.appendChild(scriptEl);

    console.log('[Swirl AI] PostHog Initialized with Session Replay.')
  }

  // ===================================================
  // POSTHOG LOGGER - Unified Event Tracking
  // ===================================================

  // Session token for correlation (set when session is created)
  let posthogSessionToken = null

  // Cumulative session token usage tracking
  let sessionTokenStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalAudioInputTokens: 0,
    totalAudioOutputTokens: 0,
    totalCachedTokens: 0,
    responseCount: 0
  }

  // Reset session token stats
  const resetSessionTokenStats = () => {
    sessionTokenStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalAudioInputTokens: 0,
      totalAudioOutputTokens: 0,
      totalCachedTokens: 0,
      responseCount: 0
    }
  }

  // Update cumulative token stats
  const updateSessionTokenStats = (usage) => {
    if (!usage) return
    sessionTokenStats.totalInputTokens += usage.input_tokens || 0
    sessionTokenStats.totalOutputTokens += usage.output_tokens || 0
    sessionTokenStats.totalTokens += usage.total_tokens || 0
    sessionTokenStats.totalAudioInputTokens += usage.input_token_details?.audio_tokens || 0
    sessionTokenStats.totalAudioOutputTokens += usage.output_token_details?.audio_tokens || 0
    sessionTokenStats.totalCachedTokens += usage.input_token_details?.cached_tokens || 0
    sessionTokenStats.responseCount++
  }

  // ===================================================
  // DEBUG: DETAILED TOKEN CONTEXT LOGGER
  // Tracks exactly what's being sent to OpenAI each turn
  // ===================================================
  const DEBUG_TOKENS = true // Set to false to disable detailed logging

  // Conversation context tracker - mirrors what OpenAI sees
  const conversationContextTracker = {
    systemPromptTokens: 0, // Estimated from session config
    toolDefinitionsTokens: 0, // Estimated from tools array
    systemPrompt: '', // Store actual system prompt for logging
    turns: [], // Array of { role, content, tokens, timestamp }

    reset() {
      this.turns = []
      this.systemPrompt = ''
      console.log('[TOKEN DEBUG] 🔄 Conversation context reset')
    },

    // Rough token estimation (~4 chars per token for English)
    estimateTokens(text) {
      if (!text) return 0
      const str = typeof text === 'string' ? text : JSON.stringify(text)
      return Math.ceil(str.length / 4)
    },

    addTurn(role, content, type = 'message') {
      const tokens = this.estimateTokens(content)
      const turn = {
        index: this.turns.length,
        role,
        type,
        tokens,
        content: content, // Store FULL content for detailed logging
        contentPreview: typeof content === 'string'
          ? content.substring(0, 100) + (content.length > 100 ? '...' : '')
          : JSON.stringify(content).substring(0, 100) + '...',
        contentLength: typeof content === 'string' ? content.length : JSON.stringify(content).length,
        timestamp: new Date().toISOString()
      }
      this.turns.push(turn)

      if (DEBUG_TOKENS) {
        console.log(`[TOKEN DEBUG] ➕ Turn ${turn.index} added:`, {
          role,
          type,
          tokens,
          contentLength: turn.contentLength
        })
      }

      return turn
    },

    getTotalContextTokens() {
      const turnsTokens = this.turns.reduce((sum, t) => sum + t.tokens, 0)
      return this.systemPromptTokens + this.toolDefinitionsTokens + turnsTokens
    },

    printContextBreakdown() {
      console.log('\n' + '═'.repeat(70))
      console.log('📊 CONVERSATION CONTEXT BREAKDOWN')
      console.log('═'.repeat(70))
      console.log(`System Prompt:     ~${this.systemPromptTokens.toLocaleString()} tokens`)
      console.log(`Tool Definitions:  ~${this.toolDefinitionsTokens.toLocaleString()} tokens`)
      console.log('─'.repeat(70))

      let runningTotal = this.systemPromptTokens + this.toolDefinitionsTokens
      this.turns.forEach((turn, i) => {
        runningTotal += turn.tokens
        const roleIcon = turn.role === 'user' ? '👤' : turn.role === 'assistant' ? '🤖' : '🔧'
        console.log(`Turn ${i}: ${roleIcon} ${turn.role.padEnd(12)} | ${turn.type.padEnd(15)} | ~${turn.tokens.toString().padStart(5)} tokens | Running: ${runningTotal.toLocaleString()}`)
        if (turn.type === 'tool_result') {
          console.log(`         └─ Content length: ${turn.contentLength.toLocaleString()} chars`)
        }
      })

      console.log('─'.repeat(70))
      console.log(`ESTIMATED TOTAL: ~${this.getTotalContextTokens().toLocaleString()} tokens`)
      console.log('═'.repeat(70) + '\n')
    },

    // Print FULL context as OpenAI sees it (for deep debugging)
    printFullContext() {
      console.log('\n' + '█'.repeat(80))
      console.log('📜 FULL CONVERSATION CONTEXT (What OpenAI Sees at This Turn)')
      console.log('█'.repeat(80))

      // System prompt (truncated for readability)
      console.log('\n┌─ SYSTEM PROMPT ─────────────────────────────────────────────────────────────')
      console.log(`│ Length: ${this.systemPrompt.length.toLocaleString()} chars (~${this.systemPromptTokens.toLocaleString()} tokens)`)
      if (this.systemPrompt) {
        console.log('│ Content (first 500 chars):')
        const promptLines = this.systemPrompt.substring(0, 500).split('\n')
        promptLines.forEach(line => console.log('│ ' + line))
        if (this.systemPrompt.length > 500) console.log('│ ... [truncated]')
      }
      console.log('└──────────────────────────────────────────────────────────────────────────────\n')

      // Each turn with full content
      this.turns.forEach((turn, i) => {
        const roleIcon = turn.role === 'user' ? '👤 USER' : turn.role === 'assistant' ? '🤖 ASSISTANT' : '🔧 TOOL RESULT'

        console.log(`┌─ TURN ${i}: ${roleIcon} ─────────────────────────────────────────────────────`)
        console.log(`│ Type: ${turn.type}`)
        console.log(`│ Tokens: ~${turn.tokens.toLocaleString()} | Chars: ${turn.contentLength.toLocaleString()}`)
        console.log(`│ Time: ${turn.timestamp}`)
        console.log('│')
        console.log('│ CONTENT:')

        // Print full content (with reasonable limit)
        const content = typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content, null, 2)
        const maxChars = turn.type === 'tool_result' ? 3000 : 1000 // More for tool results
        const lines = content.substring(0, maxChars).split('\n')
        lines.forEach(line => console.log('│ ' + line))
        if (content.length > maxChars) {
          console.log(`│`)
          console.log(`│ ... [${(content.length - maxChars).toLocaleString()} more chars truncated]`)
        }
        console.log('└──────────────────────────────────────────────────────────────────────────────\n')
      })

      // Summary
      const totalTokens = this.getTotalContextTokens()
      console.log('█'.repeat(80))
      console.log(`📊 TOTAL CONTEXT SIZE: ~${totalTokens.toLocaleString()} tokens`)
      console.log(`   ├─ System Prompt: ~${this.systemPromptTokens.toLocaleString()} tokens`)
      console.log(`   ├─ Tool Definitions: ~${this.toolDefinitionsTokens.toLocaleString()} tokens`)
      console.log(`   └─ Conversation Turns: ~${this.turns.reduce((s, t) => s + t.tokens, 0).toLocaleString()} tokens (${this.turns.length} turns)`)
      console.log('█'.repeat(80) + '\n')
    },

    // Get data for sending to backend
    getContextData() {
      return {
        systemPrompt: this.systemPrompt,
        systemPromptTokens: this.systemPromptTokens,
        toolDefinitionsTokens: this.toolDefinitionsTokens,
        turns: this.turns.map(t => ({
          role: t.role,
          type: t.type,
          tokens: t.tokens,
          content: t.content,
          contentLength: t.contentLength,
          timestamp: t.timestamp
        })),
        totalTokens: this.getTotalContextTokens()
      }
    }
  }

  // Send context debug data to backend for file logging
  const sendContextToBackend = async (turnNumber, openaiUsage) => {
    if (!DEBUG_TOKENS || !sessionToken) return

    try {
      const contextData = conversationContextTracker.getContextData()
      contextData.openaiUsage = openaiUsage

      const response = await fetch(CONFIG.contextDebugUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: sessionToken,
          turn_number: turnNumber,
          context_data: contextData
        })
      })

      if (response.ok) {
        const result = await response.json()
        console.log(`[TOKEN DEBUG] 📁 Context logged to file: ${result.log_file}`)
      } else {
        console.warn('[TOKEN DEBUG] Failed to log context to backend:', response.status)
      }
    } catch (err) {
      console.warn('[TOKEN DEBUG] Error sending context to backend:', err.message)
    }
  }

  // Log what's being sent to OpenAI via data channel
  const logDataChannelMessage = (payload, direction = 'SEND') => {
    if (!DEBUG_TOKENS) return

    const msg = typeof payload === 'string' ? JSON.parse(payload) : payload
    const tokens = conversationContextTracker.estimateTokens(payload)

    console.log(`[TOKEN DEBUG] ${direction === 'SEND' ? '📤' : '📥'} DataChannel ${direction}:`, {
      type: msg.type,
      estimatedTokens: tokens,
      ...(msg.item?.type && { itemType: msg.item.type }),
      ...(msg.item?.call_id && { callId: msg.item.call_id })
    })

    // Track tool results being sent to OpenAI
    if (msg.type === 'conversation.item.create' && msg.item?.type === 'function_call_output') {
      const output = msg.item.output
      const outputSize = output ? output.length : 0
      conversationContextTracker.addTurn('tool', output, 'tool_result')

      // Parse and show what's in the tool result
      try {
        const parsed = JSON.parse(output)
        console.log('[TOKEN DEBUG] 🔧 Tool result breakdown:', {
          success: parsed.success,
          contextLength: parsed.context?.length || 0,
          hasImages: !!parsed.images?.length,
          imagesCount: parsed.images?.length || 0,
          hasVideos: !!parsed.youtube_references?.length,
          videosCount: parsed.youtube_references?.length || 0,
          hasReviews: !!parsed.reviews?.length,
          reviewsCount: parsed.reviews?.length || 0,
          hasCards: !!parsed.cards?.length,
          totalOutputBytes: outputSize
        })
      } catch (e) {
        // Not JSON, just log size
      }
    }
  }

  // ===================================================
  // TOKEN OPTIMIZATION: Strip media data before sending to OpenAI
  // Since media is displayed in UI, we don't need to send full data to AI
  // Set to true to enable token savings (can reduce ~50-70% of tool result tokens)
  // ===================================================
  const OPTIMIZE_TOOL_TOKENS = false // Set to true to enable token optimization

  const optimizeToolResultForAI = (result) => {
    if (!OPTIMIZE_TOOL_TOKENS) return result

    // Create a copy to avoid mutating original
    const optimized = { ...result }

    // Strip images - just tell AI how many were shown
    if (optimized.images?.length > 0) {
      const count = optimized.images.length
      optimized.images_shown = count
      optimized.images = undefined // Remove full image data
      console.log(`[TOKEN OPT] Stripped ${count} images from tool result`)
    }

    // Strip youtube references - just tell AI how many videos
    if (optimized.youtube_references?.length > 0) {
      const count = optimized.youtube_references.length
      const titles = optimized.youtube_references.map(v => v.title || 'Video').slice(0, 2)
      optimized.videos_shown = count
      optimized.video_titles = titles // Keep just titles for context
      optimized.youtube_references = undefined
      console.log(`[TOKEN OPT] Stripped ${count} videos from tool result`)
    }

    // Strip reviews - just tell AI review count and summary
    if (optimized.reviews?.length > 0) {
      const count = optimized.reviews.length
      optimized.reviews_shown = count
      optimized.reviews = undefined
      console.log(`[TOKEN OPT] Stripped ${count} reviews from tool result`)
    }

    // Strip comparison cards - AI doesn't need the full data
    if (optimized.comparison_cards?.length > 0) {
      const count = optimized.comparison_cards.length
      const vehicles = optimized.comparison_cards.map(c => c.vehicle_name || c.name).slice(0, 3)
      optimized.comparison_count = count
      optimized.compared_vehicles = vehicles
      optimized.comparison_cards = undefined
      console.log(`[TOKEN OPT] Stripped ${count} comparison cards from tool result`)
    }

    // Strip booking slots - AI doesn't need full slot details
    if (optimized.booking_slots?.length > 0) {
      const count = optimized.booking_slots.length
      optimized.slots_shown = count
      optimized.booking_slots = undefined
      console.log(`[TOKEN OPT] Stripped ${count} booking slots from tool result`)
    }

    // Strip locations - keep just names for context
    if (optimized.locations?.length > 0) {
      const count = optimized.locations.length
      const names = optimized.locations.map(l => l.name || l.title).slice(0, 3)
      optimized.locations_shown = count
      optimized.location_names = names
      optimized.locations = undefined
      console.log(`[TOKEN OPT] Stripped ${count} locations from tool result`)
    }

    // Strip configurator_data - AI doesn't need image URLs
    if (optimized.configurator_data) {
      const colorsCount = optimized.configurator_data.colors?.length || 0
      const interiorsCount = optimized.configurator_data.interiors?.length || 0
      optimized.configurator_shown = true
      optimized.colors_available = colorsCount
      optimized.interiors_available = interiorsCount
      optimized.configurator_data = undefined
      console.log(`[TOKEN OPT] Stripped configurator data (${colorsCount} colors, ${interiorsCount} interiors)`)
    }

    // Strip EMI calculator data
    if (optimized.emi_calculator) {
      optimized.emi_shown = true
      optimized.emi_calculator = undefined
      console.log(`[TOKEN OPT] Stripped EMI calculator data`)
    }

    return optimized
  }

  // PostHog session replay URL (captured when session starts)
  let posthogReplayUrl = null

  // Set session token for PostHog correlation
  const setPosthogSessionToken = (token) => {
    posthogSessionToken = token
    posthogReplayUrl = null // Reset replay URL for new session
    resetSessionTokenStats() // Reset stats for new session
    if (window.posthog && token) {
      // Identify user by session token for correlation with backend
      window.posthog.identify(token)
      window.posthog.register({ nva_session_token: token })

      // Capture the session replay URL for debugging
      try {
        posthogReplayUrl = window.posthog.get_session_replay_url({ withTimestamp: true })
        console.log('[PostHog] 🎥 Session Replay URL:', posthogReplayUrl)
      } catch (err) {
        console.warn('[PostHog] Could not get replay URL:', err.message)
      }

      console.log('[PostHog] Session token set for correlation:', token.substring(0, 8) + '...')
    }
  }

  // Core logging function
  const logEvent = (eventName, properties = {}) => {
    if (!window.posthog) {
      console.warn('[PostHog] Not initialized, skipping event:', eventName)
      return
    }

    const eventData = {
      ...properties,
      nva_session_token: posthogSessionToken,
      // Include cumulative token stats for debugging
      session_total_tokens: sessionTokenStats.totalTokens,
      session_response_count: sessionTokenStats.responseCount,
      nva_model: window.SWIRL_CONFIG?.MODEL_ID,
      nva_source: 'frontend',
      timestamp: new Date().toISOString()
    }

    window.posthog.capture(eventName, eventData)
    console.log(`[PostHog] ${eventName}:`, JSON.stringify(properties).substring(0, 200))
  }

  // Session Events
  const logSessionStarted = (data) => {
    logEvent('session_started', {
      model_id: data.modelId,
      model_name: data.modelName,
      replay_url: posthogReplayUrl,
      posthog_session_id: window.posthog?.get_session_id?.() || null
    })
  }

  const logSessionError = (data) => {
    logEvent('session_error', {
      error: data.error,
      stage: data.stage
    })
  }

  const logSessionEnded = (data) => {
    logEvent('session_ended', {
      duration_ms: data.durationMs,
      total_turns: data.totalTurns
    })
  }

  // WebRTC Events
  const logWebRTCConnecting = () => {
    logEvent('webrtc_connecting', {})
  }

  const logWebRTCConnected = (data) => {
    logEvent('webrtc_connected', {
      latency_ms: data.latencyMs
    })
  }

  const logWebRTCDisconnected = (data) => {
    logEvent('webrtc_disconnected', {
      reason: data.reason,
      duration_ms: data.durationMs
    })
  }

  const logWebRTCError = (data) => {
    logEvent('webrtc_error', {
      error: data.error,
      ice_state: data.iceState
    })
  }

  // Audio Events
  const logMicPermissionGranted = () => {
    logEvent('mic_permission_granted', {})
  }

  const logMicPermissionDenied = () => {
    logEvent('mic_permission_denied', {})
  }

  const logMicMuted = (data) => {
    logEvent('mic_muted', {
      by: data.by // 'user' or 'system'
    })
  }

  const logMicUnmuted = () => {
    logEvent('mic_unmuted', {})
  }

  // Conversation Events
  const logUserSpeechStarted = (data) => {
    logEvent('user_speech_started', {
      turn_number: data.turnNumber
    })
  }

  const logUserSpeechStopped = (data) => {
    logEvent('user_speech_stopped', {
      duration_ms: data.durationMs,
      turn_number: data.turnNumber
    })
  }

  const logUserTranscript = (data) => {
    logEvent('user_transcript', {
      text: data.text,
      turn_number: data.turnNumber
    })
  }

  const logAIResponseStarted = (data) => {
    logEvent('ai_response_started', {
      turn_number: data.turnNumber
    })
  }

  const logAIResponseText = (data) => {
    logEvent('ai_response_text', {
      text: data.text,
      turn_number: data.turnNumber
    })
  }

  const logAIResponseCompleted = (data) => {
    logEvent('ai_response_completed', {
      duration_ms: data.durationMs,
      turn_number: data.turnNumber,
      // Token usage from response.done
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      total_tokens: data.totalTokens,
      // Detailed token breakdown
      input_text_tokens: data.inputTextTokens,
      input_audio_tokens: data.inputAudioTokens,
      input_cached_tokens: data.inputCachedTokens,
      output_text_tokens: data.outputTextTokens,
      output_audio_tokens: data.outputAudioTokens
    })
  }

  // Token Usage Event - detailed tracking
  const logTokenUsage = (data) => {
    logEvent('tokens_used', {
      turn_number: data.turnNumber,
      context: data.context || 'response',
      // Summary
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      total_tokens: data.totalTokens,
      // Input breakdown
      input_text_tokens: data.inputTextTokens,
      input_audio_tokens: data.inputAudioTokens,
      input_cached_tokens: data.inputCachedTokens,
      // Output breakdown
      output_text_tokens: data.outputTextTokens,
      output_audio_tokens: data.outputAudioTokens
    })
  }

  const logAIInterrupted = (data) => {
    logEvent('ai_interrupted', {
      reason: data.reason,
      turn_number: data.turnNumber
    })
  }

  // Tool Events
  const logToolCallRequested = (data) => {
    logEvent('tool_call_requested', {
      tool_name: data.toolName,
      args: data.args,
      call_id: data.callId
    })
  }

  const logToolCallCompleted = (data) => {
    logEvent('tool_call_completed', {
      tool_name: data.toolName,
      duration_ms: data.durationMs,
      success: data.success,
      call_id: data.callId
    })
  }

  const logToolCallError = (data) => {
    logEvent('tool_call_error', {
      tool_name: data.toolName,
      error: data.error,
      call_id: data.callId
    })
  }

  // Debug/Error Events - for extensive debugging
  const logDebugError = (data) => {
    logEvent('debug_error', {
      category: data.category, // 'webrtc', 'api', 'audio', 'tool', 'session'
      error: data.error,
      error_stack: data.errorStack,
      context: data.context,
      turn_number: data.turnNumber,
      // Include full session stats for debugging
      session_stats: { ...sessionTokenStats }
    })
  }

  const logDebugWarning = (data) => {
    logEvent('debug_warning', {
      category: data.category,
      message: data.message,
      context: data.context
    })
  }

  const logRateLimitHit = (data) => {
    logEvent('rate_limit_hit', {
      endpoint: data.endpoint,
      retry_after: data.retryAfter,
      context: data.context
    })
  }

  const logOpenAIError = (data) => {
    logEvent('openai_error', {
      error_type: data.errorType,
      error_code: data.errorCode,
      error_message: data.errorMessage,
      turn_number: data.turnNumber,
      session_stats: { ...sessionTokenStats }
    })
  }

  // UI Events
  const logModalOpened = (data) => {
    logEvent('modal_opened', {
      trigger: data.trigger // 'nudge' or 'prompt'
    })
  }

  const logModalClosed = (data) => {
    logEvent('modal_closed', {
      duration_ms: data.durationMs,
      turns_count: data.turnsCount
    })
  }

  const logMediaDisplayed = (data) => {
    logEvent('media_displayed', {
      type: data.type, // 'images', 'videos', 'reviews'
      count: data.count
    })
  }

  const logMediaInteracted = (data) => {
    logEvent('media_interacted', {
      type: data.type,
      action: data.action // 'view', 'click', 'swipe'
    })
  }

  const logBookingSlotSelected = (data) => {
    logEvent('booking_slot_selected', {
      date: data.date,
      time: data.time
    })
  }

  const logLocationSelected = (data) => {
    logEvent('location_selected', {
      location_name: data.locationName
    })
  }

  // Error Events
  const logFrontendError = (data) => {
    logEvent('frontend_error', {
      category: data.category,
      message: data.message,
      stack: data.stack
    })
  }

  // ===================================================
  // TRIGGER UTILITIES (EMBEDDED)
  // ===================================================

  /**
   * Throttle utility - limits function calls to once per interval
   */
  window.SWIRL_THROTTLE = function (func, limit) {
    let inThrottle
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args)
        inThrottle = true
        setTimeout(() => inThrottle = false, limit)
      }
    }
  }

  /**
   * Debounce utility - delays function call until after wait time
   */
  window.SWIRL_DEBOUNCE = function (func, delay) {
    let timeoutId
    return function (...args) {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => func.apply(this, args), delay)
    }
  }

  // ===================================================
  // PAGE-SPECIFIC TRIGGER SYSTEM
  // ===================================================

  /**
   * Load trigger file via script injection
   * Static URL from CONFIG.triggerJsUrl
   */
  async function loadPageTriggers() {
    try {
      // Inject trigger JS file
      const script = document.createElement('script')
      script.src = CONFIG.triggerJsUrl
      script.async = true

      script.onload = () => {
        console.log('[Swirl AI] ✅ Triggers loaded')

        // Initialize triggers (trigger JS will call window.SWIRL_INIT_TRIGGERS)
        if (window.SWIRL_INIT_TRIGGERS) {
          window.SWIRL_INIT_TRIGGERS({
            updatePrompt: updatePrompt
          })
        }
      }

      script.onerror = () => {
        console.log('[Swirl AI] ℹ️ Failed to load triggers')
      }

      document.head.appendChild(script)
    } catch (error) {
      console.log('[Swirl AI] ℹ️ Error loading triggers:', error.message)
    }
  }

  /**
   * Update prompt bubble
   * @param {string|null} promptText - Prompt text to show, or null to show default
   */
  function updatePrompt(promptText) {
    const promptTextEl = document.getElementById('swirl-ai-prompt-text')
    const promptBubble = document.getElementById('swirl-ai-prompt-bubble')
    const promptContent = document.getElementById('swirl-ai-prompt-content')

    if (!promptTextEl || !promptBubble || !promptContent) return

    // Don't update if modal is open
    if (modalOpen) return

    // Use default text if promptText is null/undefined/empty
    const textToShow = promptText || CONFIG.defaultPromptText

    // Add thinking state
    promptBubble.classList.remove('visible')
    promptBubble.classList.add('thinking')

    // Update prompt text after thinking animation
    setTimeout(() => {
      promptTextEl.innerHTML = textToShow

      // Update multiline classes
      const isMultiline = textToShow.length > 30
      if (isMultiline) {
        promptContent.classList.add('multiline')
        promptBubble.classList.add('multiline')
        promptTextEl.classList.add('multiline')
      } else {
        promptContent.classList.remove('multiline')
        promptBubble.classList.remove('multiline')
        promptTextEl.classList.remove('multiline')
      }

      // Show with animation
      promptBubble.classList.remove('thinking')
      promptBubble.classList.add('visible')

      console.log('[Swirl AI] 💬 Prompt updated:', textToShow)
    }, CONFIG.thinkingAnimationDuration)
  }

  /**
   * Show initial prompt with animation (called on init)
   */
  function showPromptWithAnimation() {
    setTimeout(() => {
      updatePrompt(null) // null = show default text
    }, 100)
  }

  // ===================================================
  // UI CONSTRUCTION
  // ===================================================

  function buildFloatingNudge() {
    const container = document.createElement('div')
    container.className = 'swirl-ai-prompt-container'
    container.setAttribute('role', 'button')
    container.setAttribute('tabindex', '0')
    container.setAttribute('aria-label', 'Ask Lennox AI')

    container.innerHTML = `
      <!-- AI Icon Group with blur effect -->
      <div class="swirl-ai-prompt-icon-group">
        <div class="swirl-ai-prompt-icon-blur"></div>
        <div class="swirl-ai-prompt-icon">
          <img src="${CONFIG.iconGifPath}" alt="Lennox AI" />
        </div>
      </div>

      <!-- Prompt Bubble (overlaps icon) -->
      <div class="swirl-ai-prompt-bubble" id="swirl-ai-prompt-bubble">
        <div class="swirl-ai-prompt-content" id="swirl-ai-prompt-content">
          <span class="swirl-ai-prompt-text" id="swirl-ai-prompt-text">${CONFIG.defaultPromptText}</span>
          <div class="swirl-ai-prompt-arrow">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 4L12 20M12 4L5 11M12 4L19 11" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(container)

    // Event listeners for opening the modal
    container.addEventListener('click', handlePromptClickWithAutoSend)
    container.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handlePromptClickWithAutoSend()
      }
    })

    console.log('[Swirl AI] ✅ Floating nudge injected')
  }

  function buildVoiceAgentModal() {
    const modal = document.createElement('div')
    modal.className = 'swirl-ai-voice-modal'
    modal.id = 'swirl-ai-voice-modal'

    modal.innerHTML = `
      <!-- Modal Header -->
      <div class="swirl-ai-voice-header">
        <!-- Menu Button (Left) -->
        <button class="swirl-ai-voice-menu-btn" aria-label="Menu" style="opacity: 0 !important;">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M2 4.5H16M2 9H16M2 13.5H16" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <!-- Title (Center) -->
        <h1 class="swirl-ai-voice-title">Lennox AI</h1>

        <!-- Close/Down Button (Right) -->
        <button class="swirl-ai-voice-close-btn" id="swirl-ai-close-btn" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M19 9L12 16L5 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- Test Mode Banner (only visible when ?test= in URL) -->
      ${isTestMode ? `
      <div class="swirl-ai-test-banner" id="swirl-ai-test-banner">
        <span class="swirl-ai-test-label">TEST</span>
        <input type="text" class="swirl-ai-test-input" id="swirl-ai-test-input" placeholder="Custom session ID (optional)" />
      </div>
      ` : ''}

      <!-- Content Area (Chat Messages) -->
      <div class="swirl-ai-voice-content">
        <!-- Centered AI Icon (initially visible) -->
        <div class="swirl-ai-voice-icon-container" id="swirl-ai-voice-icon-container">
          <video
            id="swirl-ai-voice-video"
            class="swirl-ai-voice-icon-gif"
            autoplay
            loop
            muted
            playsinline
            alt="Lennox AI">
            <source src="${CONFIG.voiceVideoStates.default}" type="video/mp4">
          </video>
          <div class="swirl-ai-status-message" style="display: none;"></div>
        </div>

        <!-- Chat Messages Container -->
        <div class="swirl-ai-chat-messages" id="swirl-ai-chat-messages">
          <!-- Loading Overlay - Permanent, hidden by default -->
          <div class="swirl-ai-loading-overlay" id="swirl-ai-loading-overlay" style="display: none;">
            <div class="swirl-ai-loading-content">
              <svg class="swirl-ai-loading-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.66667 1.625C9.56413 1.625 10.2917 0.89746 10.2917 0H11.0417C11.0417 0.89746 11.7692 1.625 12.6667 1.625V2.375C11.7692 2.375 11.0417 3.10254 11.0417 4H10.2917C10.2917 3.10254 9.56413 2.375 8.66667 2.375V1.625ZM0 6C2.20914 6 4 4.20914 4 2H5.33333C5.33333 4.20914 7.1242 6 9.33333 6V7.33333C7.1242 7.33333 5.33333 9.1242 5.33333 11.3333H4C4 9.1242 2.20914 7.33333 0 7.33333V6ZM2.58401 6.66667C3.45811 7.15173 4.18162 7.8752 4.66667 8.74933C5.15171 7.8752 5.87522 7.15173 6.74933 6.66667C5.87522 6.1816 5.15171 5.45813 4.66667 4.58401C4.18162 5.45813 3.45811 6.1816 2.58401 6.66667ZM10.8333 8C10.8333 9.1966 9.86327 10.1667 8.66667 10.1667V11.1667C9.86327 11.1667 10.8333 12.1367 10.8333 13.3333H11.8333C11.8333 12.1367 12.8034 11.1667 14 11.1667V10.1667C12.8034 10.1667 11.8333 9.1966 11.8333 8H10.8333Z" fill="#D9D9D9"/>
                <path d="M8.66667 1.625C9.56413 1.625 10.2917 0.89746 10.2917 0H11.0417C11.0417 0.89746 11.7692 1.625 12.6667 1.625V2.375C11.7692 2.375 11.0417 3.10254 11.0417 4H10.2917C10.2917 3.10254 9.56413 2.375 8.66667 2.375V1.625ZM0 6C2.20914 6 4 4.20914 4 2H5.33333C5.33333 4.20914 7.1242 6 9.33333 6V7.33333C7.1242 7.33333 5.33333 9.1242 5.33333 11.3333H4C4 9.1242 2.20914 7.33333 0 7.33333V6ZM2.58401 6.66667C3.45811 7.15173 4.18162 7.8752 4.66667 8.74933C5.15171 7.8752 5.87522 7.15173 6.74933 6.66667C5.87522 6.1816 5.15171 5.45813 4.66667 4.58401C4.18162 5.45813 3.45811 6.1816 2.58401 6.66667ZM10.8333 8C10.8333 9.1966 9.86327 10.1667 8.66667 10.1667V11.1667C9.86327 11.1667 10.8333 12.1367 10.8333 13.3333H11.8333C11.8333 12.1367 12.8034 11.1667 14 11.1667V10.1667C12.8034 10.1667 11.8333 9.1966 11.8333 8H10.8333Z" fill="url(#paint0_linear_14299_21689)"/>
                <path d="M8.66667 1.625C9.56413 1.625 10.2917 0.89746 10.2917 0H11.0417C11.0417 0.89746 11.7692 1.625 12.6667 1.625V2.375C11.7692 2.375 11.0417 3.10254 11.0417 4H10.2917C10.2917 3.10254 9.56413 2.375 8.66667 2.375V1.625ZM0 6C2.20914 6 4 4.20914 4 2H5.33333C5.33333 4.20914 7.1242 6 9.33333 6V7.33333C7.1242 7.33333 5.33333 9.1242 5.33333 11.3333H4C4 9.1242 2.20914 7.33333 0 7.33333V6ZM2.58401 6.66667C3.45811 7.15173 4.18162 7.8752 4.66667 8.74933C5.15171 7.8752 5.87522 7.15173 6.74933 6.66667C5.87522 6.1816 5.15171 5.45813 4.66667 4.58401C4.18162 5.45813 3.45811 6.1816 2.58401 6.66667ZM10.8333 8C10.8333 9.1966 9.86327 10.1667 8.66667 10.1667V11.1667C9.86327 11.1667 10.8333 12.1367 10.8333 13.3333H11.8333C11.8333 12.1367 12.8034 11.1667 14 11.1667V10.1667C12.8034 10.1667 11.8333 9.1966 11.8333 8H10.8333Z" fill="url(#paint1_linear_14299_21689)"/>
                <path d="M8.66667 1.625C9.56413 1.625 10.2917 0.89746 10.2917 0H11.0417C11.0417 0.89746 11.7692 1.625 12.6667 1.625V2.375C11.7692 2.375 11.0417 3.10254 11.0417 4H10.2917C10.2917 3.10254 9.56413 2.375 8.66667 2.375V1.625ZM0 6C2.20914 6 4 4.20914 4 2H5.33333C5.33333 4.20914 7.1242 6 9.33333 6V7.33333C7.1242 7.33333 5.33333 9.1242 5.33333 11.3333H4C4 9.1242 2.20914 7.33333 0 7.33333V6ZM2.58401 6.66667C3.45811 7.15173 4.18162 7.8752 4.66667 8.74933C5.15171 7.8752 5.87522 7.15173 6.74933 6.66667C5.87522 6.1816 5.15171 5.45813 4.66667 4.58401C4.18162 5.45813 3.45811 6.1816 2.58401 6.66667ZM10.8333 8C10.8333 9.1966 9.86327 10.1667 8.66667 10.1667V11.1667C9.86327 11.1667 10.8333 12.1367 10.8333 13.3333H11.8333C11.8333 12.1367 12.8034 11.1667 14 11.1667V10.1667C12.8034 10.1667 11.8333 9.1966 11.8333 8H10.8333Z" fill="url(#paint2_linear_14299_21689)"/>
                <defs>
                <linearGradient id="paint0_linear_14299_21689" x1="7" y1="0" x2="7" y2="13.3333" gradientUnits="userSpaceOnUse">
                <stop stop-color="#2496DB"/>
                <stop offset="1" stop-color="#0FC6F9"/>
                </linearGradient>
                <linearGradient id="paint1_linear_14299_21689" x1="7" y1="0" x2="7" y2="13.3333" gradientUnits="userSpaceOnUse">
                <stop stop-color="#75DDF9"/>
                <stop offset="1" stop-color="#A170EC"/>
                </linearGradient>
                <linearGradient id="paint2_linear_14299_21689" x1="7" y1="0" x2="7" y2="13.3333" gradientUnits="userSpaceOnUse">
                <stop stop-color="#75DDF9"/>
                <stop offset="1" stop-color="#537CE3"/>
                </linearGradient>
                </defs>
              </svg>
              <p class="swirl-ai-loading-text" id="swirl-ai-loading-text"></p>
            </div>
          </div>
          <!-- AI responses will be added here -->
        </div>
      </div>

      <!-- Footer Container (User Prompt Text + Controls) -->
      <div class="swirl-ai-voice-footer-container">
        <!-- User Prompt Text (Toast Box Above Footer) - Only shows user's mic input -->
        <div class="swirl-ai-user-prompt-text" id="swirl-ai-user-prompt-text" style="display: none;"></div>

        <!-- Footer Controls (Message Icon + Voice Input + Mic Button) -->
        <div class="swirl-ai-voice-footer">
          <!-- Message Icon Button (Left) -->
          <button class="swirl-ai-voice-message-btn" aria-label="Type message" id="swirl-ai-message-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Voice Input Container (Soundwave bars + Mic button together) -->
          <div class="swirl-ai-voice-input-container" id="swirl-ai-voice-input-container">
            <!-- Soundwave Bars (Animated during recording) -->
            <div class="swirl-ai-voice-soundwave-bars" id="swirl-ai-soundwave-bars">
              <div class="swirl-ai-voice-bar"></div>
              <div class="swirl-ai-voice-bar"></div>
              <div class="swirl-ai-voice-bar"></div>
              <div class="swirl-ai-voice-bar"></div>
              <div class="swirl-ai-voice-bar"></div>
            </div>

            <!-- Wave Animation (Visible ONLY when user is speaking - recognizing mode) -->
            <div class="swirl-ai-voice-wave-animation" id="swirl-ai-wave-animation" style="display: none;">
              <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/wave-animation.png" alt="Voice wave" />
            </div>

            <!-- Microphone Button -->
            <button class="swirl-ai-voice-mic-btn" id="swirl-ai-mic-btn" aria-label="Toggle microphone">
              <!-- Unmuted Icon (default) -->
              <svg class="swirl-ai-mic-icon-unmuted" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C10.34 2 9 3.34 9 5V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V5C15 3.34 13.66 2 12 2Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M19 10V12C19 15.866 15.866 19 12 19C8.13401 19 5 15.866 5 12V10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 19V23" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 23H16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <!-- Muted Icon (with slash) -->
              <svg class="swirl-ai-mic-icon-muted" width="24" height="24" viewBox="0 0 24 24" fill="none" style="display: none;">
                <path d="M12 2C10.34 2 9 3.34 9 5V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V5C15 3.34 13.66 2 12 2Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M19 10V12C19 15.866 15.866 19 12 19C8.13401 19 5 15.866 5 12V10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 19V23" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 23H16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <!-- Diagonal slash line -->
                <line x1="3" y1="3" x2="21" y2="21" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- Text Input Container (Hidden by default, shown in text mode) -->
          <div class="swirl-ai-text-input-container" id="swirl-ai-text-input-container" style="display: none;">
            <input
              type="text"
              class="swirl-ai-text-input"
              id="swirl-ai-text-input"
              placeholder="Have questions? Ask here! 🤔"
              aria-label="Type message"
            />
            <button class="swirl-ai-text-send-btn" id="swirl-ai-text-send-btn" aria-label="Send message">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M18.3333 1.66667L9.16667 10.8333" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M18.3333 1.66667L12.5 18.3333L9.16667 10.8333L1.66667 7.5L18.3333 1.66667Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- Voice Toggle Button (Right side of footer, shown only in text mode) -->
          <button class="swirl-ai-voice-toggle-btn" id="swirl-ai-voice-toggle-btn" aria-label="Switch to voice mode" style="display: none;">
            <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/voice-toggle-icon.svg" alt="Voice mode" />
          </button>
        </div>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    // Create YouTube Video Player Modal
    const videoModal = document.createElement('div')
    videoModal.id = 'swirl-ai-video-modal'
    videoModal.className = 'swirl-ai-video-modal'
    videoModal.style.display = 'none'
    videoModal.innerHTML = `
      <div class="swirl-ai-video-modal-backdrop"></div>
      <div class="swirl-ai-video-modal-container">
        <!-- Close Button -->
        <button class="swirl-ai-video-modal-close" id="swirl-ai-video-modal-close" aria-label="Close video">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <path d="M22.5 7.5L7.5 22.5M7.5 7.5L22.5 22.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Video Player Wrapper -->
        <div class="swirl-ai-video-player-wrapper">
          <!-- Swiper Container -->
          <div class="swirl-ai-video-swiper-container swiper">
            <div class="swiper-wrapper" id="swirl-ai-video-swiper-wrapper">
              <!-- Video slides will be dynamically added here -->
            </div>
          </div>

          <!-- Navigation Arrows -->
          <button class="swirl-ai-video-nav-prev" id="swirl-ai-video-nav-prev" aria-label="Previous video">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none">
              <circle cx="22.5" cy="22.5" r="22.5" fill="rgba(0,0,0,0.5)"/>
              <path d="M25 15L17 22.5L25 30" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="swirl-ai-video-nav-next" id="swirl-ai-video-nav-next" aria-label="Next video">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none">
              <circle cx="22.5" cy="22.5" r="22.5" fill="rgba(0,0,0,0.5)"/>
              <path d="M20 15L28 22.5L20 30" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <!-- Round Thumbnail Pagination -->
        <div class="swirl-ai-video-pagination" id="swirl-ai-video-pagination">
          <!-- Thumbnails will be dynamically added here -->
        </div>
      </div>
    `

    document.body.appendChild(videoModal)

    // Create Image Viewer Modal
    const imageModal = document.createElement('div')
    imageModal.id = 'swirl-ai-image-modal'
    imageModal.className = 'swirl-ai-image-modal'
    imageModal.style.display = 'none'
    imageModal.innerHTML = `
      <div class="swirl-ai-image-modal-backdrop"></div>
      <div class="swirl-ai-image-modal-container">
        <!-- Close Button -->
        <button class="swirl-ai-image-modal-close" id="swirl-ai-image-modal-close" aria-label="Close image">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <path d="M22.5 7.5L7.5 22.5M7.5 7.5L22.5 22.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Image Viewer Wrapper -->
        <div class="swirl-ai-image-viewer-wrapper">
          <!-- Swiper Container -->
          <div class="swirl-ai-image-swiper-container swiper">
            <div class="swiper-wrapper" id="swirl-ai-image-swiper-wrapper">
              <!-- Image slides will be dynamically added here -->
            </div>
          </div>

          <!-- Navigation Arrows -->
          <button class="swirl-ai-image-nav-prev" id="swirl-ai-image-nav-prev" aria-label="Previous image">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none">
              <circle cx="22.5" cy="22.5" r="22.5" fill="rgba(0,0,0,0.5)"/>
              <path d="M25 15L17 22.5L25 30" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="swirl-ai-image-nav-next" id="swirl-ai-image-nav-next" aria-label="Next image">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none">
              <circle cx="22.5" cy="22.5" r="22.5" fill="rgba(0,0,0,0.5)"/>
              <path d="M20 15L28 22.5L20 30" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <!-- Round Thumbnail Pagination -->
        <div class="swirl-ai-image-pagination" id="swirl-ai-image-pagination">
          <!-- Thumbnails will be dynamically added here -->
        </div>
      </div>
    `

    document.body.appendChild(imageModal)

    // Add event listeners
    const closeBtn = document.getElementById('swirl-ai-close-btn')
    const micBtn = document.getElementById('swirl-ai-mic-btn')

    closeBtn.addEventListener('click', closeModal)
    micBtn.addEventListener('click', toggleMicrophone)

    // Text/Voice mode toggle buttons
    const messageBtn = document.getElementById('swirl-ai-message-btn')
    const voiceToggleBtn = document.getElementById('swirl-ai-voice-toggle-btn')
    const textInput = document.getElementById('swirl-ai-text-input')
    const textSendBtn = document.getElementById('swirl-ai-text-send-btn')

    messageBtn.addEventListener('click', switchToTextMode)
    voiceToggleBtn.addEventListener('click', switchToVoiceMode)
    textSendBtn.addEventListener('click', handleTextMessageSend)
    textInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleTextMessageSend()
      }
    })

    // Video modal close button
    const videoModalCloseBtn = document.getElementById('swirl-ai-video-modal-close')
    videoModalCloseBtn.addEventListener('click', closeVideoModal)

    // Image modal close button
    const imageModalCloseBtn = document.getElementById('swirl-ai-image-modal-close')
    imageModalCloseBtn.addEventListener('click', closeImageModal)

    console.log('[Swirl AI] ✅ Voice Agent Modal built')
  }

  // ===================================================
  // PROMPT SHUFFLING
  // ===================================================

  // shufflePrompt() function removed - using simplified trigger system

  function showPromptWithAnimation() {
    const promptBubble = document.getElementById('swirl-ai-prompt-bubble')
    if (!promptBubble) return

    setTimeout(() => {
      promptBubble.classList.add('visible')
    }, CONFIG.initDelay)
  }

  // ===================================================
  // VIEWPORT-BASED SECTION DETECTION
  // ===================================================

  function initializeViewportDetection() {
    console.log('[Swirl AI] 🔍 Viewport detection initialized')

    // Initial detection after page settles
    setTimeout(() => {
      const initialSection = detectVisibleSection()
      if (initialSection) {
        console.log(`[Swirl AI] 📍 Initial section detected: ${initialSection}`)
        handleSectionChange(initialSection)
      }
    }, 1000)

    // Listen for scroll events with passive listener for performance
    window.addEventListener('scroll', onScrollDebounced, { passive: true })

    // Listen for interaction events (clicks, touches) for slider/carousel detection
    initializeInteractionDetection()
  }

  function initializeInteractionDetection() {
    console.log('[Swirl AI] 🖱️ Interaction detection initialized (clicks, touches)')

    // Detect clicks (desktop + mobile taps)
    document.addEventListener('click', (e) => {
      // Skip if clicking on Swirl AI modal elements
      if (e.target.closest('#swirl-ai-modal') || e.target.closest('#swirl-ai-fab')) {
        return
      }

      // Debounce: wait 1000ms after last interaction (to allow swiper animation to complete)
      if (interactionDebounce) clearTimeout(interactionDebounce)
      interactionDebounce = setTimeout(() => {
        if (!modalOpen) {
          console.log('[Swirl AI] 🖱️ Click interaction detected - waiting for animation to complete...')
          const visibleSection = detectVisibleSection()

          if (visibleSection) {
            if (visibleSection !== activeSection) {
              console.log(`[Swirl AI] 📍 Section changed via click: ${activeSection || 'none'} → ${visibleSection}`)
            } else {
              console.log(`[Swirl AI] 📍 Same section, but viewport content changed - re-scoring prompts`)
            }

            // Clear existing dwell timer
            if (sectionDwellTimer) {
              clearTimeout(sectionDwellTimer)
            }

            // Wait for dwell time before updating prompts
            // IMPORTANT: Always call handleSectionChange even if section didn't change
            // because viewport content might have changed (carousel slide, tabs, etc.)
            sectionDwellTimer = setTimeout(() => {
              handleSectionChange(visibleSection)
            }, CONFIG.sectionDwellTime)
          } else {
            console.log('[Swirl AI] ℹ️ No visible section detected from click')
          }
        }
      }, 1000)
    }, true)

    // Detect mobile swipes (touchend = finger lifted)
    document.addEventListener('touchend', (e) => {
      // Skip if touching Swirl AI modal elements
      if (e.target.closest('#swirl-ai-modal') || e.target.closest('#swirl-ai-fab')) {
        return
      }

      // Debounce: wait 1000ms after last interaction (to allow swiper animation to complete)
      if (interactionDebounce) clearTimeout(interactionDebounce)
      interactionDebounce = setTimeout(() => {
        if (!modalOpen) {
          console.log('[Swirl AI] 👆 Touch interaction detected - waiting for animation to complete...')
          const visibleSection = detectVisibleSection()

          if (visibleSection) {
            if (visibleSection !== activeSection) {
              console.log(`[Swirl AI] 📍 Section changed via touch: ${activeSection || 'none'} → ${visibleSection}`)
            } else {
              console.log(`[Swirl AI] 📍 Same section, but viewport content changed - re-scoring prompts`)
            }

            // Clear existing dwell timer
            if (sectionDwellTimer) {
              clearTimeout(sectionDwellTimer)
            }

            // Wait for dwell time before updating prompts
            // IMPORTANT: Always call handleSectionChange even if section didn't change
            // because viewport content might have changed (carousel slide, tabs, etc.)
            sectionDwellTimer = setTimeout(() => {
              handleSectionChange(visibleSection)
            }, CONFIG.sectionDwellTime)
          } else {
            console.log('[Swirl AI] ℹ️ No visible section detected from touch')
          }
        }
      }, 1000)
    }, { passive: true })
  }

  function onScrollDebounced() {
    // Clear existing timer
    if (scrollStopTimer) {
      clearTimeout(scrollStopTimer)
    }

    // Wait for scroll to stop
    scrollStopTimer = setTimeout(() => {
      const visibleSection = detectVisibleSection()

      if (visibleSection && visibleSection !== activeSection) {
        console.log(`[Swirl AI] 📍 Section changed: ${activeSection || 'none'} → ${visibleSection}`)

        // Clear existing dwell timer
        if (sectionDwellTimer) {
          clearTimeout(sectionDwellTimer)
        }

        // Wait for dwell time before updating prompts
        sectionDwellTimer = setTimeout(() => {
          handleSectionChange(visibleSection)
        }, CONFIG.sectionDwellTime)
      }
    }, CONFIG.scrollStopDelay)
  }

  function detectVisibleSection() {
    // Get all text content visible in the viewport
    const viewportContent = extractViewportContent()

    if (!viewportContent) {
      console.log('[Swirl AI] ⚠️ No content found in viewport')
      return null
    }

    console.log(`[Swirl AI] 🔍 Analyzing viewport content (${viewportContent.length} chars)`)

    // Match content against section keywords
    const matchedSection = matchContentToSection(viewportContent)

    if (matchedSection) {
      console.log(`[Swirl AI] 🎯 Content matched to section: ${matchedSection}`)
    } else {
      console.log('[Swirl AI] ℹ️ No section match found for current viewport content')
    }

    return matchedSection
  }

  function extractViewportContent() {
    const viewportHeight = window.innerHeight
    const viewportTop = window.scrollY + CONFIG.skipTopPixels
    const viewportBottom = window.scrollY + viewportHeight - CONFIG.skipBottomPixels

    // Parse exclude selectors
    const excludeSelectors = CONFIG.excludeSelectors
      ? CONFIG.excludeSelectors.split(',').map(s => s.trim())
      : []

    // Get all text-containing elements
    const allElements = document.querySelectorAll('body *')
    let visibleText = ''

    allElements.forEach(element => {
      // Skip script, style, and our own plugin elements
      if (
        element.tagName === 'SCRIPT' ||
        element.tagName === 'STYLE' ||
        element.id?.includes('swirl-ai') ||
        element.classList?.contains('swirl-ai')
      ) {
        return
      }

      // Skip elements matching exclude selectors
      if (excludeSelectors.length > 0) {
        const shouldExclude = excludeSelectors.some(selector => {
          try {
            return element.matches(selector) || element.closest(selector)
          } catch (e) {
            return false
          }
        })
        if (shouldExclude) {
          return
        }
      }

      const rect = element.getBoundingClientRect()
      const elementTop = rect.top + window.scrollY
      const elementBottom = elementTop + rect.height

      // Check if element is in viewport (both vertically AND horizontally visible)
      const isInViewportVertically = elementBottom > viewportTop && elementTop < viewportBottom

      // Horizontal visibility: element must be at least 70% visible (not just partially visible)
      const visibleLeft = Math.max(0, rect.left)
      const visibleRight = Math.min(window.innerWidth, rect.right)
      const visibleWidth = visibleRight - visibleLeft
      const elementWidth = rect.width
      const horizontalVisibilityPercent = elementWidth > 0 ? (visibleWidth / elementWidth) : 0
      const isInViewportHorizontally = horizontalVisibilityPercent >= 0.7 // At least 70% visible

      const isInViewport = isInViewportVertically && isInViewportHorizontally

      if (isInViewport) {
        // Get direct text content (not from children)
        const text = Array.from(element.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent.trim())
          .join(' ')

        if (text) {
          visibleText += ' ' + text
        }
      }
    })

    const keywords = visibleText.toLowerCase().trim().split(' ').slice(0, 10).join(' ')
    console.log(`[Swirl AI] 📝 Viewport Keywords: "${visibleText}..."`)

    return visibleText.toLowerCase().trim()
  }

  function matchContentToSection(content) {
    if (!content || !sectionPrompts) return null

    const scores = {}

    // Score each section based on keyword matches
    for (const [sectionKey, config] of Object.entries(sectionPrompts)) {
      const keywords = config.keywords || []
      let score = 0

      keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase()

        // Count occurrences of keyword in content
        const regex = new RegExp(keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        const matches = (content.match(regex) || []).length

        if (matches > 0) {
          // Weight by priority
          const priorityMultiplier = config.priority === 'high' ? 2 : 1
          score += matches * priorityMultiplier
        }
      })

      if (score > 0) {
        scores[sectionKey] = score
      }
    }

    console.log('[Swirl AI] 📊 Section scores:', scores)

    // Return section with highest score
    if (Object.keys(scores).length > 0) {
      const bestMatch = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a))
      return bestMatch[0].toUpperCase()
    }

    return null
  }

  function scoreAndSortPrompts(prompts, viewportContent) {
    // Extract viewport keywords (clean words, 2+ chars, no common words)
    const commonWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'are', 'was', 'will', 'can', 'want', 'see', 'how', 'other', 'more', 'about', 'what', 'when', 'where', 'who', 'why', 'compare', 'vs', 'want'])
    const viewportWords = viewportContent
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 2 && !commonWords.has(w))

    console.log(`[Swirl AI] 🔑 Extracted viewport keywords: [${viewportWords.slice(0, 10).join(', ')}]`)

    // Score each prompt based on keyword overlap with viewport
    const promptsWithScores = prompts.map(prompt => {
      let score = 0

      // Extract words from prompt text and trigger
      // Handle both string prompts and object prompts
      const promptText = (typeof prompt === 'string' ? prompt : prompt.text || '').toLowerCase()
      const trigger = (typeof prompt === 'object' ? (prompt.trigger || '') : '').toLowerCase()

      // Extract base trigger word (remove suffixes like -interact, -mode, etc.)
      const baseTrigger = trigger.split('-')[0]

      // Count how many viewport keywords appear in the prompt or trigger
      viewportWords.forEach(keyword => {
        // Check prompt text
        if (promptText.includes(keyword)) {
          score += 10
        }

        // Check full trigger
        if (trigger.includes(keyword)) {
          score += 15 // Higher weight for trigger match
        }

        // Check base trigger (e.g., "v2l" from "v2l-interact")
        if (baseTrigger && baseTrigger === keyword) {
          score += 20 // Highest weight for exact base trigger match
        }

        // Partial match in trigger (e.g., "terrain" matches "terrain-interact")
        if (baseTrigger && baseTrigger.includes(keyword) && keyword.length >= 3) {
          score += 15
        }
      })

      return { prompt, score }
    })

    // Sort by score (highest first)
    promptsWithScores.sort((a, b) => b.score - a.score)

    // Log scores for debugging
    const scoreLog = promptsWithScores.map(p => {
      const promptText = typeof p.prompt === 'string' ? p.prompt : (p.prompt.text || '')
      return `"${promptText.substring(0, 40)}..." = ${p.score}`
    }).join(', ')
    console.log(`[Swirl AI] 🎯 Prompt scores: ${scoreLog}`)

    // Return sorted prompts (without scores)
    return promptsWithScores.map(p => p.prompt)
  }

  function handleSectionChange(newSection) {
    activeSection = newSection

    // Try to match section to prompts
    const matchedPrompts = matchSectionToPrompts(newSection)

    if (matchedPrompts && matchedPrompts.length > 0) {
      // Filter prompts by persona (default: PERFORMANCE)
      const currentPersona = 'PERFORMANCE'  // Can be dynamic later
      const personaFiltered = matchedPrompts.filter(p =>
        !p.persona || p.persona === currentPersona
      )

      // Use filtered prompts, fallback to all if none match
      let filteredPrompts = personaFiltered.length > 0 ? personaFiltered : matchedPrompts

      // ===== NEW: Score individual prompts based on viewport content =====
      // Always score if we have multiple prompts (even if just 2)
      if (filteredPrompts.length > 1) {
        console.log('[Swirl AI] 🔍 Scoring prompts based on current viewport content...')
        const viewportContent = extractViewportContent()
        filteredPrompts = scoreAndSortPrompts(filteredPrompts, viewportContent)
      } else {
        console.log('[Swirl AI] ℹ️ Only 1 prompt found, skipping scoring')
      }

      // Apply maxPromptsToShow limit (take only first N prompts after scoring)
      if (CONFIG.maxPromptsToShow > 0 && filteredPrompts.length > CONFIG.maxPromptsToShow) {
        filteredPrompts = filteredPrompts.slice(0, CONFIG.maxPromptsToShow)
      }

      currentPrompts = filteredPrompts
      currentPromptIndex = 0

      // Shuffle logic removed - using simplified trigger system

      // Update prompt with animation if modal is closed
      if (!modalOpen) {
        updatePromptWithThinkingAnimation()
      }
    } else {
      // No prompts found - show default text
      currentPrompts = [{ text: CONFIG.defaultPromptText }]
      currentPromptIndex = 0

      // Shuffle logic removed - using simplified trigger system

      // Update to default prompt
      if (!modalOpen) {
        updatePromptWithThinkingAnimation()
      }
    }
  }

  function matchSectionToPrompts(sectionName) {
    if (!sectionName || !sectionPrompts) return null

    // Direct match (case-insensitive)
    const directMatch = Object.keys(sectionPrompts).find(
      key => key.toUpperCase() === sectionName.toUpperCase()
    )

    if (directMatch) {
      return sectionPrompts[directMatch].prompts
    }

    // Keyword matching
    const sectionNameLower = sectionName.toLowerCase()

    for (const [key, config] of Object.entries(sectionPrompts)) {
      const keywords = config.keywords || []

      // Check if section name contains any keyword
      const keywordMatch = keywords.some(keyword =>
        sectionNameLower.includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(sectionNameLower)
      )

      if (keywordMatch) {
        return config.prompts
      }
    }

    return null
  }

  // shufflePromptsArray() function removed - using simplified trigger system

  function updatePromptWithThinkingAnimation() {
    const promptText = document.getElementById('swirl-ai-prompt-text')
    const promptBubble = document.getElementById('swirl-ai-prompt-bubble')
    const promptContent = document.getElementById('swirl-ai-prompt-content')

    if (!promptText || !promptBubble || !promptContent) return

    // Don't update if modal is open
    if (modalOpen) return

    // Add thinking state
    promptBubble.classList.remove('visible')
    promptBubble.classList.add('thinking')

    // Update prompt text after thinking animation
    setTimeout(() => {
      const newPrompt = currentPrompts[currentPromptIndex]
      const promptTextStr = newPrompt?.text || newPrompt || ''

      promptText.innerHTML = promptTextStr

      // Update multiline classes
      const isMultiline = promptTextStr.length > 30
      if (isMultiline) {
        promptContent.classList.add('multiline')
        promptBubble.classList.add('multiline')
        promptText.classList.add('multiline')
      } else {
        promptContent.classList.remove('multiline')
        promptBubble.classList.remove('multiline')
        promptText.classList.remove('multiline')
      }

      // Show with animation
      promptBubble.classList.remove('thinking')
      promptBubble.classList.add('visible')

      console.log('[Swirl AI] 💬 Prompt updated:', promptTextStr)
    }, CONFIG.thinkingAnimationDuration)
  }

  // ===================================================
  // OLD TRACKING FUNCTIONS REMOVED
  // Trigger logic disabled for Lennox (no trigger file configured)
  // (Removed: initializeCursorTracking, initializeScrollBackDetection,
  //  initializeButtonClickTracking, initializeCalculatorTracking,
  //  triggerEnhancedPrompt, getSectionFromElement, throttle, debounce)
  // ===================================================

  // ===================================================
  // PROMPT CLICK AUTO-SEND (INDEPENDENT MODULE)
  // ===================================================

  /**
   * FEATURE: Auto-send clicked prompt to AI chat
   *
   * TOGGLE: Set CONFIG.enablePromptAutoSend = false to disable
   * IMPACT: Zero - feature is completely independent
   */

  let pendingPromptToSend = null

  /**
   * Intercepts prompt click to capture text before modal opens
   * If feature is disabled, acts as passthrough to openModal()
   */
  function handlePromptClickWithAutoSend() {
    // Feature disabled? Just open modal normally
    if (!CONFIG.enablePromptAutoSend) {
      console.log('[Swirl AI] Prompt auto-send disabled - opening modal normally')
      openModal()
      return
    }

    // Feature enabled - capture prompt text (including default)
    const promptTextElement = document.getElementById('swirl-ai-prompt-text')
    const promptText = promptTextElement?.textContent?.trim()

    // Store prompt for AI greeting after connection
    // Use default greeting text if it's the default nudge or empty
    if (!promptText || promptText === 'Ask Lennox AI' || promptText === CONFIG.defaultPromptText) {
      pendingPromptToSend = '__DEFAULT_GREETING__'
      console.log('[Swirl AI] 📌 Default nudge clicked - will greet with default message')
    } else {
      pendingPromptToSend = promptText
      console.log(`[Swirl AI] 📌 Captured nudge for AI greeting: "${promptText}"`)
    }

    // Open modal as usual
    openModal()
  }

  /**
   * Checks for pending prompt and triggers AI greeting or sends nudge question
   * Called from handleDataChannelOpen()
   */
  function checkAndSendPendingPrompt() {
    // Feature disabled? Do nothing
    if (!CONFIG.enablePromptAutoSend) {
      return
    }

    // No pending prompt? Do nothing
    if (!pendingPromptToSend) {
      return
    }

    // Wait for session to stabilize
    setTimeout(() => {
      if (!pendingPromptToSend) return

      if (pendingPromptToSend === '__DEFAULT_GREETING__') {
        // Default nudge: AI greets with "How can I help you?"
        const greetingText = CONFIG.defaultGreeting || 'How can I help you?'
        console.log(`[Swirl AI] 🎤 AI will greet with default: "${greetingText}"`)
        triggerAIGreeting(greetingText)
      } else {
        // Specific nudge: Show as user question, AI answers it
        console.log(`[Swirl AI] 📤 Sending nudge as user question: "${pendingPromptToSend}"`)
        sendNudgeAsUserQuestion(pendingPromptToSend)
      }

      pendingPromptToSend = null // Clear after triggering
    }, 500)
  }

  /**
   * Sends the nudge text as a user question and triggers AI to answer
   * This maintains the UX flow: user question at bottom, AI answer above
   */
  function sendNudgeAsUserQuestion(questionText) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[Swirl AI] ❌ Cannot send nudge question - DataChannel not ready')
      return
    }

    try {
      // Set greeting flag to keep turn detection disabled until answer is done
      isAIGreeting = true

      // Mute microphone to prevent feedback loop (mic picking up AI audio)
      muteMicrophone()

      // In text mode, ensure remote audio is muted to prevent audio playback
      if (currentInputMode === 'text' && remoteAudioEl) {
        remoteAudioEl.muted = true
        console.log('[Swirl AI] 🔇 Remote audio muted for nudge in text mode')
      }

      // Show the nudge question as user's message in the chat UI
      // Voice mode: centered toast, Text mode: right-aligned in chat
      if (currentInputMode === 'voice') {
        showUserTranscript(questionText)
      } else {
        appendUserMessageInChat(questionText)
      }

      // Show loading status
      showLoadingStatus()

      // Send as user message to AI
      const userMessage = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: questionText
            }
          ]
        }
      }
      dataChannel.send(JSON.stringify(userMessage))

      // Trigger AI to respond
      const responseCreate = {
        type: 'response.create'
      }
      dataChannel.send(JSON.stringify(responseCreate))

      console.log('[Swirl AI] ✅ Nudge question sent successfully')

    } catch (error) {
      console.error('[Swirl AI] ❌ Error sending nudge question:', error)
    }
  }

  // Mutes the microphone to prevent feedback during AI greeting/response
  // This is critical to prevent the infinite loop where mic picks up AI audio
  function muteMicrophone() {
    if (!localStream) return

    const audioTrack = localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = false
      console.log('[Swirl AI] 🔇 Microphone muted for greeting')
    }
  }

  // Unmutes the microphone after AI greeting/response is complete
  function unmuteMicrophone() {
    if (!localStream) return

    // Don't unmute if user had manually muted
    if (userMutedMic) {
      console.log('[Swirl AI] 🔇 Mic stays muted (user preference)')
      return
    }

    // Don't unmute if in text mode
    if (currentInputMode === 'text') {
      console.log('[Swirl AI] 🔇 Mic stays muted (text mode)')
      return
    }

    const audioTrack = localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = true
      console.log('[Swirl AI] 🔊 Microphone unmuted')
    }
  }

  // Waits for actual silence on the remote audio stream (AI's output)
  // This detects when AI actually stops speaking, not just when generation completes
  function waitForRemoteAudioSilence(callback) {
    let silenceCount = 0
    const requiredSilenceFrames = 20 // ~0.66 seconds of silence at 30fps
    let checkCount = 0
    const maxChecks = 600 // Max ~20 seconds of waiting

    const checkAudioLevel = () => {
      checkCount++

      // Safety timeout
      if (checkCount >= maxChecks) {
        console.log('[Swirl AI] ⏱️ Audio wait timeout, proceeding anyway')
        callback()
        return
      }

      // Check remote audio analyzer (AI's output)
      if (remoteAudioAnalyser) {
        const dataArray = new Uint8Array(remoteAudioAnalyser.frequencyBinCount)
        remoteAudioAnalyser.getByteFrequencyData(dataArray)

        // Calculate average volume
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

        if (average < 3) {
          // Very quiet - count as silence
          silenceCount++
          if (silenceCount >= requiredSilenceFrames) {
            console.log('[Swirl AI] 🔇 Remote audio silence detected, AI finished speaking')
            callback()
            return
          }
        } else {
          // Reset silence counter if audio detected
          silenceCount = 0
        }
      } else {
        // No analyzer available, use fallback delay
        console.log('[Swirl AI] ⚠️ No remote analyzer, using fallback delay')
        setTimeout(callback, 3000)
        return
      }

      // Check again in ~33ms (30fps)
      setTimeout(checkAudioLevel, 33)
    }

    // Start checking after response.done (generation complete, audio still streaming)
    setTimeout(checkAudioLevel, 100)
  }

  // Safely re-enables turn detection after greeting/nudge response
  // Checks connection state before sending
  function enableTurnDetectionSafely() {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.warn('[Swirl AI] ⚠️ Cannot re-enable turn detection - DataChannel not ready')
      return
    }

    const enableTurnDetection = {
      type: 'session.update',
      session: {
        turn_detection: {
          ...sessionConfig.turn_detection,
          create_response: true
        }
      }
    }
    dataChannel.send(JSON.stringify(enableTurnDetection))
    console.log('[Swirl AI] 🔊 Turn detection re-enabled')
  }

  /**
   * Triggers the AI to speak a greeting message
   * Uses response.create with instructions override - no fake user message needed
   * Note: Turn detection is already disabled in handleDataChannelOpen when greeting is pending
   */
  function triggerAIGreeting(greetingText) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[Swirl AI] ❌ Cannot trigger greeting - DataChannel not ready')
      return
    }

    console.log(`[Swirl AI] 📤 Triggering AI greeting: "${greetingText}"`)

    try {
      // Set greeting flag - turn detection will be re-enabled after response.done
      isAIGreeting = true

      // Mute microphone to prevent feedback loop (mic picking up AI audio)
      muteMicrophone()

      // In text mode, ensure remote audio is muted to prevent audio playback
      if (currentInputMode === 'text' && remoteAudioEl) {
        remoteAudioEl.muted = true
        console.log('[Swirl AI] 🔇 Remote audio muted for greeting in text mode')
      }

      // Trigger AI response with custom instructions for greeting
      // This is cleaner than sending a fake user message - no conversation history pollution
      const responseCreate = {
        type: 'response.create',
        response: {
          instructions: `Say exactly this greeting to start the conversation: "${greetingText}". Be natural and friendly. Do not add anything else or ask follow-up questions - just deliver this greeting.`
        }
      }

      dataChannel.send(JSON.stringify(responseCreate))

      console.log('[Swirl AI] ✅ AI greeting triggered successfully')

    } catch (error) {
      console.error('[Swirl AI] ❌ Error triggering AI greeting:', error)
    }
  }

  /**
   * Sends a text message to AI via WebRTC DataChannel
   * Independent function that can be called from anywhere
   */
  function sendTextMessageToAI(messageText) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[Swirl AI] ❌ Cannot send text - DataChannel not ready')
      return false
    }

    if (!messageText || messageText.trim() === '') {
      console.error('[Swirl AI] ❌ Cannot send empty message')
      return false
    }

    console.log(`[Swirl AI] 📤 Sending text message: "${messageText}"`)

    try {
      // Mark as new conversation turn
      handleNewUserQuestion()

      // Show user message in chat (only in voice mode - text mode already appended it)
      if (currentInputMode === 'voice') {
        showUserTranscript(messageText)
      }

      // Show loading status with random phrase
      showLoadingStatus()

      // Send message to OpenAI
      const textMessage = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: messageText
            }
          ]
        }
      }

      dataChannel.send(JSON.stringify(textMessage))

      // Trigger AI response
      const responseCreate = {
        type: 'response.create'
      }

      dataChannel.send(JSON.stringify(responseCreate))

      console.log('[Swirl AI] ✅ Text message sent successfully')
      return true

    } catch (error) {
      console.error('[Swirl AI] ❌ Error sending text message:', error)
      return false
    }
  }

  /**
   * Alias for sendTextMessageToAI - used by card click handlers
   */
  function sendGenericUserMessage(messageText) {
    return sendTextMessageToAI(messageText)
  }

  /**
   * Triggers the AI to speak unprompted — no fake user message.
   * Uses response.create with a per-response instruction so the AI speaks
   * in its own voice with full context, without polluting conversation history.
   */
  function triggerAISpeak(instruction) {
    if (!dataChannel || dataChannel.readyState !== 'open') return
    dataChannel.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: instruction
      }
    }))
  }

  /**
   * Clears any pending prompt (called on modal close)
   */
  function clearPendingPrompt() {
    if (pendingPromptToSend) {
      console.log('[Swirl AI] 🧹 Clearing pending prompt')
      pendingPromptToSend = null
    }
  }

  // ===================================================
  // MODAL OPENING & CLOSING
  // ===================================================

  function setModalDynamicHeight() {
    const modal = document.getElementById('swirl-ai-voice-modal')
    if (!modal) return

    // Set explicit height to handle mobile browser URL bar
    const vh = window.innerHeight
    modal.style.height = `${vh}px`
  }

  // Track modal open time for duration calculation
  let modalOpenTime = null

  function openModal() {
    console.log('[Swirl AI] 🎤 Opening Voice Agent Modal...')
    modalOpen = true
    modalOpenTime = Date.now()
    // PostHog: Log modal opened
    logModalOpened({ trigger: pendingPromptToSend ? 'prompt' : 'nudge' })

    let modal = document.getElementById('swirl-ai-voice-modal')

    // Build modal if it doesn't exist
    if (!modal) {
      buildVoiceAgentModal()
      modal = document.getElementById('swirl-ai-voice-modal')
    }

    // Save scroll position and disable body scroll
    scrollPosition = window.scrollY
    document.body.classList.add('swirl-ai-modal-open')

    // Set dynamic height for mobile browsers
    setModalDynamicHeight()

    // Show modal with animation
    modal.classList.add('active', 'opening')
    modal.classList.remove('closing')

    // Ensure bars are visible by default (remove recognizing class if it exists)
    const voiceInputContainer = document.getElementById('swirl-ai-voice-input-container')
    if (voiceInputContainer) {

      // Ensure correct mode UI is displayed (default: voice mode)
      const textContainer = document.getElementById('swirl-ai-text-input-container')
      const messageBtn = document.getElementById('swirl-ai-message-btn')
      const voiceToggleBtn = document.getElementById('swirl-ai-voice-toggle-btn')
      const voiceIconContainer = document.getElementById('swirl-ai-voice-icon-container')

      if (currentInputMode === 'voice') {
        if (voiceInputContainer) voiceInputContainer.style.display = 'flex'
        if (textContainer) textContainer.style.display = 'none'
        if (messageBtn) messageBtn.style.display = 'flex'
        if (voiceToggleBtn) voiceToggleBtn.style.display = 'none'
        if (voiceIconContainer) voiceIconContainer.style.display = 'flex'
      } else {
        if (voiceInputContainer) voiceInputContainer.style.display = 'none'
        if (textContainer) textContainer.style.display = 'flex'
        if (messageBtn) messageBtn.style.display = 'none'
        if (voiceToggleBtn) voiceToggleBtn.style.display = 'flex'
        if (voiceIconContainer) voiceIconContainer.style.display = 'none'
      }
      voiceInputContainer.classList.remove('recognizing')
    }

    // Shuffle logic removed - using simplified trigger system

    // Disable text input and send button until connection is ready
    const textInput = document.getElementById('swirl-ai-text-input')
    const textSendBtn = document.getElementById('swirl-ai-text-send-btn')
    if (textInput) {
      textInput.disabled = true
      textInput.placeholder = 'Connecting...'
    }
    if (textSendBtn) {
      textSendBtn.disabled = true
      textSendBtn.style.opacity = '0.5'
      textSendBtn.style.cursor = 'not-allowed'
    }

    // Show connecting status
    updateStatusMessage('Connecting...')

    // Set video to default state on modal open
    setVoiceVideoState('default')

    // Connect WebRTC when modal opens
    connectWebRTC()

    console.log('[Swirl AI] ✅ Modal opened (WebRTC connecting...)')
  }
  // ===================================================
  // TEXT/VOICE MODE SWITCHING
  // ===================================================

  function switchToTextMode() {
    console.log('[Swirl AI] Switching to text mode')
    currentInputMode = 'text'

    // Hide voice input container, show text input container
    const voiceContainer = document.getElementById('swirl-ai-voice-input-container')
    const textContainer = document.getElementById('swirl-ai-text-input-container')
    const messageBtn = document.getElementById('swirl-ai-message-btn')
    const voiceToggleBtn = document.getElementById('swirl-ai-voice-toggle-btn')
    const voiceIconContainer = document.getElementById('swirl-ai-voice-icon-container')

    if (voiceContainer) voiceContainer.style.display = 'none'
    if (textContainer) textContainer.style.display = 'flex'
    if (messageBtn) messageBtn.style.display = 'none'
    if (voiceToggleBtn) voiceToggleBtn.style.display = 'flex'
    if (voiceIconContainer) voiceIconContainer.style.display = 'none'

    // Mute microphone in text mode - directly disable without affecting userMutedMic flag
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack && audioTrack.enabled) {
        audioTrack.enabled = false
        console.log('[Swirl AI] Microphone muted for text mode')

        // Update UI to show muted state
        const micBtn = document.querySelector('.swirl-ai-voice-mic-btn')
        const unmutedIcon = document.querySelector('.swirl-ai-mic-icon-unmuted')
        const mutedIcon = document.querySelector('.swirl-ai-mic-icon-muted')
        if (micBtn && unmutedIcon && mutedIcon) {
          micBtn.classList.add('muted')
          micBtn.classList.remove('active')
          unmutedIcon.style.display = 'none'
          mutedIcon.style.display = 'block'
        }
      }
    }

    // Focus on text input
    const textInput = document.getElementById('swirl-ai-text-input')
    if (textInput) {
      setTimeout(() => textInput.focus(), 100)
    }

    console.log('[Swirl AI] Text mode activated')
  }

  async function switchToVoiceMode() {
    console.log('[Swirl AI] Switching to voice mode')

    // Check if user has real microphone permission
    if (!hasRealMicrophone) {
      console.log('[Swirl AI] ⚠️ No microphone permission - requesting access')
      // updateStatusMessage('Requesting microphone permission...')

      // Request microphone permission again
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true }
          }
        })

        console.log('[Swirl AI] ✅ Microphone permission granted!')
        hasRealMicrophone = true

        // Replace the silent track with real microphone
        if (peerConnection && localStream) {
          // Remove old silent track
          const oldTrack = localStream.getAudioTracks()[0]
          const sender = peerConnection.getSenders().find(s => s.track === oldTrack)
          if (sender) {
            const newTrack = newStream.getAudioTracks()[0]
            await sender.replaceTrack(newTrack)
            console.log('[WebRTC] ✅ Replaced silent track with real microphone')
          }

          // Update localStream reference
          localStream = newStream

          // Setup audio visualization for the new stream
          setupAudioVisualization()
        }

        logMicPermissionGranted()
      } catch (error) {
        console.log('[Swirl AI] ❌ Microphone permission denied again')
        updateStatusMessage('Microphone denied - staying in text mode')
        logMicPermissionDenied()
        return // Don't switch to voice mode, stay in text mode
      }
    }

    currentInputMode = 'voice'

    // Show voice input container, hide text input container
    const voiceContainer = document.getElementById('swirl-ai-voice-input-container')
    const textContainer = document.getElementById('swirl-ai-text-input-container')
    const messageBtn = document.getElementById('swirl-ai-message-btn')
    const voiceToggleBtn = document.getElementById('swirl-ai-voice-toggle-btn')
    const voiceIconContainer = document.getElementById('swirl-ai-voice-icon-container')

    if (voiceContainer) voiceContainer.style.display = 'flex'
    if (textContainer) textContainer.style.display = 'none'
    if (messageBtn) messageBtn.style.display = 'flex'
    if (voiceToggleBtn) voiceToggleBtn.style.display = 'none'
    if (voiceIconContainer) voiceIconContainer.style.display = 'flex'

    // Unmute microphone when switching back to voice mode - directly enable without affecting userMutedMic flag
    if (localStream && !userMutedMic) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack && !audioTrack.enabled) {
        audioTrack.enabled = true
        console.log('[Swirl AI] Microphone unmuted for voice mode')

        // Update UI to show unmuted state
        const micBtn = document.querySelector('.swirl-ai-voice-mic-btn')
        const unmutedIcon = document.querySelector('.swirl-ai-mic-icon-unmuted')
        const mutedIcon = document.querySelector('.swirl-ai-mic-icon-muted')
        if (micBtn && unmutedIcon && mutedIcon) {
          micBtn.classList.remove('muted')
          micBtn.classList.add('active')
          unmutedIcon.style.display = 'block'
          mutedIcon.style.display = 'none'
        }
      }
    }

    // Clear text input
    const textInput = document.getElementById('swirl-ai-text-input')
    if (textInput) textInput.value = ''

    console.log('[Swirl AI] Voice mode activated')
  }

  function handleTextMessageSend() {
    const textInput = document.getElementById('swirl-ai-text-input')
    if (!textInput) return

    const messageText = textInput.value.trim()
    if (!messageText) {
      console.log('[Swirl AI] Cannot send empty message')
      return
    }

    console.log(`[Swirl AI] Sending text message: "${messageText}"`)

    // Append user message in chat (right-aligned) for text mode
    appendUserMessageInChat(messageText)

    // Send text message using existing function
    const success = sendTextMessageToAI(messageText)

    if (success !== false) {
      // Clear input on successful send
      textInput.value = ''
    }
  }


  function closeModal() {
    console.log('[Swirl AI] 🔽 Closing Voice Agent Modal...')
    // PostHog: Log modal closed with duration and turns
    const modalDuration = modalOpenTime ? Date.now() - modalOpenTime : 0
    logModalClosed({ durationMs: modalDuration, turnsCount: currentConversationTurn })
    logSessionEnded({ durationMs: modalDuration, totalTurns: currentConversationTurn })
    modalOpen = false

    const modal = document.getElementById('swirl-ai-voice-modal')
    if (!modal) return

    // Restore body scroll
    document.body.classList.remove('swirl-ai-modal-open')
    window.scrollTo(0, scrollPosition)

    // 🎯 FEATURE HOOK: Clear any pending prompt
    clearPendingPrompt()

    // Close animation
    modal.classList.add('closing')
    modal.classList.remove('opening')

    setTimeout(() => {
      modal.classList.remove('active', 'closing')
    }, 400)

    // Cleanup WebRTC
    cleanupWebRTC()

    // Clear conversation messages after 1 second delay (after modal closes)
    setTimeout(() => {
      clearPreviousConversation()
      currentConversationTurn = 0
      console.log('[Swirl AI] 🧹 Cleared conversation for next session')
    }, 1000)

    // Reset to voice mode when modal closes
    currentInputMode = 'voice'

    // Shuffle logic removed - using simplified trigger system

    console.log('[Swirl AI] ✅ Modal closed')
  }

  // ===================================================
  // CONVERSATION TURN MANAGEMENT
  // ===================================================

  function clearPreviousConversation() {
    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    // Get all children except the voice icon and loading overlay
    const allChildren = Array.from(messagesContainer.children)

    allChildren.forEach(child => {
      // Keep the voice icon container and loading overlay
      if (child.classList.contains('swirl-ai-voice-icon-container') ||
        child.classList.contains('swirl-ai-loading-overlay')) {
        return
      }
      // Remove everything else
      child.remove()
    })

    console.log(`[Swirl AI] 🧹 Cleared previous conversation (turn ${currentConversationTurn})`)
  }

  function handleNewUserQuestion() {
    currentConversationTurn++
    isFirstEventInTurn = true
    console.log(`[Swirl AI] 📝 New conversation turn: ${currentConversationTurn}`)
  }

  function clearOnFirstEvent() {
    if (isFirstEventInTurn) {
      hideLoadingStatus()

      // Only clear previous conversation in voice mode
      // In text mode, keep all messages in chat history
      if (currentInputMode === 'voice') {
        clearPreviousConversation()
        console.log(`[Swirl AI] 🎯 First event in turn ${currentConversationTurn} - cleared previous content (voice mode)`)
      } else {
        console.log(`[Swirl AI] 🎯 First event in turn ${currentConversationTurn} - keeping chat history (text mode)`)
      }

      isFirstEventInTurn = false
    }
  }

  function showLoadingStatus() {
    const overlay = document.getElementById('swirl-ai-loading-overlay')
    const loadingText = document.getElementById('swirl-ai-loading-text')
    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')

    if (!overlay || !loadingText || !messagesContainer) return

    // Pick random phrase
    const randomPhrase = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)]

    // Update text
    loadingText.textContent = randomPhrase

    // Set video to thinking state
    setVoiceVideoState('thinking')

    // Show overlay
    overlay.style.display = 'flex'

    // Make container unscrollable
    messagesContainer.classList.add('loading')

    console.log(`[Swirl AI] 💭 Loading status: "${randomPhrase}"`)
  }

  function hideLoadingStatus() {
    const overlay = document.getElementById('swirl-ai-loading-overlay')
    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')

    if (!overlay) return

    // Hide overlay
    overlay.style.display = 'none'

    // Make container scrollable again
    if (messagesContainer) {
      messagesContainer.classList.remove('loading')
    }

    // Transition from thinking to speaking state (first text chunk arrived)
    setVoiceVideoState('speaking')

    console.log('[Swirl AI] ✅ Loading status hidden')
  }

  // ===================================================
  // YOUTUBE VIDEO MODAL
  // ===================================================

  function openVideoModal(videos, startIndex = 0) {
    console.log('[Swirl AI] 📹 Opening video modal', { videos, startIndex })

    currentVideoData = videos
    currentVideoIndex = startIndex

    const modal = document.getElementById('swirl-ai-video-modal')
    if (!modal) return

    // Mute microphone to prevent video audio from being sent to AI channel
    muteMicrophone()

    // Load YouTube API if not loaded
    loadYouTubeAPI().then(() => {
      // Build video slides
      buildVideoSlides()

      // Show modal
      modal.style.display = 'block'

      // Initialize player after modal is visible
      setTimeout(() => {
        initializeVideoPlayer()
      }, 100)
    }).catch(err => {
      console.error('[Swirl AI] Failed to load YouTube API:', err)
    })
  }

  function closeVideoModal() {
    console.log('[Swirl AI] 📹 Closing video modal')

    const modal = document.getElementById('swirl-ai-video-modal')
    if (!modal) return

    // Stop video - add safety checks
    if (youtubePlayer && typeof youtubePlayer.stopVideo === 'function') {
      try {
        youtubePlayer.stopVideo()
      } catch (e) {
        console.warn('[Swirl AI] Could not stop video:', e)
      }
    }

    if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
      try {
        youtubePlayer.destroy()
      } catch (e) {
        console.warn('[Swirl AI] Could not destroy player:', e)
      }
    }
    youtubePlayer = null

    // Clear progress interval
    if (updateProgressInterval) {
      clearInterval(updateProgressInterval)
      updateProgressInterval = null
    }

    // Destroy swiper
    if (videoSwiper && typeof videoSwiper.destroy === 'function') {
      try {
        videoSwiper.destroy()
      } catch (e) {
        console.warn('[Swirl AI] Could not destroy swiper:', e)
      }
    }
    videoSwiper = null

    // Hide modal
    modal.style.display = 'none'
    document.body.style.overflow = ''

    // Unmute microphone when video modal closes
    unmuteMicrophone()

    // Clear data
    currentVideoData = []
    currentVideoIndex = 0
  }

  // ===================================================
  // IMAGE MODAL FUNCTIONS
  // ===================================================

  function openImageModal(images, startIndex = 0) {
    console.log('[Swirl AI] 🖼️ Opening image modal', { images, startIndex })

    currentImageData = images
    currentImageIndex = startIndex

    const modal = document.getElementById('swirl-ai-image-modal')
    if (!modal) return

    // Build image slides
    buildImageSlides()

    // Show modal
    modal.style.display = 'block'
    document.body.style.overflow = 'hidden'

    // Initialize Swiper after modal is visible
    setTimeout(() => {
      initializeImageSwiper()
    }, 100)
  }

  function closeImageModal() {
    console.log('[Swirl AI] 🖼️ Closing image modal')

    const modal = document.getElementById('swirl-ai-image-modal')
    if (!modal) return

    // Destroy swiper
    if (imageSwiper && typeof imageSwiper.destroy === 'function') {
      try {
        imageSwiper.destroy()
      } catch (e) {
        console.warn('[Swirl AI] Could not destroy image swiper:', e)
      }
    }
    imageSwiper = null

    // Hide modal
    modal.style.display = 'none'
    document.body.style.overflow = ''

    // Clear data
    currentImageData = []
    currentImageIndex = 0
  }

  function buildImageSlides() {
    const wrapper = document.getElementById('swirl-ai-image-swiper-wrapper')
    const pagination = document.getElementById('swirl-ai-image-pagination')

    if (!wrapper || !pagination) return

    // Clear existing
    wrapper.innerHTML = ''
    pagination.innerHTML = ''

    // Build slides
    currentImageData.forEach((image, index) => {
      const imageUrl = image.url || image
      const imageAlt = image.alt || image.title || image.description || 'Vehicle Image'

      // Create slide
      const slide = document.createElement('div')
      slide.className = 'swiper-slide'
      slide.innerHTML = `
        <div class="swirl-ai-image-slide-content">
          <img src="${imageUrl}" alt="${imageAlt}" class="swirl-ai-modal-image" />
          ${image.title ? `<div class="swirl-ai-image-caption">${image.title}</div>` : ''}
        </div>
      `
      wrapper.appendChild(slide)

      // Create thumbnail for pagination
      const thumb = document.createElement('div')
      thumb.className = `swirl-ai-image-thumb ${index === currentImageIndex ? 'active' : ''}`
      thumb.innerHTML = `<img src="${imageUrl}" alt="${imageAlt}" />`
      thumb.addEventListener('click', () => {
        if (imageSwiper) {
          imageSwiper.slideTo(index)
        }
      })
      pagination.appendChild(thumb)
    })
  }

  function initializeImageSwiper() {
    loadSwiperLibrary().then(() => {
      const container = document.querySelector('.swirl-ai-image-swiper-container')
      if (!container) return

      imageSwiper = new Swiper(container, {
        slidesPerView: 1,
        spaceBetween: 0,
        initialSlide: currentImageIndex,
        navigation: {
          nextEl: '#swirl-ai-image-nav-next',
          prevEl: '#swirl-ai-image-nav-prev'
        },
        on: {
          slideChange: function () {
            currentImageIndex = this.activeIndex
            updateImageThumbnails()
          }
        }
      })

      console.log('[Swirl AI] ✅ Image Swiper initialized')
    })
  }

  function updateImageThumbnails() {
    const thumbnails = document.querySelectorAll('.swirl-ai-image-thumb')
    thumbnails.forEach((thumb, index) => {
      if (index === currentImageIndex) {
        thumb.classList.add('active')
      } else {
        thumb.classList.remove('active')
      }
    })
  }

  // ===================================================
  // VIDEO MODAL FUNCTIONS
  // ===================================================

  function buildVideoSlides() {
    const wrapper = document.getElementById('swirl-ai-video-swiper-wrapper')
    const pagination = document.getElementById('swirl-ai-video-pagination')

    if (!wrapper || !pagination) return

    // Clear existing
    wrapper.innerHTML = ''
    pagination.innerHTML = ''

    // Build slides
    currentVideoData.forEach((video, index) => {
      // Create slide
      const slide = document.createElement('div')
      slide.className = 'swiper-slide'
      slide.innerHTML = `
        <div class="swirl-ai-yt-player-container">
          <div id="swirl-ai-yt-player-${index}" class="swirl-ai-yt-player"></div>
          <div class="swirl-ai-yt-overlay"></div>
          <div class="swirl-ai-yt-controls" id="swirl-ai-yt-controls-${index}">
            <div class="swirl-ai-yt-progress-container" id="swirl-ai-yt-progress-container-${index}">
              <div class="swirl-ai-yt-progress-bar">
                <div class="swirl-ai-yt-progress-fill" id="swirl-ai-yt-progress-fill-${index}"></div>
              </div>
            </div>
            <div class="swirl-ai-yt-controls-bottom">
              <button class="swirl-ai-yt-btn-play" id="swirl-ai-yt-btn-play-${index}" aria-label="Play/Pause">
                <svg class="swirl-ai-yt-icon-play" width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M8 5V19L19 12L8 5Z" fill="white"/>
                </svg>
                <svg class="swirl-ai-yt-icon-pause" width="24" height="24" viewBox="0 0 24 24" fill="none" style="display:none;">
                  <path d="M6 4H10V20H6V4ZM14 4H18V20H14V4Z" fill="white"/>
                </svg>
              </button>
              <div class="swirl-ai-yt-time">
                <span id="swirl-ai-yt-current-time-${index}">0:00</span>
                <span>/</span>
                <span id="swirl-ai-yt-duration-${index}">0:00</span>
              </div>
              <button class="swirl-ai-yt-btn-mute" id="swirl-ai-yt-btn-mute-${index}" aria-label="Mute/Unmute">
                <svg class="swirl-ai-yt-icon-volume" width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M3 9V15H7L12 20V4L7 9H3Z" fill="white"/>
                  <path d="M16.5 12C16.5 10.23 15.48 8.71 14 7.97V16.02C15.48 15.29 16.5 13.77 16.5 12Z" fill="white"/>
                </svg>
                <svg class="swirl-ai-yt-icon-muted" width="24" height="24" viewBox="0 0 24 24" fill="none" style="display:none;">
                  <path d="M3 9V15H7L12 20V4L7 9H3Z" fill="white"/>
                  <line x1="16" y1="8" x2="22" y2="16" stroke="white" stroke-width="2" stroke-linecap="round"/>
                  <line x1="22" y1="8" x2="16" y2="16" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `
      wrapper.appendChild(slide)

      // Create pagination thumbnail
      const thumb = document.createElement('div')
      thumb.className = 'swirl-ai-video-pagination-thumb'
      if (index === currentVideoIndex) {
        thumb.classList.add('active')
      }
      thumb.style.backgroundImage = `url(${video.thumbnail_url || video.thumbnail})`
      thumb.onclick = () => goToVideo(index)
      pagination.appendChild(thumb)
    })
  }

  function initializeVideoPlayer() {
    // Prevent multiple simultaneous initializations
    if (isInitializingPlayer) {
      console.log('[Swirl AI] ⏳ Player already initializing, skipping...')
      return
    }

    isInitializingPlayer = true

    const video = currentVideoData[currentVideoIndex]
    const videoId = video.videoId || video.video_id
    const startTime = video.startTime || video.start_time || 0

    console.log('[Swirl AI] 🎬 Initializing YouTube player', { videoId, startTime })

    // Create player
    youtubePlayer = new YT.Player(`swirl-ai-yt-player-${currentVideoIndex}`, {
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
        fs: 0,
        start: Math.floor(startTime)
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange
      }
    })

    // Setup custom controls
    setupVideoControls()

    // Initialize Swiper (only once)
    if (!videoSwiper) {
      initializeVideoSwiper()
    }

    // Reset flag after a delay
    setTimeout(() => {
      isInitializingPlayer = false
    }, 500)
  }

  function onPlayerReady(event) {
    console.log('[Swirl AI] ✅ YouTube player ready')
    event.target.playVideo()

    // Start progress update interval
    updateProgressInterval = setInterval(() => {
      updateVideoProgress()
    }, 100)
  }

  function onPlayerStateChange(event) {
    const playBtn = document.getElementById(`swirl-ai-yt-btn-play-${currentVideoIndex}`)
    const playIcon = playBtn?.querySelector('.swirl-ai-yt-icon-play')
    const pauseIcon = playBtn?.querySelector('.swirl-ai-yt-icon-pause')

    if (event.data === YT.PlayerState.PLAYING) {
      if (playIcon) playIcon.style.display = 'none'
      if (pauseIcon) pauseIcon.style.display = 'block'
    } else {
      if (playIcon) playIcon.style.display = 'block'
      if (pauseIcon) pauseIcon.style.display = 'none'
    }
  }

  function setupVideoControls() {
    const playBtn = document.getElementById(`swirl-ai-yt-btn-play-${currentVideoIndex}`)
    const muteBtn = document.getElementById(`swirl-ai-yt-btn-mute-${currentVideoIndex}`)
    const progressContainer = document.getElementById(`swirl-ai-yt-progress-container-${currentVideoIndex}`)

    if (playBtn) {
      playBtn.onclick = () => {
        if (!youtubePlayer || typeof youtubePlayer.getPlayerState !== 'function') return

        if (youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING) {
          if (typeof youtubePlayer.pauseVideo === 'function') {
            youtubePlayer.pauseVideo()
          }
        } else {
          if (typeof youtubePlayer.playVideo === 'function') {
            youtubePlayer.playVideo()
          }
        }
      }
    }

    if (muteBtn) {
      muteBtn.onclick = () => {
        if (!youtubePlayer || typeof youtubePlayer.isMuted !== 'function') return

        const volumeIcon = muteBtn.querySelector('.swirl-ai-yt-icon-volume')
        const mutedIcon = muteBtn.querySelector('.swirl-ai-yt-icon-muted')

        if (youtubePlayer.isMuted()) {
          if (typeof youtubePlayer.unMute === 'function') {
            youtubePlayer.unMute()
          }
          if (volumeIcon) volumeIcon.style.display = 'block'
          if (mutedIcon) mutedIcon.style.display = 'none'
        } else {
          if (typeof youtubePlayer.mute === 'function') {
            youtubePlayer.mute()
          }
          if (volumeIcon) volumeIcon.style.display = 'none'
          if (mutedIcon) mutedIcon.style.display = 'block'
        }
      }
    }

    if (progressContainer) {
      progressContainer.onclick = (e) => {
        if (!youtubePlayer || typeof youtubePlayer.getDuration !== 'function' || typeof youtubePlayer.seekTo !== 'function') return

        const rect = progressContainer.getBoundingClientRect()
        const percent = (e.clientX - rect.left) / rect.width
        const duration = youtubePlayer.getDuration()
        youtubePlayer.seekTo(duration * percent)
      }
    }
  }

  function updateVideoProgress() {
    if (!youtubePlayer || !youtubePlayer.getCurrentTime) return

    const currentTime = youtubePlayer.getCurrentTime()
    const duration = youtubePlayer.getDuration()

    if (!duration) return

    const percent = (currentTime / duration) * 100

    const progressFill = document.getElementById(`swirl-ai-yt-progress-fill-${currentVideoIndex}`)
    if (progressFill) {
      progressFill.style.width = `${percent}%`
    }

    const currentTimeEl = document.getElementById(`swirl-ai-yt-current-time-${currentVideoIndex}`)
    const durationEl = document.getElementById(`swirl-ai-yt-duration-${currentVideoIndex}`)

    if (currentTimeEl) {
      currentTimeEl.textContent = formatVideoTime(currentTime)
    }
    if (durationEl) {
      durationEl.textContent = formatVideoTime(duration)
    }
  }

  function formatVideoTime(seconds) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  function initializeVideoSwiper() {
    loadSwiperLibrary().then(() => {
      videoSwiper = new Swiper('.swirl-ai-video-swiper-container', {
        slidesPerView: 1,
        spaceBetween: 0,
        navigation: {
          nextEl: '#swirl-ai-video-nav-next',
          prevEl: '#swirl-ai-video-nav-prev',
        },
        on: {
          slideChange: function () {
            goToVideo(this.activeIndex)
          }
        }
      })

      // Go to initial video
      videoSwiper.slideTo(currentVideoIndex, 0)
    })
  }

  function goToVideo(index) {
    if (index === currentVideoIndex) return

    console.log('[Swirl AI] 📹 Switching to video', index)

    // Clear any pending initialization
    if (playerInitTimeout) {
      clearTimeout(playerInitTimeout)
      playerInitTimeout = null
    }

    // Stop current player with safety checks
    if (youtubePlayer && typeof youtubePlayer.stopVideo === 'function') {
      try {
        youtubePlayer.stopVideo()
      } catch (e) {
        console.warn('[Swirl AI] Could not stop video:', e)
      }
    }

    if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
      try {
        youtubePlayer.destroy()
      } catch (e) {
        console.warn('[Swirl AI] Could not destroy player:', e)
      }
    }
    youtubePlayer = null

    // Clear interval
    if (updateProgressInterval) {
      clearInterval(updateProgressInterval)
      updateProgressInterval = null
    }

    // Reset initialization flag
    isInitializingPlayer = false

    // Update index
    currentVideoIndex = index

    // Update pagination
    document.querySelectorAll('.swirl-ai-video-pagination-thumb').forEach((thumb, i) => {
      thumb.classList.toggle('active', i === index)
    })

    // Slide to video (don't trigger if called from swiper event)
    if (videoSwiper && videoSwiper.activeIndex !== index) {
      videoSwiper.slideTo(index, 0)
    }

    // Debounce initialization - wait for rapid slides to finish
    playerInitTimeout = setTimeout(() => {
      initializeVideoPlayer()
    }, 300)
  }

  // ===================================================
  // WEBRTC CONNECTION
  // ===================================================

  async function connectWebRTC() {
    if (isConnected) return

    // Reset session state for a fresh conversation
    orderCompleted = false
    lastShownLennoxCards = []
    lastMentionedCard = null

    const connectionStartTime = Date.now()

    try {
      updateStatusMessage('Connecting...')
      logWebRTCConnecting()

      // 1. Get ephemeral token and session config from server
      console.log('[WebRTC] Fetching session token...')
      const response = await fetch(CONFIG.sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        throw new Error('Failed to get session token')
      }

      const { client_secret, session_config, session_token, model } = await response.json()
      sessionConfig = session_config
      sessionToken = session_token
      currentModelId = model?.id === 'unified' ? null : model?.id // Set initial model if not unified
      console.log('[WebRTC] ✅ Got session token')

      // Store session token for nudge observer to use for conversation-aware nudges
      try { localStorage.setItem('swirl_last_session_token', session_token) } catch (e) { /* silent */ }
      if (currentModelId) {
        console.log(`[WebRTC] 🚗 Initial model loaded: ${model.name} (${currentModelId})`)
      }

      // TOKEN DEBUG: Initialize context tracker with session baseline
      if (DEBUG_TOKENS) {
        conversationContextTracker.reset()
        // Store system prompt for full context logging
        conversationContextTracker.systemPrompt = sessionConfig.instructions || ''
        // Estimate system prompt tokens
        const instructionsLength = sessionConfig.instructions?.length || 0
        conversationContextTracker.systemPromptTokens = Math.ceil(instructionsLength / 4)
        // Estimate tools definitions tokens (rough estimate ~250 tokens per tool)
        const toolCount = sessionConfig.tool_names?.length || 0
        conversationContextTracker.toolDefinitionsTokens = toolCount * 250

        console.log('\n' + '═'.repeat(70))
        console.log('🚀 SESSION INITIALIZED - TOKEN BASELINE')
        console.log('═'.repeat(70))
        console.log(`System instructions: ${instructionsLength.toLocaleString()} chars (~${conversationContextTracker.systemPromptTokens.toLocaleString()} tokens)`)
        console.log(`Tool definitions: ${toolCount} tools (~${conversationContextTracker.toolDefinitionsTokens.toLocaleString()} tokens)`)
        console.log(`BASELINE: ~${(conversationContextTracker.systemPromptTokens + conversationContextTracker.toolDefinitionsTokens).toLocaleString()} tokens before any conversation`)
        console.log('═'.repeat(70) + '\n')
      }

      // Test mode: Check for custom session ID
      let posthogSessionId = session_token
      if (isTestMode) {
        const testInput = document.getElementById('swirl-ai-test-input')
        const customSessionId = testInput?.value?.trim()
        if (customSessionId) {
          posthogSessionId = customSessionId
          console.log('[WebRTC] 🧪 Using custom session ID for PostHog:', customSessionId)
        }
        // Update input to show actual session ID being used and lock it
        if (testInput) {
          testInput.value = posthogSessionId
          testInput.disabled = true
          testInput.style.opacity = '0.8'
        }
      }

      // PostHog: Set session token for correlation and log session started
      setPosthogSessionToken(posthogSessionId)
      logSessionStarted({
        modelId: model?.id || window.SWIRL_CONFIG.MODEL_ID,
        modelName: model?.name || window.SWIRL_CONFIG.MODEL_ID
      })

      // 2. Get microphone access
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent)

      // Enhanced audio constraints with advanced noise suppression
      const audioConstraints = {
        // Standard constraints (all browsers)
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },

        // Minimize latency for real-time voice
        latency: { ideal: 0 },

        // iOS-specific voice isolation (uses Apple Neural Engine - VERY effective!)
        ...(isIOS && {
          voiceIsolation: { ideal: true }
        }),

        // Chrome-specific advanced noise suppression features
        ...(isChrome && {
          googNoiseSuppression: { ideal: true },
          googHighpassFilter: { ideal: true },
          googAutoGainControl2: { ideal: true },
          googEchoCancellation: { ideal: true },
          googNoiseSuppression2: { ideal: true }
        }),

        // Mobile-specific optimizations
        ...(isMobile && {
          channelCount: 1,
          sampleRate: { ideal: 16000 },
          sampleSize: { ideal: 16 }
        })
      }

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('getUserMedia unavailable — insecure context or unsupported browser')
        }
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints
        })
        console.log('[WebRTC] ✅ Got microphone access with enhanced noise suppression')

        // Log applied audio settings for debugging
        const audioTrack = localStream.getAudioTracks()[0]
        if (audioTrack) {
          const settings = audioTrack.getSettings()
          console.log('[WebRTC] 🎙️ Audio settings:', {
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
            ...(isIOS && { voiceIsolation: 'requested' }),
            ...(isChrome && { chromeFeaturesEnabled: true })
          })
        }

        logMicPermissionGranted()
        hasRealMicrophone = true // User granted mic permission
      } catch (micError) {
        logMicPermissionDenied()
        hasRealMicrophone = false // User denied mic permission
        console.log('[WebRTC] ⚠️ Microphone access denied - creating silent audio track for text-only mode')

        // Create a silent audio track (required by OpenAI Realtime API)
        // This allows WebRTC connection to work even without mic permission
        const audioContext = new (window.AudioContext || window.webkitAudioContext)()
        const oscillator = audioContext.createOscillator()
        const destination = audioContext.createMediaStreamDestination()
        oscillator.connect(destination)
        oscillator.start()

        // Create a silent stream from the destination
        localStream = destination.stream

        // Immediately mute the track (it's silent anyway, but this ensures no audio input)
        const silentTrack = localStream.getAudioTracks()[0]
        if (silentTrack) {
          silentTrack.enabled = false
        }

        console.log('[WebRTC] ✅ Created silent audio track')

        // Automatically switch to text mode if mic permission is denied
        // Set mode IMMEDIATELY to prevent race condition with greeting audio
        currentInputMode = 'text'

        // CRITICAL: Mute remote audio element IMMEDIATELY to prevent any audio playback
        if (remoteAudioEl) {
          remoteAudioEl.muted = true
          console.log('[WebRTC] 🔇 Remote audio muted for text mode')
        }

        updateStatusMessage('Microphone denied - Text mode enabled')
        setTimeout(() => {
          switchToTextMode()
        }, 100)

        // Don't throw error - continue with text-only mode using silent track
      }

      // Setup audio visualization (only if we have real mic)
      if (localStream && localStream.getAudioTracks()[0]?.label !== 'MediaStreamAudioDestinationNode') {
        setupAudioVisualization()
      }

      // 3. Create peer connection
      const rtcConfig = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
      }
      peerConnection = new RTCPeerConnection(rtcConfig)

      // 4. Add local audio track (real mic or silent track)
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          peerConnection.addTrack(track, localStream)
        })
        console.log('[WebRTC] ✅ Added audio track to peer connection')
      }

      // 5. Handle remote audio
      peerConnection.ontrack = event => {
        console.log('[WebRTC] ✅ Received remote audio track')
        remoteAudioEl.srcObject = event.streams[0]

        // Create analyzer for remote audio to detect when AI stops speaking
        try {
          remoteAudioContext = new (window.AudioContext || window.webkitAudioContext)()
          remoteAudioAnalyser = remoteAudioContext.createAnalyser()
          remoteAudioAnalyser.fftSize = 256

          const remoteSource = remoteAudioContext.createMediaStreamSource(event.streams[0])
          remoteSource.connect(remoteAudioAnalyser)
          console.log('[WebRTC] ✅ Remote audio analyzer created')
        } catch (err) {
          console.warn('[WebRTC] ⚠️ Could not create remote audio analyzer:', err.message)
        }
      }

      // 6. Create data channel for events
      dataChannel = peerConnection.createDataChannel('oai-events')
      dataChannel.onopen = handleDataChannelOpen
      dataChannel.onmessage = handleDataChannelMessage
      dataChannel.onerror = e => console.error('[WebRTC] ❌ DataChannel error:', e)
      dataChannel.onclose = () => console.log('[WebRTC] DataChannel closed')

      // 7. Create and set local description (offer)
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      console.log('[WebRTC] Created offer')

      // 8. Send offer to OpenAI and get answer
      const sdpResponse = await fetch(CONFIG.realtimeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: offer.sdp,
          client_secret: client_secret?.value || client_secret,
          session_token: sessionToken
        })
      })

      if (!sdpResponse.ok) {
        throw new Error('Failed to connect to OpenAI')
      }

      // 9. Set remote description (answer)
      const { sdp: answerSdp } = await sdpResponse.json()
      if (!answerSdp) {
        throw new Error('Missing SDP answer from server')
      }
      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      })

      console.log('[WebRTC] ✅ Connection established!')
      isConnected = true

      // Enable text input and send button now that connection is ready
      const textInput = document.getElementById('swirl-ai-text-input')
      const textSendBtn = document.getElementById('swirl-ai-text-send-btn')
      if (textInput) {
        textInput.disabled = false
        textInput.placeholder = 'Have questions? Ask here! 🤔'
      }
      if (textSendBtn) {
        textSendBtn.disabled = false
        textSendBtn.style.opacity = '1'
        textSendBtn.style.cursor = 'pointer'
      }

      // Update status message based on current mode
      // if (currentInputMode === 'text') {
      //   updateStatusMessage('Type your message...')
      // } else {
      //   updateStatusMessage('Ready to chat')
      // }

      // PostHog: Log successful connection
      const connectionLatency = Date.now() - connectionStartTime
      logWebRTCConnected({ latencyMs: connectionLatency })
    } catch (error) {
      console.error('[WebRTC] ❌ Connection error:', error)
      updateStatusMessage('Connection failed: ' + error.message)
      isConnected = false

      // PostHog: Log connection error
      logWebRTCError({
        error: error.message,
        iceState: peerConnection?.iceConnectionState || 'unknown'
      })
      logSessionError({
        error: error.message,
        stage: 'webrtc_connection'
      })
    }
  }

  function handleDataChannelOpen() {
    console.log('[WebRTC] DataChannel open - sending session config')

    // Check if we have a pending greeting - if so, disable turn detection initially
    const hasPendingGreeting = CONFIG.enablePromptAutoSend && pendingPromptToSend

    // Send session configuration
    // NOTE: Tools are already configured by backend during session creation - don't duplicate here
    const sessionUpdate = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: sessionConfig.instructions,
        voice: sessionConfig.voice,
        // Disable turn detection if we have a pending greeting to prevent race condition
        turn_detection: hasPendingGreeting ? null : {
          ...sessionConfig.turn_detection,
          create_response: true
        },
        input_audio_transcription: sessionConfig.input_audio_transcription,
        tool_choice: 'auto',
        temperature: sessionConfig.temperature,
        max_response_output_tokens: 'inf'
      }
    }
    dataChannel.send(JSON.stringify(sessionUpdate))

    if (hasPendingGreeting) {
      console.log('[WebRTC] Turn detection disabled initially - AI greeting pending')
    }

    // updateStatusMessage('Speak to continue')

    // Add active animation to mic button
    const micBtn = document.querySelector('.swirl-ai-voice-mic-btn')
    if (micBtn && localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack && audioTrack.enabled) {
        micBtn.classList.add('active')
      }
    }

    // 🎯 FEATURE HOOK: Auto-send clicked prompt (if enabled)
    checkAndSendPendingPrompt()
  }

  function handleDataChannelMessage(event) {
    try {
      const message = JSON.parse(event.data)

      // Log non-audio events
      if (
        message.type !== 'response.audio.delta' &&
        message.type !== 'input_audio_buffer.speech_started'
      ) {
        console.log('[WebRTC]', message.type, message)
      }

      switch (message.type) {
        case 'session.created':
        case 'session.updated':
          console.log('[WebRTC] ✅ Session ready')
          break

        case 'input_audio_buffer.speech_started':
          console.log('[WebRTC] 🎤 User started speaking')
          handleNewUserQuestion()  // Mark new conversation turn
          handleUserSpeechStarted()
          // PostHog: Log user speech started
          logUserSpeechStarted({ turnNumber: currentConversationTurn })
          break

        case 'input_audio_buffer.speech_stopped':
          console.log('[WebRTC] 🛑 User stopped speaking')
          handleUserSpeechStopped()
          // PostHog: Log user speech stopped
          logUserSpeechStopped({ turnNumber: currentConversationTurn })
          break

        case 'conversation.item.input_audio_transcription.completed':
          console.log('[WebRTC] 📝 User said:', message.transcript)
          showUserTranscript(message.transcript)
          // PostHog: Log full user transcript
          logUserTranscript({ text: message.transcript, turnNumber: currentConversationTurn })
          // Voice product selection → checkout (same as clicking Buy Now)
          detectVoiceProductSelection(message.transcript)
          // TOKEN DEBUG: Track user input in context
          if (DEBUG_TOKENS && message.transcript) {
            conversationContextTracker.addTurn('user', message.transcript, 'audio_transcript')
            console.log(`[TOKEN DEBUG] 👤 User transcript: "${message.transcript.substring(0, 50)}${message.transcript.length > 50 ? '...' : ''}" (~${Math.ceil(message.transcript.length / 4)} tokens)`)
          }
          break

        case 'response.created':
          console.log('[WebRTC] 🤖 AI response starting')
          handleAISpeechStarted()
          // PostHog: Log AI response started
          logAIResponseStarted({ turnNumber: currentConversationTurn })
          break

        case 'response.audio_transcript.delta':
          updateAssistantTranscript(message.delta)
          break

        case 'response.audio_transcript.done':
          console.log('[WebRTC] ✅ AI transcript complete')
          // PostHog: Log full AI response text
          logAIResponseText({ text: currentAssistantMessage, turnNumber: currentConversationTurn })
          // TOKEN DEBUG: Track assistant response in context
          if (DEBUG_TOKENS && currentAssistantMessage) {
            conversationContextTracker.addTurn('assistant', currentAssistantMessage, 'audio_response')
            console.log(`[TOKEN DEBUG] 🤖 Assistant response: "${currentAssistantMessage.substring(0, 50)}${currentAssistantMessage.length > 50 ? '...' : ''}" (~${Math.ceil(currentAssistantMessage.length / 4)} tokens)`)
          }
          // Normalize transcript: collapse all apostrophe/quote variants and punctuation noise
          // so downstream checks work regardless of how the TTS engine encodes them.
          const normalizedMsg = currentAssistantMessage
            .replace(/[\u2018\u2019\u02BC\u0060\']/g, "'") // curly/fancy apostrophes → straight
            .replace(/[\u2013\u2014]/g, '-')               // en/em dash → hyphen
            .toLowerCase()

          // Whenever AI mentions a product by name in any message, keep lastMentionedCard current.
          if (lastShownLennoxCards.length) {
            for (const card of lastShownLennoxCards) {
              const idLower = (card.id || '').toLowerCase()
              const titleWords = (card.title || '').toLowerCase().split(/\s+/)
              if (idLower && normalizedMsg.includes(idLower)) { lastMentionedCard = card; break }
              const hits = titleWords.filter(w => w.length > 3 && normalizedMsg.includes(w))
              if (hits.length >= 2) { lastMentionedCard = card; break }
            }
          }
          // When AI says checkout confirmed phrase, lock out all further product cards immediately,
          // then show the single chosen card. orderCompleted blocks displayLennoxProductCards
          // from rendering anything — including any concurrent show_products tool result.
          if (/let's get that sorted/.test(normalizedMsg) && lastMentionedCard) {
            const cardToShow = lastMentionedCard
            lastMentionedCard = null
            lastShownLennoxCards = []
            orderCompleted = true
            console.log('[Lennox] 🎯 AI confirmed purchase — showing chosen card:', cardToShow.id)
            setTimeout(() => showVoiceConfirmedProductCard(cardToShow), 400)
          }
          break

        case 'response.function_call_arguments.done':
          console.log('[WebRTC] 🔧 Tool call:', message.name)
          // PostHog: Log tool call requested (will log completion in handleToolCall)
          logToolCallRequested({
            toolName: message.name,
            args: message.arguments ? JSON.parse(message.arguments) : {},
            callId: message.call_id
          })
          handleToolCall(message)
          break

        case 'response.done':
          // Detect if this is a tool call completion or final answer
          const hasToolCalls = message.response?.output?.some(item =>
            item.type === 'function_call'
          ) || false  // Ensure boolean value

          // Only show message for final answer (not for tool calls)
          if (!hasToolCalls) updateStatusMessage('Speak to continue')

          // For nudge/greeting flow, delay mic unmuting to prevent audio loop
          // For normal flow, unmute immediately via handleAISpeechEnded()
          if (!isAIGreeting) {
            handleAISpeechEnded()
            // Wait for actual audio to finish before returning to default state
            waitForRemoteAudioSilence(() => {
              console.log('[Swirl AI] 🔇 AI audio finished (silence detected)')
              setVoiceVideoState('default')
            })
          } else {
            // Keep mic muted for nudge flow - will unmute after buffer period
            isAISpeaking = false
            console.log('[Swirl AI] 🔇 Keeping mic muted for nudge response (preventing audio loop)')
          }

          finalizeAssistantMessage()

          // Extract token usage from response.done message
          const responseUsage = message.response?.usage
          const usageData = {
            turnNumber: currentConversationTurn,
            inputTokens: responseUsage?.input_tokens || 0,
            outputTokens: responseUsage?.output_tokens || 0,
            totalTokens: responseUsage?.total_tokens || 0,
            inputTextTokens: responseUsage?.input_token_details?.text_tokens || 0,
            inputAudioTokens: responseUsage?.input_token_details?.audio_tokens || 0,
            inputCachedTokens: responseUsage?.input_token_details?.cached_tokens || 0,
            outputTextTokens: responseUsage?.output_token_details?.text_tokens || 0,
            outputAudioTokens: responseUsage?.output_token_details?.audio_tokens || 0
          }

          // Log token usage if available
          if (responseUsage) {
            // Update cumulative session stats
            updateSessionTokenStats(responseUsage)

            console.log('[WebRTC] 📊 Token usage:', {
              input: responseUsage.input_tokens,
              output: responseUsage.output_tokens,
              total: responseUsage.total_tokens,
              session_total: sessionTokenStats.totalTokens
            })
            logTokenUsage(usageData)

            // TOKEN DEBUG: Show detailed breakdown of what's consuming tokens
            if (DEBUG_TOKENS) {
              const inputDetails = responseUsage.input_token_details || {}
              const outputDetails = responseUsage.output_token_details || {}

              console.log('\n' + '═'.repeat(70))
              console.log(`📊 TURN ${usageData.turnNumber} - DETAILED TOKEN ANALYSIS`)
              console.log('═'.repeat(70))
              console.log('INPUT TOKENS:', responseUsage.input_tokens?.toLocaleString())
              console.log('  ├─ Text tokens:   ', (inputDetails.text_tokens || 0).toLocaleString())
              console.log('  ├─ Audio tokens:  ', (inputDetails.audio_tokens || 0).toLocaleString())
              console.log('  └─ Cached tokens: ', (inputDetails.cached_tokens || 0).toLocaleString(), inputDetails.cached_tokens > 0 ? '✨ (savings!)' : '')
              console.log('')
              console.log('OUTPUT TOKENS:', responseUsage.output_tokens?.toLocaleString())
              console.log('  ├─ Text tokens:   ', (outputDetails.text_tokens || 0).toLocaleString())
              console.log('  └─ Audio tokens:  ', (outputDetails.audio_tokens || 0).toLocaleString())
              console.log('─'.repeat(70))

              // Calculate token growth
              const prevInput = sessionTokenStats.totalInputTokens - responseUsage.input_tokens
              const tokenGrowth = responseUsage.input_tokens - prevInput
              if (usageData.turnNumber > 0 && prevInput > 0) {
                console.log(`⚠️  INPUT TOKEN GROWTH: +${tokenGrowth.toLocaleString()} tokens from last turn`)
                console.log(`   (Turn ${usageData.turnNumber - 1}: ${prevInput.toLocaleString()} → Turn ${usageData.turnNumber}: ${responseUsage.input_tokens.toLocaleString()})`)
              }

              console.log('')
              console.log('SESSION TOTALS:')
              console.log('  Total input:  ', sessionTokenStats.totalInputTokens.toLocaleString())
              console.log('  Total output: ', sessionTokenStats.totalOutputTokens.toLocaleString())
              console.log('  Total cached: ', sessionTokenStats.totalCachedTokens.toLocaleString())
              console.log('  Responses:    ', sessionTokenStats.responseCount)
              console.log('═'.repeat(70) + '\n')

              // Print the context breakdown (summary)
              conversationContextTracker.printContextBreakdown()

              // Print FULL context (detailed - shows what OpenAI sees)
              // This shows the accumulated conversation at this turn
              conversationContextTracker.printFullContext()

              // Send context to backend for file logging
              sendContextToBackend(usageData.turnNumber, responseUsage)
            }
          }

          // PostHog: Log AI response completed with token data
          logAIResponseCompleted(usageData)

          // Render pending media enrichment AFTER AI response is complete
          if (pendingMediaEnrichment) {
            console.log('[WebRTC] 🎬 Rendering queued media enrichment')
            const media = pendingMediaEnrichment
            pendingMediaEnrichment = null // Clear before rendering

            // Small delay to ensure text is visible first
            setTimeout(() => {
              // Render comparison cards if they were delayed for stream-first behavior
              if (media.display_comparison_after_stream && media.comparison_cards) {
                console.log('[WebRTC] 🎴 Displaying comparison cards after voice stream')
                displayComparisonCards(media.comparison_cards)
              }

              // Render warranty card after voice response
              if (media.display_warranty_after_stream && media.warranty_data) {
                console.log('[WebRTC] 🛡️ Displaying warranty card after voice stream')
                displayWarrantyCard(media.warranty_data)
              }

              // Render images
              if (media.images?.length > 0) {
                displayMedia({ images: media.images })
              }

              // Render videos
              if (media.youtube_references?.length > 0) {
                displayMedia({ youtube_references: media.youtube_references })
              }

              // Render reviews
              if (media.reviews?.length > 0) {
                displayReviews({ reviews: media.reviews })
              }

              // Render offer card after voice response
              if (media.display_offer_after_stream && media.offer_card) {
                console.log('[WebRTC] 🎉 Displaying offer card after voice stream')
                displayOfferCard(media.offer_card)
              }

              // Render EMI calculator after voice response
              if (media.display_emi_calculator_after_stream && media.emi_calculator) {
                console.log('[WebRTC] 📊 Displaying EMI calculator after voice stream')
                displayEMICalculator(media.emi_calculator)
              }
            }, 300)
          }

          // If this was the AI greeting/nudge response, re-enable turn detection and unmute mic
          if (isAIGreeting) {
            isAIGreeting = false
            console.log('[Swirl AI] ✅ AI greeting/nudge response complete')

            // Strategy: Allow early interruption while preventing audio loop
            // 1. Mic is currently MUTED (kept muted at line 2934 to prevent feedback)
            // 2. Wait 2.5 seconds to ensure AI audio has played clearly (prevents loop)
            // 3. Then UNMUTE mic and enable turn detection together
            // 4. This allows user interruption after ~2.5s of AI speaking

            setTimeout(() => {
              // Additional safety: Check if AI audio is very loud (initial burst)
              // If so, wait a bit more to ensure clear audio separation
              if (remoteAudioAnalyser) {
                const dataArray = new Uint8Array(remoteAudioAnalyser.frequencyBinCount)
                remoteAudioAnalyser.getByteFrequencyData(dataArray)
                const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

                if (average > 30) { // High volume - AI speaking loudly
                  console.log('[Swirl AI] 🔊 AI audio still very loud, waiting 1 more second...')
                  setTimeout(() => {
                    console.log('[Swirl AI] 🔊 Unmuting mic and enabling turn detection - user can now interrupt')
                    unmuteMicrophone()
                    enableTurnDetectionSafely()
                    // updateStatusMessage('Listening... (you can interrupt)') // Visual feedback
                  }, 1000) // Wait 1 more second if audio is very loud
                  return
                }
              }

              console.log('[Swirl AI] 🔊 Unmuting mic and enabling turn detection - user can now interrupt')
              unmuteMicrophone() // Unmute mic after AI audio has started
              enableTurnDetectionSafely() // Enable interruption capability
              // updateStatusMessage('Listening... (you can interrupt)') // Visual feedback
            }, 2500) // 2.5 second buffer ensures AI audio plays first, preventing feedback loop

            // Still wait for actual silence on the remote audio stream for cleanup/logging
            // This ensures we know when AI has fully finished speaking
            waitForRemoteAudioSilence(() => {
              console.log('[Swirl AI] 🔇 AI finished speaking (audio silence detected)')
              // Mic and turn detection already enabled above
              // Set video back to default state after audio completely finishes
              setVoiceVideoState('default')
            })
          }

          // Check if there's a pending message to send after cancellation
          if (pendingMessageAfterCancel) {
            console.log('[Swirl AI] 📤 Sending pending message after cancellation')
            const messageToSend = pendingMessageAfterCancel
            pendingMessageAfterCancel = null

            // Send the pending message after a brief delay
            setTimeout(() => {
              sendGenericUserMessage(messageToSend)
            }, 100)
          }
          break

        case 'response.cancelled':
          console.log('[WebRTC] 🛑 Response successfully cancelled')
          handleAISpeechEnded()
          // PostHog: Log AI interrupted
          logAIInterrupted({ reason: 'user_speech', turnNumber: currentConversationTurn })

          // Clear audio buffer completely after successful cancellation
          if (remoteAudioEl && remoteAudioEl.srcObject) {
            console.log('[Swirl AI] 🧹 Clearing audio after cancellation')
            const stream = remoteAudioEl.srcObject

            // Temporarily disable tracks
            const audioTracks = stream.getAudioTracks()
            audioTracks.forEach(track => {
              track.enabled = false
            })

            remoteAudioEl.pause()
            remoteAudioEl.currentTime = 0

            // Re-enable after clearing
            setTimeout(() => {
              audioTracks.forEach(track => {
                track.enabled = true
              })
            }, 100)
          }

          // Send pending message if exists
          if (pendingMessageAfterCancel) {
            console.log('[Swirl AI] 📤 Sending pending message after successful cancellation')
            const messageToSend = pendingMessageAfterCancel
            pendingMessageAfterCancel = null

            setTimeout(() => {
              sendGenericUserMessage(messageToSend)
            }, 200)
          }
          break

        case 'error':
          // Ignore harmless cancellation errors (response already complete)
          if (message.error?.code === 'response_cancel_not_active') {
            console.log('[WebRTC] ℹ️ Cancel request ignored - response already complete')

            // If there's a pending message, send it immediately since response is done
            if (pendingMessageAfterCancel) {
              console.log('[Swirl AI] 📤 Sending pending message (cancel was unnecessary)')
              const messageToSend = pendingMessageAfterCancel
              pendingMessageAfterCancel = null

              setTimeout(() => {
                sendGenericUserMessage(messageToSend)
              }, 100)
            }
            break
          }

          console.error('[WebRTC] ❌ Error:', message.error)
          // PostHog: Log OpenAI error
          logOpenAIError({
            errorType: message.error?.type,
            errorCode: message.error?.code,
            errorMessage: message.error?.message,
            turnNumber: currentConversationTurn
          })
          showError(message.error?.message || 'An error occurred')
          break
      }
    } catch (error) {
      console.error('[WebRTC] ❌ Error parsing message:', error)
      // PostHog: Log debug error
      logDebugError({
        category: 'webrtc',
        error: error.message,
        errorStack: error.stack,
        context: 'message_parsing',
        turnNumber: currentConversationTurn
      })
    }
  }

  function handleUserSpeechStarted() {
    isListening = true

    // Check if audio is actually playing
    const isActuallyPlaying = remoteAudioEl && !remoteAudioEl.paused && remoteAudioEl.currentTime > 0

    // Cancel AI if speaking
    if (isAISpeaking && isActuallyPlaying && dataChannel?.readyState === 'open') {
      console.log('[Swirl AI] 🛑 Interrupting AI speech - user started speaking')

      try {
        dataChannel.send(JSON.stringify({ type: 'response.cancel' }))
      } catch (error) {
        console.warn('[Swirl AI] ⚠️ Cancel request failed (response may be already complete):', error)
      }

      // Immediately stop audio playback (but keep stream connected)
      if (remoteAudioEl) {
        remoteAudioEl.pause()
        remoteAudioEl.currentTime = 0
        // Don't disconnect srcObject - we need it for the next response!
      }

      // Force set flag to false
      isAISpeaking = false
    } else if (isAISpeaking) {
      // Flag is true but audio not playing - just reset the flag
      console.log('[Swirl AI] ℹ️ Resetting stale isAISpeaking flag')
      isAISpeaking = false
    }

    // ONLY when recognizing (user speaking): Add recognizing class to hide bars and show wave
    const voiceInputContainer = document.getElementById('swirl-ai-voice-input-container')
    if (voiceInputContainer) {
      voiceInputContainer.classList.add('recognizing')
    }
    // CSS will automatically: hide bars (.swirl-ai-voice-soundwave-bars), show wave (.swirl-ai-voice-wave-animation)

    // Set video to listening state
    setVoiceVideoState('listening')

    updateStatusMessage('Listening...')
  }

  function handleUserSpeechStopped() {
    isListening = false

    // Recognition stopped: Remove recognizing class to hide wave and show bars again
    const voiceInputContainer = document.getElementById('swirl-ai-voice-input-container')
    if (voiceInputContainer) {
      voiceInputContainer.classList.remove('recognizing')
    }
    // CSS will automatically: show bars (.swirl-ai-voice-soundwave-bars), hide wave (.swirl-ai-voice-wave-animation)

    // Show loading status with random phrase
    showLoadingStatus()

    updateStatusMessage('Processing...')
  }

  function handleAISpeechStarted() {
    isAISpeaking = true

    // Skip audio playback in text mode - mute the remote audio element
    if (currentInputMode === 'text') {
      console.log('[Swirl AI] Text mode active - muting audio playback')
      if (remoteAudioEl) {
        remoteAudioEl.muted = true
      }
      updateStatusMessage('AI responding...')
      return
    }

    // Unmute remote audio in voice mode (in case it was muted in text mode)
    if (remoteAudioEl) {
      remoteAudioEl.muted = false
    }

    // CRITICAL: Resume audio playback if it was previously paused (e.g., after barge-in/interruption)
    // After calling remoteAudioEl.pause(), browsers block autoplay, so we must explicitly call play()
    if (remoteAudioEl && remoteAudioEl.paused && remoteAudioEl.srcObject) {
      remoteAudioEl.play()
        .then(() => {
          console.log('[WebRTC] ▶️ Resumed audio playback for new AI response')
        })
        .catch((err) => {
          console.warn('[WebRTC] ⚠️ Could not resume audio playback:', err.message)
          // Retry once after short delay (handles timing issues with WebRTC stream)
          setTimeout(() => {
            if (remoteAudioEl && remoteAudioEl.paused && remoteAudioEl.srcObject) {
              remoteAudioEl.play().catch(() => { })
            }
          }, 100)
        })
    }

    // Mute mic to prevent echo in voice mode (only if user hasn't manually muted)
    if (currentInputMode === 'voice' && localStream && !userMutedMic) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = false
        console.log('[WebRTC] Mic auto-muted during AI speech')
      }
    }

    // Note: Speaking state is already set in hideLoadingStatus() when first text arrives
    // This ensures speaking state shows as soon as response starts (even before audio plays)

    // updateStatusMessage('AI speaking...')
  }

  function handleAISpeechEnded(toolCall = false) {
    isAISpeaking = false

    // Note: Default state is set in waitForRemoteAudioSilence() callback
    // after audio actually finishes playing (not when text generation completes)

    // Different behavior based on input mode
    if (currentInputMode === 'text') {
      // In text mode: ensure mic stays muted, show text mode status
      if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0]
        if (audioTrack) {
          audioTrack.enabled = false
          console.log('[WebRTC] Mic kept muted in text mode')
        }
      }
      // updateStatusMessage('Type your message...')
    } else {
      // In voice mode: re-enable mic
      if (localStream && !userMutedMic) {
        const audioTrack = localStream.getAudioTracks()[0]
        if (audioTrack) {
          audioTrack.enabled = true
          const micBtn = document.querySelector('.swirl-ai-voice-mic-btn')
          if (micBtn) {
            micBtn.classList.add('active')
          }
        }
      }
      // updateStatusMessage('Your turn to speak...')
    }
  }

  function cleanupWebRTC() {
    if (peerConnection) {
      peerConnection.close()
      peerConnection = null
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      localStream = null
    }
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    dataChannel = null
    isConnected = false
    sessionToken = null

    // Reset test mode input
    if (isTestMode) {
      const testInput = document.getElementById('swirl-ai-test-input')
      if (testInput) {
        testInput.value = ''
        testInput.disabled = false
        testInput.style.opacity = '1'
      }
    }

    userMutedMic = false
    isAISpeaking = false
    isListening = false
    pendingMessageAfterCancel = null

    // Reset text streaming
    stopSynchronizedTextReveal()
    transcriptQueue = []
    fullTranscript = ''
    displayedText = ''
    currentAssistantMessage = ''
    firstTranscriptTime = null
    audioPlayStartTime = null
    isAudioPlaying = false
  }

  // ===================================================
  // TOOL CALLING
  // ===================================================

  async function handleToolCall(message) {
    const functionName = message.name
    const callId = message.call_id
    const toolStartTime = Date.now()

    console.log(`[WebRTC] 🔧 Tool call: ${functionName}`)

    try {
      let args
      try {
        args = JSON.parse(message.arguments)
      } catch (e) {
        args = message.arguments
      }

      // Execute tool on server
      const response = await fetch(CONFIG.toolsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: functionName,
          tool_args: args,
          call_id: callId,
          session_token: sessionToken,
          model_id: currentModelId // NEW: Send current active model
        })
      })

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`)
      }

      const responseData = await response.json()
      const result = responseData.result

      console.log('[WebRTC] 🔧 Tool result:', result?.success)

      // NEW: Update current model if detect_model_intent returned a model
      if (result?.model_id) {
        currentModelId = result.model_id
        console.log(`[WebRTC] 🔄 Model switched to: ${result.model_name} (${result.model_id})`)

        // Optional: Update UI indicator if you want to show current model
        updateModelIndicator(result.model_name)
      }

      // Queue media content (images, videos, reviews) for rendering AFTER AI response
      // This applies to: enrich_with_media, get_customer_reviews, search_vehicle_images, search_vehicle_knowledge
      const hasMediaContent = result?.has_media ||
        result?.images?.length > 0 ||
        result?.youtube_references?.length > 0 ||
        (result?.reviews?.length > 0 && (result?.show_reviews || functionName === 'get_customer_reviews'))

      if (hasMediaContent) {
        console.log('[WebRTC] 📦 Queuing media for after AI response:', functionName)
        // Merge with existing pending media (in case multiple tools return media)
        pendingMediaEnrichment = {
          ...pendingMediaEnrichment,
          images: result.images || pendingMediaEnrichment?.images,
          youtube_references: result.youtube_references || pendingMediaEnrichment?.youtube_references,
          reviews: result.reviews || pendingMediaEnrichment?.reviews,
          has_media: true
        }
      }

      // Display NON-media UI elements immediately (these need user interaction)
      // EXCEPT comparison cards if stream_response_first flag is set - those come after voice

      // Display Lennox product cards (UCP catalog) if available
      if (result?.has_cards && result?.cards?.length > 0) {
        displayLennoxProductCards(result.cards)
      }

      // Display vehicle cards if available (legacy BYD cards - kept for compatibility)
      if (result?.cards && result.cards.length > 0 && !result?.has_cards) {
        displayVehicleCards({ cards: result.cards })
      }

      // Display comparison cards carousel if available
      // BUT if stream_response_first is true, delay this until after voice response completes
      if (result?.has_comparison && result?.comparison_cards) {
        if (result?.stream_response_first) {
          // Queue comparison cards to display after voice response finishes
          pendingMediaEnrichment = {
            ...pendingMediaEnrichment,
            comparison_cards: result.comparison_cards,
            display_comparison_after_stream: true
          }
          console.log('[WebRTC] ⏸️  Delaying comparison cards - will show after voice response')
        } else {
          // Old behavior: show cards immediately
          displayComparisonCards(result.comparison_cards)
        }
      }

      // Display pricing table if available
      if (result?.has_pricing && result?.pricing_data) {
        displayPricingTable(result.pricing_data)
      }

      // Display trim comparison if available
      if (result?.has_trim_comparison && result?.trim_comparison_data) {
        displayTrimComparison(result.trim_comparison_data)
      }

      // Queue warranty card to display after voice response
      if (result?.has_warranty && result?.warranty_data) {
        pendingMediaEnrichment = {
          ...pendingMediaEnrichment,
          warranty_data: result.warranty_data,
          display_warranty_after_stream: true
        }
        console.log('[WebRTC] ⏸️  Queuing warranty card - will show after voice response')
      }

      // Queue offer card to display after voice response
      if (result?.has_offer && result?.offer_card) {
        pendingMediaEnrichment = {
          ...pendingMediaEnrichment,
          offer_card: result.offer_card,
          display_offer_after_stream: true
        }
        console.log('[WebRTC] ⏸️  Queuing offer card - will show after voice response')
      }

      // Queue EMI calculator to display after voice response
      if (result?.has_emi_calculator && result?.emi_calculator) {
        pendingMediaEnrichment = {
          ...pendingMediaEnrichment,
          emi_calculator: result.emi_calculator,
          display_emi_calculator_after_stream: true
        }
        console.log('[WebRTC] ⏸️  Queuing EMI calculator - will show after voice response')
      }

      // Display locations list if available (needs user selection)
      if (result?.has_locations && result?.locations && result.locations.length > 0) {
        displayLocations(result.locations)
      }

      // Display booking confirmation if available
      if (result?.has_booking && result?.booking_data) {
        displayBookingConfirmation(result.booking_data)
      }

      // Display booking slots if available (needs user selection)
      if (result?.has_booking_slots && result?.booking_slots) {
        displayBookingSlots(result.booking_slots)
      }

      // Display next steps if available (post-booking)
      if (result?.next_steps && result.next_steps.length > 0) {
        displayNextSteps(result.next_steps)
      }

      // Display predictive questions if available
      if (result?.predictive_suggestions && result.predictive_suggestions.length > 0) {
        displayPredictiveQuestions(result.predictive_suggestions)
      }

      // Display color gallery if available
      if (result?.is_color_gallery && result?.images?.length > 0) {
        displayColorGallery(result.images, result.available_colors)
      }

      // Display car configurator if available
      console.log('[WebRTC] 🚗 Checking configurator:', {
        has_configurator: result?.has_configurator,
        has_data: !!result?.configurator_data,
        colors_count: result?.configurator_data?.colors?.length || 0
      })
      if (result?.has_configurator && result?.configurator_data) {
        console.log('[WebRTC] 🚗 Calling displayConfigurator with:', result.configurator_data)
        try {
          displayConfigurator(result.configurator_data)
          console.log('[WebRTC] ✅ displayConfigurator completed')
        } catch (err) {
          console.error('[WebRTC] ❌ displayConfigurator error:', err)
        }
      }

      // Send result back to OpenAI
      // Apply token optimization if enabled (strips media data that's already shown in UI)
      const optimizedResult = optimizeToolResultForAI(result)
      const resultString = JSON.stringify(optimizedResult)
      const outputPayload = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: resultString
        }
      }

      // TOKEN DEBUG: Log what's being sent to OpenAI
      if (DEBUG_TOKENS) {
        console.log('\n' + '─'.repeat(50))
        console.log(`[TOKEN DEBUG] 🔧 TOOL RESULT → OpenAI: ${functionName}`)
        console.log('─'.repeat(50))
        console.log(`Total chars being sent: ${resultString.length.toLocaleString()}`)
        console.log(`Estimated tokens: ~${Math.ceil(resultString.length / 4).toLocaleString()}`)
        console.log('Payload breakdown:', {
          success: result.success,
          context: result.context ? `${result.context.length} chars` : 'none',
          images: result.images?.length || 0,
          youtube_references: result.youtube_references?.length || 0,
          reviews: result.reviews?.length || 0,
          cards: result.cards?.length || 0,
          locations: result.locations?.length || 0,
          booking_slots: result.booking_slots?.length || 0,
          comparison_cards: result.comparison_cards?.length || 0,
          pricing_data: result.pricing_data ? 'yes' : 'no'
        })
        // Log the first 500 chars of the payload for inspection
        console.log('Payload preview:', resultString.substring(0, 500) + (resultString.length > 500 ? '...' : ''))
        console.log('─'.repeat(50) + '\n')
      }

      logDataChannelMessage(outputPayload, 'SEND')
      dataChannel.send(JSON.stringify(outputPayload))

      // For show_products: cards are now visible — the AI already spoke before calling the tool.
      // Do NOT trigger another response; let the user browse and act on their own terms.
      if (functionName !== 'show_products') {
        await new Promise(resolve => setTimeout(resolve, 100))
        dataChannel.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: 'Answer the user\'s question using the tool results.'
          }
        }))
      }

      console.log('[WebRTC] 🔧 ✅ Tool call complete')
      // PostHog: Log tool call completed
      logToolCallCompleted({
        toolName: functionName,
        durationMs: Date.now() - toolStartTime,
        success: true,
        callId: callId
      })
    } catch (error) {
      console.error('[WebRTC] 🔧 ❌ Tool call failed:', error)
      // PostHog: Log tool call error
      logToolCallError({
        toolName: functionName,
        error: error.message,
        callId: callId
      })

      // Send error back to OpenAI
      const errorOutput = {
        success: false,
        error: error.message,
        context: `Error: ${error.message}`
      }

      dataChannel.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(errorOutput)
          }
        })
      )

      // Request response even after error
      dataChannel.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio']
          }
        })
      )
    }
  }

  // ===================================================
  // MICROPHONE CONTROL
  // ===================================================

  function toggleMicrophone() {
    if (!localStream) return

    const audioTrack = localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      userMutedMic = !audioTrack.enabled

      console.log(`[WebRTC] 🎤 Microphone ${audioTrack.enabled ? 'unmuted' : 'muted'} by user`)
      // PostHog: Log mic mute/unmute
      if (audioTrack.enabled) {
        logMicUnmuted()
      } else {
        logMicMuted({ by: 'user' })
      }

      const micBtn = document.querySelector('.swirl-ai-voice-mic-btn')
      const unmutedIcon = document.querySelector('.swirl-ai-mic-icon-unmuted')
      const mutedIcon = document.querySelector('.swirl-ai-mic-icon-muted')

      if (micBtn && unmutedIcon && mutedIcon) {
        micBtn.classList.toggle('muted', !audioTrack.enabled)

        if (audioTrack.enabled) {
          // Unmuted state
          micBtn.classList.add('active')
          unmutedIcon.style.display = 'block'
          mutedIcon.style.display = 'none'
        } else {
          // Muted state
          micBtn.classList.remove('active')
          unmutedIcon.style.display = 'none'
          mutedIcon.style.display = 'block'
        }
      }

      hideStatusMessages()
    }
  }

  // ===================================================
  // AUDIO VISUALIZATION
  // ===================================================

  function setupAudioVisualization() {
    if (!localStream) return

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256

      const source = audioContext.createMediaStreamSource(localStream)
      source.connect(analyser)
    } catch (error) {
      console.error('[WebRTC] Audio visualization error:', error)
    }
  }

  // ===================================================
  // AUDIO SYNCHRONIZATION
  // ===================================================

  function setupAudioSyncListeners() {
    if (!remoteAudioEl) return

    remoteAudioEl.addEventListener('play', () => {
      console.log('[Sync] Audio started playing')
      isAudioPlaying = true
      audioPlayStartTime = Date.now()
      startSynchronizedTextReveal()
    })

    remoteAudioEl.addEventListener('pause', () => {
      console.log('[Sync] Audio paused')
      isAudioPlaying = false  // Keep state consistent when audio is paused (e.g., during barge-in)
    })

    remoteAudioEl.addEventListener('ended', () => {
      console.log('[Sync] Audio ended')
      isAudioPlaying = false
      setTimeout(flushRemainingText, 200)
    })

    // Error handling for audio stream issues
    remoteAudioEl.addEventListener('error', (e) => {
      console.error('[Sync] Audio error:', e)
      isAudioPlaying = false
      // Try to recover by re-triggering play on next AI response
    })

    remoteAudioEl.addEventListener('stalled', () => {
      console.warn('[Sync] Audio stalled - stream may be buffering')
    })

    remoteAudioEl.addEventListener('waiting', () => {
      console.log('[Sync] Audio waiting for data')
    })
  }

  // ===================================================
  // TEXT STREAMING & RENDERING
  // ===================================================

  function renderMarkdown(element, text) {
    if (typeof marked === 'undefined') {
      element.textContent = text
      return
    }

    try {
      const html = marked.parse(text, {
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false
      })
      element.innerHTML = html
      scrollToBottom()
    } catch (error) {
      element.textContent = text
    }
  }

  function updateAssistantTranscript(delta) {
    const now = Date.now()

    if (!firstTranscriptTime) {
      firstTranscriptTime = now
    }

    transcriptQueue.push({
      text: delta,
      timestamp: now
    })

    fullTranscript += delta
    currentAssistantMessage += delta

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    let messageDiv = messagesContainer?.querySelector('.swirl-ai-response-message.current')

    if (!messageDiv) {
      // Clear previous conversation on first text event
      clearOnFirstEvent()

      hideStatusMessages()

      // Voice icon GIF stays visible at top (never hide it)

      messageDiv = document.createElement('div')
      messageDiv.className = 'swirl-ai-response-message current'
      messagesContainer?.appendChild(messageDiv)
    }

    if (!syncInterval) {
      startSynchronizedTextReveal()
    }
  }

  function startSynchronizedTextReveal() {
    if (syncInterval) return

    console.log('[Sync] Starting text reveal')

    syncInterval = setInterval(() => {
      const now = Date.now()
      let textToReveal = ''
      let itemsToProcess = 0

      for (let i = 0; i < transcriptQueue.length; i++) {
        const item = transcriptQueue[i]
        const itemAge = now - item.timestamp

        if (itemAge >= TEXT_DELAY_MS) {
          textToReveal += item.text
          itemsToProcess++
        } else {
          break
        }
      }

      if (itemsToProcess > 0) {
        transcriptQueue.splice(0, itemsToProcess)
        displayedText += textToReveal

        const messageDiv = document.querySelector('.swirl-ai-response-message.current')
        if (messageDiv) {
          renderMarkdown(messageDiv, displayedText)
        }
      }
    }, SYNC_INTERVAL_MS)
  }

  function stopSynchronizedTextReveal() {
    if (syncInterval) {
      clearInterval(syncInterval)
      syncInterval = null
    }
  }

  function flushRemainingText() {
    if (transcriptQueue.length > 0) {
      console.log('[Sync] Flushing remaining text')

      for (const item of transcriptQueue) {
        displayedText += item.text
      }
      transcriptQueue = []

      const messageDiv = document.querySelector('.swirl-ai-response-message.current')
      if (messageDiv) {
        renderMarkdown(messageDiv, displayedText)
      }
    }
  }

  function finalizeAssistantMessage() {
    stopSynchronizedTextReveal()
    flushRemainingText()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    const messageDiv = messagesContainer?.querySelector('.swirl-ai-response-message.current')
    if (messageDiv) messageDiv.classList.remove('current')

    currentAssistantMessage = ''
    transcriptQueue = []
    fullTranscript = ''
    displayedText = ''
    firstTranscriptTime = null
    audioPlayStartTime = null

    // updateStatusMessage('Speak to continue')
  }

  // ===================================================
  // CHAT UI FUNCTIONS - NEW FIGMA DESIGN
  // ===================================================

  // Update model indicator badge to show current active model
  function updateModelIndicator(modelName) {
    if (!modelName) return

    const modalContent = document.querySelector('.swirl-ai-voice-modal-content')
    if (!modalContent) return

    let indicator = document.getElementById('swirl-current-model-indicator')
    if (!indicator) {
      // Create indicator if doesn't exist
      indicator = document.createElement('div')
      indicator.id = 'swirl-current-model-indicator'
      indicator.style.cssText = `
        position: absolute;
        top: 60px;
        right: 20px;
        padding: 6px 12px;
        background: #1E40AF;
        color: white;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(30, 64, 175, 0.3);
      `
      modalContent.appendChild(indicator)
    }
    indicator.textContent = `Current: ${modelName}`
  }

  function showUserTranscript(text) {
    console.log('[Swirl AI] User transcript:', text)

    // Show user text in toast box (disappears after 2 seconds)
    const userPromptBox = document.getElementById('swirl-ai-user-prompt-text')
    if (userPromptBox) {
      userPromptBox.textContent = text
      userPromptBox.style.display = 'flex'

      // Hide after 2 seconds
      setTimeout(() => {
        userPromptBox.style.display = 'none'
      }, 2000)
    }
  }

  /**
   * Appends user message in chat container for text mode (right-aligned)
   * Used only in text mode - voice mode uses showUserTranscript instead
   */
  function appendUserMessageInChat(text) {
    console.log('[Swirl AI] Appending user message in chat (text mode):', text)

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    // Create user message div (right-aligned)
    const userMessageDiv = document.createElement('div')
    userMessageDiv.className = 'swirl-ai-user-message'
    userMessageDiv.textContent = text

    messagesContainer.appendChild(userMessageDiv)
    scrollToBottom()
  }

  function scrollToBottom() {
    if (currentInputMode === 'voice') return // No scrolling in voice mode
    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
  }

  /**
   * Changes the voice agent video state
   * @param {string} state - One of: 'default', 'listening', 'thinking', 'speaking'
   */
  function setVoiceVideoState(state) {
    const videoElement = document.getElementById('swirl-ai-voice-video')
    if (!videoElement) {
      console.warn('[Swirl AI] Voice video element not found')
      return
    }

    const videoPath = CONFIG.voiceVideoStates[state]
    if (!videoPath) {
      console.warn(`[Swirl AI] Invalid video state: ${state}`)
      return
    }

    // Check if already showing this state
    const currentSrc = videoElement.querySelector('source')?.src
    if (currentSrc === videoPath) {
      return // Already showing this state
    }

    console.log(`[Swirl AI] 🎬 Changing video state to: ${state}`)

    // Change video source
    const sourceElement = videoElement.querySelector('source')
    if (sourceElement) {
      sourceElement.src = videoPath
      videoElement.load() // Reload video with new source
      videoElement.play().catch(err => {
        console.warn('[Swirl AI] Video autoplay blocked:', err)
      })
    }
  }

  // ===================================================
  // VEHICLE CARDS DISPLAY (Simple UI - No Card Titles)
  // ===================================================

  // ===================================================
  // LENNOX PRODUCT CARDS (UCP Catalog)
  // ===================================================

  // Show a single highlighted product card after voice confirmation — Buy Now triggers checkout
  function showVoiceConfirmedProductCard(card) {
    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer || !card) return

    const seerLabel = card.seer2 ? `${card.seer2} SEER2` : card.seer ? `${card.seer} SEER` : ''
    const starsHtml = '★'.repeat(Math.floor(card.rating || 4)) + '☆'.repeat(5 - Math.floor(card.rating || 4))

    const wrapper = document.createElement('div')
    wrapper.className = 'swirl-ai-response-container'
    wrapper.innerHTML = `
      <style>
        @keyframes lx-chosen-in {
          0%   { opacity:0; transform:translateY(16px) scale(0.97); }
          100% { opacity:1; transform:translateY(0) scale(1); }
        }
        .lx-chosen-card {
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid #e8e8ed;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06);
          overflow: hidden;
          animation: lx-chosen-in 0.35s ease both;
          max-width: 280px;
        }
        .lx-chosen-badge {
          background: #1d1d1f;
          color: #fff;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 5px 14px;
          text-align: center;
        }
        .lx-chosen-buy-btn {
          width: 100%;
          padding: 12px;
          background: #1d1d1f;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }
        .lx-chosen-buy-btn:hover { opacity: 0.82; }
      </style>
      <div class="lx-chosen-card" data-product-id="${card.id}">
        <div class="lx-chosen-badge">✓ Your Choice</div>
        <div style="background:#f5f5f7;padding:16px;display:flex;align-items:center;justify-content:center;height:140px;border-bottom:1px solid #e8e8ed;">
          <img src="${card.image_url}" alt="${card.title}" style="max-height:120px;max-width:100%;object-fit:contain;" onerror="this.style.opacity='0'" />
        </div>
        <div style="padding:14px;">
          <div style="font-size:10px;color:#86868b;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.6px;font-weight:500;">${card.series}</div>
          <div style="font-size:15px;font-weight:600;color:#1d1d1f;margin-bottom:9px;line-height:1.3;">${card.title}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px;">
            ${seerLabel ? `<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:500;background:#f0f4ff;color:#3a6fda;border:1px solid #d5e2ff;">${seerLabel}</span>` : ''}
            ${card.noise ? `<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:500;background:#f5f5f7;color:#86868b;border:1px solid #e8e8ed;">${card.noise} dB</span>` : ''}
            ${card.energy_star ? `<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:500;background:#f0faf4;color:#28a745;border:1px solid #c3e6cb;">Energy Star</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
            <span style="color:#f5a623;font-size:12px;letter-spacing:1px;">${starsHtml}</span>
            <span style="font-size:11px;color:#86868b;">${card.rating} (${(card.reviews||0).toLocaleString()})</span>
          </div>
          <div style="font-size:18px;font-weight:700;color:#1d1d1f;margin-bottom:12px;">${card.price_display || '$$$'}</div>
          <button class="lx-chosen-buy-btn" data-id="${card.id}">Confirm & Buy Now</button>
        </div>
      </div>
    `

    // Clicking Buy Now or the card itself → checkout
    wrapper.addEventListener('click', (e) => {
      const btn = e.target.closest('.lx-chosen-buy-btn')
      const cardEl = e.target.closest('.lx-chosen-card')
      if (btn) {
        e.stopPropagation()
        initiateUCPCheckout(btn.dataset.id)
      } else if (cardEl) {
        initiateUCPCheckout(cardEl.dataset.productId)
      }
    })

    messagesContainer.appendChild(wrapper)
    scrollToBottom()
  }

  // Notify AI that a user clicked on a product card (interest, not purchase)
  function notifyAIOfCardInterest(card) {
    if (!card) return
    const productName = card.title || card.id
    const series = card.series ? ` (${card.series})` : ''
    console.log('[Lennox] 👆 Card interest click:', card.id)
    // Pin this card as the current selection — so if the AI responds with "let's get that sorted",
    // the checkout detection has the card ready without needing to re-parse the AI's words.
    lastMentionedCard = card
    triggerAISpeak(`The customer just clicked on the ${productName}${series} card — they're interested. Speak as their advisor: acknowledge their choice warmly, share one specific compelling reason this is a great pick for them (energy efficiency, noise level, warranty, reliability — pick the most relevant), then naturally invite them to ask anything or take the next step. 1-2 sentences, confident and warm.`)
  }

  // Track which card the user is talking about — AI owns all confirmation logic
  function detectVoiceProductSelection(transcript) {
    if (!transcript || !lastShownLennoxCards.length) return
    const t = transcript.toLowerCase()

    let matchedCard = null

    for (const card of lastShownLennoxCards) {
      const idLower = (card.id || '').toLowerCase()
      const titleWords = (card.title || '').toLowerCase().split(/\s+/)
      const seriesLower = (card.series || '').toLowerCase()
      const tierLower = (card.price_display || '').toLowerCase()

      if (idLower && t.includes(idLower.replace(/-/g, ' '))) { matchedCard = card; break }
      const titleHits = titleWords.filter(w => w.length > 3 && t.includes(w))
      if (titleHits.length >= 2) { matchedCard = card; break }
      if (seriesLower && (seriesLower.split(' ').some(w => w.length > 4 && t.includes(w)))) { matchedCard = card; break }
      if ((t.includes('second') || t.includes('2nd') || t.includes('middle')) && lastShownLennoxCards.indexOf(card) === 1) { matchedCard = card; break }
      if ((t.includes('first') || t.includes('1st')) && lastShownLennoxCards.indexOf(card) === 0) { matchedCard = card; break }
      if ((t.includes('third') || t.includes('3rd')) && lastShownLennoxCards.indexOf(card) === 2) { matchedCard = card; break }
      if ((t.includes('last') || t.includes('fourth') || t.includes('4th')) && lastShownLennoxCards.indexOf(card) === lastShownLennoxCards.length - 1) { matchedCard = card; break }
      if ((t.includes('premium') || t.includes('expensive') || t.includes('best')) && tierLower === '$$$$') { matchedCard = card; break }
      if ((t.includes('budget') || t.includes('cheapest') || t.includes('affordable')) && tierLower === '$') { matchedCard = card; break }
    }

    // "that one" / "this one" with single card shown
    if (!matchedCard && lastShownLennoxCards.length === 1 && /\b(that|this) one\b/i.test(t)) {
      matchedCard = lastShownLennoxCards[0]
    }

    if (matchedCard) {
      lastMentionedCard = matchedCard
      console.log('[Lennox] 🎙️ Tracking user interest in:', matchedCard.id)
    }
  }

  async function initiateUCPCheckout(productId) {
    console.log('[Lennox] Initiating UCP checkout for:', productId)

    // Silently stop AI if speaking — checkout runs independently, no AI interaction during flow
    if (isAISpeaking && dataChannel?.readyState === 'open') {
      try { dataChannel.send(JSON.stringify({ type: 'response.cancel' })) } catch (e) {}
      isAISpeaking = false
    }

    try {
      const createRes = await fetch('/checkout-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: 'USD',
          line_items: [{ item: { id: productId }, quantity: 1 }],
          payment: {}
        })
      })
      if (!createRes.ok) throw new Error('Failed to create checkout')
      const checkout = await createRes.json()
      const lineItemIds = checkout.line_items.map(li => li.id)

      const updateRes = await fetch(`/checkout-sessions/${checkout.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: checkout.id,
          currency: checkout.currency,
          line_items: checkout.line_items,
          payment: checkout.payment || {},
          buyer: {
            full_name: 'Lennox Customer',
            email: 'customer@lennox.com',
            phone_number: '+1-800-555-0100'
          },
          fulfillment: {
            methods: [{
              type: 'shipping',
              selected_destination_id: 'dest_1',
              destinations: [{
                id: 'dest_1',
                name: 'Lennox Customer',
                address: {
                  street_address: '1600 Amphitheatre Pkwy',
                  address_locality: 'Mountain View',
                  address_region: 'CA',
                  postal_code: '94043',
                  address_country: 'US',
                  full_name: 'Lennox Customer'
                }
              }],
              groups: [{ line_item_ids: lineItemIds, selected_option_id: 'std-ship' }]
            }]
          }
        })
      })
      if (!updateRes.ok) throw new Error('Failed to update checkout')
      const updated = await updateRes.json()

      // Inject checkout card into voice agent chat
      const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
      if (!messagesContainer) return
      const item = updated.line_items?.[0]?.item || {}
      const buyer = updated.buyer || {}
      const dest = updated.fulfillment?.methods?.[0]?.destinations?.[0]

      const checkoutDiv = document.createElement('div')
      checkoutDiv.className = 'swirl-ai-response-container'
      checkoutDiv.innerHTML = `
        <div style="background:#fff;border-radius:16px;border:1px solid #e0e0e0;padding:20px;max-width:420px;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <span style="font-size:18px;font-weight:600;color:#1f1f1f;">Lennox</span>
            <span style="font-size:13px;color:#5f6368;">Review your order</span>
          </div>
          <div style="display:flex;gap:12px;background:#f8f9fa;border-radius:12px;padding:14px;margin-bottom:14px;align-items:center;">
            <img src="${item.image_url || `/assets/${item.id}.png`}" style="width:64px;height:64px;object-fit:contain;border-radius:8px;background:#fff;" />
            <div style="flex:1;">
              <div style="font-weight:500;color:#1f1f1f;font-size:14px;">${item.title || 'Lennox AC Unit'}</div>
              <div style="font-size:12px;color:#5f6368;margin-top:2px;">Qty: 1</div>
            </div>
            <div style="font-size:13px;font-weight:600;color:#1f1f1f;">Contact dealer</div>
          </div>
          ${buyer.full_name ? `<div style="display:flex;gap:10px;padding:12px;background:#f8f9fa;border-radius:10px;margin-bottom:10px;align-items:center;"><span style="font-size:20px;">👤</span><div><div style="font-size:13px;font-weight:500;">${buyer.full_name}</div><div style="font-size:12px;color:#5f6368;">${buyer.email || ''}</div></div></div>` : ''}
          ${dest ? `<div style="display:flex;gap:10px;padding:12px;background:#f8f9fa;border-radius:10px;margin-bottom:10px;align-items:center;"><span style="font-size:20px;">📍</span><div style="font-size:12px;color:#5f6368;">${dest.address?.street_address}, ${dest.address?.address_locality}, ${dest.address?.address_region}</div></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #e0e0e0;margin-top:4px;margin-bottom:14px;">
            <span style="font-size:13px;color:#5f6368;">Pricing</span>
            <span style="font-size:15px;font-weight:600;color:#1f1f1f;">Contact dealer</span>
          </div>
          <button id="lennox-pay-btn-${checkout.id}" style="width:100%;padding:13px;background:#4285f4;color:#fff;border:none;border-radius:24px;font-size:15px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
            <span style="font-weight:700;font-size:17px;">G</span> Pay with Google Pay
          </button>
          <div style="font-size:11px;color:#80868b;line-height:1.4;margin-top:12px;">By continuing, you agree to Lennox terms and return policy.</div>
        </div>
      `
      messagesContainer.appendChild(checkoutDiv)
      // Always scroll checkout into view regardless of input mode — user must see it
      checkoutDiv.scrollIntoView({ behavior: 'smooth', block: 'start' })

      document.getElementById(`lennox-pay-btn-${checkout.id}`)?.addEventListener('click', async () => {
        try {
          const completeRes = await fetch(`/checkout-sessions/${checkout.id}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payment_data: {
                id: 'gpay_' + Date.now(),
                handler_id: 'google_pay',
                type: 'card',
                brand: 'visa',
                last_digits: '3297',
                credential: { type: 'token', token: 'demo_token_' + Date.now() }
              }
            })
          })
          const completed = await completeRes.json()
          const orderId = completed.order_id || checkout.id
          const orderItem = completed.line_items?.[0]?.item || item
          const orderBuyer = completed.buyer || buyer
          const orderDest = completed.fulfillment?.methods?.[0]?.destinations?.[0] || dest
          // Delivery estimate: 3-4 business days from order
          const deliveryDate = new Date()
          deliveryDate.setDate(deliveryDate.getDate() + 4)
          const deliveryStr = deliveryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          const addr = orderDest?.address || orderDest || {}
          const productName = orderItem?.title || 'Lennox AC Unit'

          // Show confirmed order card — Lennox branded, Etsy-style layout
          const orderIdShort = orderId ? String(orderId).slice(0, 16).toUpperCase() : 'LNX-' + Date.now().toString(36).toUpperCase()
          const buyerName = orderBuyer?.full_name || 'Lennox Customer'
          const buyerEmail = orderBuyer?.email || 'customer@lennox.com'
          const addrLine = addr?.street_address ? `${addr.street_address}, ${addr.address_locality}, ${addr.address_region} ${addr.postal_code || ''}`.trim() : ''

          checkoutDiv.innerHTML = `
            <style>
              @keyframes lx-confirm-in {
                0%   { opacity:0; transform:translateY(20px) scale(0.97); }
                100% { opacity:1; transform:translateY(0) scale(1); }
              }
              @keyframes lx-checkpop {
                0%   { transform:scale(0) rotate(-20deg); opacity:0; }
                65%  { transform:scale(1.18) rotate(4deg); opacity:1; }
                100% { transform:scale(1) rotate(0); opacity:1; }
              }
              @keyframes lx-ring-pop {
                0%   { transform:scale(1); opacity:0.7; }
                100% { transform:scale(1.75); opacity:0; }
              }
              .lx-confirm-card {
                background: #1c1c1e;
                border-radius: 18px;
                border: 1px solid rgba(255,255,255,0.10);
                max-width: 400px;
                overflow: hidden;
                box-shadow: 0 12px 40px rgba(0,0,0,0.45);
                animation: lx-confirm-in 0.45s cubic-bezier(0.25,1,0.5,1) both;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              }
              .lx-confirm-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 18px 20px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.07);
              }
              .lx-confirm-title {
                font-size: 17px;
                font-weight: 700;
                color: #fff;
                letter-spacing: -0.3px;
              }
              .lx-confirm-check {
                position: relative;
                width: 38px;
                height: 38px;
                flex-shrink: 0;
              }
              .lx-confirm-check-ring {
                position: absolute;
                inset: 0;
                border-radius: 50%;
                border: 2px solid rgba(52,199,89,0.55);
                animation: lx-ring-pop 1.5s ease-out 0.2s infinite;
              }
              .lx-confirm-check-circle {
                width: 38px;
                height: 38px;
                border-radius: 50%;
                background: #34c759;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 3px 14px rgba(52,199,89,0.4);
                animation: lx-checkpop 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.15s both;
              }
              .lx-confirm-body {
                padding: 16px 20px;
              }
              .lx-confirm-thankyou {
                font-size: 13.5px;
                font-weight: 600;
                color: #fff;
                margin-bottom: 4px;
              }
              .lx-confirm-email-note {
                font-size: 12px;
                color: rgba(255,255,255,0.45);
                margin-bottom: 16px;
                line-height: 1.45;
              }
              .lx-confirm-meta-row {
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                margin-bottom: 5px;
              }
              .lx-confirm-meta-label {
                font-size: 12px;
                color: rgba(255,255,255,0.4);
              }
              .lx-confirm-meta-value {
                font-size: 12.5px;
                font-weight: 500;
                color: rgba(255,255,255,0.82);
              }
              .lx-confirm-meta-value.link {
                color: #4da3ff;
                text-decoration: underline;
                cursor: pointer;
              }
              .lx-confirm-divider {
                height: 1px;
                background: rgba(255,255,255,0.07);
                margin: 14px 0;
              }
              .lx-confirm-product-row {
                display: flex;
                gap: 14px;
                align-items: center;
                background: rgba(255,255,255,0.05);
                border-radius: 12px;
                padding: 12px;
                margin-bottom: 14px;
                border: 1px solid rgba(255,255,255,0.07);
              }
              .lx-confirm-product-img {
                width: 66px;
                height: 66px;
                object-fit: contain;
                border-radius: 8px;
                background: rgba(255,255,255,0.06);
                flex-shrink: 0;
              }
              .lx-confirm-product-brand {
                font-size: 10px;
                color: rgba(255,255,255,0.35);
                text-transform: uppercase;
                letter-spacing: 0.7px;
                margin-bottom: 4px;
              }
              .lx-confirm-product-name {
                font-size: 13.5px;
                font-weight: 600;
                color: rgba(255,255,255,0.9);
                line-height: 1.3;
                margin-bottom: 4px;
              }
              .lx-confirm-product-qty {
                font-size: 11.5px;
                color: rgba(255,255,255,0.38);
              }
              .lx-confirm-product-price {
                font-size: 13px;
                font-weight: 600;
                color: rgba(255,255,255,0.7);
                margin-left: auto;
                flex-shrink: 0;
                align-self: flex-start;
                padding-top: 2px;
              }
              .lx-confirm-totals {
                background: rgba(255,255,255,0.04);
                border-radius: 10px;
                padding: 12px 14px;
                margin-bottom: 14px;
              }
              .lx-confirm-total-row {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                color: rgba(255,255,255,0.45);
                margin-bottom: 6px;
              }
              .lx-confirm-total-row:last-child { margin-bottom: 0; }
              .lx-confirm-total-row.grand {
                font-size: 14px;
                font-weight: 700;
                color: #fff;
                padding-top: 8px;
                margin-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.09);
              }
              .lx-confirm-support {
                display: flex;
                gap: 10px;
                align-items: flex-start;
                background: rgba(255,255,255,0.04);
                border-radius: 10px;
                padding: 12px 14px;
                font-size: 11.5px;
                color: rgba(255,255,255,0.35);
                line-height: 1.45;
              }
              .lx-confirm-support-icon {
                font-size: 15px;
                flex-shrink: 0;
                margin-top: 1px;
              }
              .lx-confirm-support a {
                color: #4da3ff;
              }
            </style>
            <div class="lx-confirm-card">
              <div class="lx-confirm-header">
                <span class="lx-confirm-title">Order confirmed</span>
                <div class="lx-confirm-check">
                  <div class="lx-confirm-check-ring"></div>
                  <div class="lx-confirm-check-circle">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                </div>
              </div>

              <div class="lx-confirm-body">
                <div class="lx-confirm-thankyou">Thank you. Your order has been confirmed.</div>
                <div class="lx-confirm-email-note">Lennox will send a confirmation to your email. It may take a few minutes to arrive.</div>

                <div class="lx-confirm-meta-row">
                  <span class="lx-confirm-meta-label">Order number</span>
                  <span class="lx-confirm-meta-value link">${orderIdShort}</span>
                </div>
                <div class="lx-confirm-meta-row">
                  <span class="lx-confirm-meta-label">Delivery</span>
                  <span class="lx-confirm-meta-value">Arrives by ${deliveryStr}</span>
                </div>
                ${addrLine ? `
                <div class="lx-confirm-meta-row" style="margin-top:2px;">
                  <span class="lx-confirm-meta-label">Shipping address</span>
                  <span class="lx-confirm-meta-value" style="text-align:right;max-width:55%;">${buyerName}<br><span style="font-weight:400;color:rgba(255,255,255,0.45);font-size:11.5px;">${addrLine}</span></span>
                </div>` : ''}

                <div class="lx-confirm-divider"></div>

                <div class="lx-confirm-product-row">
                  <img class="lx-confirm-product-img" src="${orderItem?.image_url || `/assets/${orderItem?.id}.png`}" onerror="this.style.opacity='0'" alt="${productName}" />
                  <div style="flex:1;min-width:0;">
                    <div class="lx-confirm-product-brand">Lennox</div>
                    <div class="lx-confirm-product-name">${productName}</div>
                    <div class="lx-confirm-product-qty">Qty: 1</div>
                  </div>
              
                </div>

                <div class="lx-confirm-totals">
                  <div class="lx-confirm-total-row">
                    <span>Payment method</span>
                    <span>Visa XXXX 3297</span>
                  </div>
                  <div class="lx-confirm-total-row">
                    <span>Subtotal</span>
                    <span>Contact dealer</span>
                  </div>
                  <div class="lx-confirm-total-row">
                    <span>Installation & shipping</span>
                    <span>Contact dealer</span>
                  </div>
                  <div class="lx-confirm-total-row grand">
                    <span>Total price</span>
                    <span>Contact dealer</span>
                  </div>
                </div>

                <div class="lx-confirm-support">
                  <span class="lx-confirm-support-icon">🔧</span>
                  <span><a href="#">Contact Lennox Support</a> if you need help with your order. We can assist with installation, delivery, warranty, and returns.</span>
                </div>
              </div>
            </div>
          `
          scrollToBottom()

          // Order done — lock out all further product card rendering permanently
          orderCompleted = true
          lastShownLennoxCards = []
          lastMentionedCard = null

          // After 1s: agent celebrates — speaks in its own voice, no fake user message
          setTimeout(() => {
            triggerAISpeak(`The customer just completed their purchase of the ${productName} (order ref ${orderIdShort}, arriving by ${deliveryStr}). The order confirmation card is already visible — do NOT read out the details. Speak as their trusted advisor: celebrate this moment genuinely, tell them why they made a great choice, and leave them feeling great about it. 2-3 warm, natural sentences.`)
          }, 1000)

        } catch (e) {
          console.error('[Lennox] Payment error:', e)
        }
      })
    } catch (err) {
      console.error('[Lennox] Checkout error:', err)
    }
  }

  function displayLennoxProductCards(cards) {
    if (orderCompleted) return // Order is done — never show product cards again
    console.log('[Lennox] Displaying product cards:', cards.length)
    lastShownLennoxCards = cards // Track for voice selection
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer || !cards.length) return

    const container = document.createElement('div')
    container.className = 'swirl-ai-response-container'

    container.innerHTML = `
      <style>
        @keyframes lennox-card-in {
          from { opacity:0; transform:translateY(16px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .swirl-lennox-card {
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid #e8e8ed;
          overflow: hidden;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
          animation: lennox-card-in 0.35s ease both;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
        }
        .swirl-lennox-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.1);
        }
        .lennox-card-img-wrap {
          background: #f5f5f7;
          padding: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 160px;
        }
        .lennox-tag {
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.1px;
        }
        .lennox-buy-btn {
          width: 100%;
          padding: 11px;
          background: #1d1d1f;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.1px;
          transition: background 0.15s ease;
        }
        .lennox-buy-btn:hover { background: #3a3a3c; }
        .swirl-ai-cards-nav-prev, .swirl-ai-cards-nav-next {
          background: rgba(255,255,255,0.9) !important;
          border: 1px solid #e8e8ed !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
        }
      </style>
      <div class="swirl-ai-cards-swiper-wrapper">
        <div class="swirl-ai-lennox-cards-swiper swiper">
          <div class="swiper-wrapper">
            ${cards.map((card, i) => {
              const seerLabel = card.seer2 ? `${card.seer2} SEER2` : card.seer ? `${card.seer} SEER` : ''
              const starsHtml = '★'.repeat(Math.floor(card.rating || 4)) + '☆'.repeat(5 - Math.floor(card.rating || 4))
              return `
                <div class="swiper-slide">
                  <div class="swirl-lennox-card" data-product-id="${card.id}" style="animation-delay:${i * 0.06}s;">
                    <div class="lennox-card-img-wrap">
                      <img src="${card.image_url}" alt="${card.title}" style="max-height:130px;max-width:100%;object-fit:contain;" onerror="this.style.opacity='0'" />
                    </div>
                    <div style="padding:16px;">
                      <div style="font-size:10px;color:#86868b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;font-weight:500;">${card.series}</div>
                      <div style="font-size:15px;font-weight:600;color:#1d1d1f;margin-bottom:10px;line-height:1.3;">${card.title}</div>
                      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;">
                        ${seerLabel ? `<span class="lennox-tag" style="background:#f0f5ff;color:#3b7ef5;border:1px solid #d5e3fd;">${seerLabel}</span>` : ''}
                        ${card.noise ? `<span class="lennox-tag" style="background:#f5f5f7;color:#6e6e73;border:1px solid #e8e8ed;">${card.noise} dB</span>` : ''}
                        ${card.energy_star ? `<span class="lennox-tag" style="background:#f0fdf4;color:#22a04a;border:1px solid #bbf7d0;">Energy Star</span>` : ''}
                      </div>
                      <div style="display:flex;align-items:center;gap:5px;margin-bottom:12px;">
                        <span style="color:#f59e0b;font-size:11px;letter-spacing:0.5px;">${starsHtml}</span>
                        <span style="font-size:11px;color:#86868b;">${card.rating} (${(card.reviews||0).toLocaleString()})</span>
                      </div>
                      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;">
                        <span style="font-size:18px;font-weight:700;color:#1d1d1f;">${card.price_display || '$$$'}</span>
                      </div>
                      <button class="lennox-buy-btn" data-id="${card.id}">Buy Now</button>
                    </div>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>
        <button class="swirl-ai-cards-nav-prev" aria-label="Previous">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="rgba(255,255,255,0.9)"/><path d="M18 11L13 16L18 21" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="swirl-ai-cards-nav-next" aria-label="Next">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="rgba(255,255,255,0.9)"/><path d="M14 11L19 16L14 21" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `

    messagesContainer.appendChild(container)

    // Event delegation — survives Swiper DOM cloning
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.lennox-buy-btn')
      const card = e.target.closest('.swirl-lennox-card')
      if (btn) {
        // Buy Now → go straight to checkout
        e.stopPropagation()
        initiateUCPCheckout(btn.dataset.id)
      } else if (card) {
        // Card click → user is interested, tell AI to focus on this product
        e.stopPropagation()
        const productId = card.dataset.productId
        const matchedCard = lastShownLennoxCards.find(c => c.id === productId)
        if (matchedCard) {
          notifyAIOfCardInterest(matchedCard)
        }
      }
    })

    loadSwiperLibrary().then(() => {
      new Swiper(container.querySelector('.swirl-ai-lennox-cards-swiper'), {
        slidesPerView: 1.15,
        spaceBetween: 14,
        grabCursor: true,
        navigation: {
          nextEl: container.querySelector('.swirl-ai-cards-nav-next'),
          prevEl: container.querySelector('.swirl-ai-cards-nav-prev'),
        },
        breakpoints: {
          640: { slidesPerView: 1.6 },
          768: { slidesPerView: 2.1 },
          1024: { slidesPerView: 2.4 }
        }
      })
    })

    scrollToBottom()
  }

  function displayVehicleCards(cardsData) {
    console.log('[Swirl AI] Displaying vehicle cards:', cardsData)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const cards = cardsData.cards || []

    if (cards.length === 0) {
      console.log('[Swirl AI] No vehicle cards to display')
      return
    }

    // Create response container
    const responseContainer = document.createElement('div')
    responseContainer.className = 'swirl-ai-response-container'

    // Build HTML - NO CARD TITLES (Simple UI)
    responseContainer.innerHTML = `
      <h3 class="swirl-ai-response-header">Here are some options for you</h3>
      <div class="swirl-ai-cards-swiper-wrapper">
        <div class="swirl-ai-cards-swiper swiper">
          <div class="swiper-wrapper">
          ${cards
        .map(card => {
          const title = card.title || 'Vehicle'
          const imageUrl = card.image_url || card.image || 'https://via.placeholder.com/400x225'
          const features = card.features || []

          return `
                <div class="swiper-slide">
                  <div class="swirl-ai-vehicle-card">
                    <div class="swirl-ai-card-image">
                      <img src="${imageUrl}" alt="${title}" />
                    </div>
                    <div class="swirl-ai-card-features">
                      ${features
              .map(
                feature => `
                          <div class="swirl-ai-feature-item">
                            <div class="swirl-ai-check-icon">
                              <svg viewBox="0 0 16 16" fill="none">
                                <path d="M13.5 4.5L6 12L2.5 8.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                              </svg>
                            </div>
                            <p>${feature}</p>
                          </div>
                        `
              )
              .join('')}
                    </div>
                  </div>
                </div>
              `
        })
        .join('')}
          </div>
        </div>
        <!-- Navigation Buttons (Desktop Only) -->
        <button class="swirl-ai-cards-nav-prev" aria-label="Previous card">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
            <path d="M18 11L13 16L18 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="swirl-ai-cards-nav-next" aria-label="Next card">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
            <path d="M14 11L19 16L14 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `

    messagesContainer.appendChild(responseContainer)

    // Initialize Swiper
    loadSwiperLibrary().then(() => {
      new Swiper(responseContainer.querySelector('.swirl-ai-cards-swiper'), {
        slidesPerView: 1.1,
        spaceBetween: 16,
        freeMode: true,
        grabCursor: true,
        navigation: {
          nextEl: responseContainer.querySelector('.swirl-ai-cards-nav-next'),
          prevEl: responseContainer.querySelector('.swirl-ai-cards-nav-prev'),
        },
        breakpoints: {
          640: { slidesPerView: 1.5 },
          768: { slidesPerView: 2.2 },
          1024: { slidesPerView: 2.5 }
        }
      })
    })

    scrollToBottom()
  }

  // ===================================================
  // REVIEWS DISPLAY
  // ===================================================

  function displayReviews(reviewsData) {
    console.log('[Swirl AI] ⭐ Reviews carousel detected')
    console.log('[Swirl AI] Displaying reviews:', reviewsData)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const reviews = reviewsData.reviews || []

    if (reviews.length === 0) {
      console.log('[Swirl AI] No reviews to display')
      return
    }

    // PostHog: Log reviews displayed
    logMediaDisplayed({ type: 'reviews', count: reviews.length })

    const reviewsContainer = document.createElement('div')
    reviewsContainer.className = 'swirl-ai-reviews-container'

    reviewsContainer.innerHTML = `
      <div class="swirl-ai-reviews-header">
        <div class="swirl-ai-reviews-header-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/>
          </svg>
        </div>
        <h3 class="swirl-ai-reviews-header-text">Reviews</h3>
      </div>
      <div class="swirl-ai-reviews-swiper-wrapper">
        <div class="swirl-ai-reviews-swiper swiper">
          <div class="swiper-wrapper">
          ${reviews
        .map(review => {
          const quote = review.quote || review.text || review.review_text || ''
          const reviewer = review.reviewer || review.author || review.reviewer_name || 'Anonymous'
          const date = review.date || ''
          const avatarType = review.avatarType || 'user'

          // Choose avatar icon based on type
          const avatarIcon = avatarType === 'youtube' ? `
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="13" cy="13" r="12" stroke="white" stroke-width="2"/>
              <path d="M16.5 13L11 9.5V16.5L16.5 13Z" fill="white"/>
            </svg>
          ` : `
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <circle cx="13" cy="13" r="12" stroke="white" stroke-width="2"/>
              <circle cx="13" cy="10" r="3" fill="white"/>
              <path d="M6 22C6 18.6863 8.68629 16 12 16H14C17.3137 16 20 18.6863 20 22" stroke="white" stroke-width="2"/>
            </svg>
          `

          // Format author text with date if available
          const authorText = date ? `– ${reviewer}-${date}` : `– ${reviewer}`

          return `
                <div class="swiper-slide">
                  <div class="swirl-ai-review-card">
                    <div class="swirl-ai-review-quote-icon">
                      <svg width="34" height="30" viewBox="0 0 34 30" fill="none">
                        <path d="M0 30V15.5556C0 6.96667 5.66667 0 14.2222 0V4.44444C8.88889 4.44444 4.44444 8.88889 4.44444 14.2222V17.7778H14.2222V30H0ZM19.7778 30V15.5556C19.7778 6.96667 25.4444 0 34 0V4.44444C28.6667 4.44444 24.2222 8.88889 24.2222 14.2222V17.7778H34V30H19.7778Z" fill="#E82E34" fill-opacity="0.8"/>
                      </svg>
                    </div>
                    <div class="swirl-ai-review-content">
                      <p class="swirl-ai-review-text">${quote}</p>
                    </div>
                    <div class="swirl-ai-review-author">
                      <div class="swirl-ai-review-author-icon">
                        ${avatarIcon}
                      </div>
                      <p class="swirl-ai-review-author-name">${authorText}</p>
                    </div>
                  </div>
                </div>
              `
        })
        .join('')}
          </div>
        </div>
        <!-- Navigation Buttons (Desktop Only) -->
        <button class="swirl-ai-reviews-nav-prev" aria-label="Previous review">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
            <path d="M18 11L13 16L18 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="swirl-ai-reviews-nav-next" aria-label="Next review">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
            <path d="M14 11L19 16L14 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `

    messagesContainer.appendChild(reviewsContainer)

    // Initialize Swiper
    loadSwiperLibrary().then(() => {
      new Swiper(reviewsContainer.querySelector('.swirl-ai-reviews-swiper'), {
        slidesPerView: 1.3,
        spaceBetween: 16,
        freeMode: true,
        grabCursor: true,
        navigation: {
          nextEl: reviewsContainer.querySelector('.swirl-ai-reviews-nav-next'),
          prevEl: reviewsContainer.querySelector('.swirl-ai-reviews-nav-prev'),
        },
        breakpoints: {
          640: { slidesPerView: 1.5 },
          768: { slidesPerView: 2.2 },
          1024: { slidesPerView: 3 },
          1400: { slidesPerView: 3.5 }
        }
      })
    })

    scrollToBottom()
  }

  // ===================================================
  // COMPARISON CARDS CAROUSEL DISPLAY
  // ===================================================

  function displayComparisonCards(comparisonCards) {
    console.log('[Swirl AI] 🎯 Comparison cards carousel detected')
    console.log('[Swirl AI] Displaying comparison cards:', comparisonCards)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    if (!comparisonCards || comparisonCards.length === 0) {
      console.log('[Swirl AI] No comparison cards to display')
      return
    }

    // Icon mapping for sections
    const sectionIcons = {
      'Range:': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-icon-range.png',
      'Battery:': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-icon-battery.png',
      'Performance:': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-icon-performance.png',
      'Charging:': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-icon-charging.png',
      'Key Strengths:': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-icon-key-strengths.png',
      'Best for:': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-icon-best-for.png'
    }

    const carouselContainer = document.createElement('div')
    carouselContainer.className = 'swirl-ai-comparison-carousel-container'

    carouselContainer.innerHTML = `
      <div class="swirl-ai-comparison-swiper-wrapper">
        <div class="swirl-ai-comparison-swiper swiper">
          <div class="swiper-wrapper">
          ${comparisonCards
        .map(card => {
          const isOurPick = card.isOurPick || false
          const name = card.name || 'Unknown Vehicle'
          const imageUrl = card.image_url || ''
          const range = card.range || 'N/A'
          const battery = card.battery || 'N/A'
          const acceleration = card.acceleration || 'N/A'
          const charging = card.charging || 'N/A'
          const keyStrengths = card.keyStrengths || []
          const bestFor = card.bestFor || []

          return `
                <div class="swiper-slide">
                  <div class="swirl-ai-comparison-card ${isOurPick ? 'our-pick' : ''}">

                    ${imageUrl
              ? `<div class="swirl-ai-comparison-card-image">
                          <img src="${imageUrl}" alt="${name}" />
                        </div>`
              : ''
            }

                    <div class="swirl-ai-comparison-card-header">
                      <h3 class="swirl-ai-comparison-card-title">${name}</h3>
                      <hr class="swirl-ai-comparison-divider" />
                      ${isOurPick
              ? `<div class="swirl-ai-comparison-badge">
                          <span>⭐ Best</span>
                        </div>`
              : ''
            }
                    </div>

                    <div class="swirl-ai-comparison-card-body">

                      <!-- Range Section -->
                      <div class="swirl-ai-comparison-section">
                        <div class="swirl-ai-comparison-section-header">
                          <img src="${sectionIcons['Range:']}" alt="Range" class="swirl-ai-comparison-section-icon" />
                          <span class="swirl-ai-comparison-section-title">Range:</span>
                        </div>
                        <div class="swirl-ai-comparison-section-content">
                          <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-checkmark.svg" alt="Check" class="swirl-ai-comparison-checkmark" />
                          <span class="swirl-ai-comparison-section-text">${range}</span>
                        </div>
                      </div>

                      <!-- Battery Section -->
                      <div class="swirl-ai-comparison-section">
                        <div class="swirl-ai-comparison-section-header">
                          <img src="${sectionIcons['Battery:']}" alt="Battery" class="swirl-ai-comparison-section-icon" />
                          <span class="swirl-ai-comparison-section-title">Battery:</span>
                        </div>
                        <div class="swirl-ai-comparison-section-content">
                          <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-checkmark.svg" alt="Check" class="swirl-ai-comparison-checkmark" />
                          <span class="swirl-ai-comparison-section-text">${battery}</span>
                        </div>
                      </div>
                      also
                      <!-- Performance Section -->
                      <div class="swirl-ai-comparison-section">
                        <div class="swirl-ai-comparison-section-header">
                          <img src="${sectionIcons['Performance:']}" alt="Performance" class="swirl-ai-comparison-section-icon" />
                          <span class="swirl-ai-comparison-section-title">Performance:</span>
                        </div>
                        <div class="swirl-ai-comparison-section-content">
                          <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-checkmark.svg" alt="Check" class="swirl-ai-comparison-checkmark" />
                          <span class="swirl-ai-comparison-section-text">${acceleration}</span>
                        </div>
                      </div>

                      <!-- Charging Section -->
                      <div class="swirl-ai-comparison-section">
                        <div class="swirl-ai-comparison-section-header">
                          <img src="${sectionIcons['Charging:']}" alt="Charging" class="swirl-ai-comparison-section-icon" />
                          <span class="swirl-ai-comparison-section-title">Charging:</span>
                        </div>
                        <div class="swirl-ai-comparison-section-content">
                          <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-checkmark.svg" alt="Check" class="swirl-ai-comparison-checkmark" />
                          <span class="swirl-ai-comparison-section-text">${charging}</span>
                        </div>
                      </div>

                      <!-- Key Strengths Section -->
                      ${keyStrengths.length > 0
              ? `<div class="swirl-ai-comparison-section multi-line">
                          <div class="swirl-ai-comparison-section-header">
                            <img src="${sectionIcons['Key Strengths:']}" alt="Key Strengths" class="swirl-ai-comparison-section-icon" />
                            <span class="swirl-ai-comparison-section-title">Key Strengths:</span>
                          </div>
                          <div class="swirl-ai-comparison-section-list">
                            ${keyStrengths.map(strength => `
                              <div class="swirl-ai-comparison-section-content">
                                <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-checkmark.svg" alt="Check" class="swirl-ai-comparison-checkmark" />
                                <span class="swirl-ai-comparison-section-text">${strength}</span>
                              </div>
                            `).join('')}
                          </div>
                        </div>`
              : ''
            }

                      <!-- Best For Section -->
                      ${bestFor.length > 0
              ? `<div class="swirl-ai-comparison-section multi-line">
                          <div class="swirl-ai-comparison-section-header">
                            <img src="${sectionIcons['Best for:']}" alt="Best for" class="swirl-ai-comparison-section-icon" />
                            <span class="swirl-ai-comparison-section-title">Best for:</span>
                          </div>
                          <div class="swirl-ai-comparison-section-list">
                            ${bestFor.map(item => `
                              <div class="swirl-ai-comparison-section-content">
                                <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/comparison-checkmark.svg" alt="Check" class="swirl-ai-comparison-checkmark" />
                                <span class="swirl-ai-comparison-section-text">${item}</span>
                              </div>
                            `).join('')}
                          </div>
                        </div>`
              : ''
            }

                    </div>
                  </div>
                </div>
              `
        })
        .join('')}
          </div>
        </div>
        <!-- Navigation Buttons (Desktop Only) -->
        <button class="swirl-ai-comparison-nav-prev" aria-label="Previous comparison">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
            <path d="M18 11L13 16L18 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="swirl-ai-comparison-nav-next" aria-label="Next comparison">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
            <path d="M14 11L19 16L14 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `

    messagesContainer.appendChild(carouselContainer)

    // Initialize Swiper with 1.2 slidesPerView for mobile
    loadSwiperLibrary().then(() => {
      new Swiper(carouselContainer.querySelector('.swirl-ai-comparison-swiper'), {
        slidesPerView: 1.2,
        spaceBetween: 16,
        freeMode: true,
        grabCursor: true,
        navigation: {
          nextEl: carouselContainer.querySelector('.swirl-ai-comparison-nav-next'),
          prevEl: carouselContainer.querySelector('.swirl-ai-comparison-nav-prev'),
        },
        breakpoints: {
          640: { slidesPerView: 1.5 },
          768: { slidesPerView: 2.2 },
          1024: { slidesPerView: 2.5 }
        }
      })
    })

    scrollToBottom()
  }

  // ===================================================
  // MEDIA DISPLAY (IMAGES & VIDEOS - Simple UI)
  // ===================================================

  function displayMedia(mediaData) {
    const formattedMedia = {
      videos: mediaData.videos || mediaData.youtube_references || [],
      images: mediaData.images || []
    }

    // Detection logs
    if (formattedMedia.videos.length > 0) {
      console.log('[Swirl AI] 🎥 Videos carousel detected')
      // PostHog: Log videos displayed
      logMediaDisplayed({ type: 'videos', count: formattedMedia.videos.length })
    }
    if (formattedMedia.images.length > 0) {
      console.log('[Swirl AI] 🖼️ Images carousel detected')
      // PostHog: Log images displayed
      logMediaDisplayed({ type: 'images', count: formattedMedia.images.length })
    }

    console.log('[Swirl AI] Displaying media:', mediaData)
    console.log('[Swirl AI] Videos count:', formattedMedia.videos.length)
    console.log('[Swirl AI] Images count:', formattedMedia.images.length)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    addMediaCarousel(messagesContainer, formattedMedia)
  }

  function addMediaCarousel(container, mediaData) {
    console.log('[Swirl AI] Adding media carousel')

    // Videos section
    if (mediaData.videos && mediaData.videos.length > 0) {
      const videosContainer = document.createElement('div')
      videosContainer.className = 'swirl-ai-media-container'

      videosContainer.innerHTML = `
        <div class="swirl-ai-media-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M3 3.993C3 3.445 3.445 3 3.993 3H20.007C20.555 3 21 3.445 21 3.993V20.007C20.9997 20.2703 20.895 20.5227 20.7089 20.7089C20.5227 20.895 20.2703 20.9997 20.007 21H3.993C3.72972 20.9997 3.4773 20.895 3.29114 20.7089C3.10497 20.5227 3.00026 20.2703 3 20.007V3.993ZM5 5V19H19V5H5ZM10.622 8.415L15.501 11.667C15.5559 11.7035 15.6009 11.753 15.632 11.8111C15.6631 11.8692 15.6794 11.9341 15.6794 12C15.6794 12.0659 15.6631 12.1308 15.632 12.1889C15.6009 12.247 15.5559 12.2965 15.501 12.333L10.621 15.585C10.5608 15.6249 10.491 15.6477 10.4189 15.6512C10.3468 15.6546 10.2751 15.6384 10.2114 15.6043C10.1477 15.5703 10.0945 15.5197 10.0573 15.4578C10.02 15.396 10.0003 15.3252 10 15.253V8.747C10.0001 8.67465 10.0199 8.60369 10.0572 8.54168C10.0944 8.47967 10.1478 8.42893 10.2116 8.39486C10.2755 8.36079 10.3473 8.34467 10.4196 8.34822C10.4919 8.35177 10.5618 8.37485 10.622 8.415V8.415Z" fill="white"/>
          </svg>
          <span>Videos</span>
        </div>
        <div class="swirl-ai-media-swiper-wrapper">
          <div class="swirl-ai-media-swiper swiper">
            <div class="swiper-wrapper">
            ${mediaData.videos
          .map(video => {
            const thumbnailUrl =
              video.thumbnail_url ||
              video.thumbnail ||
              `https://img.youtube.com/vi/${video.video_id || video.videoId}/maxresdefault.jpg`
            const videoUrl =
              video.timestamped_url ||
              video.url ||
              video.video_url ||
              `https://www.youtube.com/watch?v=${video.video_id || video.videoId}`

            // Calculate dynamic clip positioning
            const totalSeconds = video.totalSeconds || 0
            const clipDuration = video.clipDuration || 0
            const startTime = video.startTime || video.start_time || 0

            // Convert clip duration to MM:SS format
            const formatTime = (seconds) => {
              const mins = Math.floor(seconds / 60)
              const secs = Math.floor(seconds % 60)
              return `${mins}:${secs.toString().padStart(2, '0')}`
            }
            const durationDisplay = clipDuration > 0 ? formatTime(clipDuration) : (video.duration || '2:02')

            // Calculate clip position and width as percentage
            let clipPosition = 0 // left position
            let clipWidth = 20.76 // default width

            if (totalSeconds > 0 && clipDuration > 0) {
              clipPosition = (startTime / totalSeconds) * 100
              clipWidth = (clipDuration / totalSeconds) * 100

              // Ensure clip doesn't overflow container
              if (clipPosition + clipWidth > 100) {
                clipPosition = 100 - clipWidth
              }
              if (clipPosition < 0) {
                clipPosition = 0
              }
            }

            // Calculate duration label position (center of clip)
            let durationLabelPosition = clipPosition + (clipWidth / 2)

            // Clamp label position to keep it inside container (10% to 90%)
            // This prevents the label from going outside on edges
            if (durationLabelPosition < 10) {
              durationLabelPosition = 10
            } else if (durationLabelPosition > 90) {
              durationLabelPosition = 90
            }

            // If no features in response, add 2 static default features
            const features = video.features && video.features.length > 0
              ? video.features
              : []

            return `
                  <div class="swiper-slide">
                    <div class="swirl-ai-video-card" data-video-index="${mediaData.videos.indexOf(video)}">
                      <div class="swirl-ai-video-thumbnail">
                        <img src="${thumbnailUrl}" alt="${video.title || 'Video'}" />
                        <svg class="swirl-ai-video-expand" width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M13.75 2.5h3.75v3.75m0 7.5v3.75h-3.75M6.25 17.5H2.5v-3.75m0-7.5V2.5h3.75" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <div class="swirl-ai-video-duration-wrapper">
                          <span class="swirl-ai-video-duration" style="left: ${durationLabelPosition}%">${durationDisplay}</span>
                          <div class="swirl-ai-video-progress">
                            <div class="swirl-ai-video-progress-bg"></div>
                            <div class="swirl-ai-video-progress-fill" style="left: ${clipPosition}%; width: ${clipWidth}%"></div>
                          </div>
                        </div>
                      </div>
                      <div class="swirl-ai-video-features">
                        ${features.map(feature => `
                          <div class="swirl-ai-video-feature">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <path d="M6.66667 10.6667L3.33333 7.33333L2.39333 8.27333L6.66667 12.5467L14.6667 4.54667L13.7267 3.60667L6.66667 10.6667Z" fill="#13B178"/>
                            </svg>
                            <span>${feature}</span>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  </div>
                `
          })
          .join('')}
            </div>
          </div>
          <!-- Navigation Buttons (Desktop Only) -->
          <button class="swirl-ai-media-nav-prev" aria-label="Previous video">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
              <path d="M18 11L13 16L18 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="swirl-ai-media-nav-next" aria-label="Next video">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
              <path d="M14 11L19 16L14 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `

      container.appendChild(videosContainer)

      // Initialize Swiper for videos
      loadSwiperLibrary().then(() => {
        new Swiper(videosContainer.querySelector('.swirl-ai-media-swiper'), {
          slidesPerView: 1.5,
          spaceBetween: 8,
          freeMode: true,
          grabCursor: true,
          navigation: {
            nextEl: videosContainer.querySelector('.swirl-ai-media-nav-next'),
            prevEl: videosContainer.querySelector('.swirl-ai-media-nav-prev'),
          },
          breakpoints: {
            768: { slidesPerView: 2.2, spaceBetween: 12 },
            1024: { slidesPerView: 3.2, spaceBetween: 12 },
            1280: { slidesPerView: 3.2, spaceBetween: 12 }
          }
        })
      })

      // Add click handlers to video cards
      const videoCards = videosContainer.querySelectorAll('.swirl-ai-video-card')
      videoCards.forEach(card => {
        card.style.cursor = 'pointer'
        card.addEventListener('click', () => {
          const videoIndex = parseInt(card.getAttribute('data-video-index'))
          openVideoModal(mediaData.videos, videoIndex)
        })
      })
    }

    // Images section
    if (mediaData.images && mediaData.images.length > 0) {
      const imagesContainer = document.createElement('div')
      imagesContainer.className = 'swirl-ai-media-container'

      imagesContainer.innerHTML = `
        <div class="swirl-ai-media-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.828 21L4.808 21.02L4.787 21H2.992C2.72881 20.9997 2.4765 20.895 2.29049 20.7088C2.10448 20.5226 2 20.2702 2 20.007V3.993C2.00183 3.73038 2.1069 3.47902 2.29251 3.29322C2.47813 3.10742 2.72938 3.00209 2.992 3H21.008C21.556 3 22 3.445 22 3.993V20.007C21.9982 20.2696 21.8931 20.521 21.7075 20.7068C21.5219 20.8926 21.2706 20.9979 21.008 21H4.828ZM20 15V5H4V19L14 9L20 15ZM20 17.828L14 11.828L6.828 19H20V17.828ZM8 11C7.46957 11 6.96086 10.7893 6.58579 10.4142C6.21071 10.0391 6 9.53043 6 9C6 8.46957 6.21071 7.96086 6.58579 7.58579C6.96086 7.21071 7.46957 7 8 7C8.53043 7 9.03914 7.21071 9.41421 7.58579C9.78929 7.96086 10 8.46957 10 9C10 9.53043 9.78929 10.0391 9.41421 10.4142C9.03914 10.7893 8.53043 11 8 11Z" fill="white"/>
          </svg>
          <span>Images</span>
        </div>
        <div class="swirl-ai-media-swiper-wrapper">
          <div class="swirl-ai-media-swiper swiper">
            <div class="swiper-wrapper">
            ${mediaData.images
          .map((image, index) => {
            const imageUrl = image.url || image
            const imageAlt = image.alt || image.title || image.description || 'Vehicle Image'

            return `
                  <div class="swiper-slide">
                    <div class="swirl-ai-media-card" data-image-index="${index}">
                      <div class="swirl-ai-media-wrapper">
                        <img src="${imageUrl}" alt="${imageAlt}" class="swirl-ai-media-image" />
                      </div>
                      ${image.title ? `<div class="swirl-ai-media-features"><p>${image.title}</p></div>` : ''}
                    </div>
                  </div>
                `
          })
          .join('')}
            </div>
          </div>
          <!-- Navigation Buttons (Desktop Only) -->
          <button class="swirl-ai-media-nav-prev" aria-label="Previous image">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
              <path d="M18 11L13 16L18 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="swirl-ai-media-nav-next" aria-label="Next image">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="rgba(0,0,0,0.6)"/>
              <path d="M14 11L19 16L14 21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `

      container.appendChild(imagesContainer)

      // Initialize Swiper for images
      loadSwiperLibrary().then(() => {
        new Swiper(imagesContainer.querySelector('.swirl-ai-media-swiper'), {
          slidesPerView: 1.5,
          spaceBetween: 8,
          freeMode: true,
          grabCursor: true,
          navigation: {
            nextEl: imagesContainer.querySelector('.swirl-ai-media-nav-next'),
            prevEl: imagesContainer.querySelector('.swirl-ai-media-nav-prev'),
          },
          breakpoints: {
            768: { slidesPerView: 2.2, spaceBetween: 12 },
            1024: { slidesPerView: 3.2, spaceBetween: 12 },
            1280: { slidesPerView: 3.2, spaceBetween: 12 }
          }
        })
      })

      // Add click handlers to image cards
      const imageCards = imagesContainer.querySelectorAll('.swirl-ai-media-card')
      imageCards.forEach(card => {
        card.style.cursor = 'pointer'
        card.addEventListener('click', () => {
          const imageIndex = parseInt(card.getAttribute('data-image-index'))
          openImageModal(mediaData.images, imageIndex)
        })
      })
    }

    scrollToBottom()
  }

  // ===================================================
  // BOOKING SLOTS DISPLAY (GRID LAYOUT)
  // ===================================================

  function displayBookingSlots(bookingSlotsData) {
    console.log('[Swirl AI] 📅 Booking slots detected')

    if (!bookingSlotsData || bookingSlotsData.length === 0) {
      console.log('[Swirl AI] No booking slots to display')
      return
    }

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) {
      console.error('[Swirl AI] ❌ Messages container not found')
      return
    }

    const slotsContainer = document.createElement('div')
    slotsContainer.className = 'swirl-ai-booking-slots-container'

    // Calendar icon SVG
    const calendarIcon = `
      <svg class="swirl-ai-calendar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 3H21C21.2652 3 21.5196 3.10536 21.7071 3.29289C21.8946 3.48043 22 3.73478 22 4V20C22 20.2652 21.8946 20.5196 21.7071 20.7071C21.5196 20.8946 21.2652 21 21 21H3C2.73478 21 2.48043 20.8946 2.29289 20.7071C2.10536 20.5196 2 20.2652 2 20V4C2 3.73478 2.10536 3.48043 2.29289 3.29289C2.48043 3.10536 2.73478 3 3 3H7V1H9V3H15V1H17V3ZM20 9H4V19H20V9ZM15 5H9V7H7V5H4V7H20V5H17V7H15V5Z" fill="white"/>
      </svg>
    `

    slotsContainer.innerHTML = `
      <div class="swirl-ai-booking-slots-grid">
        ${bookingSlotsData.map(slot => {
      const date = slot.date || ''
      const times = slot.times || []

      return `
            <div class="swirl-ai-booking-slot-card" data-date="${date}">
              <div class="swirl-ai-slot-date-header">
                ${calendarIcon}
                <span class="swirl-ai-slot-date">${date}</span>
              </div>
              <div class="swirl-ai-slot-times">
                ${times.map(time => `
                  <button class="swirl-ai-time-pill" data-time="${time}">
                    ${time}
                  </button>
                `).join('')}
              </div>
            </div>
          `
    }).join('')}
      </div>
    `

    messagesContainer.appendChild(slotsContainer)

    // Add click handlers to time pills
    addTimeSlotClickHandlers(slotsContainer)

    scrollToBottom()
  }

  function addTimeSlotClickHandlers(container) {
    const timePills = container.querySelectorAll('.swirl-ai-time-pill')

    timePills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation()

        const card = pill.closest('.swirl-ai-booking-slot-card')
        const date = card.dataset.date
        const time = pill.dataset.time

        // Remove previous selection
        container.querySelectorAll('.swirl-ai-time-pill').forEach(p => {
          p.classList.remove('selected')
        })

        // Mark as selected
        pill.classList.add('selected')

        console.log(`[Swirl AI] 📅 Selected slot: ${date} at ${time}`)

        // Send selection to AI for booking
        handleTimeSlotSelection(date, time)
      })
    })
  }

  function handleTimeSlotSelection(date, time) {
    console.log(`[Swirl AI] 📅 User selected slot: ${date} at ${time}`)
    // PostHog: Log booking slot selected
    logBookingSlotSelected({ date, time })

    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[Swirl AI] ❌ Cannot send - DataChannel not ready')
      return
    }

    const selectionMessage = `I'd like to book for ${date} at ${time}`

    // ===== SLOT-SPECIFIC: Stop ALL current speech and clear buffer =====
    console.log('[Swirl AI] 🛑 SLOT BUTTON: Interrupting AI speech')

    // Cancel any active AI response
    const wasAISpeaking = isAISpeaking
    if (isAISpeaking) {
      console.log('[Swirl AI] 🛑 Sending cancellation request')

      try {
        dataChannel.send(JSON.stringify({ type: 'response.cancel' }))
      } catch (error) {
        console.warn('[Swirl AI] ⚠️ Cancel request failed:', error)
      }

      isAISpeaking = false
    }

    // Send slot selection message (will wait for response.cancelled if cancellation was sent)
    if (wasAISpeaking) {
      // Store message to send after cancellation completes
      pendingMessageAfterCancel = selectionMessage
      console.log('[Swirl AI] ⏳ Slot selection queued - will send after cancellation completes')
    } else {
      // No active response, send immediately
      console.log('[Swirl AI] ✅ Sending slot selection immediately')
      sendGenericUserMessage(selectionMessage)
    }
  }


  // ===================================================
  // PRICING TABLE DISPLAY
  // ===================================================

  function displayPricingTable(pricingData) {
    console.log('[Swirl AI] 💰 Pricing table with color swatches detected')
    console.log('[Swirl AI] Displaying pricing table:', pricingData)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const { variants, rows, availability, colors, agentPerks } = pricingData

    // Icon mapping for row labels
    const iconMap = {
      'Base price': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/pricing-base-price.png',
      'Registration': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/pricing-registration.png',
      'Insurance (est.)': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/pricing-insurance.png',
      'Dealer fee': 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/pricing-base-price.png'
    }

    // Build pricing table HTML
    const tableHTML = `
      <div class="swirl-ai-pricing-container">
        <!-- Pricing Table -->
        <div class="swirl-ai-pricing-table-wrapper">
          <!-- Header Row -->
          <div class="swirl-ai-pricing-header-row">
            <div class="swirl-ai-pricing-header-cell">Variant</div>
            ${variants.map(v => `
              <div class="swirl-ai-pricing-header-cell">${v.name}</div>
            `).join('')}
          </div>

          <!-- Data Rows -->
          <div class="swirl-ai-pricing-body">
            ${rows.map((row, index) => `
              <div class="swirl-ai-pricing-row ${index === rows.length - 1 ? 'last' : ''}">
                <img src="${iconMap[row.label] || 'https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/pricing-base-price.png'}" class="swirl-ai-pricing-icon" alt="${row.label}" />
                <div class="swirl-ai-pricing-label">${row.label}</div>
                ${row.values.map(val => `
                  <div class="swirl-ai-pricing-value">${val}</div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Availability Section -->
        ${availability && availability.length > 0 ? `
          <div class="swirl-ai-pricing-availability">
            <div class="swirl-ai-pricing-availability-title">Regarding the availability of the model</div>
            ${availability.map(item => `
              <div class="swirl-ai-pricing-availability-item">
                <img src="https://nudge-voice-plugin.s3.ap-south-1.amazonaws.com/plugin/assets/pricing-stock-icon.png" class="swirl-ai-pricing-stock-icon" alt="Stock" />
                <span>${item}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Colors Section -->
        ${colors && colors.length > 0 ? `
          <div class="swirl-ai-pricing-colors">
            <div class="swirl-ai-pricing-colors-title">Colors :</div>
            <div class="swirl-ai-pricing-colors-grid">
              ${colors.map(color => `
                <div class="swirl-ai-pricing-color-swatch">
                  ${color.image_url
        ? `<img src="${color.image_url}" class="swirl-ai-pricing-color-image" alt="${color.name}" loading="lazy" />`
        : `<div class="swirl-ai-pricing-color-image" style="background-color: ${color.hex}"></div>`
      }
                  <div class="swirl-ai-pricing-color-name">${color.name}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Agent Perks Section -->
        ${agentPerks && agentPerks.length > 0 ? `
          <div class="swirl-ai-agent-perks">
            <div class="swirl-ai-agent-perks-title">Agent Perks</div>
            <div class="swirl-ai-agent-perks-grid">
              ${agentPerks.map(perk => `
                <div class="swirl-ai-agent-perk-item">
                  <div class="swirl-ai-agent-perk-icon">${perk.icon}</div>
                  <div class="swirl-ai-agent-perk-content">
                    <div class="swirl-ai-agent-perk-title">${perk.title}</div>
                    <div class="swirl-ai-agent-perk-description">${perk.description}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `

    messagesContainer.insertAdjacentHTML('beforeend', tableHTML)
    scrollToBottom()
  }

  // ===================================================
  // LOCATIONS LIST DISPLAY (Before Booking)
  // ===================================================

  function displayLocations(locations) {
    console.log('[Swirl AI] 📍 Locations list detected')
    console.log('[Swirl AI] Displaying locations:', locations)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    if (!locations || locations.length === 0) {
      console.log('[Swirl AI] No locations to display')
      return
    }

    const locationsContainer = document.createElement('div')
    locationsContainer.className = 'swirl-ai-locations-container'

    locationsContainer.innerHTML = `
      <div class="swirl-ai-locations-grid">
        ${locations.map((location, index) => {
      const name = location.name || 'Lennox Dealer'
      const address = location.address || ''
      const imageUrl = location.image_url || ''

      return `
            <div class="swirl-ai-location-card" data-location-index="${index}">
              ${imageUrl ? `
                <div class="swirl-ai-location-image">
                  <img src="${imageUrl}" alt="${name}" />
                </div>
              ` : ''}
              <div class="swirl-ai-location-content">
                <h3 class="swirl-ai-location-name">${name}</h3>
                ${address ? `
                  <div class="swirl-ai-location-address-wrapper">
                    <svg class="swirl-ai-location-pin-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 8C8.4243 8 8.83136 7.83143 9.13137 7.53137C9.43138 7.23131 9.6 6.82435 9.6 6.4C9.6 5.97565 9.43138 5.56869 9.13137 5.26863C8.83136 4.96857 8.4243 4.8 8 4.8C7.57565 4.8 7.16869 4.96857 6.86863 5.26863C6.56857 5.56869 6.4 5.97565 6.4 6.4C6.4 6.82435 6.56857 7.23131 6.86863 7.53137C7.16869 7.83143 7.57565 8 8 8Z" fill="white"/>
                      <path d="M8 0.8C6.51478 0.8 5.0904 1.39 4.04025 2.44025C2.99 3.4904 2.4 4.91478 2.4 6.4C2.4 8.8592 4.2592 11.4872 8 14.8976C11.7408 11.4872 13.6 8.8592 13.6 6.4C13.6 4.91478 13.01 3.4904 11.9597 2.44025C10.9096 1.39 9.48522 0.8 8 0.8Z" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <p class="swirl-ai-location-address">${address}</p>
                  </div>
                ` : ''}
              </div>
            </div>
          `
    }).join('')}
      </div>
    `

    messagesContainer.appendChild(locationsContainer)

    // Add click event listeners to each location card
    const locationCards = locationsContainer.querySelectorAll('.swirl-ai-location-card')
    locationCards.forEach(card => {
      card.style.cursor = 'pointer'
      card.addEventListener('click', () => {
        const locationIndex = parseInt(card.getAttribute('data-location-index'))
        const selectedLocation = locations[locationIndex]
        handleLocationCardClick(selectedLocation)
      })
    })

    scrollToBottom()
  }

  /**
   * Handles location card click - interrupts speech and sends location to AI
   */
  function handleLocationCardClick(location) {
    console.log('[Swirl AI] 📍 Location card clicked:', location)
    // PostHog: Log location selected
    logLocationSelected({ locationName: location.name || 'unknown' })

    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[Swirl AI] ❌ Cannot send - DataChannel not ready')
      return
    }

    // Construct message to send to AI - clearly indicate SELECTION for booking flow
    const locationName = location.name || 'this location'

    const selectionMessage = `I select ${locationName} for my test drive booking`

    // ===== LOCATION-SPECIFIC: Stop ALL current speech and clear buffer =====
    console.log('[Swirl AI] 🛑 LOCATION CARD: Interrupting AI speech')

    // Cancel any active AI response
    const wasAISpeaking = isAISpeaking
    if (isAISpeaking) {
      console.log('[Swirl AI] 🛑 Sending cancellation request')

      try {
        dataChannel.send(JSON.stringify({ type: 'response.cancel' }))
      } catch (error) {
        console.warn('[Swirl AI] ⚠️ Cancel request failed:', error)
      }

      isAISpeaking = false
    }

    // Send location selection message (will wait for response.cancelled if cancellation was sent)
    if (wasAISpeaking) {
      // Store message to send after cancellation completes
      pendingMessageAfterCancel = selectionMessage
      console.log('[Swirl AI] ⏳ Location selection queued - will send after cancellation completes')
    } else {
      // No active response, send immediately
      console.log('[Swirl AI] ✅ Sending location selection immediately')
      sendGenericUserMessage(selectionMessage)
    }
  }

  // ===================================================
  // BOOKING CONFIRMATION DISPLAY
  // ===================================================

  function displayBookingConfirmation(bookingData) {
    console.log('[Swirl AI] 📅 Booking confirmation detected')
    console.log('[Swirl AI] Displaying booking confirmation:', bookingData)

    // Clear previous conversation on first event
    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const { customer_name, date, time, location } = bookingData

    const bookingContainer = document.createElement('div')
    bookingContainer.className = 'swirl-ai-booking-confirmation'

    bookingContainer.innerHTML = `
      <div class="swirl-ai-booking-content">
        <h2 class="swirl-ai-booking-heading">Great choice ${customer_name || ''}</h2>
        <p class="swirl-ai-booking-schedule">Test drive is scheduled on ${date || 'TBD'}, ${time || 'TBD'}.</p>
        ${location ? `
          <div class="swirl-ai-booking-location">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="swirl-ai-booking-location-icon">
              <path d="M10 10C10.5304 10 11.0391 9.78929 11.4142 9.41421C11.7893 9.03914 12 8.53043 12 8C12 7.46957 11.7893 6.96086 11.4142 6.58579C11.0391 6.21071 10.5304 6 10 6C9.46957 6 8.96086 6.21071 8.58579 6.58579C8.21071 6.96086 8 7.46957 8 8C8 8.53043 8.21071 9.03914 8.58579 9.41421C8.96086 9.78929 9.46957 10 10 10Z" fill="white"/>
              <path d="M10 1C8.14348 1 6.36301 1.7375 5.05025 3.05025C3.7375 4.36301 3 6.14348 3 8C3 11.074 5.324 14.359 10 18.622C14.676 14.359 17 11.074 17 8C17 6.14348 16.2625 4.36301 14.9497 3.05025C13.637 1.7375 11.8565 1 10 1Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="swirl-ai-booking-location-text">${location}</span>
          </div>
        ` : ''}
      </div>
    `

    messagesContainer.appendChild(bookingContainer)
    scrollToBottom()
  }

  // ===================================================
  // WARRANTY CARD DISPLAY
  // ===================================================

  function displayWarrantyCard(warrantyData) {
    console.log('[Swirl AI] 🛡️ Warranty card detected')
    console.log('[Swirl AI] Displaying warranty:', warrantyData)

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const { vehicleWarranty, batteryWarranty, footer } = warrantyData

    const warrantyContainer = document.createElement('div')
    warrantyContainer.className = 'swirl-ai-warranty-card'

    warrantyContainer.innerHTML = `
      <div class="swirl-ai-warranty-section">
        <div class="swirl-ai-warranty-section-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="swirl-ai-warranty-icon">
            <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 11L11 13L15 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="swirl-ai-warranty-label">Vehicle warranty</span>
        </div>
        <div class="swirl-ai-warranty-values">
          <div class="swirl-ai-warranty-value-item">
            <div class="swirl-ai-warranty-value-number">${vehicleWarranty?.duration || '6 yrs'}</div>
            <div class="swirl-ai-warranty-value-label">Duration</div>
          </div>
          <div class="swirl-ai-warranty-value-item">
            <div class="swirl-ai-warranty-value-number">${vehicleWarranty?.kilometers || '150K'}</div>
            <div class="swirl-ai-warranty-value-label">Kilometers</div>
          </div>
        </div>
      </div>

      <div class="swirl-ai-warranty-divider"></div>

      <div class="swirl-ai-warranty-section">
        <div class="swirl-ai-warranty-section-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="swirl-ai-warranty-icon">
            <rect x="2" y="7" width="18" height="12" rx="2" stroke="white" stroke-width="2"/>
            <line x1="23" y1="11" x2="23" y2="15" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <path d="M6 11V15" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <path d="M10 11V15" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="swirl-ai-warranty-label">Battery warranty</span>
        </div>
        <div class="swirl-ai-warranty-values">
          <div class="swirl-ai-warranty-value-item">
            <div class="swirl-ai-warranty-value-number">${batteryWarranty?.duration || '6 yrs'}</div>
            <div class="swirl-ai-warranty-value-label">Duration</div>
          </div>
          <div class="swirl-ai-warranty-value-item">
            <div class="swirl-ai-warranty-value-number">${batteryWarranty?.kilometers || '150K'}</div>
            <div class="swirl-ai-warranty-value-label">Kilometers</div>
          </div>
          <div class="swirl-ai-warranty-value-item">
            <div class="swirl-ai-warranty-value-number">${batteryWarranty?.capacity || '70%'}</div>
            <div class="swirl-ai-warranty-value-label">Capacity</div>
          </div>
        </div>
      </div>

      ${footer ? `
        <div class="swirl-ai-warranty-footer">
          ${footer}
        </div>
      ` : ''}
    `

    messagesContainer.appendChild(warrantyContainer)
    scrollToBottom()
  }


  // ===================================================
  // EMI CALCULATOR COMPONENT
  // ===================================================

  // Debounce utility for EMI calculator
  let emiDebounceTimer = null
  const debounceEMI = (fn, delay = 500) => {
    return (...args) => {
      if (emiDebounceTimer) clearTimeout(emiDebounceTimer)
      emiDebounceTimer = setTimeout(() => fn(...args), delay)
    }
  }

  // EMI Calculator state
  let emiCalculatorState = {
    modelId: null,
    carPrice: 0,
    downpaymentPercent: 20,
    tenureYears: 5,
    interestRate: 5,
    isLoading: false,
    lastResult: null
  }

  // Format currency for display
  const formatCurrency = (amount, currency = 'AED') => {
    return `${currency} ${amount.toLocaleString()}`
  }

  // Calculate EMI via API
  const calculateEMIFromAPI = async () => {
    if (!emiCalculatorState.modelId) {
      console.warn('[EMI_CALC] No model ID available')
      return
    }

    emiCalculatorState.isLoading = true
    updateEMILoadingState(true)

    try {
      console.log('[EMI_CALC] Calculating EMI with params:', {
        model_id: emiCalculatorState.modelId,
        downpayment_percent: emiCalculatorState.downpaymentPercent,
        tenure_years: emiCalculatorState.tenureYears,
        interest_rate: emiCalculatorState.interestRate
      })

      const response = await fetch(`${BASE_URL}voice-agent/emi-calculator/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: emiCalculatorState.modelId,
          downpayment_percent: emiCalculatorState.downpaymentPercent,
          tenure_years: emiCalculatorState.tenureYears,
          interest_rate: emiCalculatorState.interestRate
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result = await response.json()
      console.log('[EMI_CALC] API response:', result)

      if (result.success) {
        emiCalculatorState.lastResult = result
        updateEMIDisplay(result)
      } else {
        console.error('[EMI_CALC] API error:', result.error)
      }
    } catch (error) {
      console.error('[EMI_CALC] Request failed:', error.message)
    } finally {
      emiCalculatorState.isLoading = false
      updateEMILoadingState(false)
    }
  }

  // Debounced version of calculateEMI
  const debouncedCalculateEMI = debounceEMI(calculateEMIFromAPI, 500)

  // Update loading state in UI
  const updateEMILoadingState = (isLoading) => {
    const monthlyPaymentEl = document.querySelector('.swirl-ai-emi-monthly-amount')
    if (monthlyPaymentEl) {
      if (isLoading) {
        monthlyPaymentEl.classList.add('loading')
        monthlyPaymentEl.textContent = '...'
      } else {
        monthlyPaymentEl.classList.remove('loading')
      }
    }
  }

  // Update EMI display with new values
  const updateEMIDisplay = (result) => {
    const monthlyPaymentEl = document.querySelector('.swirl-ai-emi-monthly-amount')
    if (monthlyPaymentEl && result.monthly_payment) {
      monthlyPaymentEl.textContent = formatCurrency(result.monthly_payment)
    }

    // Update down payment display
    const downPaymentValueEl = document.querySelector('.swirl-ai-emi-slider-downpayment .swirl-ai-emi-slider-value')
    if (downPaymentValueEl && result.down_payment) {
      downPaymentValueEl.textContent = formatCurrency(result.down_payment)
    }
  }

  // Update slider track fill
  const updateSliderTrack = (slider) => {
    const min = parseFloat(slider.min)
    const max = parseFloat(slider.max)
    const value = parseFloat(slider.value)
    const percent = ((value - min) / (max - min)) * 100
    slider.style.setProperty('--slider-percent', `${percent}%`)
  }

  // Handle slider input changes
  const handleSliderChange = (type, value) => {
    console.log(`[EMI_CALC] Slider change: ${type} = ${value}`)

    switch (type) {
      case 'downpayment':
        emiCalculatorState.downpaymentPercent = value
        break
      case 'tenure':
        emiCalculatorState.tenureYears = value
        break
      case 'interest':
        emiCalculatorState.interestRate = value
        break
    }

    // Update slider value display immediately
    const sliderGroup = document.querySelector(`.swirl-ai-emi-slider-${type}`)
    if (sliderGroup) {
      const valueEl = sliderGroup.querySelector('.swirl-ai-emi-slider-value')
      if (valueEl) {
        if (type === 'downpayment') {
          const amount = Math.round((emiCalculatorState.carPrice * value) / 100)
          valueEl.textContent = formatCurrency(amount)
        } else if (type === 'tenure') {
          valueEl.textContent = `${value} years`
        } else if (type === 'interest') {
          valueEl.textContent = `${value}%`
        }
      }
    }

    // Trigger debounced API call
    debouncedCalculateEMI()
  }

  // Display EMI Calculator
  function displayEMICalculator(config) {
    console.log('[Swirl AI] 📊 EMI Calculator initialized')
    console.log('[Swirl AI] EMI Config:', config)

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    // Initialize state from config - use initial_values if provided (from voice command)
    emiCalculatorState.modelId = config.model_id
    emiCalculatorState.carPrice = config.car_price

    const sliderConfig = config.slider_config || {}
    const downpaymentConfig = sliderConfig.downpayment || {}
    const tenureConfig = sliderConfig.tenure || {}
    const interestConfig = sliderConfig.interest_rate || {}

    // Use defaults from slider_config (which already incorporates initial_values from backend)
    emiCalculatorState.downpaymentPercent = downpaymentConfig.default_percent || 20
    emiCalculatorState.tenureYears = tenureConfig.default_years || 5
    emiCalculatorState.interestRate = interestConfig.default || 5

    // Calculate initial down payment amount
    const initialDownPayment = Math.round((config.car_price * emiCalculatorState.downpaymentPercent) / 100)

    const cardContainer = document.createElement('div')
    cardContainer.className = 'swirl-ai-emi-calculator'

    cardContainer.innerHTML = `
      <div class="swirl-ai-emi-header">
        <span class="swirl-ai-emi-title">You can calculate your EMI</span>
      </div>
      <div class="swirl-ai-emi-monthly">
        <span class="swirl-ai-emi-monthly-amount">${formatCurrency(0)}</span>
        <span class="swirl-ai-emi-monthly-label">MONTHLY PAYMENT</span>
      </div>
      <div class="swirl-ai-emi-sliders">
        <div class="swirl-ai-emi-slider-group swirl-ai-emi-slider-downpayment">
          <div class="swirl-ai-emi-slider-header">
            <span class="swirl-ai-emi-slider-label">DOWN PAYMENT</span>
            <span class="swirl-ai-emi-slider-value">${formatCurrency(initialDownPayment)}</span>
          </div>
          <input type="range"
            class="swirl-ai-emi-slider"
            data-type="downpayment"
            min="${downpaymentConfig.min_percent || 20}"
            max="${downpaymentConfig.max_percent || 90}"
            value="${emiCalculatorState.downpaymentPercent}"
            step="1"
          />
          <div class="swirl-ai-emi-slider-range">
            <span>${formatCurrency(downpaymentConfig.min_amount || 0)}</span>
            <span>${formatCurrency(downpaymentConfig.max_amount || 0)}</span>
          </div>
        </div>
        <div class="swirl-ai-emi-slider-group swirl-ai-emi-slider-tenure">
          <div class="swirl-ai-emi-slider-header">
            <span class="swirl-ai-emi-slider-label">DURATION</span>
            <span class="swirl-ai-emi-slider-value">${emiCalculatorState.tenureYears} years</span>
          </div>
          <input type="range"
            class="swirl-ai-emi-slider"
            data-type="tenure"
            min="${tenureConfig.min_years || 2}"
            max="${tenureConfig.max_years || 10}"
            value="${emiCalculatorState.tenureYears}"
            step="1"
          />
          <div class="swirl-ai-emi-slider-range">
            <span>${tenureConfig.min_years || 2} yrs</span>
            <span>${tenureConfig.max_years || 10} yrs</span>
          </div>
        </div>
        <div class="swirl-ai-emi-slider-group swirl-ai-emi-slider-interest">
          <div class="swirl-ai-emi-slider-header">
            <span class="swirl-ai-emi-slider-label">INTEREST RATE</span>
            <span class="swirl-ai-emi-slider-value">${emiCalculatorState.interestRate}%</span>
          </div>
          <input type="range"
            class="swirl-ai-emi-slider"
            data-type="interest"
            min="${interestConfig.min || 1}"
            max="${interestConfig.max || 10}"
            value="${emiCalculatorState.interestRate}"
            step="0.5"
          />
          <div class="swirl-ai-emi-slider-range">
            <span>${interestConfig.min || 1}%</span>
            <span>${interestConfig.max || 10}%</span>
          </div>
        </div>
      </div>
    `

    messagesContainer.appendChild(cardContainer)

    // Initialize slider track fills
    const sliders = cardContainer.querySelectorAll('.swirl-ai-emi-slider')
    sliders.forEach(slider => {
      updateSliderTrack(slider)

      slider.addEventListener('input', (e) => {
        const type = e.target.dataset.type
        const value = parseFloat(e.target.value)
        updateSliderTrack(e.target)
        handleSliderChange(type, value)
      })
    })

    scrollToBottom()

    // Trigger initial calculation
    calculateEMIFromAPI()
  }

  // Trigger EMI calculator from outside (e.g., from tool response)
  window.showEMICalculator = async (modelId) => {
    const targetModelId = modelId || currentModelId
    if (!targetModelId) {
      console.warn('[EMI_CALC] No model ID provided')
      return
    }

    try {
      const response = await fetch(`${BASE_URL}voice-agent/emi-calculator/config?model_id=${targetModelId}`)
      if (!response.ok) {
        throw new Error(`Config fetch failed: ${response.status}`)
      }
      const config = await response.json()
      if (config.success) {
        displayEMICalculator(config)
      } else {
        console.error('[EMI_CALC] Config error:', config.error)
      }
    } catch (error) {
      console.error('[EMI_CALC] Failed to fetch config:', error.message)
    }
  }

  // Update EMI calculator slider values programmatically (for voice commands)
  window.updateEMISlider = (type, value) => {
    const slider = document.querySelector(`.swirl-ai-emi-slider[data-type="${type}"]`)
    if (!slider) {
      console.warn('[EMI_CALC] Slider not found:', type)
      return false
    }

    slider.value = value
    updateSliderTrack(slider)
    handleSliderChange(type, parseFloat(value))
    return true
  }

  // Set down payment by amount (will calculate percent)
  window.setDownPaymentAmount = (amount) => {
    if (!emiCalculatorState.carPrice) {
      console.warn('[EMI_CALC] Car price not set')
      return false
    }
    const percent = Math.round((amount / emiCalculatorState.carPrice) * 100)
    const clampedPercent = Math.max(20, Math.min(90, percent))
    return window.updateEMISlider('downpayment', clampedPercent)
  }

  // ===================================================
  // PROMOTIONAL OFFER CARD DISPLAY
  // ===================================================

  function displayOfferCard(offerData) {
    console.log('[Swirl AI] 🎉 Offer card detected')
    console.log('[Swirl AI] Displaying offer card:', offerData)

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const {
      tag = 'Lennox offer',
      text = 'Contact your local Lennox dealer for current promotions'
    } = offerData

    const cardContainer = document.createElement('div')
    cardContainer.className = 'swirl-ai-offer-card'

    cardContainer.innerHTML = `
      <span class="swirl-ai-offer-card-tag">${tag}</span>
      <p class="swirl-ai-offer-card-text">${text}</p>
    `

    messagesContainer.appendChild(cardContainer)
    scrollToBottom()
  }

  // ===================================================
  // TRIM COMPARISON DISPLAY
  // ===================================================

  function displayTrimComparison(trimData) {
    console.log('[Swirl AI] 🔄 Trim comparison detected')
    console.log('[Swirl AI] Displaying trim comparison:', trimData)

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const { heading, trims } = trimData
    const useCarousel = trims && trims.length >= 3

    const trimContainer = document.createElement('div')
    trimContainer.className = 'swirl-ai-trim-comparison-container'

    const trimCardTemplate = (trim) => `
      <div class="swirl-ai-trim-card">
        <div class="swirl-ai-trim-card-header">
          <h3 class="swirl-ai-trim-card-title">${trim.name}</h3>
          <p class="swirl-ai-trim-card-subtitle">${trim.subtitle}</p>
        </div>
        <div class="swirl-ai-trim-card-features">
          ${trim.features?.map(feature => `
            <div class="swirl-ai-trim-feature">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="swirl-ai-trim-checkmark">
                <circle cx="10" cy="10" r="10" fill="#22c55e"/>
                <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="swirl-ai-trim-feature-text">${feature}</span>
            </div>
          `).join('') || ''}
        </div>
      </div>
    `

    if (useCarousel) {
      // Carousel mode for 3+ trims
      const trimSlides = trims?.map(trim => `
        <div class="swiper-slide">
          ${trimCardTemplate(trim)}
        </div>
      `).join('') || ''

      trimContainer.innerHTML = `
        <div class="swirl-ai-trim-heading">${heading}</div>
        <div class="swirl-ai-trim-swiper-wrapper">
          <div class="swirl-ai-trim-swiper swiper">
            <div class="swiper-wrapper">
              ${trimSlides}
            </div>
          </div>
          <!-- Navigation Arrows -->
          <button class="swirl-ai-trim-nav-prev" aria-label="Previous trim">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none">
              <circle cx="22.5" cy="22.5" r="22.5" fill="rgba(0,0,0,0.5)"/>
              <path d="M25 15L17 22.5L25 30" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="swirl-ai-trim-nav-next" aria-label="Next trim">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none">
              <circle cx="22.5" cy="22.5" r="22.5" fill="rgba(0,0,0,0.5)"/>
              <path d="M20 15L28 22.5L20 30" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `

      messagesContainer.appendChild(trimContainer)

      // Initialize Swiper
      setTimeout(() => {
        new Swiper(trimContainer.querySelector('.swirl-ai-trim-swiper'), {
          slidesPerView: 1.2,
          spaceBetween: 12,
          freeMode: true,
          grabCursor: true,
          navigation: {
            nextEl: trimContainer.querySelector('.swirl-ai-trim-nav-next'),
            prevEl: trimContainer.querySelector('.swirl-ai-trim-nav-prev'),
          },
          breakpoints: {
            768: { slidesPerView: 2, spaceBetween: 12 },
            1024: { slidesPerView: 2.5, spaceBetween: 12 }
          }
        })
      }, 100)
    } else {
      // Grid mode for 2 trims
      const trimCards = trims?.map(trim => trimCardTemplate(trim)).join('') || ''

      trimContainer.innerHTML = `
        <div class="swirl-ai-trim-heading">${heading}</div>
        <div class="swirl-ai-trim-cards-wrapper">
          ${trimCards}
        </div>
      `

      messagesContainer.appendChild(trimContainer)
    }

    scrollToBottom()
  }

  // ===================================================
  // NEXT STEPS DISPLAY (Post-Booking)
  // ===================================================

  function displayNextSteps(steps) {
    console.log('[Swirl AI] 📋 Next steps detected')
    console.log('[Swirl AI] Displaying next steps:', steps)

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const stepsContainer = document.createElement('div')
    stepsContainer.className = 'swirl-ai-next-steps-container'

    const stepItems = steps.map((step, index) => `
      <div class="swirl-ai-next-step-item">
        <div class="swirl-ai-next-step-number">${index + 1}</div>
        <div class="swirl-ai-next-step-content">
          ${step.title ? `<h4 class="swirl-ai-next-step-title">${step.title}</h4>` : ''}
          <p class="swirl-ai-next-step-desc">${step.description || step}</p>
        </div>
      </div>
    `).join('')

    stepsContainer.innerHTML = `
      <div class="swirl-ai-next-steps-header">
        <h3 class="swirl-ai-next-steps-title">What's Next</h3>
      </div>
      <div class="swirl-ai-next-steps-list">
        ${stepItems}
      </div>
    `

    messagesContainer.appendChild(stepsContainer)
    scrollToBottom()
  }

  // ===================================================
  // PREDICTIVE QUESTIONS DISPLAY
  // ===================================================

  function displayPredictiveQuestions(suggestions) {
    console.log('[Swirl AI] 💡 Predictive questions detected')
    console.log('[Swirl AI] Displaying suggestions:', suggestions)

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    // Remove any existing predictive questions
    const existing = messagesContainer.querySelector('.swirl-ai-predictive-container')
    if (existing) existing.remove()

    const predictiveContainer = document.createElement('div')
    predictiveContainer.className = 'swirl-ai-predictive-container'

    const chips = suggestions.map(suggestion => `
      <button class="swirl-ai-predictive-chip" data-question="${suggestion}">
        ${suggestion}
      </button>
    `).join('')

    predictiveContainer.innerHTML = `
      <div class="swirl-ai-predictive-label">You might also want to know:</div>
      <div class="swirl-ai-predictive-chips">
        ${chips}
      </div>
    `

    messagesContainer.appendChild(predictiveContainer)

    // Add click handlers to chips
    const chipButtons = predictiveContainer.querySelectorAll('.swirl-ai-predictive-chip')
    chipButtons.forEach(chip => {
      chip.addEventListener('click', () => {
        const question = chip.getAttribute('data-question')
        console.log('[Swirl AI] 💡 Predictive question clicked:', question)

        // Remove the predictive container after selection
        predictiveContainer.remove()

        // Send the question to AI
        if (dataChannel && dataChannel.readyState === 'open') {
          sendGenericUserMessage(`Tell me about ${question}`)
        }
      })
    })

    scrollToBottom()
  }

  // ===================================================
  // COLOR GALLERY DISPLAY
  // ===================================================

  function displayColorGallery(images, availableColors) {
    console.log('[Swirl AI] 🎨 Color gallery detected')
    console.log('[Swirl AI] Displaying colors:', availableColors)

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) return

    const colorContainer = document.createElement('div')
    colorContainer.className = 'swirl-ai-color-gallery-container'

    const colorCards = images.map(image => `
      <div class="swirl-ai-color-card">
        <div class="swirl-ai-color-image">
          <img src="${image.url || image.image_url}" alt="${image.color_name || 'Color'}" loading="lazy" />
        </div>
        <div class="swirl-ai-color-name">${image.color_name || 'Color Option'}</div>
      </div>
    `).join('')

    colorContainer.innerHTML = `
      <div class="swirl-ai-color-gallery-header">
        <h3 class="swirl-ai-color-gallery-title">Available Colors</h3>
      </div>
      <div class="swirl-ai-color-gallery-grid">
        ${colorCards}
      </div>
    `

    messagesContainer.appendChild(colorContainer)
    scrollToBottom()
  }

  // Car Configurator - interactive color/interior selector (matches Figma design)
  function displayConfigurator(configuratorData) {
    console.log('[Swirl AI] 🚗 Car configurator detected')

    clearOnFirstEvent()

    const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    if (!messagesContainer) {
      console.error('[Swirl AI] ❌ Messages container not found for configurator')
      return
    }

    // Remove any existing configurator cards (only one should exist at a time)
    const existingConfigurators = messagesContainer.querySelectorAll('.swirl-ai-configurator-container')
    existingConfigurators.forEach(el => el.remove())
    console.log(`[Swirl AI] Removed ${existingConfigurators.length} existing configurator(s)`)

    const container = document.createElement('div')
    container.className = 'swirl-ai-configurator-container'

    // Assets path - use local for development, S3 for production
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const assetsBase = isLocalhost ? './assets' : (CONFIG.s3AssetsUrl || './assets')

    // Category tabs - only Color and Interior (as per design)
    const categoryTabs = [
      { id: 'color', name: 'Color', icon: `${assetsBase}/config-icon-color.png` },
      { id: 'interior', name: 'Interior', icon: `${assetsBase}/config-icon-interior.png` }
    ]

    const categoryTabsHtml = categoryTabs.map((tab, index) => `
      <button class="swirl-ai-config-tab ${index === 0 ? 'active' : ''}" data-category="${tab.id}">
        <img class="swirl-ai-config-tab-icon" src="${tab.icon}" alt="${tab.name}" />
        <span class="swirl-ai-config-tab-label">${tab.name}</span>
      </button>
    `).join('')

    // Build color swatch buttons
    const colors = configuratorData.colors || []
    const colorSwatchesHtml = colors.map((color, index) => {
      return `
        <button class="swirl-ai-config-swatch"
                data-type="color"
                data-id="${color.id}"
                data-name="${color.name}"
                data-image="${color.image_url || ''}">
          <div class="swirl-ai-config-swatch-color" style="background: ${color.hex || '#888'}"></div>
          <span class="swirl-ai-config-swatch-label">${color.name}</span>
        </button>
      `
    }).join('')

    // Build interior swatch buttons
    const interiors = configuratorData.interiors || []
    const interiorSwatchesHtml = interiors.map((interior, index) => {
      return `
        <button class="swirl-ai-config-swatch"
                data-type="interior"
                data-id="${interior.id}"
                data-name="${interior.name}"
                data-image="${interior.image_url || ''}">
          <div class="swirl-ai-config-swatch-interior">
            <img src="${assetsBase}/config-icon-interior.png" alt="${interior.name}" />
          </div>
          <span class="swirl-ai-config-swatch-label">${interior.name}</span>
        </button>
      `
    }).join('')

    // Initial image - ALWAYS use wireframe first (as per user request)
    const wireframeUrl = configuratorData.wireframe_url || ''
    const hasValidWireframe = wireframeUrl && !wireframeUrl.startsWith('undefined') && !wireframeUrl.startsWith('null')

    console.log('[Swirl AI] 🖼️ Configurator DEBUG:', {
      wireframe_url_raw: configuratorData.wireframe_url,
      wireframe_url_processed: wireframeUrl,
      hasValidWireframe: hasValidWireframe,
      initial_image_url: configuratorData.initial_image_url,
      colors_count: colors.length,
      first_color_image: colors[0]?.image_url
    })

    container.innerHTML = `
      <div class="swirl-ai-configurator">
        <div class="swirl-ai-configurator-image">
          ${hasValidWireframe ? `
            <img id="swirl-ai-config-car-image"
                 src="${wireframeUrl}"
                 alt="${configuratorData.modelName || 'Car'}"
                 onload="console.log('[Swirl AI] ✅ Wireframe image loaded successfully:', this.src)"
                 onerror="console.error('[Swirl AI] ❌ Wireframe image FAILED to load:', this.src); this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="swirl-ai-config-placeholder" style="display:none;">
              <span style="font-size:64px;">🚗</span>
              <p style="color:#fff;font-size:18px;">${configuratorData.modelName || 'Configure Your Car'}</p>
            </div>
          ` : `
            <div class="swirl-ai-config-placeholder" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;">
              <span style="font-size:64px;">🚗</span>
              <p style="color:#fff;font-size:18px;margin:12px 0 0;">${configuratorData.modelName || 'Configure Your Car'}</p>
              <p style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:8px;">Select a color below</p>
            </div>
          `}
        </div>
        <div class="swirl-ai-configurator-options">
          <div class="swirl-ai-config-tabs-row">
            ${categoryTabsHtml}
          </div>
          <div class="swirl-ai-config-swatches-row" data-section="colors" data-active="true">
            ${colorSwatchesHtml || '<p style="color:rgba(255,255,255,0.5);text-align:center;width:100%;">No colors available</p>'}
          </div>
          <div class="swirl-ai-config-swatches-row" data-section="interiors" data-active="false" style="display:none;">
            ${interiorSwatchesHtml || '<p style="color:rgba(255,255,255,0.5);text-align:center;width:100%;">No interior options</p>'}
          </div>
        </div>
      </div>
    `

    messagesContainer.appendChild(container)
    console.log('[Swirl AI] ✅ Configurator appended to DOM')

    // Store configurator data for tab switching
    container.configuratorData = configuratorData

    // Add click handlers for category tabs - switch between color/interior options
    const tabButtons = container.querySelectorAll('.swirl-ai-config-tab')
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => handleConfiguratorTabClick(btn, container))
    })

    // Add click handlers for all swatches (color and interior)
    const swatchButtons = container.querySelectorAll('.swirl-ai-config-swatch')
    swatchButtons.forEach(btn => {
      btn.addEventListener('click', () => handleConfiguratorSelection(btn))
    })

    scrollToBottom()
  }

  // Handle tab click - switch between Color/Interior options
  function handleConfiguratorTabClick(button, container) {
    const category = button.dataset.category
    console.log('[Swirl AI] Tab clicked:', category)

    // Update active tab
    const tabButtons = container.querySelectorAll('.swirl-ai-config-tab')
    tabButtons.forEach(t => t.classList.remove('active'))
    button.classList.add('active')

    // Show/hide appropriate swatches row
    const colorsRow = container.querySelector('[data-section="colors"]')
    const interiorsRow = container.querySelector('[data-section="interiors"]')

    if (category === 'color') {
      if (colorsRow) colorsRow.style.display = 'flex'
      if (interiorsRow) interiorsRow.style.display = 'none'
    } else if (category === 'interior') {
      if (colorsRow) colorsRow.style.display = 'none'
      if (interiorsRow) interiorsRow.style.display = 'flex'
    } else {
      // For wheel/alloys, keep colors visible (placeholder for future)
      if (colorsRow) colorsRow.style.display = 'flex'
      if (interiorsRow) interiorsRow.style.display = 'none'
    }
  }

  // Handle configurator option selection (silent - no AI message, just UI update)
  function handleConfiguratorSelection(button) {
    const type = button.dataset.type
    const id = button.dataset.id
    const name = button.dataset.name || button.querySelector('.swirl-ai-config-swatch-label')?.textContent || id
    const imageUrl = button.dataset.image

    console.log(`[Swirl AI] Configurator selection: ${type} = ${name}`)

    // Update active state in the swatches row
    const row = button.closest('.swirl-ai-config-swatches-row')
    if (row) {
      row.querySelectorAll('.swirl-ai-config-swatch').forEach(btn => btn.classList.remove('active'))
      button.classList.add('active')
    }

    // Update car image based on selection type
    const carImage = document.getElementById('swirl-ai-config-car-image')
    const placeholder = carImage?.nextElementSibling

    if (carImage && imageUrl && imageUrl !== 'null' && imageUrl !== 'undefined') {
      // Show image, hide placeholder (in case wireframe failed to load initially)
      carImage.style.display = 'block'
      carImage.style.opacity = '0.3'
      if (placeholder) placeholder.style.display = 'none'

      // Smooth image transition
      const newImg = new Image()
      newImg.onload = () => {
        carImage.src = imageUrl
        carImage.style.opacity = '1'
      }
      newImg.src = imageUrl
    }

    // Don't send to AI - let user browse silently, they can speak when ready
  }

  // ===================================================
  // UTILITIES
  // ===================================================

  function updateStatusMessage(text) {
    console.log('[Swirl AI] Status:', text)
    const statusElement = document.querySelector('.swirl-ai-status-message')
    if (statusElement) {
      statusElement.textContent = text
      statusElement.style.display = 'block'
    }
  }

  function hideStatusMessages() {
    const statusElement = document.querySelector('.swirl-ai-status-message')
    if (statusElement) statusElement.style.display = 'none'
  }

  function showError(message) {
    console.error('[Swirl AI] Error:', message)

    // Hide loading status on error
    hideLoadingStatus()

    // const messagesContainer = document.querySelector('.swirl-ai-chat-messages')
    // if (!messagesContainer) return

    // const errorDiv = document.createElement('div')
    // errorDiv.className = 'swirl-ai-response-message'
    // errorDiv.style.color = '#ef4444'
    // errorDiv.textContent = `Error: ${message}`

    // messagesContainer.appendChild(errorDiv)
    // scrollToBottom()

    // setTimeout(() => errorDiv.remove(), 5000)
  }

  // ===================================================
  // AUTO-START
  // ===================================================

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
