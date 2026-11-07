import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createPaymentStartup } from "./paymentStartup";
import { resolveStripeCredentialSource } from "./stripeClient";
import { scopePaymentMethodBackfill } from "./stripeBackfill";

test("payment method backfill only visits customers in the active Stripe connection", async () => {
  async function* items(values: any[]) { yield* values; }
  const requested: string[] = [];
  const written: any[] = [];
  const sync = {
    getAccountId: async () => "active-account",
    upsertPaymentMethods: async (batch: any[], account: string) => { written.push({ batch, account }); },
    syncPaymentMethods: async () => ({ synced: -1 }),
  };
  scopePaymentMethodBackfill(sync, {
    customers: { list: () => items([{ id: "active-customer" }]) },
    paymentMethods: { list: ({ customer }: any) => {
      requested.push(customer);
      return items(Array.from({ length: 101 }, (_, i) => ({ id: `method-${i}` })));
    } },
  } as any);
  assert.deepEqual(await sync.syncPaymentMethods(), { synced: 101 });
  assert.deepEqual(requested, ["active-customer"]);
  assert.deepEqual(written.map(x => x.batch.length), [100, 1]);
  assert.ok(written.every(x => x.account === "active-account"));
});

test("scoped backfill propagates Stripe failures rather than claiming readiness", async () => {
  const sync = {
    getAccountId: async () => "active-account",
    upsertPaymentMethods: async () => {},
    syncPaymentMethods: async () => ({ synced: 0 }),
  };
  scopePaymentMethodBackfill(sync, {
    customers: { list: async function* () { throw new Error("provider unavailable"); } },
  } as any);
  await assert.rejects(sync.syncPaymentMethods(), /provider unavailable/);
});

test("Replit development always selects its development Stripe connection over shared keys", () => {
  assert.equal(resolveStripeCredentialSource({
    REPL_ID: "development-repl",
    REPLIT_CONNECTORS_HOSTNAME: "connectors.example",
    REPL_IDENTITY: "identity-placeholder",
    STRIPE_SECRET_KEY: "live-key-placeholder",
    VITE_STRIPE_PUBLISHABLE_KEY: "live-publishable-placeholder",
  }), "development-connector");
});

test("local environment keys remain supported outside Replit", () => {
  assert.equal(resolveStripeCredentialSource({
    STRIPE_SECRET_KEY: "local-key-placeholder",
    VITE_STRIPE_PUBLISHABLE_KEY: "local-publishable-placeholder",
  }), "environment");
});

test("production uses configured production keys and otherwise its production connector", () => {
  assert.equal(resolveStripeCredentialSource({
    REPLIT_DEPLOYMENT: "1",
    STRIPE_SECRET_KEY: "production-key-placeholder",
    VITE_STRIPE_PUBLISHABLE_KEY: "production-publishable-placeholder",
  }), "environment");
  assert.equal(resolveStripeCredentialSource({
    REPLIT_DEPLOYMENT: "1",
    REPLIT_CONNECTORS_HOSTNAME: "connectors.example",
    WEB_REPL_RENEWAL: "deployment-identity-placeholder",
  }), "production-connector");
});

const env = { DATABASE_URL: "postgres://fake:secret@local/test", REPLIT_DOMAINS: "example.test" };
function fixture(failure?: string, backfill?: () => Promise<void>) {
  const calls: string[] = [];
  const logs: string[] = [];
  const action = async (stage: string) => {
    calls.push(stage);
    if (failure === stage) throw new Error("sk_test_secret postgres://user:password@host customer@example.test");
  };
  const startup = createPaymentStartup({
    runMigrations: async () => action("migration"),
    getStripeSync: async () => {
      await action("client");
      return {
        findOrCreateManagedWebhook: async (url: string) => {
          assert.equal(url, "https://example.test/api/stripe/webhook");
          await action("webhook");
        },
        syncBackfill: async (options: { object: "all" }) => {
          assert.deepEqual(options, { object: "all" });
          await action("backfill");
          await backfill?.();
        },
      };
    },
  }, env, event => logs.push(event));
  return { startup, calls, logs };
}

test("ready only after all stages complete; initialization is idempotent", async () => {
  const { startup, calls } = fixture();
  assert.equal(startup.snapshot().status, "pending");
  await Promise.all([startup.start(), startup.start()]);
  assert.equal(startup.snapshot().status, "ready");
  assert.deepEqual(calls, ["migration", "client", "webhook", "backfill"]);
  const copy = startup.snapshot();
  copy.stages.migration = "failed";
  assert.equal(startup.snapshot().stages.migration, "ready");
});

for (const stage of ["migration", "client", "webhook", "backfill"] as const) {
  test(`${stage} failures remain visible without leaking error details`, async () => {
    const { startup, calls, logs } = fixture(stage);
    await startup.start();
    assert.equal(startup.snapshot().status, "failed");
    assert.equal(startup.snapshot().stages[stage], "failed");
    assert.doesNotMatch(logs.join("") + JSON.stringify(startup.snapshot()), /sk_test_secret|password|customer@|postgres:/);
    if (stage === "migration") assert.deepEqual(calls, ["migration"]);
    if (stage === "client") assert.deepEqual(calls, ["migration", "client"]);
    if (stage === "webhook") assert.equal(startup.snapshot().stages.backfill, "ready");
  });
}

test("pending backfill is not reported as ready", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const backfill = new Promise<void>(resolve => { finish = resolve; });
  const { startup } = fixture(undefined, async () => { entered(); await backfill; });
  const work = startup.start();
  await enteredPromise;
  assert.equal(startup.snapshot().status, "initializing");
  assert.equal(startup.snapshot().stages.backfill, "running");
  finish();
  await work;
  assert.equal(startup.snapshot().status, "ready");
});

for (const config of [{}, { DATABASE_URL: env.DATABASE_URL }]) {
  test(`missing configuration is explicit: ${Object.keys(config).join(",") || "all"}`, async () => {
    const forbidden = async () => { assert.fail("must not access payment services"); };
    const startup = createPaymentStartup({ runMigrations: forbidden, getStripeSync: forbidden }, config, () => {});
    await startup.start();
    assert.equal(startup.snapshot().status, "failed");
    assert.equal(startup.snapshot().stages.configuration, "failed");
  });
}

test("disabled synchronization does not access dependencies even without configuration", async () => {
  const forbidden = async () => { assert.fail("must not access payment services"); };
  const startup = createPaymentStartup({ runMigrations: forbidden, getStripeSync: forbidden },
    { STRIPE_SYNC_ENABLED: "false" }, () => {});
  await startup.start();
  assert.equal(startup.snapshot().status, "disabled");
  assert.equal(startup.snapshot().stages.migration, "pending");
});

test("HTTP signal returns no-store 503 for incomplete/failed startup and 200 for ready", async () => {
  const { startup } = fixture();
  const failed = fixture("webhook").startup;
  await failed.start();
  const app = express();
  app.get("/api/health/payments", startup.handler);
  app.get("/failed", failed.handler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const pending = await fetch(`${base}/api/health/payments`);
    assert.equal(pending.status, 503);
    assert.equal(pending.headers.get("cache-control"), "no-store");
    assert.equal((await pending.json()).status, "pending");
    await startup.start();
    assert.equal((await fetch(`${base}/api/health/payments`)).status, 200);
    const failure = await fetch(`${base}/failed`);
    assert.equal(failure.status, 503);
    assert.equal((await failure.json()).stages.webhook, "failed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
