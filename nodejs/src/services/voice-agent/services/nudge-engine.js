// Nudge engine - evaluates whether to show a nudge to the user

export async function evaluateNudge(payload, sessionKey, modelConfig, conversationHistory) {
  // Stub: always returns no nudge - extend with LLM logic when needed
  return {
    should_nudge: false,
    reason: 'nudge_engine_stub'
  }
}
