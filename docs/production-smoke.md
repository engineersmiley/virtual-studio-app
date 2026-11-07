# Production startup smoke check

Run on Linux/macOS with Node 22.12+, npm dependencies and PostgreSQL binaries
(`initdb`, `pg_ctl`, `createdb` on PATH, or discoverable via `pg_config`;
on Ubuntu, install `postgresql`):

```sh
npm run build
npm run test:production:runner
npm run test:production
```

The check starts a fresh temporary PostgreSQL cluster on a loopback-only port,
then executes the real `npm run start` command (`NODE_ENV=production node
dist/index.cjs`). It requires JSON `{ "status": "ok" }` from `/api/health`
(which runs `SELECT 1`) and HTML from the built client's `/` route.
It fails on an early crash, invalid response, missing build, or startup timeout,
prints bounded server logs, and stops the server process group and database.
It never uses an existing database or pushes a schema to one. Run as a non-root
user, as required by PostgreSQL.

The child environment is allowlisted. Database URLs, payment keys, connector
identities, injected Node options and proxy settings are not inherited.
`STRIPE_SYNC_ENABLED=false` explicitly skips Stripe initialization, including its
migrations, webhook registration and backfill; default production behavior is
unchanged. No payment or email routes are invoked. This verifies boot and
database connectivity, not business schema migrations or payment integration.

PR checks and both desktop release validation jobs run the check after bundling,
before release builds are allowed to proceed. No CI secrets are required.
