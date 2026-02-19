// Data builders - builds structured UI card data from model config

export function buildPricingTableData(modelConfig) {
  if (!modelConfig?.price_aed) return null
  const rows = Object.entries(modelConfig.price_aed).map(([variant, price]) => ({
    variant,
    price,
    currency: 'AED'
  }))
  return { rows, title: `${modelConfig.name} Pricing` }
}

export function buildWarrantyData(modelConfig) {
  const warranty = modelConfig?.specifications?.warranty
  if (!warranty) return null
  return { warranty, title: `${modelConfig?.name || 'Vehicle'} Warranty` }
}

export function buildTrimComparisonData(modelConfig) {
  if (!modelConfig?.variants || modelConfig.variants.length < 2) return null
  return {
    title: `${modelConfig.name} Trim Comparison`,
    trims: modelConfig.variants.map(v => ({ name: v }))
  }
}

export function buildComparisonTableData(modelConfig, competitors, aspects) {
  return {
    title: 'Comparison',
    aspects,
    rows: competitors.map(c => ({ name: c.name, data: c }))
  }
}

export function buildComparisonCardsData(modelConfig, competitors) {
  return competitors.map(c => ({ name: c.name, specs: c }))
}

export function buildConfiguratorData(modelConfig, options) {
  return {
    model_id: modelConfig?.id,
    model_name: modelConfig?.name,
    selected_color: options?.selected_color || null,
    selected_interior: options?.selected_interior || null,
    selected_view: options?.selected_view || 'front'
  }
}

export function generateBookingSlots() {
  const slots = []
  const today = new Date()

  for (let d = 1; d <= 6; d++) {
    const date = new Date(today)
    date.setDate(today.getDate() + d)
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })

    slots.push({
      date: dateStr,
      times: ['10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM']
    })
  }

  return slots
}
