// Tools config - defines tools available to the voice agent
// Adapted for Lennox UCP (no BYD-specific tools)

export const TOOLS_CONFIG = [
  {
    type: 'function',
    name: 'show_products',
    description: 'Show Lennox AC product cards with images. Call this whenever the user wants to: browse products, see options, compare models, view a specific model or series, see a picture/photo of any AC unit, or is ready to buy. This is the ONLY way to show product images — always call this when user asks to "see" or "show" any Lennox product.',
    parameters: {
      type: 'object',
      properties: {
        filter_series: {
          type: 'string',
          enum: ['all', 'signature', 'elite', 'merit'],
          description: 'Filter by product series. Use "all" by default unless user specifies a series. Use "signature" for Dave Lennox Signature Collection, "elite" for Elite Series, "merit" for Merit Series.'
        },
        model_id: {
          type: 'string',
          description: 'Specific product model ID to show (e.g. "sl25kcv", "el22kcv", "ml17xc1"). Use this when user asks about or wants to see a specific model.'
        },
        limit: {
          type: 'number',
          description: 'Max number of products to show. Default: 1 for specific model, 4 for series/all.'
        }
      },
      required: ['filter_series']
    }
  }
]
