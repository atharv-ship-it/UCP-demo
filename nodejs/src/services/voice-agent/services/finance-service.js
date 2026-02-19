// Finance service - EMI calculation stub

export function getEMICalculatorConfig(modelId, variant) {
  return {
    success: false,
    error: 'EMI calculator not configured for this product'
  }
}

export async function calculateEMI({ model_id, variant, downpayment_percent, tenure_years, interest_rate }) {
  return {
    success: false,
    error: 'EMI calculation not configured for this product'
  }
}
