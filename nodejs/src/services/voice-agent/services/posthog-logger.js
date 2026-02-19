// PostHog logger - stub (no PostHog configured, logs to console in dev)

const DEBUG = process.env.VOICE_AGENT_DEBUG === 'true'
const log = (...args) => { if (DEBUG) console.log('[POSTHOG]', ...args) }

export function registerSession(sessionToken, data) { log('registerSession', sessionToken, data) }
export function logSessionCreated(sessionToken, data) { log('logSessionCreated', sessionToken, data) }
export function logSessionConfig(sessionToken, config) { log('logSessionConfig', sessionToken) }
export function logConversationMessage(sessionToken, data) { log('logConversationMessage', sessionToken, data?.role) }
export function logTokenUsage(sessionToken, data) { log('logTokenUsage', sessionToken, data) }
export function logToolExecutionStarted(sessionToken, data) { log('logToolExecutionStarted', data?.toolName) }
export function logToolExecutionCompleted(sessionToken, data) { log('logToolExecutionCompleted', data?.toolName, data?.durationMs + 'ms') }
export function logToolExecutionError(sessionToken, data) { console.error('[POSTHOG] toolError', data?.toolName, data?.error) }
export function logSecurityEvent(sessionToken, data) { console.warn('[POSTHOG] securityEvent', data?.type) }
export function logError(sessionToken, data) { console.error('[POSTHOG] error', data?.error) }
