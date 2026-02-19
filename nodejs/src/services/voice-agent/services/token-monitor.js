// Token monitor - tracks token usage per session (in-memory)

const sessionUsage = new Map()

export function logUsage(sessionToken, usage, context) {
  if (!sessionUsage.has(sessionToken)) {
    sessionUsage.set(sessionToken, { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 })
  }
  const s = sessionUsage.get(sessionToken)
  s.inputTokens += usage.input_tokens || usage.prompt_tokens || 0
  s.outputTokens += usage.output_tokens || usage.completion_tokens || 0
  s.totalTokens += usage.total_tokens || 0
  s.calls++
}

export function logRequestContext(sessionToken, context) {
  // no-op in stub - extend if file logging needed
}

export function getTotalSummary() {
  let totalInput = 0, totalOutput = 0, totalAll = 0, sessions = 0
  for (const s of sessionUsage.values()) {
    totalInput += s.inputTokens
    totalOutput += s.outputTokens
    totalAll += s.totalTokens
    sessions++
  }
  return { totalInputTokens: totalInput, totalOutputTokens: totalOutput, totalTokens: totalAll, sessions }
}

export function endSession(sessionToken) {
  sessionUsage.delete(sessionToken)
}
