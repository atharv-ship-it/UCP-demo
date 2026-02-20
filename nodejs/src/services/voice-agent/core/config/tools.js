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
  },
  {
    type: 'function',
    name: 'show_journey_media',
    description: `Show supporting videos or reviews at the right moment in the customer journey. Call this sparingly — only when media genuinely adds value and the user is receptive. Rules:
- "videos": show when the user is in an exploring or comparing mood AND a video adds what words can't — a real walkthrough, how the unit operates, efficiency in action, installation context. Also offer proactively after a few turns if user is still curious and no video shown yet. Do NOT show when user is in buying/transactional mode, during checkout, or post-purchase.
- "reviews": show when user asks about reliability, real-world experience, owner satisfaction, "is it worth it", or expresses doubt about the purchase. Do NOT show reviews during awareness or if the user is already convinced.
- Never call during or after checkout.`,
    parameters: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['awareness', 'consideration', 'high_end_comfort', 'decision', 'post_purchase'],
          description: 'The current journey stage based on what the user is expressing. awareness=learning/curious, consideration=comparing/evaluating, high_end_comfort=interested in premium/variable-speed, decision=ready to buy/confirm, post_purchase=already bought.'
        },
        type: {
          type: 'string',
          enum: ['videos', 'reviews'],
          description: 'videos: YouTube walkthroughs and explainers. reviews: written owner/expert reviews and articles.'
        }
      },
      required: ['stage', 'type']
    }
  }
]
