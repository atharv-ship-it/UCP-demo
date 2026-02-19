// Voice Agent Router - Hono-compatible
// Mounts all voice agent endpoints under /voice-agent prefix

import { Hono } from 'hono'
import {
  calculateEMIHandler,
  createSession,
  evaluateTextResponse,
  exchangeRealtimeSdp,
  executeTools,
  getConversationHistoryHandler,
  getEMIConfig,
  getTokenUsage,
  handleNudge,
  logContextDebug,
  pruneConversationHandler,
  reportUsage,
  storeConversationMessage
} from './voice-agent.controller.js'
import {
  MAX_SESSION_REQUESTS,
  MAX_TOOL_REQUESTS,
  rateLimiter
} from './voice-agent.helper.js'

// Adapter: wraps a controller function (req/res style) for Hono context
// The controller functions expect Express-like req/res objects
function adapt(fn) {
  return async (c) => {
    const req = {
      body: await c.req.json().catch(() => ({})),
      query: Object.fromEntries(new URL(c.req.url).searchParams.entries()),
      params: c.req.param(),
      headers: {},
      ip: c.req.header('x-forwarded-for') || 'unknown',
      connection: { remoteAddress: 'unknown' },
      header: (name) => c.req.header(name),
      get: (name) => c.req.header(name)
    }

    // Proxy headers object
    req.headers = new Proxy({}, {
      get(_, key) { return c.req.header(String(key)) }
    })

    let responseData = null
    let responseStatus = 200

    const res = {
      status(code) { responseStatus = code; return res },
      json(data) { responseData = data; return res },
      send(data) { responseData = data; return res }
    }

    await fn(req, res)

    return c.json(responseData, responseStatus)
  }
}

// Simple rate limiter middleware for Hono
function honoRateLimiter(maxRequests, keyPrefix) {
  const rateLimitMap = new Map()
  const WINDOW_MS = 60000

  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for') || 'unknown'
    const key = `${keyPrefix}:${ip}`
    const now = Date.now()

    let record = rateLimitMap.get(key)
    if (!record || now - record.windowStart > WINDOW_MS) {
      record = { windowStart: now, count: 0 }
    }
    record.count++
    rateLimitMap.set(key, record)

    if (record.count > maxRequests) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429)
    }

    await next()
  }
}

const voiceAgentRouter = new Hono()

// Health & Info
voiceAgentRouter.get('/api/token-usage', adapt(getTokenUsage))

// WebRTC session & tools
voiceAgentRouter.post('/session', honoRateLimiter(MAX_SESSION_REQUESTS, 'session'), adapt(createSession))
voiceAgentRouter.post('/realtime', honoRateLimiter(MAX_SESSION_REQUESTS, 'realtime'), adapt(exchangeRealtimeSdp))
voiceAgentRouter.post('/tools', honoRateLimiter(MAX_TOOL_REQUESTS, 'tools'), adapt(executeTools))

// Conversation history
voiceAgentRouter.post('/conversation/message', honoRateLimiter(500, 'conversation'), adapt(storeConversationMessage))
voiceAgentRouter.get('/conversation/history', honoRateLimiter(200, 'conversation'), adapt(getConversationHistoryHandler))
voiceAgentRouter.post('/conversation/prune', honoRateLimiter(100, 'conversation'), adapt(pruneConversationHandler))

// Token usage reporting
voiceAgentRouter.post('/usage', honoRateLimiter(500, 'usage'), adapt(reportUsage))

// Context debug logging
voiceAgentRouter.post('/context-debug', honoRateLimiter(100, 'debug'), adapt(logContextDebug))

// Nudge decision
voiceAgentRouter.post('/nudge', honoRateLimiter(200, 'nudge'), adapt(handleNudge))

// Text-based evaluation
voiceAgentRouter.post('/evaluate', honoRateLimiter(100, 'evaluate'), adapt(evaluateTextResponse))

// EMI Calculator
voiceAgentRouter.get('/emi-calculator/config', honoRateLimiter(200, 'emi'), adapt(getEMIConfig))
voiceAgentRouter.post('/emi-calculator/calculate', honoRateLimiter(200, 'emi'), adapt(calculateEMIHandler))

export default voiceAgentRouter
