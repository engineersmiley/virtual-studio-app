---
name: Stripe backfill defaults
description: A silent no-op in the installed Stripe synchronization SDK's optional backfill arguments.
---

Require an explicit supported object selector when requesting Stripe backfill.

**Why:** The installed stripe-replit-sync 1.0.0 implementation's omitted-selector default is function-valued and matches none of its synchronization cases. A no-argument call can resolve after account lookup without syncing records, creating false readiness.

**How to apply:** When upgrading or wrapping this SDK, inspect its actual selector behavior and assert the request arguments in local stubs. A fulfilled promise alone is insufficient evidence that synchronization ran.
