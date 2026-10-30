---
name: CSS dependency patching
description: Why security-only dependency updates retain a selector-parser override rather than migrate Tailwind.
---

Keep the patched postcss-selector-parser override while the existing Tailwind and typography dependencies still select the unpatched version-6 line.

**Why:** Even the latest typography release retained an exact vulnerable parser dependency during the security update. Parser 7 worked with the existing CSS build, avoiding an unrelated Tailwind-major migration.

**How to apply:** Recheck the upstream dependency requirements before removing the override. Remove it only when the normal dependency tree resolves a patched parser and the CSS production build still passes.
