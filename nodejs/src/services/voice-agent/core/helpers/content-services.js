// Content services - image search and review generation stubs

export async function searchRelevantImages(query, modelConfig, sseHelpers) {
  // Stub: no image CDN configured for Lennox UCP yet
  return { success: false, images: [] }
}

export function shouldShowReviews(query) {
  const reviewKeywords = [
    'review', 'opinion', 'experience', 'feedback', 'recommend',
    'worth', 'reliable', 'quality', 'owner', 'rating'
  ]
  const queryLower = (query || '').toLowerCase()
  const showReviews = reviewKeywords.some(kw => queryLower.includes(kw))
  return { showReviews, category: 'general' }
}

export function generateReviewsFromContext(searchResult, modelConfig) {
  // Stub: returns empty array - extend when real review data is available
  return []
}
