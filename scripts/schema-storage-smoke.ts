import assert from "node:assert/strict";

if (!process.env.SCHEMA_SMOKE_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.SCHEMA_SMOKE_DATABASE_URL ||
    !/^postgresql:\/\/smoke@127\.0\.0\.1:\d+\/smoke$/.test(process.env.DATABASE_URL)) {
  throw new Error("Run npm run test:schema; this worker requires the disposable database runner");
}
const { storage } = await import("../server/storage");
const { pool } = await import("../server/db");

// Only launched by schema-smoke.mjs with an isolated environment. Import no
// routes or payment services: the Stripe-managed schema is intentionally absent.
const reads = [
  { table: "sessions", column: "name", read: () => storage.getSessions() },
  { table: "recordings", column: "filename", read: () => storage.getRecordings() },
  { table: "users", column: "email", read: () => storage.getUser("schema-smoke-missing") },
  { table: "promo_codes", column: "code", read: () => storage.getAllPromoCodes() },
];

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error) return String(error.code);
  return "cause" in error ? postgresCode(error.cause) : undefined;
}

try {
  // SELECTs include every mapped column, even on an empty database.
  assert.deepEqual(await storage.getSessions(), []);
  assert.deepEqual(await storage.getRecordings(), []);
  assert.deepEqual(await storage.getAllPromoCodes(), []);
  assert.equal(await storage.getSession("ABSENT"), undefined);
  assert.equal(await storage.getRecording(-1), undefined);
  assert.equal(await storage.getUser("schema-smoke-missing"), undefined);
  assert.equal(await storage.getUserByEmail("missing@example.invalid"), undefined);
  assert.equal(await storage.getPromoCode("ABSENT"), undefined);
  console.log("Schema compatibility passed: all four application tables and mapped columns are readable");

  // Negative controls prove these are actual storage queries, not a health
  // probe or a fallback that hides missing relations/columns.
  for (const { table, column, read } of reads) {
    await pool.query(`ALTER TABLE "${table}" RENAME TO "schema_smoke_hidden"`);
    try {
      await assert.rejects(read, error => postgresCode(error) === "42P01",
        `${table}: missing table must fail`);
    } finally {
      await pool.query(`ALTER TABLE "schema_smoke_hidden" RENAME TO "${table}"`);
    }
    await pool.query(`ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "schema_smoke_hidden"`);
    try {
      await assert.rejects(read, error => postgresCode(error) === "42703",
        `${table}.${column}: missing column must fail`);
    } finally {
      await pool.query(`ALTER TABLE "${table}" RENAME COLUMN "schema_smoke_hidden" TO "${column}"`);
    }
    await read();
  }
  console.log("Schema negative controls passed: missing tables and columns fail storage reads");
} finally {
  await pool.end();
}
