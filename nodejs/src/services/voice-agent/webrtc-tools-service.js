// WebRTC Tools Service
// Handles tool execution and session configuration for WebRTC-based voice agent

import {
  handleGetCompetitorComparison,
  handleSearchVehicleKnowledge
} from './services/azure-search-service.js'

import { TOOLS_CONFIG } from './core/config/tools.js'
import {
  generateReviewsFromContext,
  searchRelevantImages,
  shouldShowReviews
} from './core/helpers/content-services.js'
import {
  buildComparisonCardsData,
  buildComparisonTableData,
  buildPricingTableData,
  buildWarrantyData,
  buildTrimComparisonData,
  buildConfiguratorData,
  generateBookingSlots
} from './core/helpers/data-builders.js'
import { searchChargingStations } from './core/helpers/ev-charging-stations.js'
import {
  validateBookingData,
  parseSpokenPhoneNumber,
  formatPhoneForDisplay,
  formatPhoneForSpeech
} from './core/helpers/validation.js'
import {
  cacheChargingStations,
  cacheCompetitorComparison,
  cacheCustomerReviews,
  cacheImageSearch,
  cacheLocalKBSearch,
  cacheVehicleSearch,
  getCachedChargingStations,
  getCachedCompetitorComparison,
  getCachedCustomerReviews,
  getCachedImageSearch,
  getCachedLocalKBSearch,
  getCachedVehicleSearch
} from './services/redis-cache.js'

import {
  buildDynamicSystemPrompt,
  MEDIA_ORCHESTRATOR_SYSTEM_PROMPT,
  MODEL_DETECTION_SYSTEM_PROMPT,
  buildLocalKBSearchPrompt,
  MODEL_DETECTION_CONTEXT,
  IMAGE_DISPLAY_CONTEXT,
  IMAGE_ACKNOWLEDGMENT_CONTEXT,
  VIDEO_DISPLAY_CONTEXT,
  VIDEOS_AND_REVIEWS_CONTEXT,
  CUSTOMER_REVIEWS_CONTEXT,
  buildComparisonVoiceContext,
  SHOWROOM_LOCATIONS_CONTEXT,
  BOOKING_SLOTS_CONTEXT,
  BOOKING_CONFIRMATION_CONTEXT,
  TRIM_COMPARISON_CONTEXT,
  LIST_FORMAT_CONTEXT,
  PARAGRAPH_FORMAT_CONTEXT,
  LANGUAGE_ENFORCEMENT_CONTEXT,
  NO_IMAGES_CONTEXT,
  NO_IMAGES_FOUND_CONTEXT,
  IMAGES_ERROR_CONTEXT,
  stripUrlsFromContext
} from './config/prompts.js'

