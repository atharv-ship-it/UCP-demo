import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { zValidator } from '@hono/zod-validator';
import { type Context, Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { pinoHttp } from 'pino-http';
import { mkdirSync } from 'fs';

// ✅ ROOT FIX: Removed AgentService - using pure UCP APIs instead
import { CheckoutService, zCompleteCheckoutRequest } from './api/checkout';
import { DiscoveryService } from './api/discovery';
import { OrderService } from './api/order';
import { TestingService } from './api/testing';

import { initDbs, getProductsDb, getTransactionsDb } from './data/db';
import { getAllProducts } from './data/products';

import {
  ExtendedCheckoutCreateRequestSchema,
  ExtendedCheckoutUpdateRequestSchema,
  OrderSchema,
} from './models';

import { IdParamSchema, prettyValidation } from './utils/validation';

const app = new Hono();

/* -------------------- DB INIT -------------------- */

mkdirSync('databases', { recursive: true });
initDbs('databases/products.db', 'databases/transactions.db');

/* -------------------- SEED DATA -------------------- */

function seedDatabase() {
  const productsDb = getProductsDb();
  const transactionsDb = getTransactionsDb();

  const existing = productsDb
    .prepare('SELECT COUNT(*) as count FROM products')
    .get() as { count: number };

  if (existing.count > 0) return;

  console.log('Seeding database with initial data...');

  const insertProduct = productsDb.prepare(`
    INSERT INTO products (
      id, title, price, image_url, series, description,
      seer, seer2, noise, energy_star, rating, reviews,
      price_display, price_dollars
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ✅ ROOT FIX: Add ALL 10 products
  insertProduct.run('sl28xcv', 'Lennox SL28XCV', 1200000, '/assets/sl28xcv.png',
    'Dave Lennox Signature Collection', 'Precise, highest-efficiency, fully digital, variable-capacity air conditioner', 28, null, 59, 1, 4.5, 550, '$$$$', '$12,000');

  insertProduct.run('sl25kcv', 'Lennox SL25KCV', 1070000, '/assets/sl25kcv.png',
    'Dave Lennox Signature Collection', 'The most precise and efficient air conditioner available', null, 26, 58, 1, 4.2, 107, '$$$$', '$10,700');

  insertProduct.run('xc21', 'Lennox XC21', 770000, '/assets/xc21.png',
    'Dave Lennox Signature Collection', 'The most efficient two-stage central air conditioner you can buy', 21, 19.2, 69, 1, 4.5, 1149, '$$$', '$7,700');

  insertProduct.run('el23xcv', 'Lennox EL23XCV', 630000, '/assets/el23xcv.png',
    'Elite Series', 'High-efficiency, digitally-enabled, variable-capacity air conditioner', 22, 22.4, 59, 1, 4.4, 347, '$$$', '$6,300');

  insertProduct.run('el22kcv', 'Lennox EL22KCV', 648900, '/assets/el22kcv.png',
    'Elite Series', 'High-efficiency, digital-ready, variable-capacity air conditioner compatible with 2025 Compliant Refrigerant', null, 22.5, 60, 1, 4.6, 224, '$$$', '$6,489');

  insertProduct.run('el17xc1', 'Lennox EL17XC1', 510000, '/assets/el17xc1.png',
    'Elite Series', 'Mid-efficiency, single-stage air conditioner', 18.6, 17.4, null, 1, 4.5, 1395, '$$', '$5,100');

  insertProduct.run('el16xc1', 'Lennox EL16XC1', 550000, '/assets/el16xc1.png',
    'Elite Series', 'Standard-efficiency, single-stage air conditioner', 17, null, 71, 1, 4.5, 11587, '$$', '$5,500');

  insertProduct.run('el16kc1', 'Lennox EL16KC1', 400000, '/assets/el16kc1.png',
    'Elite Series', 'Mid-efficiency, single-stage air conditioner compatible with 2025 Compliant Refrigerant', null, 17, 72, 1, 4.5, 612, '$$', '$4,000');

  insertProduct.run('ml17xc1', 'Lennox ML17XC1', 280000, '/assets/ml17xc1.png',
    'Merit Series', 'Standard-efficiency, single-stage air conditioner', 17, 16.2, null, 0, 4.4, 7164, '$', '$2,800');

  insertProduct.run('ml17kc2', 'Lennox ML17KC2', 350000, '/assets/ml17kc2.png',
    'Merit Series', 'Mid-efficiency, two-stage air conditioner compatible with 2025 Compliant Refrigerant', null, 18, null, 1, 4.4, 373, '$', '$3,500');

  const insertInventory = transactionsDb.prepare(
    'INSERT INTO inventory (product_id, quantity) VALUES (?, ?)',
  );

  insertInventory.run('sl28xcv', 100);
  insertInventory.run('sl25kcv', 120);
  insertInventory.run('xc21', 200);
  insertInventory.run('el23xcv', 180);
  insertInventory.run('el22kcv', 150);
  insertInventory.run('el17xc1', 300);
  insertInventory.run('el16xc1', 400);
  insertInventory.run('el16kc1', 250);
  insertInventory.run('ml17xc1', 400);
  insertInventory.run('ml17kc2', 350);

  console.log('Database seeded.');
}

seedDatabase();

/* -------------------- SERVICES -------------------- */

const discoveryService = new DiscoveryService();
const checkoutService = new CheckoutService();
const orderService = new OrderService();
const testingService = new TestingService(checkoutService);

/* ✅ ROOT FIX: Removed AgentService - using pure UCP APIs instead */

/* -------------------- MIDDLEWARE -------------------- */

app.use(requestId());

app.use(async (c: Context, next) => {
  c.env.incoming.id = c.var.requestId;

  await new Promise<void>((resolve) =>
    pinoHttp({
      quietReqLogger: true,
      transport: {
        target: 'pino-http-print',
        options: { destination: 1, all: true, translateTime: true },
      },
    })(c.env.incoming, c.env.outgoing, () => resolve()),
  );

  c.set('logger', c.env.incoming.log);
  await next();
});

/* -------------------- VERSION NEGOTIATION -------------------- */

app.use(async (c: Context, next) => {
  const ucpAgent = c.req.header('UCP-Agent');
  if (ucpAgent) {
    const match = ucpAgent.match(/version="([^"]+)"/);
    if (match && match[1] > discoveryService.ucpVersion) {
      return c.json({ error: 'Unsupported UCP version' }, 400);
    }
  }
  await next();
});

/* -------------------- DISCOVERY -------------------- */

app.get('/.well-known/ucp', discoveryService.getMerchantProfile);

/* -------------------- CHECKOUT -------------------- */

app.post(
  '/checkout-sessions',
  zValidator('json', ExtendedCheckoutCreateRequestSchema, prettyValidation),
  checkoutService.createCheckout,
);

app.get(
  '/checkout-sessions/:id',
  zValidator('param', IdParamSchema, prettyValidation),
  checkoutService.getCheckout,
);

app.put(
  '/checkout-sessions/:id',
  zValidator('param', IdParamSchema, prettyValidation),
  zValidator('json', ExtendedCheckoutUpdateRequestSchema, prettyValidation),
  checkoutService.updateCheckout,
);

app.post(
  '/checkout-sessions/:id/complete',
  zValidator('param', IdParamSchema, prettyValidation),
  zValidator('json', zCompleteCheckoutRequest, prettyValidation),
  checkoutService.completeCheckout,
);

app.post(
  '/checkout-sessions/:id/cancel',
  zValidator('param', IdParamSchema, prettyValidation),
  checkoutService.cancelCheckout,
);

/* -------------------- ORDERS -------------------- */

app.get(
  '/orders/:id',
  zValidator('param', IdParamSchema, prettyValidation),
  orderService.getOrder,
);

app.put(
  '/orders/:id',
  zValidator('param', IdParamSchema, prettyValidation),
  zValidator('json', OrderSchema, prettyValidation),
  orderService.updateOrder,
);

/* -------------------- TESTING -------------------- */

app.post(
  '/testing/simulate-shipping/:id',
  zValidator('param', IdParamSchema, prettyValidation),
  testingService.shipOrder,
);

/* -------------------- CHAT (DISCOVERY UI) -------------------- */
/* ✅ ROOT FIX: AI-powered conversational discovery - NO CHECKOUT CREATION */

app.post('/chat', async (c: Context) => {
  const body = await c.req.json<{ message: string; history: Array<{ role: string; content: string }> }>();
  const { message, history = [] } = body;

  const allProducts = getAllProducts();

  // Build system prompt with product catalog
  const systemPrompt = `You are an expert sales assistant for Lennox air conditioning systems. Your goal is to help users find and purchase the best Lennox AC units.

RESPONSE STYLE:
- Keep responses SHORT and conversational (1-2 sentences max for questions)
- Never introduce yourself or explain what you do
- Never say things like "I'm here to help you find the perfect..."
- Just ask direct, friendly questions
- Be natural.

YOUR ROLE & SCOPE:
- If request is outside this scope (used units, unrealistic budget, other brands), politely stir the conversation back on track
- Stay focused on your expertise - don't engage with out-of-scope requests beyond one polite redirect

CONVERSATION FLOW:
1. User expresses interest in buying → Show products that match ANY context you have (if none, show diverse range: budget + mid + premium)
2. After showing products → Gauge interest: "See anything you like, or want different options?"
3. User shows interest in specific product/asks questions → Provide details, then include purchase_link
4. When user shows clear purchase intent (e.g., "I want to buy", "Let's do it", "I'll take it"), set purchase_link to: http://localhost:3001?product_id=PRODUCT_ID (replace PRODUCT_ID with the actual product ID they're interested in)
5. purchase_link triggers the Universal Commerce Protocol checkout flow

STAGES:
- "clarification": Need more specific info
- "recommendation": Ready to show products
- "comparison": Comparing products
- "details": Explaining a specific product

RULES:
- Keep responses concise and natural
- Don't be overly formal or salesy
- Ask ONE question at a time when clarifying
- Recommend 2-3 products max
- Use product IDs exactly as provided

AVAILABLE PRODUCTS:
${allProducts.map(p => `- ${p.id}: ${p.title} (${p.series})
  SEER: ${p.seer || 'N/A'}, SEER2: ${p.seer2 || 'N/A'}, Noise: ${p.noise || 'N/A'}dB
  Price: ${p.price} (${p.price_dollars}), Rating: ${p.rating}/5, Reviews: (${p.reviews} reviews),
  Description: ${p.description}`).join("\n")}

Respond ONLY with valid JSON in this exact format:
{
  "stage": "greeting|clarification|recommendation|comparison|details|purchase",
  "message": "Your conversational response to the user",
  "recommended_products": ["product_id1", "product_id2"],
  "show_products": false,
}

`;

  try {
    // Use OpenAI GPT-4o-mini for conversation
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.3,
        max_tokens: 200, // Reduced from 350 for faster responses
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      throw new Error('AI API failed');
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    // Parse JSON response
    let parsed: any;
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      // Fallback if AI doesn't return valid JSON
      parsed = {
        message: aiResponse,
        recommended_products: [],
        show_products: false
      };
    }

    // Get recommended products
    const products = parsed.show_products && parsed.recommended_products
      ? allProducts.filter((p: any) => parsed.recommended_products.includes(p.id)).map((p: any) => ({
          id: p.id,
          title: p.title,
          series: p.series,
          name: p.title,
          image: p.image_url,
          price: p.price_display,
          priceDollars: p.price_dollars,
          seer: p.seer,
          seer2: p.seer2,
          noise: p.noise,
          energyStar: p.energy_star,
          rating: p.rating,
          reviews: p.reviews
        }))
      : [];

    return c.json({
      message: parsed.message,
      products,
    });

  } catch (error) {
    console.error('Chat error:', error);
    // Fallback response
    return c.json({
      message: 'I apologize, but I encountered an error. How can I help you find the right Lennox AC unit?',
      products: [],
    });
  }
});

/* ✅ ROOT FIX: REMOVED /agent endpoints - frontend uses pure UCP APIs instead */

/* -------------------- STATIC -------------------- */

app.use('/*', serveStatic({ root: './public' }));

/* -------------------- SERVER -------------------- */

serve(
  { fetch: app.fetch, port: 3000 },
  (info) => {
    console.log(`UCP Backend running on http://localhost:${info.port}`);
  },
);
