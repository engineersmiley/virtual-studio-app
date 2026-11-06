import Stripe from 'stripe';

let connectionSettings: any;

export type StripeCredentialSource = "environment" | "development-connector" | "production-connector";

export function resolveStripeCredentialSource(env: NodeJS.ProcessEnv): StripeCredentialSource {
  const isProduction = env.REPLIT_DEPLOYMENT === "1";
  const hasEnvironmentKey = Boolean(env.STRIPE_SECRET_KEY || env.VITE_STRIPE_PUBLISHABLE_KEY);
  const isReplitRuntime = Boolean(
    env.REPL_ID || env.REPLIT_CONNECTORS_HOSTNAME || env.REPL_IDENTITY ||
    env.WEB_REPL_RENEWAL || env.REPLIT_DOMAINS || env.REPLIT_DEV_DOMAIN,
  );

  // In a Replit development workspace, never let shared environment secrets
  // override the separate development Stripe connection. StripeSync can
  // mutate provider webhooks during initialization, so falling back to live
  // keys from development is unsafe.
  if (!isProduction && isReplitRuntime) return "development-connector";
  if (hasEnvironmentKey) return "environment";
  return isProduction ? "production-connector" : "development-connector";
}

async function getCredentials() {
  const source = resolveStripeCredentialSource(process.env);
  if (source === "environment") {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.VITE_STRIPE_PUBLISHABLE_KEY) {
      throw new Error("Incomplete Stripe environment credentials");
    }
    console.log('Using Stripe keys from environment variables');
    return {
      publishableKey: process.env.VITE_STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
    };
  }

  // Fallback to Replit connector
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname) throw new Error('Replit connector hostname unavailable');
  if (!xReplitToken) throw new Error('Replit connector identity unavailable');

  const connectorName = 'stripe';
  const targetEnvironment = source === "production-connector" ? "production" : "development";
  console.log(`Using Stripe ${targetEnvironment} connection from Replit connector`);

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
  
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  console.log('Using Stripe keys from Replit connector');
  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey);
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
