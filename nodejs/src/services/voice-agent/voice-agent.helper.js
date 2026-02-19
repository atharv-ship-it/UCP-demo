// Voice Agent Helper - Utility functions for rate limiting, session management, and security

import { endSession as endTokenSession } from './services/token-monitor.js'

// Allowed origins for CORS
export const ALLOWED_ORIGINS = [
  'https://nudge.goswirl.ai',
  'https://denza-uae.ae',
  'http://localhost:9018',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://192.168.31.168:9000'
]

// Rate limiting configuration
export const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
export const MAX_SESSION_REQUESTS = 100 // Max 100 session requests per minute per IP (POC)
export const MAX_TOOL_REQUESTS = 300 // Max 300 tool requests per minute per IP (POC)

// Session configuration
export const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

// Session tokens: track valid sessions
export const validSessions = new Map()

// Rate limiting: track requests per IP
const rateLimitMap = new Map()

// Start session cleanup interval - cleans up expired sessions every 5 minutes
export const startSessionCleanup = () => {
  setInterval(() => {
    const now = Date.now()

    // Cleanup expired sessions
    // eslint-disable-next-line no-unused-vars
    for (const [sessionId, sessionData] of validSessions.entries()) {
      if (now - sessionData.createdAt > SESSION_TTL_MS) {
        endTokenSession(sessionId)
        validSessions.delete(sessionId)
      }
    }

    // Cleanup rate limit entries
    // eslint-disable-next-line no-unused-vars
    for (const [ip, limitData] of rateLimitMap.entries()) {
      if (now - limitData.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(ip)
      }
    }
  }, 5 * 60 * 1000)
}

// Rate limiter middleware factory
export const rateLimiter = (maxRequests, keyPrefix = 'general') => {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown'
    const key = `${keyPrefix}:${ip}`
    const now = Date.now()

    let record = rateLimitMap.get(key)

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      record = { windowStart: now, count: 0 }
    }

    record.count++
    rateLimitMap.set(key, record)

    if (record.count > maxRequests) {
      console.warn(
        `[VOICE AGENT HELPER] Rate limit exceeded for ${ip} on ${keyPrefix}`
      )
      return res.status(429).json({
        error: 'Too many requests. Please try again later.'
      })
    }

    next()
  }
}

// CORS options for Express
export const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.) in development
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true)
    }

    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(
        `[VOICE AGENT HELPER] Blocked request from origin: ${origin}`
      )
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}
