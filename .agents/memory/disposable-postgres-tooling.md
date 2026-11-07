---
name: Disposable PostgreSQL tooling
description: Environment differences when discovering binaries for isolated PostgreSQL tests.
---

Do not assume `pg_config` is available just because PostgreSQL server tools are
installed. In this project's Replit Nix environment, `initdb` and `pg_ctl` are
available on PATH but `pg_config` is not. Ubuntu installations often expose the
reverse discovery pattern: `pg_config` locates a versioned server bin directory.

**Why:** A disposable-database check initially failed before server startup by
requiring `pg_config`, despite the necessary server tools already being present.

**How to apply:** For local test tooling that must work in Replit and Ubuntu CI,
support direct server-tool discovery as well as the `pg_config --bindir` route.
