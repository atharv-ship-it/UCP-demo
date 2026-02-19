// Session state helpers - in-memory tracking for nudge/interest signals

const sessionState = new Map()

function getState(sessionToken) {
  if (!sessionState.has(sessionToken)) {
    sessionState.set(sessionToken, {
      exchangeCount: 0,
      modelFocus: null,
      interestSignals: []
    })
  }
  return sessionState.get(sessionToken)
}

export async function incrementExchangeCount(sessionToken) {
  const state = getState(sessionToken)
  state.exchangeCount++
}

export async function setModelFocus(sessionToken, modelId) {
  const state = getState(sessionToken)
  state.modelFocus = modelId
}

export async function recordInterestSignal(sessionToken, signal) {
  const state = getState(sessionToken)
  state.interestSignals.push({ signal, at: Date.now() })
}

export function getSessionState(sessionToken) {
  return getState(sessionToken)
}
