// Validation helpers

export function validateSessionToken(sessionToken, validSessions) {
  if (!sessionToken) {
    return { isValid: false, error: 'Missing session token' }
  }
  if (!validSessions.has(sessionToken)) {
    return { isValid: false, error: 'Invalid or expired session token' }
  }
  return { isValid: true }
}

export function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return { isValid: false, error: 'Message must be an object' }
  }
  if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
    return { isValid: false, error: 'Message must have a valid role' }
  }
  if (message.content === undefined || message.content === null) {
    return { isValid: false, error: 'Message must have content' }
  }
  return { isValid: true }
}

export function validateBookingData(bookingData) {
  const errors = []
  const details = {}

  if (!bookingData.customer_name?.trim()) {
    errors.push('name')
    details.customer_name = 'required'
  }
  if (!bookingData.phone_number?.trim()) {
    errors.push('phone number')
    details.phone_number = 'required'
  }
  if (!bookingData.location?.trim()) {
    errors.push('location')
    details.location = 'required'
  }
  if (!bookingData.preferred_date?.trim()) {
    errors.push('date')
    details.preferred_date = 'required'
  }
  if (!bookingData.preferred_time?.trim()) {
    errors.push('time')
    details.preferred_time = 'required'
  }

  return { isValid: errors.length === 0, errors, details }
}

export function parseSpokenPhoneNumber(input) {
  if (!input) return { digits: '', parseSuccess: false }

  let text = input.toLowerCase()
  // Handle spoken patterns
  text = text.replace(/\btriple\s+(\d|[a-z])\b/g, (_, d) => d + d + d)
  text = text.replace(/\bdouble\s+(\d|[a-z])\b/g, (_, d) => d + d)
  text = text.replace(/\boh\b/g, '0')
  text = text.replace(/\bzero\b/g, '0')

  const digits = text.replace(/\D/g, '')
  return { digits, parseSuccess: digits.length >= 7 }
}

export function formatPhoneForDisplay(digits) {
  if (!digits) return ''
  return digits.split('').join('-')
}

export function formatPhoneForSpeech(digits) {
  if (!digits) return ''
  return digits.split('').join('-')
}