// Deduplicate videos by videoId to prevent duplicates
const dedupeVideos = videos => {
  if (!videos || !Array.isArray(videos)) return []
  const seen = new Set()
  return videos.filter(video => {
    const id = video?.videoId || video?.video_id
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

// Analyze query to determine which media type is most relevant
const analyzeQueryForMedia = async (query, modelName) => {
  console.log(`[BYD MEDIA ORCHESTRATOR] Analyzing query: "${query}"`)

  const systemPrompt = MEDIA_ORCHESTRATOR_SYSTEM_PROMPT(modelName)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User query: "${query}"` }
        ],
        temperature: 0.1,
        max_tokens: 50,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const result = JSON.parse(data.choices[0].message.content)

    console.log(`[BYD MEDIA ORCHESTRATOR] Decision: ${result.media_type}`)
    return result
  } catch (error) {
    console.error(
      '[BYD MEDIA ORCHESTRATOR] LLM analysis failed:',
      error.message
    )
    // Fallback: return none to avoid breaking the flow
    return { media_type: 'none' }
  }
}

// Detect BYD model from user message using keyword matching + LLM fallback
const detectModelFromMessage = async userMessage => {
  console.log(`[MODEL DETECTION] Analyzing message: "${userMessage}"`)

  // Model name mapping (common variations)
  const modelMap = {
    'byd-shark-6': ['shark 6', 'shark6', 'shark', 'pickup', 'truck'],
    'byd-atto-3': ['atto 3', 'atto3', 'atto', 'electric suv'],
    'byd-han': ['han', 'luxury sedan'],
    'byd-qin-plus': ['qin plus', 'qin', 'qin+'],
    'byd-seal': ['seal', 'plug in sedan', 'plug-in sedan'],
    'byd-seal-7': ['seal 7', 'seal7', 'seal seven'],
    'byd-sealion-7': ['sealion 7', 'sea lion 7', 'sealion7', 'sealion'],
    'byd-song-plus': ['song plus', 'song', 'song+']
  }

  // Simple keyword matching first (fast path)
  const messageLower = userMessage.toLowerCase()
  // eslint-disable-next-line no-unused-vars
  for (const [modelId, keywords] of Object.entries(modelMap)) {
    // eslint-disable-next-line no-unused-vars
    for (const keyword of keywords) {
      if (messageLower.includes(keyword)) {
        console.log(
          `[MODEL DETECTION] ✓ Keyword match: "${keyword}" → ${modelId}`
        )
        return { model_id: modelId, confidence: 0.9, method: 'keyword' }
      }
    }
  }

  // Fallback: LLM-based detection (for ambiguous cases)
  console.log('[MODEL DETECTION] No keyword match - trying LLM fallback')
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: MODEL_DETECTION_SYSTEM_PROMPT
          },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const result = JSON.parse(data.choices[0].message.content)
    console.log(
      `[MODEL DETECTION] LLM result: ${result.model_id ||
        'none'} (confidence: ${result.confidence})`
    )
    return { ...result, method: 'llm' }
  } catch (error) {
    console.error('[MODEL DETECTION] LLM fallback failed:', error.message)
    return { model_id: null, confidence: 0 }
  }
}

// In-memory cache for loaded KB data (per model)
const kbCache = new Map()

// Extract relevant KB data for LLM search (specifications, pricing, highlights, warranty, colors)
const extractKBForSearch = modelConfig => {
  return {
    name: modelConfig.name,
    brand: modelConfig.brand,
    category: modelConfig.category,
    market: modelConfig.market,
    price_aed: modelConfig.price_aed,
    variants: modelConfig.variants,
    specifications: modelConfig.specifications,
    highlights: modelConfig.highlights,
    warranty: modelConfig.specifications?.warranty,
    colors: modelConfig.specifications?.colors,
    key_selling_points: modelConfig.personality?.key_selling_points || []
  }
}

// Load and cache KB data for a model
const loadKBData = modelConfig => {
  const modelId = modelConfig.id
  if (!kbCache.has(modelId)) {
    const kbData = extractKBForSearch(modelConfig)
    kbCache.set(modelId, kbData)
    console.log(
      `[BYD WEBRTC TOOLS] ✓ Loaded and cached KB for ${modelConfig.name}`
    )
  }
  return kbCache.get(modelId)
}

// Search local KB using LLM
const searchLocalKBWithLLM = async (query, queryType, modelConfig) => {
  console.log(
    `[BYD WEBRTC TOOLS] Searching local KB for: "${query}" (${queryType})`
  )

  // Load KB data (cached)
  const kbData = loadKBData(modelConfig)

  // Build prompt for LLM to search KB
  const systemPrompt = buildLocalKBSearchPrompt(kbData)

  const userPrompt = `Customer Question: "${query}"
Query Type: ${queryType}

Can you answer this question using the KB data provided? Respond in JSON format.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-nano',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const result = JSON.parse(data.choices[0].message.content)

    console.log(
      `[BYD WEBRTC TOOLS] Local KB search result: found=${result.found}`
    )

    return result
  } catch (error) {
    console.error(
      '[BYD WEBRTC TOOLS] Local KB LLM search failed:',
      error.message
    )
    return {
      found: false,
      reason: 'LLM search error',
      error: error.message
    }
  }
}

// Get tools without model name replacement (for unified multi-model agent)
const getTools = () => {
  return TOOLS_CONFIG
}


console.log(
  '[BYD WEBRTC TOOLS] Service initialized - Dynamic multi-model support enabled'
)

// Get session configuration for WebRTC client (unified for both single-model and multi-model)
export const getSessionConfig = (voice = 'marin') => {
  const instructions = buildDynamicSystemPrompt()
  const tools = getTools()

  return {
    instructions,
    tools,
    voice, // 'marin' (female) or 'echo' (male)
    modalities: ['text', 'audio'],
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    // Server VAD for speech detection and interruption
    turn_detection: {
      type: 'server_vad',
      threshold: 0.85, // Higher threshold = less sensitive to background noise (0.0-1.0) - optimized for noisy café environment
      prefix_padding_ms: 300,
      silence_duration_ms: 2000, // Enough for AI to complete full responses without clipping
      create_response: true
    },
    input_audio_transcription: {
      model: 'whisper-1'
    },
    temperature: 0.8, // OpenAI recommended for natural voice quality
    max_response_output_tokens: 800 // Allow complete natural responses
  }
}

export const getUnifiedSessionConfig = (voice = 'marin') => {
  return getSessionConfig(voice)
}

// Execute a tool call from WebRTC client
export const executeToolCall = async (toolName, toolArgs, modelConfig) => {
  const modelName = modelConfig?.name || 'Unknown Model'
  const modelId = modelConfig?.id || 'unknown'

  console.log(`[BYD WEBRTC TOOLS] Executing: ${toolName} for ${modelName}`)
  console.log(`[BYD WEBRTC TOOLS] Model ID: ${modelId}`)
  console.log(
    `[BYD WEBRTC TOOLS] Azure Index: ${modelConfig?.azure_search?.indexName ||
      'NOT CONFIGURED'}`
  )
  console.log('[BYD WEBRTC TOOLS] modelConfig.images check:', {
    exists: !!modelConfig?.images,
    keys: modelConfig?.images ? Object.keys(modelConfig.images) : 'NO IMAGES'
  })

  try {
    if (toolName === 'detect_model_intent') {
      // Detect which BYD model the user is referring to
      const { user_message } = toolArgs
      console.log(
        `[BYD WEBRTC TOOLS] Detecting model intent from: "${user_message}"`
      )

      // Call model detection helper
      const detectedModel = await detectModelFromMessage(user_message)

      if (detectedModel.model_id) {
        // Model successfully detected
        // Note: Session update will be handled by the controller
        // Import model registry to get model config
        const { getModelConfig } = await import('./core/config/index.js')
        const detectedModelConfig = getModelConfig(detectedModel.model_id)

        if (detectedModelConfig) {
          console.log(
            `[BYD WEBRTC TOOLS] ✓ Model detected: ${detectedModelConfig.name}`
          )

          return {
            context: MODEL_DETECTION_CONTEXT({
              modelName: detectedModelConfig.name,
              modelCategory: detectedModelConfig.category
            }),
            model_id: detectedModel.model_id,
            model_name: detectedModelConfig.name,
            model_category: detectedModelConfig.category,
            confidence: detectedModel.confidence,
            method: detectedModel.method,
            success: true
          }
        } else {
          console.warn(
            `[BYD WEBRTC TOOLS] Model config not found for: ${detectedModel.model_id}`
          )
          return {
            context:
              '[Error: Model configuration not found. Please try again.]',
            model_id: null,
            confidence: 0,
            success: false
          }
        }
      } else {
        // No model detected
        console.log('[BYD WEBRTC TOOLS] Could not detect a specific model')
        return {
          context:
            "[Could not detect a specific BYD model from your message. Please mention which model you'd like to know about: Shark 6, Atto 3, Han, Qin Plus, Seal, Seal 7, Sealion 7, or Song Plus.]",
          model_id: null,
          confidence: 0,
          success: false
        }
      }
    }

    if (toolName === 'search_local_knowledge') {
      // Search local KB using LLM with caching
      console.log(
        `[BYD WEBRTC TOOLS] Searching local KB: "${toolArgs.query}" (${toolArgs.query_type})`
      )

      // Check cache first
      let llmResult = await getCachedLocalKBSearch(
        modelId,
        toolArgs.query,
        toolArgs.query_type
      )

      if (!llmResult) {
        console.log('[BYD WEBRTC TOOLS] Local KB cache miss - calling LLM')
        llmResult = await searchLocalKBWithLLM(
          toolArgs.query,
          toolArgs.query_type,
          modelConfig
        )
        // Cache the result
        await cacheLocalKBSearch(
          modelId,
          toolArgs.query,
          toolArgs.query_type,
          llmResult
        )
      } else {
        console.log('[BYD WEBRTC TOOLS] ✓ Using cached local KB search result')
      }

      if (llmResult.found) {
        // Answer found in local KB
        console.log('[BYD WEBRTC TOOLS] ✓ Answer found in local KB')

        // Check if this is a pricing query - build pricing table data
        const queryLower = (toolArgs.query || '').toLowerCase()
        const pricingKeywords = [
          'price',
          'cost',
          'how much',
          'pricing',
          'pay',
          'expensive',
          'cheap',
          'afford',
          'budget'
        ]
        const hasPricingKeyword = pricingKeywords.some(keyword =>
          queryLower.includes(keyword)
        )
        const isPricingQuery =
          toolArgs.query_type === 'pricing' || hasPricingKeyword

        let pricingData = null
        let hasPricing = false

        if (isPricingQuery) {
          console.log(
            '[BYD WEBRTC TOOLS] Detected pricing query - building pricing table'
          )
          pricingData = buildPricingTableData(modelConfig)
          hasPricing = true
        }

        // Check if this is a warranty query
        const warrantyKeywords = [
          'warranty',
          'coverage',
          'guarantee',
          'protection',
          'service plan',
          'roadside'
        ]
        const hasWarrantyKeyword = warrantyKeywords.some(keyword =>
          queryLower.includes(keyword)
        )

        let warrantyData = null
        let hasWarranty = false

        if (hasWarrantyKeyword) {
          console.log(
            '[BYD WEBRTC TOOLS] Detected warranty query - building warranty card'
          )
          warrantyData = buildWarrantyData(modelConfig)
          hasWarranty = true
        }

        // Check if this is a trim/variant comparison query
        const trimKeywords = [
          'trim',
          'variant',
          'version',
          'difference',
          'compare',
          'deluxe',
          'flagship',
          'standard',
          'premium',
          'base',
          'which one',
          'which trim'
        ]
        const hasTrimKeyword = trimKeywords.some(keyword =>
          queryLower.includes(keyword)
        )

        let trimComparisonData = null
        let hasTrimComparison = false

        if (hasTrimKeyword) {
          trimComparisonData = buildTrimComparisonData(modelConfig)
          if (trimComparisonData) {
            hasTrimComparison = true
          }
        }

        // ENRICH WITH MEDIA - automatically attach images/videos/reviews
        console.log(
          '[BYD WEBRTC TOOLS] Enriching local KB answer with media...'
        )
        let mediaEnrichment = {
          media_type: 'none',
          has_media: false
        }

        try {
          // Step 1: Decide which media type is most relevant
          const mediaDecision = await analyzeQueryForMedia(
            toolArgs.query,
            modelName
          )
          console.log(
            '[BYD WEBRTC TOOLS] Media decision for local KB result:',
            mediaDecision.media_type
          )

          // Step 2: Fetch the appropriate media type
          if (mediaDecision.media_type === 'images') {
            // Check cache first
            let imageSearchResult = await getCachedImageSearch(
              modelId,
              toolArgs.query
            )

            if (!imageSearchResult) {
              console.log(
                '[BYD WEBRTC TOOLS] Image cache miss - fetching images for local KB'
              )
              imageSearchResult = await searchRelevantImages(
                toolArgs.query,
                modelConfig,
                null
              )
              if (imageSearchResult.success) {
                await cacheImageSearch(
                  modelId,
                  toolArgs.query,
                  imageSearchResult
                )
              }
            } else {
              console.log('[BYD WEBRTC TOOLS] ✓ Using cached images')
            }

            if (
              imageSearchResult.success &&
              imageSearchResult.images?.length > 0
            ) {
              const imageContext = IMAGE_DISPLAY_CONTEXT
              mediaEnrichment = {
                media_type: 'images',
                images: imageSearchResult.images,
                has_media: true,
                media_context: imageContext
              }
            }
          }

          if (mediaDecision.media_type === 'reviews') {
            // Check cache first
            let cachedReviews = await getCachedCustomerReviews(
              modelId,
              toolArgs.query
            )

            if (!cachedReviews) {
              console.log(
                '[BYD WEBRTC TOOLS] Reviews cache miss - generating reviews for local KB'
              )
              const reviewQuery = `${modelName} owner reviews feedback experience`
              const searchResult = await handleSearchVehicleKnowledge(
                { query: reviewQuery, query_type: 'general_info' },
                modelConfig,
                null
              )
              cachedReviews = generateReviewsFromContext(
                searchResult,
                modelConfig
              )
              if (cachedReviews.length > 0) {
                await cacheCustomerReviews(
                  modelId,
                  toolArgs.query,
                  cachedReviews
                )
              }
            } else {
              console.log('[BYD WEBRTC TOOLS] ✓ Using cached reviews')
            }

            if (cachedReviews && cachedReviews.length > 0) {
              const reviewContext = `[REVIEWS DISPLAYED - NEVER READ QUOTES ALOUD. Say ONLY 1 sentence like "Here's what owners are saying—check them out!" then ask a follow-up. DO NOT quote or summarize the review content.]`
              mediaEnrichment = {
                media_type: 'reviews',
                reviews: cachedReviews,
                has_media: true,
                media_context: reviewContext
              }
            }
          }

          if (mediaDecision.media_type === 'videos') {
            // Check cache first
            const cacheKey = `${modelId}:${toolArgs.query}:local_kb_media`
            let videoResult = await getCachedVehicleSearch(modelId, cacheKey)

            if (!videoResult) {
              console.log(
                '[BYD WEBRTC TOOLS] Video cache miss - fetching videos for local KB'
              )
              videoResult = await handleSearchVehicleKnowledge(
                { query: toolArgs.query, query_type: 'media' },
                modelConfig,
                null
              )
              await cacheVehicleSearch(modelId, cacheKey, videoResult)
            } else {
              console.log('[BYD WEBRTC TOOLS] ✓ Using cached videos')
            }

            if (videoResult?.youtube_references?.length > 0) {
              const videoContext = VIDEO_DISPLAY_CONTEXT(modelName)
              mediaEnrichment = {
                media_type: 'videos',
                youtube_references: dedupeVideos(
                  videoResult.youtube_references
                ),
                has_media: true,
                media_context: videoContext
              }
            }
          }

          // Handle videos_and_reviews for technical spec questions
          if (mediaDecision.media_type === 'videos_and_reviews') {
            console.log(
              '[BYD WEBRTC TOOLS] Fetching both videos AND reviews for technical spec query'
            )

            // Fetch videos
            const videoCacheKey = `${modelId}:${toolArgs.query}:local_kb_media`
            let videoResult = await getCachedVehicleSearch(
              modelId,
              videoCacheKey
            )
            if (!videoResult) {
              videoResult = await handleSearchVehicleKnowledge(
                { query: toolArgs.query, query_type: 'media' },
                modelConfig,
                null
              )
              await cacheVehicleSearch(modelId, videoCacheKey, videoResult)
            }

            // Fetch reviews
            let cachedReviews = await getCachedCustomerReviews(
              modelId,
              toolArgs.query
            )
            if (!cachedReviews) {
              const reviewQuery = `${modelName} owner reviews feedback experience`
              const searchResult = await handleSearchVehicleKnowledge(
                { query: reviewQuery, query_type: 'general_info' },
                modelConfig,
                null
              )
              cachedReviews = generateReviewsFromContext(
                searchResult,
                modelConfig
              )
              if (cachedReviews.length > 0) {
                await cacheCustomerReviews(
                  modelId,
                  toolArgs.query,
                  cachedReviews
                )
              }
            }

            // Combine both
            const hasVideos = videoResult?.youtube_references?.length > 0
            const hasReviews = cachedReviews?.length > 0

            if (hasVideos || hasReviews) {
              const combinedContext = VIDEOS_AND_REVIEWS_CONTEXT
              mediaEnrichment = {
                media_type: 'videos_and_reviews',
                has_media: true,
                media_context: combinedContext,
                ...(hasVideos && {
                  youtube_references: dedupeVideos(
                    videoResult.youtube_references
                  )
                }),
                ...(hasReviews && {
                  reviews: cachedReviews,
                  show_reviews: true
                })
              }
              console.log(
                `[BYD WEBRTC TOOLS] ✓ Combined media: ${
                  hasVideos ? 'videos' : ''
                } ${hasReviews ? 'reviews' : ''}`
              )
            }
          }
        } catch (error) {
          console.error(
            '[BYD WEBRTC TOOLS] Media enrichment failed:',
            error.message
          )
          // Continue without media on error - don't break the KB answer
        }

        // Append media context instruction if media was enriched
        let finalContext = llmResult.answer

        // Add formatting instruction based on is_list flag
        if (llmResult.is_list) {
          finalContext += ` ${LIST_FORMAT_CONTEXT}`
        } else {
          finalContext += ` ${PARAGRAPH_FORMAT_CONTEXT}`
        }

        if (mediaEnrichment.media_context) {
          finalContext += '\n\n' + mediaEnrichment.media_context
        }

        // Add trim comparison context if available
        if (hasTrimComparison) {
          finalContext += `\n\n${TRIM_COMPARISON_CONTEXT}`
        }

        // Add language reminder to prevent Arabic/other language responses
        finalContext += ` ${LANGUAGE_ENFORCEMENT_CONTEXT}`

        return {
          success: true,
          context: finalContext,
          source: 'local_kb',
          data_used: llmResult.data_used || [],
          pricing_data: pricingData,
          has_pricing: hasPricing,
          warranty_data: warrantyData,
          has_warranty: hasWarranty,
          trim_comparison_data: trimComparisonData,
          has_trim_comparison: hasTrimComparison,
          media_type: mediaEnrichment.media_type,
          has_media: mediaEnrichment.has_media,
          ...(mediaEnrichment.images && { images: mediaEnrichment.images }),
          ...(mediaEnrichment.reviews && {
            reviews: mediaEnrichment.reviews,
            show_reviews: true
          }),
          ...(mediaEnrichment.youtube_references && {
            youtube_references: mediaEnrichment.youtube_references
          })
        }
      } else {
        // Answer NOT found in local KB - suggest using Azure Search
        console.log(
          '[BYD WEBRTC TOOLS] ✗ Answer not found in local KB:',
          llmResult.reason
        )
        return {
          success: false,
          context: `I don't have that specific information readily available. ${llmResult.reason ||
            'Let me search for more details.'}`,
          source: 'local_kb',
          not_found: true,
          reason: llmResult.reason
        }
      }
    }

    if (toolName === 'search_vehicle_knowledge') {
      // Check cache first
      const cacheKey = `${modelId}:${toolArgs.query}:${toolArgs.query_type ||
        'general'}`
      let result = await getCachedVehicleSearch(modelId, cacheKey)

      if (!result) {
        console.log(
          '[BYD WEBRTC TOOLS] Cache miss - fetching from Azure Search'
        )
        result = await handleSearchVehicleKnowledge(
          toolArgs,
          modelConfig,
          null // No SSE helpers for WebRTC
        )
        // Cache the result
        await cacheVehicleSearch(modelId, cacheKey, result)
      } else {
        console.log('[BYD WEBRTC TOOLS] ✓ Using cached search result')
      }

      // Use search results directly - KB already in session instructions
      let searchContext = result.context || 'Information found.'
      if (searchContext.length > 500) {
        searchContext = searchContext.substring(0, 500) + '...'
      }

      // Build enriched context for AI response (URLs stripped since media is shown in UI)
      const enrichedContext = stripUrlsFromContext(searchContext)

      // Check if this is a pricing query - build pricing table data
      // Enhanced detection: check query_type AND common pricing keywords
      const queryLower = (toolArgs.query || '').toLowerCase()
      const pricingKeywords = [
        'price',
        'cost',
        'how much',
        'pricing',
        'pay',
        'expensive',
        'cheap',
        'afford',
        'budget'
      ]
      const hasPricingKeyword = pricingKeywords.some(keyword =>
        queryLower.includes(keyword)
      )

      const isPricingQuery =
        toolArgs.query_type === 'pricing' || hasPricingKeyword
      let pricingData = null
      let hasPricing = false

      if (isPricingQuery) {
        console.log(
          '[BYD WEBRTC TOOLS] Detected pricing query - building pricing table'
        )
        console.log(
          '[BYD WEBRTC TOOLS] Query type:',
          toolArgs.query_type,
          '| Query:',
          toolArgs.query
        )
        pricingData = buildPricingTableData(modelConfig)
        hasPricing = true
      }

      // ENRICH WITH MEDIA - automatically attach images/videos/reviews to Azure search results
      console.log(
        '[BYD WEBRTC TOOLS] Enriching Azure search result with media...'
      )
      let mediaEnrichment = {
        media_type: 'none',
        has_media: false
      }

      try {
        // Step 1: Decide which media type is most relevant
        const mediaDecision = await analyzeQueryForMedia(
          toolArgs.query,
          modelName
        )
        console.log(
          '[BYD WEBRTC TOOLS] Media decision for Azure search result:',
          mediaDecision.media_type
        )

        // Step 2: Fetch the appropriate media type
        if (mediaDecision.media_type === 'images') {
          // Check cache first
          let imageSearchResult = await getCachedImageSearch(
            modelId,
            toolArgs.query
          )

          if (!imageSearchResult) {
            console.log(
              '[BYD WEBRTC TOOLS] Image cache miss - fetching images for Azure search'
            )
            imageSearchResult = await searchRelevantImages(
              toolArgs.query,
              modelConfig,
              null
            )
            if (imageSearchResult.success) {
              await cacheImageSearch(modelId, toolArgs.query, imageSearchResult)
            }
          } else {
            console.log('[BYD WEBRTC TOOLS] ✓ Using cached images')
          }

          if (
            imageSearchResult.success &&
            imageSearchResult.images?.length > 0
          ) {
            const imageContext = `[Images displayed in UI - DO NOT list URLs. Say ONLY "Here are some great shots for you!" then ask a follow-up question like "What do you think?" or "Want to see more?"]`
            mediaEnrichment = {
              media_type: 'images',
              images: imageSearchResult.images,
              has_media: true,
              media_context: imageContext
            }
          }
        }

        if (mediaDecision.media_type === 'reviews') {
          // Check cache first
          let cachedReviews = await getCachedCustomerReviews(
            modelId,
            toolArgs.query
          )

          if (!cachedReviews) {
            console.log(
              '[BYD WEBRTC TOOLS] Reviews cache miss - generating reviews for Azure search'
            )
            const reviewQuery = `${modelName} owner reviews feedback experience`
            const searchResult = await handleSearchVehicleKnowledge(
              { query: reviewQuery, query_type: 'general_info' },
              modelConfig,
              null
            )
            cachedReviews = generateReviewsFromContext(
              searchResult,
              modelConfig
            )
            if (cachedReviews.length > 0) {
              await cacheCustomerReviews(modelId, toolArgs.query, cachedReviews)
            }
          } else {
            console.log('[BYD WEBRTC TOOLS] ✓ Using cached reviews')
          }

          if (cachedReviews && cachedReviews.length > 0) {
            const reviewContext = `[REVIEWS DISPLAYED - NEVER READ QUOTES ALOUD. Say ONLY 1 sentence like "Here's what owners are saying—check them out!" then ask a follow-up. DO NOT quote or summarize the review content.]`
            mediaEnrichment = {
              media_type: 'reviews',
              reviews: cachedReviews,
              has_media: true,
              media_context: reviewContext
            }
          }
        }

        if (mediaDecision.media_type === 'videos') {
          // Check cache first
          const cacheKey = `${modelId}:${toolArgs.query}:azure_search_media`
          let videoResult = await getCachedVehicleSearch(modelId, cacheKey)

          if (!videoResult) {
            console.log(
              '[BYD WEBRTC TOOLS] Video cache miss - fetching videos for Azure search'
            )
            videoResult = await handleSearchVehicleKnowledge(
              { query: toolArgs.query, query_type: 'media' },
              modelConfig,
              null
            )
            await cacheVehicleSearch(modelId, cacheKey, videoResult)
          } else {
            console.log('[BYD WEBRTC TOOLS] ✓ Using cached videos')
          }

          if (videoResult?.youtube_references?.length > 0) {
            const videoContext = `\n\n${VIDEO_DISPLAY_CONTEXT(modelName)}`
            mediaEnrichment = {
              media_type: 'videos',
              youtube_references: dedupeVideos(videoResult.youtube_references),
              has_media: true,
              media_context: videoContext
            }
          }
        }

        // Handle videos_and_reviews for technical spec questions (Azure search)
        if (mediaDecision.media_type === 'videos_and_reviews') {
          console.log(
            '[BYD WEBRTC TOOLS] Fetching both videos AND reviews for technical spec query (Azure)'
          )

          // Fetch videos
          const videoCacheKey = `${modelId}:${toolArgs.query}:azure_search_media`
          let videoResult = await getCachedVehicleSearch(modelId, videoCacheKey)
          if (!videoResult) {
            videoResult = await handleSearchVehicleKnowledge(
              { query: toolArgs.query, query_type: 'media' },
              modelConfig,
              null
            )
            await cacheVehicleSearch(modelId, videoCacheKey, videoResult)
          }

          // Fetch reviews
          let cachedReviews = await getCachedCustomerReviews(
            modelId,
            toolArgs.query
          )
          if (!cachedReviews) {
            const reviewQuery = `${modelName} owner reviews feedback experience`
            const searchResult = await handleSearchVehicleKnowledge(
              { query: reviewQuery, query_type: 'general_info' },
              modelConfig,
              null
            )
            cachedReviews = generateReviewsFromContext(
              searchResult,
              modelConfig
            )
            if (cachedReviews.length > 0) {
              await cacheCustomerReviews(modelId, toolArgs.query, cachedReviews)
            }
          }

          // Combine both
          const hasVideos = videoResult?.youtube_references?.length > 0
          const hasReviews = cachedReviews?.length > 0

          if (hasVideos || hasReviews) {
            const combinedContext = `\n\n${VIDEOS_AND_REVIEWS_CONTEXT}`
            mediaEnrichment = {
              media_type: 'videos_and_reviews',
              has_media: true,
              media_context: combinedContext,
              ...(hasVideos && {
                youtube_references: dedupeVideos(videoResult.youtube_references)
              }),
              ...(hasReviews && {
                reviews: cachedReviews,
                show_reviews: true
              })
            }
            console.log(
              `[BYD WEBRTC TOOLS] ✓ Combined media (Azure): ${
                hasVideos ? 'videos' : ''
              } ${hasReviews ? 'reviews' : ''}`
            )
          }
        }
      } catch (error) {
        console.error(
          '[BYD WEBRTC TOOLS] Media enrichment failed:',
          error.message
        )
        // Continue without media on error - don't break the Azure search answer
      }

      // Append media context instruction if media was enriched
      let finalContext = enrichedContext
      if (mediaEnrichment.media_context) {
        finalContext += mediaEnrichment.media_context
      }
      // Add language reminder to prevent Arabic/other language responses
      finalContext += ` ${LANGUAGE_ENFORCEMENT_CONTEXT}`

      const toolResult = {
        success: true,
        context: finalContext,
        pricing_data: pricingData,
        has_pricing: hasPricing,
        media_type: mediaEnrichment.media_type,
        has_media: mediaEnrichment.has_media,
        ...(mediaEnrichment.images && { images: mediaEnrichment.images }),
        ...(mediaEnrichment.reviews && {
          reviews: mediaEnrichment.reviews,
          show_reviews: true
        }),
        ...(mediaEnrichment.youtube_references && {
          youtube_references: mediaEnrichment.youtube_references
        })
      }

      console.log(
        '[BYD WEBRTC TOOLS] Result - Media type:',
        mediaEnrichment.media_type,
        '| Has media:',
        mediaEnrichment.has_media
      )
      if (hasPricing) {
        console.log('[BYD WEBRTC TOOLS] Returning pricing data')
      }

      return toolResult
    }

    if (toolName === 'search_vehicle_images') {
      const imageCategory = toolArgs.image_category || 'general'
      console.log(
        `[BYD WEBRTC TOOLS] Searching images: "${toolArgs.query}" (category: ${imageCategory})`
      )

      // Check if model has images enabled
      if (!modelConfig?.images?.enabled) {
        console.log('[BYD WEBRTC TOOLS] Images not enabled for this model')
        return {
          success: false,
          context: NO_IMAGES_CONTEXT(modelName),
          images: [],
          has_images: false
        }
      }

      try {
        // Check cache first
        let imageSearchResult = await getCachedImageSearch(
          modelId,
          toolArgs.query
        )

        if (!imageSearchResult) {
          console.log(
            '[BYD WEBRTC TOOLS] Image cache miss - calling AI image selection'
          )
          imageSearchResult = await searchRelevantImages(
            toolArgs.query,
            modelConfig,
            null // No SSE helpers for WebRTC
          )

          // Cache the result if successful
          if (imageSearchResult.success) {
            await cacheImageSearch(modelId, toolArgs.query, imageSearchResult)
          }
        } else {
          console.log('[BYD WEBRTC TOOLS] ✓ Using cached image search result')
        }

        if (imageSearchResult.success && imageSearchResult.images.length > 0) {
          console.log(
            `[BYD WEBRTC TOOLS] ✓ Returning ${imageSearchResult.images.length} images`
          )

          return {
            success: true,
            context: IMAGE_ACKNOWLEDGMENT_CONTEXT(modelName),
            images: imageSearchResult.images,
            has_images: true,
            image_count: imageSearchResult.images.length
          }
        }

        // No relevant images found
        console.log('[BYD WEBRTC TOOLS] No relevant images found for query')
        return {
          success: true,
          context: NO_IMAGES_FOUND_CONTEXT(toolArgs.query, modelName),
          images: [],
          has_images: false
        }
      } catch (error) {
        console.error('[BYD WEBRTC TOOLS] Image search error:', error.message)
        return {
          success: false,
          context: IMAGES_ERROR_CONTEXT(modelName),
          images: [],
          has_images: false,
          error: error.message
        }
      }
    }

    if (toolName === 'get_ev_charging_stations') {
      console.log(
        '[BYD WEBRTC TOOLS] Searching EV charging stations:',
        toolArgs.query || 'all stations'
      )

      try {
        // Check cache first
        const locationQuery = toolArgs.query || ''
        let result = await getCachedChargingStations(locationQuery)

        if (!result) {
          console.log(
            '[BYD WEBRTC TOOLS] Charging stations cache miss - fetching data'
          )
          result = searchChargingStations(locationQuery)
          // Cache the result
          await cacheChargingStations(locationQuery, result)
        } else {
          console.log('[BYD WEBRTC TOOLS] ✓ Using cached charging stations')
        }

        // Limit to only 5 stations with full details
        const limitedStations = result.stations.slice(0, 5)
        const totalCount = result.count

        // Build response context
        const stationsByEmirate = {}
        limitedStations.forEach(station => {
          if (!stationsByEmirate[station.emirate]) {
            stationsByEmirate[station.emirate] = []
          }
          stationsByEmirate[station.emirate].push(station)
        })

        // Build a concise summary for voice response
        const emirateList = Object.keys(stationsByEmirate).join(', ')
        const specs = result.overview.charging_specs

        const context = `Found ${totalCount} charging stations across ${emirateList}. The ${modelName} supports ${specs.ac_charging} and ${specs.dc_charging} charging. [Station cards displayed above - reference them naturally. IMPORTANT: Always respond in English only - never translate to Arabic even if user asked in Arabic.]`

        console.log(
          `[BYD WEBRTC TOOLS] Returning 5 out of ${totalCount} charging stations`
        )

        return {
          success: true,
          context: context,
          charging_stations: limitedStations,
          total_stations: totalCount,
          showing_stations: limitedStations.length,
          charging_overview: result.overview,
          stations_by_emirate: stationsByEmirate,
          has_charging_stations: true
        }
      } catch (error) {
        console.error(
          '[BYD WEBRTC TOOLS] Error fetching charging stations:',
          error
        )
        return {
          success: false,
          context:
            'I can tell you that the UAE has excellent charging infrastructure with DEWA in Dubai and ADNOC in Abu Dhabi. Would you like more details about the charging capabilities? [IMPORTANT: Always respond in English only - never translate to Arabic.]',
          has_charging_stations: false
        }
      }
    }

    if (toolName === 'get_customer_reviews') {
      console.log(
        '[BYD WEBRTC TOOLS] Fetching customer reviews for query:',
        toolArgs.query
      )

      // Check if this query should show reviews
      const reviewDecision = shouldShowReviews(toolArgs.query)

      if (!reviewDecision.showReviews) {
        console.log('[BYD WEBRTC TOOLS] Query does not qualify for reviews')
        return {
          success: false,
          context:
            "I don't have specific customer reviews for that query, but I can help you with other information about the vehicle.",
          show_reviews: false,
          reviews: []
        }
      }

      // Check cache first
      let cachedReviews = await getCachedCustomerReviews(
        modelId,
        toolArgs.query
      )

      let reviews
      if (cachedReviews) {
        console.log('[BYD WEBRTC TOOLS] ✓ Using cached customer reviews')
        reviews = cachedReviews
      } else {
        console.log(
          '[BYD WEBRTC TOOLS] Reviews cache miss - generating reviews'
        )
        // Search KB for review content using the model name
        const reviewQuery = `${modelName} owner reviews feedback experience performance quality`
        const result = await handleSearchVehicleKnowledge(
          {
            query: reviewQuery,
            query_type: 'general_info'
          },
          modelConfig,
          null
        )

        // Generate reviews from search context using LLM-style synthesis
        reviews = generateReviewsFromContext(result, modelConfig)

        // Cache the generated reviews
        if (reviews.length > 0) {
          await cacheCustomerReviews(modelId, toolArgs.query, reviews)
        }
      }

      if (reviews.length === 0) {
        console.log('[BYD WEBRTC TOOLS] No reviews could be generated')
        return {
          success: false,
          context:
            "I don't have customer reviews available right now, but I can tell you about the vehicle's features and specifications.",
          show_reviews: false,
          reviews: []
        }
      }

      console.log(
        `[BYD WEBRTC TOOLS] ✓ Returning ${reviews.length} customer reviews`
      )

      // Generate conclusion based on review categories (2-3 sentences)
      const reviewCategories = reviews.map(r => {
        const quote = r.quote.toLowerCase()
        if (
          quote.includes('range') ||
          quote.includes('battery') ||
          quote.includes('charge')
        )
          return 'range'
        if (
          quote.includes('performance') ||
          quote.includes('power') ||
          quote.includes('acceleration')
        )
          return 'performance'
        if (
          quote.includes('tech') ||
          quote.includes('features') ||
          quote.includes('infotainment')
        )
          return 'technology'
        if (
          quote.includes('quality') ||
          quote.includes('build') ||
          quote.includes('interior')
        )
          return 'quality'
        if (
          quote.includes('value') ||
          quote.includes('price') ||
          quote.includes('worth')
        )
          return 'value'
        return 'general'
      })

      // Build conclusion highlighting main themes
      const categoryCount = reviewCategories.reduce((acc, cat) => {
        acc[cat] = (acc[cat] || 0) + 1
        return acc
      }, {})
      const topCategory = Object.keys(categoryCount).sort(
        (a, b) => categoryCount[b] - categoryCount[a]
      )[0]

      const conclusions = CUSTOMER_REVIEWS_CONTEXT

      return {
        success: true,
        context: conclusions[topCategory] || conclusions.general,
        show_reviews: true,
        reviews: reviews,
        review_category: reviewDecision.category
      }
    }

    if (toolName === 'enrich_with_media') {
      console.log(
        '[BYD WEBRTC TOOLS] Enriching response with media for query:',
        toolArgs.query
      )

      try {
        // Step 1: Use LLM to decide which media type is most relevant
        const mediaDecision = await analyzeQueryForMedia(
          toolArgs.query,
          modelName
        )
        console.log('[BYD WEBRTC TOOLS] Media decision:', mediaDecision)

        // Step 2: If no media needed, return early
        if (mediaDecision.media_type === 'none') {
          return {
            success: true,
            media_type: 'none',
            has_media: false,
            context: '[No media enrichment needed for this query]'
          }
        }

        // Step 3: Call the appropriate media tool based on decision
        let mediaResult = null

        if (mediaDecision.media_type === 'images') {
          // Check cache first
          let imageSearchResult = await getCachedImageSearch(
            modelId,
            toolArgs.query
          )

          if (!imageSearchResult) {
            console.log(
              '[BYD WEBRTC TOOLS] Image cache miss - calling AI image selection'
            )
            imageSearchResult = await searchRelevantImages(
              toolArgs.query,
              modelConfig,
              null
            )
            if (imageSearchResult.success) {
              await cacheImageSearch(modelId, toolArgs.query, imageSearchResult)
            }
          } else {
            console.log('[BYD WEBRTC TOOLS] ✓ Using cached image search result')
          }

          if (
            imageSearchResult.success &&
            imageSearchResult.images?.length > 0
          ) {
            mediaResult = {
              media_type: 'images',
              images: imageSearchResult.images,
              has_images: true,
              has_media: true
            }
          }
        }

        if (mediaDecision.media_type === 'reviews') {
          // Check cache first
          let cachedReviews = await getCachedCustomerReviews(
            modelId,
            toolArgs.query
          )

          if (!cachedReviews) {
            console.log(
              '[BYD WEBRTC TOOLS] Reviews cache miss - generating reviews'
            )
            const reviewQuery = `${modelName} owner reviews feedback experience`
            const searchResult = await handleSearchVehicleKnowledge(
              { query: reviewQuery, query_type: 'general_info' },
              modelConfig,
              null
            )
            cachedReviews = generateReviewsFromContext(
              searchResult,
              modelConfig
            )
            if (cachedReviews.length > 0) {
              await cacheCustomerReviews(modelId, toolArgs.query, cachedReviews)
            }
          } else {
            console.log('[BYD WEBRTC TOOLS] ✓ Using cached customer reviews')
          }

          if (cachedReviews && cachedReviews.length > 0) {
            mediaResult = {
              media_type: 'reviews',
              reviews: cachedReviews,
              show_reviews: true,
              has_media: true
            }
          }
        }

        if (mediaDecision.media_type === 'videos') {
          // Check cache first
          const cacheKey = `${modelId}:${toolArgs.query}:media`
          let videoResult = await getCachedVehicleSearch(modelId, cacheKey)

          if (!videoResult) {
            console.log(
              '[BYD WEBRTC TOOLS] Video cache miss - fetching from Azure Search'
            )
            videoResult = await handleSearchVehicleKnowledge(
              { query: toolArgs.query, query_type: 'media' },
              modelConfig,
              null
            )
            await cacheVehicleSearch(modelId, cacheKey, videoResult)
          } else {
            console.log('[BYD WEBRTC TOOLS] ✓ Using cached video search result')
          }

          if (videoResult?.youtube_references?.length > 0) {
            mediaResult = {
              media_type: 'videos',
              youtube_references: dedupeVideos(videoResult.youtube_references),
              has_media: true
            }
          }
        }

        // Handle videos_and_reviews for technical spec questions
        if (mediaDecision.media_type === 'videos_and_reviews') {
          console.log(
            '[BYD WEBRTC TOOLS] Fetching both videos AND reviews for technical spec query'
          )

          // Fetch videos
          const videoCacheKey = `${modelId}:${toolArgs.query}:media`
          let videoResult = await getCachedVehicleSearch(modelId, videoCacheKey)
          if (!videoResult) {
            videoResult = await handleSearchVehicleKnowledge(
              { query: toolArgs.query, query_type: 'media' },
              modelConfig,
              null
            )
            await cacheVehicleSearch(modelId, videoCacheKey, videoResult)
          }

          // Fetch reviews
          let cachedReviews = await getCachedCustomerReviews(
            modelId,
            toolArgs.query
          )
          if (!cachedReviews) {
            const reviewQuery = `${modelName} owner reviews feedback experience`
            const searchResult = await handleSearchVehicleKnowledge(
              { query: reviewQuery, query_type: 'general_info' },
              modelConfig,
              null
            )
            cachedReviews = generateReviewsFromContext(
              searchResult,
              modelConfig
            )
            if (cachedReviews.length > 0) {
              await cacheCustomerReviews(modelId, toolArgs.query, cachedReviews)
            }
          }

          // Combine both
          const hasVideos = videoResult?.youtube_references?.length > 0
          const hasReviews = cachedReviews?.length > 0

          if (hasVideos || hasReviews) {
            mediaResult = {
              media_type: 'videos_and_reviews',
              has_media: true,
              ...(hasVideos && {
                youtube_references: dedupeVideos(videoResult.youtube_references)
              }),
              ...(hasReviews && {
                reviews: cachedReviews,
                show_reviews: true
              })
            }
            console.log(
              `[BYD WEBRTC TOOLS] ✓ Combined media: ${
                hasVideos ? 'videos' : ''
              } ${hasReviews ? 'reviews' : ''}`
            )
          }
        }

        // Step 4: Return the media result
        if (mediaResult) {
          console.log(
            `[BYD WEBRTC TOOLS] ✓ Returning ${mediaResult.media_type} media`
          )
          return {
            success: true,
            ...mediaResult,
            context: `[${mediaResult.media_type.toUpperCase()} will appear after your response - DO NOT say "on screen" or "above". Simply answer the question naturally, then the media will appear as visual support.]`
          }
        }

        // No media found
        return {
          success: true,
          media_type: 'none',
          has_media: false,
          context: '[No relevant media found for this query]'
        }
      } catch (error) {
        console.error(
          '[BYD WEBRTC TOOLS] Media enrichment error:',
          error.message
        )
        return {
          success: false,
          media_type: 'none',
          has_media: false,
          error: error.message,
          context: '[Media enrichment failed]'
        }
      }
    }

    if (toolName === 'get_competitor_comparison') {
      // Check cache first
      const competitors = toolArgs.competitor_vehicles || []
      const comparisonAspects = toolArgs.comparison_aspects || [
        'price',
        'performance',
        'features'
      ]
      let cachedComparison = await getCachedCompetitorComparison(
        modelId,
        competitors,
        comparisonAspects
      )

      let result
      if (cachedComparison) {
        console.log('[BYD WEBRTC TOOLS] ✓ Using cached competitor comparison')
        result = cachedComparison
      } else {
        console.log(
          '[BYD WEBRTC TOOLS] Comparison cache miss - fetching from Perplexity API'
        )
        result = await handleGetCompetitorComparison(
          toolArgs,
          modelConfig,
          'UAE',
          null // No SSE helpers for WebRTC
        )

        // Cache the result if successful
        if (result.success) {
          await cacheCompetitorComparison(
            modelId,
            competitors,
            comparisonAspects,
            result
          )
        }
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to fetch comparison data',
          context:
            result.comparison_context || 'Unable to fetch comparison data.'
        }
      }

      // Build structured comparison data for UI rendering (both table and cards)
      const comparisonData = buildComparisonTableData(
        modelConfig,
        result.competitors || [],
        toolArgs.comparison_aspects || ['price', 'performance', 'features']
      )

      // Build card-based comparison data
      const comparisonCards = buildComparisonCardsData(
        modelConfig,
        result.competitors || []
      )

      // Build concise comparison summary - card shows details, voice gives conclusion
      // Get model-specific advantages from comparison
      const specs = modelConfig?.specifications || {}
      const priceAed = modelConfig?.price_aed
      const basePrice = priceAed ? Object.values(priceAed)[0] : null
      const combinedPower =
        specs?.powertrain?.combined_power_hp ||
        specs?.powertrain?.motor?.power_hp
      const combinedRange =
        specs?.performance?.combined_range_km ||
        specs?.battery?.electric_range_km

      // Find what makes our car better based on actual specs
      const advantages = []

      if (basePrice && combinedPower && combinedRange) {
        // Build ground truth advantages
        if (combinedPower >= 300) {
          advantages.push(`stronger ${combinedPower}hp performance`)
        }
        if (combinedRange >= 800) {
          advantages.push(`impressive ${combinedRange}km range`)
        }
        if (basePrice < 200000) {
          advantages.push('competitive pricing')
        }
      }

      // Build 2-3 sentence response highlighting real advantages
      const advantageText =
        advantages.length > 0
          ? advantages.slice(0, 2).join(' and ')
          : 'excellent overall value'

      // Get competitor names for context
      const competitorNames = (result.competitors || [])
        .map(c => c.name)
        .slice(0, 2)
        .join(' and ')

      const voiceContext = buildComparisonVoiceContext({
        modelName,
        advantageText,
        competitorNames
      })

      // ENRICH COMPARISON WITH VIDEOS - fetch videos for the model
      console.log('[BYD WEBRTC TOOLS] Enriching comparison with videos...')
      let videoEnrichment = {
        has_videos: false
      }

      try {
        // Create dynamic cache key based on competitors to get different videos for each comparison
        const competitorList = (competitors || []).sort().join('|')
        const cacheKey = `${modelId}:comparison_vs_${competitorList ||
          'general'}`
        let videoResult = await getCachedVehicleSearch(modelId, cacheKey)

        if (!videoResult) {
          console.log(
            '[BYD WEBRTC TOOLS] Video cache miss - fetching videos for comparison'
          )
          // Generate query that includes competitor names for more relevant videos
          const competitorContext =
            competitors.length > 0
              ? `vs ${competitors.join(' and ')}`
              : 'overview'
          videoResult = await handleSearchVehicleKnowledge(
            {
              query: `${modelName} ${competitorContext} comparison features demo`,
              query_type: 'media'
            },
            modelConfig,
            null
          )
          await cacheVehicleSearch(modelId, cacheKey, videoResult)
        } else {
          console.log('[BYD WEBRTC TOOLS] ✓ Using cached comparison videos')
        }

        if (videoResult?.youtube_references?.length > 0) {
          videoEnrichment = {
            has_videos: true,
            youtube_references: dedupeVideos(videoResult.youtube_references)
          }
        }
      } catch (error) {
        console.error(
          '[BYD WEBRTC TOOLS] Video enrichment for comparison failed:',
          error.message
        )
      }

      // ENRICH COMPARISON WITH REVIEWS - fetch reviews for the model
      console.log('[BYD WEBRTC TOOLS] Enriching comparison with reviews...')
      let reviewEnrichment = {
        has_reviews: false
      }

      try {
        let cachedReviews = await getCachedCustomerReviews(
          modelId,
          'comparison_reviews'
        )
        if (!cachedReviews) {
          console.log(
            '[BYD WEBRTC TOOLS] Review cache miss - fetching reviews for comparison'
          )
          const reviewQuery = `${modelName} owner reviews feedback experience comparison`
          const searchResult = await handleSearchVehicleKnowledge(
            { query: reviewQuery, query_type: 'general_info' },
            modelConfig,
            null
          )
          cachedReviews = generateReviewsFromContext(searchResult, modelConfig)
          if (cachedReviews.length > 0) {
            await cacheCustomerReviews(
              modelId,
              'comparison_reviews',
              cachedReviews
            )
          }
        } else {
          console.log('[BYD WEBRTC TOOLS] ✓ Using cached comparison reviews')
        }

        if (cachedReviews?.length > 0) {
          reviewEnrichment = {
            has_reviews: true,
            reviews: cachedReviews
          }
        }
      } catch (error) {
        console.error(
          '[BYD WEBRTC TOOLS] Review enrichment for comparison failed:',
          error.message
        )
      }

      // Build result: text → cards → videos → reviews
      const comparisonResult = {
        success: true,
        context: voiceContext,
        comparison_data: comparisonData,
        comparison_cards: comparisonCards,
        has_comparison: true,
        stream_response_first: true,
        display_cards_after_stream: true,
        denza_model: result.denza_model,
        competitors: result.competitors,
        comparison_aspects: result.comparison_aspects
      }

      // Add videos (after cards in UI ordering)
      if (videoEnrichment.has_videos) {
        comparisonResult.youtube_references = videoEnrichment.youtube_references
        comparisonResult.has_videos = true
      }

      // Add reviews LAST (after videos in UI ordering)
      if (reviewEnrichment.has_reviews) {
        comparisonResult.reviews = reviewEnrichment.reviews
        comparisonResult.has_reviews = true
      }

      return comparisonResult
    }

    if (toolName === 'show_promotional_offer') {
      console.log('[BYD WEBRTC TOOLS] Showing promotional offer card')

      const offerCard = {
        tag: 'Ramadan offer',
        text: 'Save AED 4,000 on any BYD model — book before Ramadan!'
      }

      return {
        success: true,
        context: `[OFFER CARD DISPLAYED - Say something like: "Great news! We have a Ramadan special — AED 4,000 off all models! Book before Ramadan and save big. Want to explore finance options or book a test drive?"]
[CRITICAL: Respond in ENGLISH ONLY. Never switch to Arabic or any other language.]`,
        offer_card: offerCard,
        has_offer: true
      }
    }

    if (toolName === 'show_emi_calculator') {
      console.log('[BYD WEBRTC TOOLS] Showing EMI calculator:', toolArgs)

      const variants =
        modelConfig?.variants || Object.keys(modelConfig?.price_aed || {})
      const variant = variants[0] || 'Standard'
      const carPrice = modelConfig?.price_aed?.[variant] || 0

      // Parse user-specified values from tool args
      const {
        down_payment_amount,
        tenure_years: userTenure,
        interest_rate: userInterest
      } = toolArgs || {}

      // Calculate default down payment percent (or from user amount)
      let defaultDownPercent = 20
      if (down_payment_amount && carPrice > 0) {
        defaultDownPercent = Math.round((down_payment_amount / carPrice) * 100)
        defaultDownPercent = Math.max(20, Math.min(90, defaultDownPercent))
      }

      // Use user values or defaults
      const defaultTenure = userTenure || 5
      const defaultInterest = userInterest || 5

      const emiConfig = {
        model_id: modelConfig?.id,
        model_name: modelConfig?.name,
        variant,
        car_price: carPrice,
        currency: 'AED',
        slider_config: {
          downpayment: {
            min_percent: 20,
            max_percent: 90,
            min_amount: Math.round(carPrice * 0.2),
            max_amount: Math.round(carPrice * 0.9),
            default_percent: defaultDownPercent
          },
          tenure: {
            min_years: 2,
            max_years: 10,
            default_years: Math.max(2, Math.min(10, defaultTenure))
          },
          interest_rate: {
            min: 1,
            max: 10,
            default: Math.max(1, Math.min(10, defaultInterest))
          }
        },
        initial_values: {
          down_payment_amount: down_payment_amount || null,
          tenure_years: userTenure || null,
          interest_rate: userInterest || null
        }
      }

      // Build context message based on whether user specified values
      let contextMsg =
        "Here's the EMI calculator! Adjust down payment, duration, and interest rate with the sliders—monthly payments update instantly."
      if (down_payment_amount) {
        const formattedAmount = Number(down_payment_amount).toLocaleString()
        contextMsg = `I've set the down payment to AED ${formattedAmount} for you. You can adjust it and other values using the sliders.`
      }

      return {
        success: true,
        context: `[EMI CALCULATOR DISPLAYED - Say: "${contextMsg}"]
[CRITICAL: Respond in ENGLISH ONLY. Never switch to Arabic or any other language.]`,
        emi_calculator: emiConfig,
        has_emi_calculator: true,
        display_emi_calculator_after_stream: true
      }
    }

    if (toolName === 'validate_phone_number') {
      const { phone_input } = toolArgs
      console.log('[BYD WEBRTC TOOLS] Capturing phone number:', phone_input)

      // Parse spoken phone number patterns (handles "triple nine", "double five", etc.)
      const parsed = parseSpokenPhoneNumber(phone_input)
      const displayPhone = formatPhoneForDisplay(parsed.digits)
      const speechPhone = formatPhoneForSpeech(parsed.digits)

      console.log(`[BYD WEBRTC TOOLS] Phone parsed:`, {
        input: phone_input,
        digits: parsed.digits,
        displayPhone,
        speechPhone,
        parseSuccess: parsed.parseSuccess
      })

      return {
        success: true,
        valid: parsed.parseSuccess,
        phone: parsed.digits,
        display_phone: displayPhone,
        speech_phone: speechPhone,
        context: `[PHONE CAPTURED: ${displayPhone}. Say EXACTLY: "Got it—${speechPhone}. Is that correct?" Read each digit with hyphens. If yes → locations. If correction → call tool again.]`
      }
    }

    if (toolName === 'get_showroom_locations') {
      console.log('[BYD WEBRTC TOOLS] Getting showroom locations')

      // Extract locations directly from model config
      const locations = modelConfig?.locations || {}
      let locationsData = null
      let hasLocations = false

      if (
        locations.uae &&
        Array.isArray(locations.uae) &&
        locations.uae.length > 0
      ) {
        locationsData = locations.uae.map(location => ({
          name: location.name,
          emirate: location.emirate,
          address: location.address,
          phone: location.phone,
          hours: location.hours,
          types: location.types || [],
          google_maps_url: location.google_maps_url || ''
        }))
        hasLocations = true
        console.log(
          '[BYD WEBRTC TOOLS] ✓ Returning',
          locationsData.length,
          'showroom locations'
        )
      } else {
        console.error('[BYD WEBRTC TOOLS] ✗ No locations found in model config')
      }

      return {
        success: hasLocations,
        context: hasLocations
          ? SHOWROOM_LOCATIONS_CONTEXT
          : "I'm having trouble pulling up locations. Which area works best—Dubai, Abu Dhabi, or Sharjah?",
        locations: locationsData,
        has_locations: hasLocations
      }
    }

    if (toolName === 'get_booking_slots') {
      console.log('[BYD WEBRTC TOOLS] Generating booking slots for next 6 days')

      // Generate available slots
      const slots = generateBookingSlots()

      console.log('[BYD WEBRTC TOOLS] Generated', slots.length, 'days of slots')

      return {
        success: true,
        context: BOOKING_SLOTS_CONTEXT,
        booking_slots: slots,
        has_booking_slots: true
      }
    }

    if (toolName === 'book_test_drive') {
      // Simulate booking logic - in production, this would call a CRM API
      console.log('[BYD WEBRTC TOOLS] Processing test drive booking:', toolArgs)

      // Extract booking details
      const {
        customer_name,
        phone_number,
        location,
        preferred_date,
        preferred_time
      } = toolArgs

      // Validate booking data
      const validation = validateBookingData(toolArgs)
      if (!validation.isValid) {
        console.warn(
          '[BYD WEBRTC TOOLS] Validation failed:',
          validation.errors,
          validation.details
        )

        let clarificationMsg = ''
        if (validation.errors.length === 1) {
          clarificationMsg = `Just need your ${validation.errors[0]} to lock this in. What is it?`
        } else {
          clarificationMsg = `Missing a few details: ${validation.errors.join(
            ', '
          )}. Let's sort them out—what's your full name?`
        }

        return {
          success: false,
          error: 'Missing or invalid booking information',
          context: clarificationMsg,
          missing_fields: validation.errors
        }
      }

      // Build booking confirmation data for UI
      const bookingData = {
        customer_name: customer_name.trim(),
        phone_number: phone_number.trim(),
        location: location.trim(),
        date: preferred_date.trim(),
        time: preferred_time.trim(),
        booking_id: `TD-${Date.now()}`
      }

      // In production, this would create actual booking in CRM
      console.log(
        '[BYD WEBRTC TOOLS] Booking created successfully:',
        bookingData
      )

      return {
        success: true,
        context: BOOKING_CONFIRMATION_CONTEXT({
          preferredDate: preferred_date,
          preferredTime: preferred_time,
          phoneNumber: phone_number,
          modelName: modelConfig?.name || 'BYD Vehicle'
        }),
        booking_data: bookingData,
        has_booking: true
      }
    }

    if (toolName === 'show_car_configurator') {
      console.log('[BYD WEBRTC TOOLS] Showing car configurator:', toolArgs)

      const configuratorData = buildConfiguratorData(modelConfig, {
        selected_color: toolArgs.selected_color || null,
        selected_interior: toolArgs.selected_interior || null,
        selected_view: toolArgs.selected_view || 'front'
      })

      const modelName = modelConfig?.name || 'BYD Vehicle'
      const hasPreselectedColor = !!toolArgs.selected_color

      return {
        success: true,
        context: hasPreselectedColor
          ? `[CONFIGURATOR NOW VISIBLE with ${toolArgs.selected_color} - Say "Here's the ${modelName} in ${toolArgs.selected_color}! Tap other colors to explore." then WAIT. Card disappears after this turn - if user asks to see configurator again, RE-CALL this tool. RESPOND IN ENGLISH ONLY.]`
          : `[CONFIGURATOR NOW VISIBLE - Say "Here's the configurator! Tap any color to see your ${modelName}." then WAIT. Card disappears after this turn - if user asks to see it again, RE-CALL this tool. RESPOND IN ENGLISH ONLY.]`,
        configurator_data: configuratorData,
        has_configurator: true
      }
    }

    return {
      success: false,
      error: `Unknown tool: ${toolName}`
    }
  } catch (error) {
    console.error(`[BYD WEBRTC TOOLS] Error executing ${toolName}:`, error)
    return {
      success: false,
      error: error.message,
      context:
        'Sorry, I had trouble getting that information. Let me try to help with what I know.'
    }
  }
}

export const executeMultipleTools = async (toolCalls, modelConfig) => {
  const modelName = modelConfig?.name || 'Unknown Model'
  console.log(
    `[BYD WEBRTC TOOLS] Executing ${toolCalls.length} tools in parallel for ${modelName}`
  )

  try {
    // Execute all tools in parallel using Promise.all
    const startTime = Date.now()
    const results = await Promise.all(
      toolCalls.map(async (toolCall, index) => {
        const { name, args } = toolCall
        console.log(
          `[BYD WEBRTC TOOLS] Parallel [${index + 1}/${
            toolCalls.length
          }]: ${name}`
        )

        try {
          const result = await executeToolCall(name, args, modelConfig)
          return {
            success: true,
            toolName: name,
            result,
            index
          }
        } catch (error) {
          console.error(
            `[BYD WEBRTC TOOLS] Parallel tool ${name} failed:`,
            error.message
          )
          return {
            success: false,
            toolName: name,
            error: error.message,
            index
          }
        }
      })
    )
    const duration = Date.now() - startTime

    console.log(
      `[BYD WEBRTC TOOLS] ✓ Parallel execution completed in ${duration}ms`
    )

    // Return results in original order
    return results.sort((a, b) => a.index - b.index)
  } catch (error) {
    console.error(
      '[BYD WEBRTC TOOLS] Parallel execution failed:',
      error.message
    )
    throw error
  }
}
