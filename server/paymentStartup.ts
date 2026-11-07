import type { RequestHandler } from "express";

type Stage = "configuration" | "migration" | "client" | "webhook" | "backfill";
type StageState = "pending" | "running" | "ready" | "failed";
export interface PaymentStartupDependencies {
  runMigrations: (options: { databaseUrl: string }) => Promise<unknown>;
  getStripeSync: () => Promise<{
    findOrCreateManagedWebhook: (url: string) => Promise<unknown>;
    syncBackfill: (options: { object: "all" }) => Promise<unknown>;
  }>;
}

// Only fixed enums and timestamps leave this module. Never retain SDK errors:
// their messages and stacks can include keys, database URLs or customer data.
export function createPaymentStartup(
  dependencies: PaymentStartupDependencies,
  env: NodeJS.ProcessEnv = process.env,
  emit: (event: string) => void = console.log,
) {
  let status: "pending" | "initializing" | "ready" | "failed" | "disabled" = "pending";
  const stages: Record<Stage, StageState> = {
    configuration: "pending", migration: "pending", client: "pending",
    webhook: "pending", backfill: "pending",
  };
  let updatedAt = new Date().toISOString();
  let started: Promise<void> | undefined;
  const snapshot = () => ({ status, stages: { ...stages }, updatedAt });
  function report() {
    updatedAt = new Date().toISOString();
    emit(JSON.stringify({ event: "payment_startup", ...snapshot() }));
  }
  async function step<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
    stages[stage] = "running";
    report();
    try {
      const value = await operation();
      stages[stage] = "ready";
      report();
      return value;
    } catch {
      stages[stage] = "failed";
      status = "failed";
      report();
      throw new Error("payment_startup_failed");
    }
  }
  async function initialize() {
    if (env.STRIPE_SYNC_ENABLED === "false") {
      status = "disabled";
      report();
      return;
    }
    status = "initializing";
    report();
    try {
      const config = await step("configuration", async () => {
        if (!env.DATABASE_URL) throw new Error("missing_database");
        const host = env.REPLIT_DEPLOYMENT === "1"
          ? "virtualstudio.sale" : env.REPLIT_DOMAINS?.split(",")[0]?.trim();
        if (!host) throw new Error("missing_webhook_host");
        const url = new URL(`https://${host}`);
        if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
          throw new Error("invalid_webhook_host");
        }
        return { databaseUrl: env.DATABASE_URL, webhookUrl: `${url.origin}/api/stripe/webhook` };
      });
      await step("migration", () => dependencies.runMigrations({ databaseUrl: config.databaseUrl }));
      const sync = await step("client", dependencies.getStripeSync);
      // A webhook failure must remain visible even if backfill succeeds.
      // Continue backfill to preserve the existing independent sync behavior.
      try {
        await step("webhook", () => sync.findOrCreateManagedWebhook(config.webhookUrl));
      } catch { /* already recorded without sensitive error details */ }
      await step("backfill", () => sync.syncBackfill({ object: "all" }));
      status = Object.values(stages).every(value => value === "ready") ? "ready" : "failed";
      report();
    } catch { /* stage failure is already recorded; core server stays available */ }
  }
  const handler: RequestHandler = (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(status === "ready" ? 200 : 503).json(snapshot());
  };
  return {
    snapshot,
    handler,
    // Repeated callers share one initialization attempt, not concurrent migrations.
    start: () => (started ??= initialize()),
  };
}
