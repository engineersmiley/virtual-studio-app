import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withDisposableDatabase } from './production-smoke.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));

// No external URL option: even when DATABASE_URL is set in the invoking shell,
// migration and storage reads only receive this newly-created cluster's URL.
await withDisposableDatabase(async env => {
  const run = (command, args) => execFileSync(command, args, {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
    encoding: 'utf8',
  });
  try {
    console.log(run('npm', ['run', 'db:push']));
    // Worker refuses direct invocation against an inherited DATABASE_URL.
    env.SCHEMA_SMOKE_DATABASE_URL = env.DATABASE_URL;
    console.log(run(process.execPath, ['--import', 'tsx', 'scripts/schema-storage-smoke.ts']));
  } catch (error) {
    throw new Error(`Schema compatibility check failed\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
});
