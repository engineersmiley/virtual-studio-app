---
name: Admin subscriber data access
description: Protect subscriber email and subscription records behind real admin authentication.
---

The subscriber listing route must remain unavailable until the app has a real admin-authentication boundary.

**Why:** An unauthenticated endpoint returning subscriber emails, subscription status, and promo-code details would expose private account data.

**How to apply:** Before implementing or enabling subscriber-list functionality, add and verify server-side admin authentication; do not treat client-supplied email headers as authorization.
