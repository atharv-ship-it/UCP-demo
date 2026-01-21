import {type Context} from 'hono';
import {getAllProducts, type Product} from '../data/products';
import {getInventory} from '../data/inventory';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface AgentStep {
  step: string;
  status: 'pending' | 'done';
  detail?: string;
}

interface AgentResponse {
  message: string;
  steps: AgentStep[];
  order?: {
    id: string;
    total: string;
    items: string[];
  };
  needsInput?: {
    type: 'buyer_info' | 'shipping_address' | 'shipping_option' | 'payment';
    checkoutId: string;
    options?: any;
  };
}

interface LLMResponse {
  intent: 'purchase' | 'inquiry' | 'other';
  productId: string | null;
  message: string;
}

interface BuyerInfo {
  full_name: string;
  email: string;
  phone_number: string;
}

interface ShippingAddress {
  street_address: string;
  address_locality: string;
  address_region: string;
  postal_code: string;
  address_country: string;
  full_name: string;
}

interface PaymentCard {
  number: string;
  expiry_month: number;
  expiry_year: number;
  cvc: string;
  name: string;
  billing_address: ShippingAddress;
}

async function parseIntentWithLLM(query: string, products: Product[]): Promise<LLMResponse> {
  const productList = products.map(p => `- ID: "${p.id}", Title: "${p.title}", Price: $${(p.price / 100).toFixed(2)}`).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `You are a shopping assistant. Analyze the user's query and determine their intent.

Available products in our catalog:
${productList}

Respond with JSON only (no markdown):
{
  "intent": "purchase" | "inquiry" | "other",
  "productId": "product_id_if_matched" or null,
  "message": "friendly response to the user"
}

Rules:
- If user wants to buy something, set intent to "purchase" and match to the closest product
- If product is not in catalog, set productId to null and explain what we have
- If user is just asking questions, set intent to "inquiry"
- Always be helpful and suggest available products if no match found`
      },
      {
        role: 'user',
        content: query
      }
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || '{}';
  try {
    return JSON.parse(content) as LLMResponse;
  } catch {
    return {
      intent: 'other',
      productId: null,
      message: 'I had trouble understanding your request. Could you please rephrase?'
    };
  }
}

