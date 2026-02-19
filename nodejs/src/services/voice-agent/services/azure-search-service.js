// Azure Search service - stub (no Azure index for Lennox UCP)
// The voice agent falls back to local KB when this returns empty

export async function handleSearchVehicleKnowledge(toolArgs, modelConfig, sseHelpers) {
  return {
    success: false,
    context: 'Azure Search is not configured. Using local knowledge base.',
    youtube_references: [],
    source: 'azure_stub'
  }
}

export async function handleGetCompetitorComparison(toolArgs, modelConfig, market, sseHelpers) {
  return {
    success: false,
    context: 'Competitor comparison is not configured.',
    competitors: [],
    comparison_aspects: toolArgs.comparison_aspects || []
  }
}
