# Payment startup monitoring

`GET /api/health` remains the existing PostgreSQL/core availability check. Stripe
failures do not block serving the application or alter that check.

Monitor `GET /api/health/payments` separately. It is a public, read-only,
`Cache-Control: no-store` endpoint containing only fixed status values, stage
states and the last transition timestamp. It does not query Stripe.

- HTTP 200 / `ready`: configuration, migration, client creation, managed webhook
  setup and initial backfill all completed successfully.
- HTTP 503 / `pending` or `initializing`: startup is not finished. Stage states
  identify work still pending or running, including a stalled backfill.
- HTTP 503 / `failed`: at least one stage failed. A successful backfill cannot
  hide a failed webhook setup.
- HTTP 503 / `disabled`: synchronization was deliberately disabled with
  `STRIPE_SYNC_ENABLED=false`. This is expected in isolated production smoke
  tests; those tests continue to use the core health endpoint.

Structured console events named `payment_startup` report each stage transition
with the same sanitized fields. SDK error objects, messages, credentials,
webhook URLs and customer data are deliberately not included in these events
or responses.

Alert on failure or on initialization remaining incomplete beyond your normal
startup window. Check database configuration/access for configuration or migration
failures, Stripe credential configuration for client failures, managed webhook
configuration for webhook failures, and Stripe/database access for backfill
failures. Fix the cause and restart to attempt initialization again.

This is **startup readiness**, not a continuous Stripe availability check or a
guarantee that checkout and future webhook deliveries will succeed. It is
process-local and resets on restart. Do not use it as core server liveness.

`npm run test:payments` uses local injected migration and Stripe-client stubs;
it never calls payment services. It is also included in `npm test`.