function getAvailableProductNames(products: Product[]): string {
  return products.map(p => p.title).join(', ');
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export class AgentService {
  private baseUrl = 'http://localhost:3000';

  handleQuery = async (c: Context) => {
    const {query} = await c.req.json<{query: string}>();
    const steps: AgentStep[] = [];

    try {
      steps.push({step: 'Understanding your request', status: 'done', detail: query});

      const products = getAllProducts();
      steps.push({
        step: 'Browsing available products',
        status: 'done',
        detail: `Found ${products.length} products`,
      });

      if (products.length === 0) {
        return c.json<AgentResponse>({
          message: 'No products available in the store.',
          steps,
        });
      }

      const llmResponse = await parseIntentWithLLM(query, products);
      steps.push({
        step: 'AI analyzed your request',
        status: 'done',
        detail: `Intent: ${llmResponse.intent}`,
      });

      if (llmResponse.intent !== 'purchase') {
        return c.json<AgentResponse>({
          message: llmResponse.message,
          steps,
        });
      }

      if (!llmResponse.productId) {
        steps.push({
          step: 'Searching catalog',
          status: 'done',
          detail: 'No matching product found',
        });
        return c.json<AgentResponse>({
          message: llmResponse.message || `Sorry, I couldn't find that product in our catalog. We currently have: ${getAvailableProductNames(products)}.`,
          steps,
        });
      }

      const matchedProduct = products.find(p => p.id === llmResponse.productId);
      if (!matchedProduct) {
        return c.json<AgentResponse>({
          message: `Sorry, I couldn't find that product. We currently have: ${getAvailableProductNames(products)}.`,
          steps,
        });
      }

      steps.push({
        step: 'Found matching product',
        status: 'done',
        detail: `${matchedProduct.title} - ${formatPrice(matchedProduct.price)}`,
      });

      const stock = getInventory(matchedProduct.id);
      if (!stock || stock < 1) {
        steps.push({step: 'Checking availability', status: 'done', detail: 'Out of stock'});
        return c.json<AgentResponse>({
          message: `Sorry, ${matchedProduct.title} is currently out of stock.`,
          steps,
        });
      }
      steps.push({step: 'Checking availability', status: 'done', detail: `${stock} in stock`});

      const checkoutRes = await fetch(`${this.baseUrl}/checkout-sessions`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          currency: 'USD',
          line_items: [
            {
              item: {id: matchedProduct.id},
              quantity: 1,
            },
          ],
          payment: {},
        }),
      });

      if (!checkoutRes.ok) {
        const err = await checkoutRes.json();
        throw new Error(`Checkout creation failed: ${JSON.stringify(err)}`);
      }

      const checkout = await checkoutRes.json() as {id: string; totals: Array<{type: string; amount: number}>};
      steps.push({
        step: 'Creating checkout session',
        status: 'done',
        detail: `Session ${checkout.id.slice(0, 8)}...`,
      });

      steps.push({step: 'Collecting buyer information', status: 'pending'});
      return c.json<AgentResponse>({
        message: `Great! I found ${matchedProduct.title} for ${formatPrice(checkout.totals.find(t => t.type === 'total')?.amount || 0)}. Please provide your contact information to continue.`,
        steps,
        needsInput: {
          type: 'buyer_info',
          checkoutId: checkout.id,
        },
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      steps.push({step: 'Error', status: 'done', detail: errorMessage});

      return c.json<AgentResponse>(
        {
          message: `Something went wrong: ${errorMessage}`,
          steps,
        },
        500,
      );
    }
  };

  updateBuyerInfo = async (c: Context) => {
    const {checkoutId, buyerInfo} = await c.req.json<{checkoutId: string; buyerInfo: BuyerInfo}>();
    const steps: AgentStep[] = [];

    try {
      const checkoutRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}`);
      const checkout = await checkoutRes.json() as any;

      const updateRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          ...checkout,
          buyer: {
            full_name: buyerInfo.full_name,
            email: buyerInfo.email,
            phone_number: buyerInfo.phone_number,
          },
        }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update buyer info');
      }

      steps.push({step: 'Buyer information saved', status: 'done'});
      steps.push({step: 'Collecting shipping address', status: 'pending'});

      return c.json<AgentResponse>({
        message: 'Thanks! Now please provide your shipping address.',
        steps,
        needsInput: {
          type: 'shipping_address',
          checkoutId,
        },
      });
    } catch (error) {
      return c.json<AgentResponse>(
        {
          message: `Error: ${error instanceof Error ? error.message : String(error)}`,
          steps,
        },
        500,
      );
    }
  };

  updateShippingAddress = async (c: Context) => {
    const {checkoutId, shippingAddress} = await c.req.json<{checkoutId: string; shippingAddress: ShippingAddress}>();
    const steps: AgentStep[] = [];

    try {
      const checkoutRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}`);
      const checkout = await checkoutRes.json() as any;

      const updateRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          ...checkout,
          fulfillment: {
            methods: [
              {
                type: 'shipping',
                destinations: [
                  {
                    id: 'dest_1',
                    ...shippingAddress,
                  },
                ],
                selected_destination_id: 'dest_1',
              },
            ],
          },
        }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update shipping address');
      }

      const updatedCheckout = await updateRes.json() as any;
      const shippingOptions = updatedCheckout.fulfillment?.methods?.[0]?.groups?.[0]?.options || [];

      steps.push({step: 'Shipping address saved', status: 'done'});
      steps.push({step: 'Loading shipping options', status: 'done', detail: `${shippingOptions.length} options available`});

      return c.json<AgentResponse>({
        message: 'Please select a shipping option.',
        steps,
        needsInput: {
          type: 'shipping_option',
          checkoutId,
          options: shippingOptions,
        },
      });
    } catch (error) {
      return c.json<AgentResponse>(
        {
          message: `Error: ${error instanceof Error ? error.message : String(error)}`,
          steps,
        },
        500,
      );
    }
  };

  selectShippingOption = async (c: Context) => {
    const {checkoutId, optionId} = await c.req.json<{checkoutId: string; optionId: string}>();
    const steps: AgentStep[] = [];

    try {
      const checkoutRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}`);
      const checkout = await checkoutRes.json() as any;

      checkout.fulfillment.methods[0].groups[0].selected_option_id = optionId;

      const updateRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(checkout),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to select shipping option');
      }

      const updatedCheckout = await updateRes.json() as any;
      const total = updatedCheckout.totals.find((t: any) => t.type === 'total')?.amount || 0;

      steps.push({step: 'Shipping option selected', status: 'done'});
      steps.push({step: 'Total calculated', status: 'done', detail: formatPrice(total)});
      steps.push({step: 'Processing payment', status: 'pending'});

      return c.json<AgentResponse>({
        message: `Your total is ${formatPrice(total)}. Processing payment with your saved card...`,
        steps,
        needsInput: {
          type: 'payment',
          checkoutId,
        },
      });
    } catch (error) {
      return c.json<AgentResponse>(
        {
          message: `Error: ${error instanceof Error ? error.message : String(error)}`,
          steps,
        },
        500,
      );
    }
  };

  completePayment = async (c: Context) => {
    const {checkoutId, paymentCard} = await c.req.json<{checkoutId: string; paymentCard: PaymentCard}>();
    const steps: AgentStep[] = [];

    try {
      const completeRes = await fetch(`${this.baseUrl}/checkout-sessions/${checkoutId}/complete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          payment_data: {
            id: 'card_1',
            handler_id: 'google_pay',
            type: 'card',
            brand: 'visa',
            last_digits: paymentCard.number.slice(-4),
            credential: {
              type: 'card',
              card_number_type: 'fpan',
              number: paymentCard.number,
              expiry_month: paymentCard.expiry_month,
              expiry_year: paymentCard.expiry_year,
              cvc: paymentCard.cvc,
              name: paymentCard.name,
            },
            billing_address: paymentCard.billing_address,
          },
        }),
      });

      if (!completeRes.ok) {
        const err = await completeRes.json();
        throw new Error(`Payment failed: ${err.detail || JSON.stringify(err)}`);
      }

      const completedCheckout = await completeRes.json() as any;
      const total = completedCheckout.totals.find((t: any) => t.type === 'total')?.amount || 0;

      steps.push({step: 'Processing payment', status: 'done', detail: 'Payment successful'});
      steps.push({step: 'Order placed', status: 'done', detail: `Order ${completedCheckout.order_id.slice(0, 8)}...`});

      return c.json<AgentResponse>({
        message: `🎉 Purchase complete! Your order ID is ${completedCheckout.order_id}. Total: ${formatPrice(total)}`,
        steps,
        order: {
          id: completedCheckout.order_id,
          total: formatPrice(total),
          items: completedCheckout.line_items.map((li: any) => li.item.title),
        },
      });
    } catch (error) {
      steps.push({step: 'Payment failed', status: 'done', detail: error instanceof Error ? error.message : String(error)});
      return c.json<AgentResponse>(
        {
          message: `Payment failed: ${error instanceof Error ? error.message : String(error)}`,
          steps,
        },
        500,
      );
    }
  };
}