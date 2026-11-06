---
name: Stripe webhook ownership
description: Why development startup must be checked for cross-environment webhook mutations.
---

Treat Stripe synchronization startup as a provider-side mutation, not a harmless
readiness check. Managed webhook ownership must be scoped to its environment.

**Why:** Development startup preferred shared Stripe environment secrets over
the Replit development connector. Its separate local database therefore treated
the live webhook as orphaned and attempted cleanup. Selecting the development
connector now prevents this cross-environment provider mutation. Development
webhook setup succeeded through that connector, but its backfill still failed;
production recovery must be verified after publishing.

**How to apply:** Before changing or repeatedly restarting billing initialization,
inspect the SDK's cleanup behavior, endpoint destination, database metadata, and
development/production ownership. Prevent one environment from deleting another's
webhook. Verify changes against mocked provider operations before live mutations;
do not expose credentials or silently weaken billing authorization. In Replit
development, prefer the development connector over shared environment keys; use
production-only environment keys only in the deployment.
