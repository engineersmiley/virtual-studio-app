---
name: Remote input lifetimes
description: Why permission checks alone cannot protect delayed input across revocation and reauthorization.
---

Treat delayed remote input as belonging to its original authorization lifetime and transport. Cancel pending input on revocation, connection replacement, session teardown, and removal of its source view.

**Why:** The server checks current room-level permission, not the grant under which a browser gesture began. A revoked gesture that survives until permission is granted again can pass that check. React render-time permission closures also lag synchronous transport events.

**How to apply:** Keep authorization invalidation synchronous with transport messages and local termination. Test revoke-then-regrant before the original timer expires, not only revocation while permission stays false. Cover throttled pointer movement as well as delayed clicks.
