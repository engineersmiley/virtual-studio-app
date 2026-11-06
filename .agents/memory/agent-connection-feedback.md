---
name: Agent connection feedback
description: Why desktop connection attempts must have a bounded, truthful outcome.
---

An Agent connection attempt is successful only after the server accepts the initial registration; a dispatched network request is not success. Bound the initial request by wall-clock time and let failed attempts return to a retryable UI state with the server's actual error.

**Why:** A failed or stalled request previously left the desktop button showing “Connecting…” indefinitely. A fully exiting and reopening Agent did not resolve the user's symptom. Socket inactivity timeouts alone do not bound DNS, TLS, or unfinished responses.

**How to apply:** Keep network attempts generation-scoped so an old completion cannot replace a newer session. Treat server rejection (including an already-connected Agent) as a visible failure, never as permission to bypass capture or control consent. Verify the fix in the released installer; changing the website does not update a running desktop process.
