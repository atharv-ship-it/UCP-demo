// Redis cache - in-memory fallback (no Redis required for dev/POC)

const cache = new Map()
const TTL_MS = 10 * 60 * 1000 // 10 minutes

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
}

function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.value
}

// Conversation history (per session, in-memory)
const conversations = new Map()

export async function addConversationMessage(sessionToken, message) {
  if (!conversations.has(sessionToken)) conversations.set(sessionToken, [])
  conversations.get(sessionToken).push(message)
  return true
}

export async function getConversationHistory(sessionToken, limit = 20) {
  const history = conversations.get(sessionToken) || []
  return history.slice(-limit)
}

export async function getConversationTokenEstimate(sessionToken) {
  const history = conversations.get(sessionToken) || []
  const chars = history.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)
  return Math.ceil(chars / 4) // rough estimate: 4 chars per token
}

export async function pruneConversationHistory(sessionToken, maxTokens = 4000) {
  const history = conversations.get(sessionToken) || []
  let pruned = 0
  while (history.length > 4) {
    const chars = history.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)
    if (Math.ceil(chars / 4) <= maxTokens) break
    history.shift()
    pruned++
  }
  conversations.set(sessionToken, history)
  return pruned
}

// Generic cache helpers
export async function cacheVehicleSearch(modelId, key, value) { cacheSet(`vs:${modelId}:${key}`, value) }
export async function getCachedVehicleSearch(modelId, key) { return cacheGet(`vs:${modelId}:${key}`) }

export async function cacheLocalKBSearch(modelId, query, queryType, value) { cacheSet(`kb:${modelId}:${query}:${queryType}`, value) }
export async function getCachedLocalKBSearch(modelId, query, queryType) { return cacheGet(`kb:${modelId}:${query}:${queryType}`) }

export async function cacheImageSearch(modelId, query, value) { cacheSet(`img:${modelId}:${query}`, value) }
export async function getCachedImageSearch(modelId, query) { return cacheGet(`img:${modelId}:${query}`) }

export async function cacheCustomerReviews(modelId, query, value) { cacheSet(`rev:${modelId}:${query}`, value) }
export async function getCachedCustomerReviews(modelId, query) { return cacheGet(`rev:${modelId}:${query}`) }

export async function cacheChargingStations(query, value) { cacheSet(`ev:${query}`, value) }
export async function getCachedChargingStations(query) { return cacheGet(`ev:${query}`) }

export async function cacheCompetitorComparison(modelId, competitors, aspects, value) {
  cacheSet(`comp:${modelId}:${competitors.join(',')}:${aspects.join(',')}`, value)
}
export async function getCachedCompetitorComparison(modelId, competitors, aspects) {
  return cacheGet(`comp:${modelId}:${competitors.join(',')}:${aspects.join(',')}`)
}
