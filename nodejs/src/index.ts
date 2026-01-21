import 'dotenv/config';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {zValidator} from '@hono/zod-validator';
import {type Context, Hono} from 'hono';
import {requestId} from 'hono/request-id';
import {pinoHttp} from 'pino-http';
import {mkdirSync} from 'fs'; 
import {AgentService} from './api/agent';
import {CheckoutService, zCompleteCheckoutRequest} from './api/checkout';
import {DiscoveryService} from './api/discovery';
import {OrderService} from './api/order';
import {TestingService} from './api/testing';
import {initDbs, getProductsDb, getTransactionsDb} from './data/db';
import {ExtendedCheckoutCreateRequestSchema, ExtendedCheckoutUpdateRequestSchema, OrderSchema,} from './models';
import {IdParamSchema, prettyValidation} from './utils/validation';

const app = new Hono();

mkdirSync('databases', { recursive: true });
initDbs('databases/products.db', 'databases/transactions.db');

// Seed database with initial data
function seedDatabase() {
  const productsDb = getProductsDb();
  const transactionsDb = getTransactionsDb();

  // Check if products already exist
  const existingProducts = productsDb.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };

  if (existingProducts.count === 0) {
    console.log('Seeding database with initial data...');

    // Insert products
    const insertProduct = productsDb.prepare('INSERT INTO products (id, title, price, image_url) VALUES (?, ?, ?, ?)');
    insertProduct.run('bouquet_roses', 'Bouquet of Red Roses', 3500, 'https://example.com/roses.jpg');
    insertProduct.run('pot_ceramic', 'Ceramic Pot', 1500, 'https://example.com/pot.jpg');
    insertProduct.run('bouquet_sunflowers', 'Sunflower Bundle', 2500, 'https://example.com/sunflowers.jpg');
    insertProduct.run('bouquet_tulips', 'Spring Tulips', 3000, 'https://example.com/tulips.jpg');
    insertProduct.run('orchid_white', 'White Orchid', 4500, 'https://example.com/orchid.jpg');
    insertProduct.run('gardenias', 'Gardenias', 2000, 'https://example.com/gardenias.jpg');

    // Insert inventory
    const insertInventory = transactionsDb.prepare('INSERT INTO inventory (product_id, quantity) VALUES (?, ?)');
    insertInventory.run('bouquet_roses', 1000);
    insertInventory.run('pot_ceramic', 2000);
    insertInventory.run('bouquet_sunflowers', 500);
    insertInventory.run('bouquet_tulips', 1500);
    insertInventory.run('orchid_white', 800);
    insertInventory.run('gardenias', 100);

    console.log('Database seeded successfully!');
  } else {
    console.log('Database already contains data, skipping seed.');
  }
}

seedDatabase();

const agentService = new AgentService();
const checkoutService = new CheckoutService();
const orderService = new OrderService();
const discoveryService = new DiscoveryService();
const testingService = new TestingService(checkoutService);

// Setup logging for each request
app.use(requestId());
app.use(async (c: Context, next: () => Promise<void>) => {
  c.env.incoming.id = c.var.requestId;

  await new Promise<void>((resolve) =>
    pinoHttp({
      quietReqLogger: true,
      transport: {
        target: 'pino-http-print',
        options: {
          destination: 1,
          all: true,
          translateTime: true,
        },
      },
    })(c.env.incoming, c.env.outgoing, () => resolve()),
  );

  c.set('logger', c.env.incoming.log);

  await next();
});

// Middleware for Version Negotiation
app.use(async (c: Context, next: () => Promise<void>) => {
  const ucpAgent = c.req.header('UCP-Agent');
  if (ucpAgent) {
    const match = ucpAgent.match(/version="([^"]+)"/);
    if (match) {
      const clientVersion = match[1];
      const serverVersion = discoveryService.ucpVersion;
      if (clientVersion > serverVersion) {
        return c.json(
          {error: `Unsupported UCP version: ${clientVersion}`},
          400,
        );
      }
    }
  }
  await next();
});

/* Discovery endpoints */
app.get('/.well-known/ucp', discoveryService.getMerchantProfile);

/* Checkout Capability endpoints */
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

/* Order Capability endpoints */
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

/* Testing endpoints */
app.post(
    '/testing/simulate-shipping/:id',
    zValidator('param', IdParamSchema, prettyValidation),
    testingService.shipOrder,
);

/* Agent endpoints for UI */
app.post('/agent', agentService.handleQuery);
app.post('/agent/buyer-info', agentService.updateBuyerInfo);
app.post('/agent/shipping-address', agentService.updateShippingAddress);
app.post('/agent/shipping-option', agentService.selectShippingOption);
app.post('/agent/payment', agentService.completePayment);

/* Serve static files */
app.use('/*', serveStatic({root: './public'}));

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);