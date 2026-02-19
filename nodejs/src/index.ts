import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { zValidator } from '@hono/zod-validator';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { pinoHttp } from 'pino-http';
import { mkdirSync } from 'fs';
// @ts-ignore - JS module, no types needed
import voiceAgentRouter from './services/voice-agent/voice-agent.router.js';

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

/* -------------------- CORS -------------------- */

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

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
      seer, seer2, eer2, noise, energy_star, rating, reviews,
      price_display, refrigerant_type, compressor_type, compressor_stages,
      features, warranty_compressor_years, warranty_parts_years,
      status, regional_availability, url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ✅ ROOT FIX: Complete Lennox AC product catalog (18 models) from official JSON data (2026-02-02)
  // Format: id, title, price (internal), image_url, series, description, seer, seer2, eer2, noise, energy_star, rating, reviews, price_display, refrigerant_type, compressor_type, compressor_stages, features (JSON), warranty_compressor_years, warranty_parts_years, status, regional_availability, url

  // === DAVE LENNOX SIGNATURE COLLECTION (Premium: $$$$) ===
  insertProduct.run('sl25kcv', 'Lennox SL25KCV', 0, '/assets/sl25kcv.png',
    'Dave Lennox Signature Collection',
    'The most precise and efficient air conditioner available',
    null, 26.0, 12.6, 58, 1, 4.2, 107, '$$$$',
    'R-454B', 'Variable-Capacity', 'Variable',
    JSON.stringify(['Digitally intelligent with S40 Smart Thermostat compatibility', 'Innovative cabinet design with composite unit base', 'Sound-dampening system with precision-balanced direct-drive fan', '2025 EPA compliant refrigerant (R-454B)', 'Sensors for automatic diagnostics and adjustments']),
    10, 10, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/sl25kcv');

  insertProduct.run('sl28xcv', 'Lennox SL28XCV', 0, '/assets/sl28xcv.png',
    'Dave Lennox Signature Collection',
    'Precise, highest-efficiency, fully digital, variable-capacity air conditioner',
    28.0, null, null, 59, 1, 4.5, 550, '$$$$',
    'R-410A', 'Variable-Capacity Scroll', 'Variable',
    JSON.stringify(['Part of Ultimate Comfort System', 'Precise Comfort technology adjusts in minute increments', '28 SEER - highest efficiency rating', 'Most Efficient ENERGY STAR certified 2022', 'Variable-capacity compressor for low-speed quiet operation', 'Quantum Coil with proprietary aluminum alloy', 'iComfort S30 thermostat integration', 'PermaGuard Cabinet with SmartHinge Louver Design']),
    10, 10, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/sl28xcv');

  insertProduct.run('xc21', 'Lennox XC21', 0, '/assets/xc21.png',
    'Dave Lennox Signature Collection',
    'The most efficient two-stage central air conditioner',
    21.0, 19.2, null, 69, 1, 4.5, 1149, '$$$',
    'R-410A', 'Two-Stage Scroll', 'Two-Stage',
    JSON.stringify(['Multi-stage operation for fine-tuned cooling', 'Humidity control with Humiditrol system compatibility', 'Most Efficient ENERGY STAR certified 2022', 'Quietest multi-stage air conditioner available', 'iComfort-enabled technology', 'PermaGuard Cabinet with SmartHinge Louver Design']),
    10, 10, 'Active - Regional (Northern region only)', 'Northern region only',
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/xc21');

  // === ELITE SERIES (Mid-High: $$$ to $$) ===
  insertProduct.run('el22kcv', 'Lennox EL22KCV', 0, '/assets/el22kcv.png',
    'Elite Series',
    'High-efficiency, digital-ready, variable-capacity air conditioner compatible with 2025 Compliant Refrigerant',
    null, 22.5, null, 60, 1, 4.6, 224, '$$$',
    'R-454B', 'Variable-Capacity', 'Variable',
    JSON.stringify(['Variable-capacity operation like a dimmer switch', '2025 EPA compliant refrigerant (R-454B)', 'Digital-ready for smart thermostat integration', 'Precision-balanced direct-drive fan', 'Sound level as quiet as 60 dB']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el22kcv');

  insertProduct.run('el23xcv', 'Lennox EL23XCV', 0, '/assets/el23xcv.png',
    'Elite Series',
    'High-efficiency, digitally-enabled, variable-capacity air conditioner',
    22.0, 22.4, null, 59, 1, 4.4, 347, '$$$',
    'R-410A', 'Variable-Capacity Scroll', 'Variable',
    JSON.stringify(['Variable-capacity operation adjusts like a dimmer switch', '22.00 SEER2 efficiency rating', 'ENERGY STAR certified', 'Sound level as quiet as 59 dB (dishwasher level)', 'Digital bridge to perfect air with S30/S40 Smart Thermostat', 'Quantum Coil with proprietary aluminum alloy', 'PermaGuard Cabinet with SmartHinge Louver Design', 'Digitally-enabled diagnostics']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el23xcv');

  insertProduct.run('xc20', 'Lennox XC20', 0, '/assets/xc20.png',
    'Elite Series',
    'High-efficiency air conditioner with true variable capacity',
    22.0, 20.2, null, 65, 1, 4.4, 500, '$$$',
    'R-410A', 'Variable-Capacity Scroll', 'Variable',
    JSON.stringify(['Variable-capacity operation adjusts like a dimmer switch', 'Precise humidity control', 'Most Efficient ENERGY STAR certified 2022', 'iComfort-enabled technology', 'PermaGuard Cabinet with SmartHinge Louver Design', 'Advanced sound reduction features']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/xc20');

  insertProduct.run('el18kcv', 'Lennox EL18KCV', 0, '/assets/el18kcv.png',
    'Elite Series',
    'Mid-efficiency, digital-ready, variable-capacity air conditioner compatible with 2025 Compliant Refrigerant',
    null, 19.5, null, 67, 1, 4.3, 300, '$$$',
    'R-454B', 'Variable-Capacity', 'Variable',
    JSON.stringify(['Variable-capacity operation adjusts like a dimmer switch', '2025 EPA compliant refrigerant (R-454B)', 'Digital-ready for S40 Smart Thermostat', 'Sound level as quiet as 67 dB (clothes washer level)', 'Galvanized steel cabinet with hinged louver panel design', 'Precision humidity control']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el18kcv');

  insertProduct.run('el18xcv', 'Lennox EL18XCV', 0, '/assets/el18xcv.png',
    'Elite Series',
    'Truly variable. Truly digital.',
    18.0, 18.8, null, 72, 1, 4.3, 400, '$$',
    'R-410A', 'Variable-Capacity', 'Variable',
    JSON.stringify(['Variable-capacity operation', 'iComfort-enabled technology', 'PermaGuard Cabinet with SmartHinge Louver Design']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el18xcv');

  insertProduct.run('el16kc1', 'Lennox EL16KC1', 0, '/assets/el16kc1.png',
    'Elite Series',
    'Mid-efficiency, single-stage air conditioner compatible with 2025 Compliant Refrigerant',
    null, 17.0, null, 72, 1, 4.5, 612, '$$',
    'R-454B', 'Scroll', 'Single-Stage',
    JSON.stringify(['2025 EPA compliant refrigerant (R-454B)', 'Single-stage operation', 'Mid-efficiency performance']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el16kc1');

  insertProduct.run('el15kc1', 'Lennox EL15KC1', 0, '/assets/el15kc1.png',
    'Elite Series',
    'Mid-efficiency, single-stage air conditioner compatible with 2025 Compliant Refrigerant',
    null, 16.0, null, 72, 1, 4.4, 350, '$$',
    'R-454B', 'Scroll', 'Single-Stage',
    JSON.stringify(['2025 EPA compliant refrigerant (R-454B)', 'Single-stage operation', 'Mid-efficiency performance']),
    10, 5, 'Active - Regional (Northern region only)', 'Northern region only',
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el15kc1');

  insertProduct.run('el16xc1', 'Lennox EL16XC1', 0, '/assets/el16xc1.png',
    'Elite Series',
    'Standard-efficiency, single-stage air conditioner',
    17.0, null, null, 71, 1, 4.5, 11587, '$$',
    'R-410A', 'Scroll', 'Single-Stage',
    JSON.stringify(['Single-stage operation', 'Standard-efficiency performance']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el16xc1');

  insertProduct.run('el17xc1', 'Lennox EL17XC1', 0, '/assets/el17xc1.png',
    'Elite Series',
    'Mid-efficiency, single-stage air conditioner',
    18.6, 17.4, null, null, 1, 4.5, 1395, '$$',
    'R-410A', 'Scroll', 'Single-Stage',
    JSON.stringify(['Single-stage operation', 'Mid-efficiency performance']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/el17xc1');

  // === MERIT SERIES (Budget: $) ===
  insertProduct.run('ml17xc1', 'Lennox ML17XC1', 0, '/assets/ml17xc1.png',
    'Merit Series',
    'Standard-efficiency, single-stage air conditioner',
    17.0, 16.2, null, null, 0, 4.4, 7164, '$',
    'R-410A', 'Scroll', 'Single-Stage',
    JSON.stringify(['Single-stage operation', 'Standard-efficiency performance', 'Value-oriented Merit Series']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/ml17xc1');

  insertProduct.run('ml17kc2', 'Lennox ML17KC2', 0, '/assets/ml17kc2.png',
    'Merit Series',
    'Mid-efficiency, two-stage air conditioner compatible with 2025 Compliant Refrigerant',
    null, 18.0, null, null, 1, 4.4, 375, '$',
    'R-454B', 'Scroll', 'Two-Stage',
    JSON.stringify(['2025 EPA compliant refrigerant (R-454B)', 'Two-stage operation', 'Mid-efficiency performance']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/ml17kc2');

  insertProduct.run('ml18xc2', 'Lennox ML18XC2', 0, '/assets/ml18xc2.png',
    'Merit Series',
    'Mid-efficiency, two-stage air conditioner',
    18.0, 17.8, null, null, 1, 4.3, 450, '$',
    'R-410A', 'Scroll', 'Two-Stage',
    JSON.stringify(['Two-stage operation', 'Mid-efficiency performance']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/ml18xc2');

  insertProduct.run('ml14kc1', 'Lennox ML14KC1', 0, '/assets/ml14kc1.png',
    'Merit Series',
    'Standard-efficiency, single-stage air conditioner compatible with 2025 Compliant Refrigerant',
    null, null, null, 73, 1, 4.2, 280, '$',
    'R-454B', 'Scroll', 'Single-Stage',
    JSON.stringify(['2025 EPA compliant refrigerant (R-454B)', 'Single-stage operation', 'Standard-efficiency performance']),
    10, 5, 'Active', null,
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/ml14kc1');

  insertProduct.run('ml13kc1', 'Lennox ML13KC1', 0, '/assets/ml13kc1.png',
    'Merit Series',
    'Standard-efficiency, single-stage air conditioner compatible with 2025 Compliant Refrigerant',
    null, 13.4, null, 73, 1, 4.2, 200, '$',
    'R-454B', 'Scroll', 'Single-Stage',
    JSON.stringify(['2025 EPA compliant refrigerant (R-454B)', 'Single-stage operation', 'Standard-efficiency performance']),
    10, 5, 'Active - Regional (Northern region only)', 'Northern region only',
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/ml13kc1');

  insertProduct.run('ml14xc1', 'Lennox ML14XC1', 0, '/assets/ml14xc1.png',
    'Merit Series',
    'Efficient, durable air conditioner',
    17.0, 13.4, null, 73, 1, 4.3, 320, '$',
    'R-410A', 'Scroll', 'Single-Stage',
    JSON.stringify(['Single-stage operation', 'Efficient and durable design']),
    10, 5, 'Active - Regional (Northern region only)', 'Northern region only',
    'https://www.lennox.com/residential/products/heating-cooling/air-conditioners/ml14xc1');

  // === INVENTORY FOR ALL 18 MODELS ===
  const insertInventory = transactionsDb.prepare(
    'INSERT INTO inventory (product_id, quantity) VALUES (?, ?)',
  );

  // Signature Collection
  insertInventory.run('sl25kcv', 50);
  insertInventory.run('sl28xcv', 50);
  insertInventory.run('xc21', 80);
  // Elite Series
  insertInventory.run('el22kcv', 100);
  insertInventory.run('el23xcv', 100);
  insertInventory.run('xc20', 120);
  insertInventory.run('el18kcv', 150);
  insertInventory.run('el18xcv', 150);
  insertInventory.run('el17xc1', 200);
  insertInventory.run('el16kc1', 200);
  insertInventory.run('el15kc1', 180);
  insertInventory.run('el16xc1', 250);
  // Merit Series
  insertInventory.run('ml17xc1', 300);
  insertInventory.run('ml17kc2', 300);
  insertInventory.run('ml18xc2', 280);
  insertInventory.run('ml14kc1', 350);
  insertInventory.run('ml13kc1', 350);
  insertInventory.run('ml14xc1', 320);

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
- NEVER mention dollar prices or specific costs - only use Price Guide ($, $$, $$$, $$$$) to indicate relative pricing tier
- When asked about specs, provide SEER/SEER2, noise level, refrigerant type, compressor info, warranty, and features - but NEVER dollar amounts
- For pricing, always say "Contact your local Lennox dealer for pricing" or refer to the Price Guide tier

AVAILABLE PRODUCTS:
${allProducts.map(p => {
  const features = p.features ? JSON.parse(p.features).slice(0, 3).join(', ') : 'N/A';
  return `- ${p.id}: ${p.title} (${p.series})
  SEER: ${p.seer || 'N/A'}, SEER2: ${p.seer2 || 'N/A'}, Noise: ${p.noise || 'N/A'}dB
  Refrigerant: ${p.refrigerant_type || 'N/A'}, Compressor: ${p.compressor_stages || 'N/A'}
  Price Guide: ${p.price_display}, Rating: ${p.rating}/5 (${p.reviews} reviews)
  Warranty: ${p.warranty_compressor_years}yr compressor, ${p.warranty_parts_years}yr parts
  Status: ${p.status || 'Active'}${p.regional_availability ? ` (${p.regional_availability})` : ''}
  Key Features: ${features}
  Description: ${p.description}`;
}).join("\n")}

Respond ONLY with valid JSON in this exact format:
{
  "stage": "greeting|clarification|recommendation|comparison|details|purchase",
  "message": "Your conversational response to the user",
  "recommended_products": ["product_id1", "product_id2"],
  "show_products": false,
}

Set show_products to true when you want to display the recommended products to the user.
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

    // ✅ ROOT FIX: Show product cards whenever AI recommends products (intelligent behavior)
    const products = parsed.recommended_products && Array.isArray(parsed.recommended_products) && parsed.recommended_products.length > 0
      ? allProducts.filter((p: any) => parsed.recommended_products.includes(p.id)).map((p: any) => ({
          id: p.id,
          title: p.title,
          series: p.series,
          name: p.title,
          image: p.image_url,
          price: p.price_display, // Official price guide: $, $$, $$$, $$$$
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

/* -------------------- VOICE AGENT -------------------- */

app.route('/voice-agent', voiceAgentRouter);

/* -------------------- STATIC -------------------- */

app.use('/*', serveStatic({ root: './public' }));

/* -------------------- SERVER -------------------- */

// ✅ ROOT FIX: Use Railway's PORT environment variable for deployment
const port = parseInt(process.env.PORT || '3000', 10);

serve(
  { fetch: app.fetch, port, hostname: '0.0.0.0' },
  (info) => {
    console.log(`UCP Backend running on http://localhost:${info.port}`);
  },
);
