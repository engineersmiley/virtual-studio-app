import fs from "node:fs";
import path from "node:path";

// The workspace registry proxy can serialize private URLs into npm lockfiles.
// Normalize only that known prefix; keep exact versions and integrity hashes.
const lockPath = path.resolve(import.meta.dirname, "../package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const proxyPrefix = "http://package-firewall.replit.internal/npm/";
let normalized = 0;

for (const entry of Object.values(lock.packages ?? {})) {
  if (entry.resolved?.startsWith(proxyPrefix)) {
    if (!entry.integrity) {
      throw new Error("Cannot normalize a package without its integrity hash.");
    }
    entry.resolved = `https://registry.npmjs.org/${entry.resolved.slice(proxyPrefix.length)}`;
    normalized++;
  }
}

if (normalized) {
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Normalized ${normalized} package URLs for portable npm installs.`);
}
