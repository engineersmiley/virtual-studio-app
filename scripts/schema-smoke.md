# Schema compatibility validation

Run `npm run test:schema` with PostgreSQL server tools installed (`initdb` on
PATH, or `pg_config --bindir`). Like the production smoke, run as a non-root
user. No existing database or payment credentials are needed or used.

The runner creates a fresh temporary loopback-only PostgreSQL cluster, executes
the supported `npm run db:push` command using `drizzle.config.ts` and
`shared/schema.ts`, then runs non-payment reads through `server/storage.ts`.
Every mapped column in users, promo codes, sessions, and recordings is selected.
Empty lists and absent records are asserted. Negative controls temporarily
rename each table and a representative column and require the real PostgreSQL
missing-table/missing-column errors before restoring them.

Migration or read failures exit nonzero. Each subprocess has a timeout, and the
cluster is stopped and its files removed on success or failure. The environment
is allowlisted by the shared disposable-cluster helper: inherited database URLs,
payment credentials, and Node injection settings are not passed to children.
Do not invoke the TypeScript worker directly.

This runs separately from production boot validation, in the local build
validation and the PR/current-installer/legacy-installer release gates. It does
not validate the Stripe-managed schema, upgrade existing installations, or
automatically migrate development or production databases.
