import Stripe from 'stripe';

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  const data = await response.json();
  const connectionSettings = data.items?.[0];

  if (!connectionSettings?.settings?.secret) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return connectionSettings.settings.secret;
}

async function seedProducts() {
  console.log('Getting Stripe credentials...');
  const secretKey = await getCredentials();
  
  const stripe = new Stripe(secretKey);

  console.log('Checking for existing products...');
  const existingProducts = await stripe.products.search({ 
    query: "name:'Virtual Studio Pro'" 
  });

  if (existingProducts.data.length > 0) {
    console.log('Virtual Studio Pro product already exists:', existingProducts.data[0].id);
    
    const prices = await stripe.prices.list({ 
      product: existingProducts.data[0].id, 
      active: true 
    });
    
    if (prices.data.length > 0) {
      console.log('Monthly price:', prices.data[0].id);
      console.log('\nProduct already set up! Price ID:', prices.data[0].id);
      return;
    }
  }

  console.log('Creating Virtual Studio Pro product...');
  const product = await stripe.products.create({
    name: 'Virtual Studio Pro',
    description: 'Unlimited remote recording sessions with your team',
    metadata: {
      app: 'virtual-studio',
      tier: 'pro'
    }
  });
  console.log('Created product:', product.id);

  console.log('Creating monthly price...');
  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 999,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {
      plan: 'monthly'
    }
  });
  console.log('Created monthly price:', monthlyPrice.id);

  console.log('\n=== Setup Complete ===');
  console.log('Product ID:', product.id);
  console.log('Price ID:', monthlyPrice.id);
  console.log('\nMonthly subscription: $9.99/month');
}

seedProducts().catch(console.error);
