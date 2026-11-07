---
name: Stripe backfill defaults
description: A silent no-op in the installed Stripe synchronization SDK's optional backfill arguments.
---

Require an explicit supported object selector when requesting Stripe backfill.

**Why:** The installed stripe-replit-sync 1.0.0 implementation's omitted-selector default is function-valued and matches none of its synchronization cases. A no-argument call can resolve after account lookup without syncing records, creating false readiness.

**How to apply:** When upgrading or wrapping this SDK, inspect its actual selector behavior and assert the request arguments in local stubs. A fulfilled promise alone is insufficient evidence that synchronization ran.

Enumerate payment-method customers through the currently authenticated Stripe
API, not the unfiltered local customer cache.

**Why:** The SDK's payment-method backfill reads all cached customer IDs without
account or test/live isolation. Databases previously populated from multiple
Stripe environments can therefore make an otherwise valid backfill fail at
that step. Scoping enumeration through the active connection allowed a full
development backfill to finish successfully.

**How to apply:** Preserve SDK-owned upserts and account scoping, paginate the
API enumeration, and propagate failures. Do not delete cached customers or
silently skip errors to manufacture a healthy status.
