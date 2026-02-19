// Model registry - stub (no BYD models needed for Lennox/UCP)
// Extend this if you add model-specific configs in future

const models = new Map()

export function getModelConfig(modelId) {
  return models.get(modelId) || null
}

export function getModelsInfo() {
  return Array.from(models.values()).map(m => ({ id: m.id, name: m.name }))
}

export function hasModel(modelId) {
  return models.has(modelId)
}

export function registerModel(config) {
  models.set(config.id, config)
}
