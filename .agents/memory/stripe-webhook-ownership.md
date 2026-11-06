---
name: Stripe webhook ownership
description: Why development startup must be checked for cross-environment webhook mutations.
---

Treat Stripe synchronization startup as a provider-side mutation, not a harmless
readiness check. Managed webhook ownership must be scoped to its environment.

**Why:** A development restart logged removal of an orphaned managed webhook
whose destination was the published application's URL. Published startup logs
also contained missing-endpoint errors. This warrants investigating competing
ownership; it does not establish the cause of every payment startup failure.

**How to apply:** Before changing or repeatedly restarting billing initialization,
inspect the SDK's cleanup behavior, endpoint destination, database metadata, and
development/production ownership. Prevent one environment from deleting another's
webhook. Verify changes against mocked provider operations before live mutations;
do not expose credentials or silently weaken billing authorization.
