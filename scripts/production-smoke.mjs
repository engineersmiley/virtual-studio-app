import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));

// Deliberate allowlist: never inherit DATABASE_URL, Stripe/Gmail credentials,
// Replit identities, proxy settings, or NODE_OPTIONS from a developer/CI shell.
export function isolatedEnvironment() {
  return Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].filter(key => process.env[key])
      .map(key => [key, process.env[key]]),
  );
}

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Exercise the public start command, not tsx or an alternate test server.
export async function checkServer({ cwd = root, env, port, timeoutMs = 30_000 }) {
  let output = '';
  let exited = false;
  const child = spawn('npm', ['run', 'start'], {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  child.stdout.on('data', data => { output = (output + data).slice(-16_000); });
  child.stderr.on('data', data => { output = (output + data).slice(-16_000); });
  child.once('exit', () => { exited = true; });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  // Attach immediately, including spawn failures, to avoid unhandled rejections.
  closed.catch(() => {});
  function kill(signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  const abort = () => kill('SIGKILL');
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exited) throw new Error('Production server exited before becoming healthy');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(Math.min(2000, timeoutMs)),
        });
        assert.equal(response.status, 200, 'Health must return HTTP 200');
        assert.match(response.headers.get('content-type') ?? '', /application\/json/);
        assert.deepEqual(await response.json(), { status: 'ok' });
        const page = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(Math.min(2000, timeoutMs)),
        });
        assert.equal(page.status, 200, 'Built client must return HTTP 200');
        assert.match(await page.text(), /<html[\s>]/i, 'Built client must serve HTML');
        if (exited) throw new Error('Production server exited during health check');
        console.log('Production smoke passed: HTTP health and built client are ready');
        return;
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    }
    throw new Error(`Production startup timed out after ${timeoutMs}ms: ${lastError?.message}`);
  } catch (error) {
    throw new Error(`${error.message}\n--- production server output ---\n${output}`);
  } finally {
    kill('SIGTERM');
    await Promise.race([closed.catch(() => {}), delay(2000)]);
    // npm may exit before its server child; kill the entire process group.
    kill('SIGKILL');
    await closed.catch(() => {});
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}

// Shared with schema validation; callers never supply a database URL.
export async function withDisposableDatabase(run) {
  const env = isolatedEnvironment();
  // Nix puts server binaries directly on PATH without pg_config. Ubuntu puts
  // them in a versioned directory exposed by pg_config instead.
  let bindir;
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    const binary = path.join(directory, 'initdb');
    if (await access(binary).then(() => true, () => false)) {
      bindir = path.dirname(await realpath(binary));
      break;
    }
  }
  if (!bindir) {
    bindir = execFileSync('pg_config', ['--bindir'], { env, encoding: 'utf8' }).trim();
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'production-smoke-'));
  const data = path.join(directory, 'data');
  const dbPort = await freePort();
  const pg = (command, args) => execFileSync(path.join(bindir, command), args, {
    env, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
  });
  let initialized = false;
  try {
    pg('initdb', ['-D', data, '-U', 'smoke', '--auth=trust', '--no-locale', '--encoding=UTF8']);
    initialized = true;
    pg('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'),
      '-o', `-h 127.0.0.1 -p ${dbPort} -k ${directory}`, '-w', 'start']);
    pg('createdb', ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'smoke', 'smoke']);
    await run({
      ...env,
      DATABASE_URL: `postgresql://smoke@127.0.0.1:${dbPort}/smoke`,
    });
  } catch (error) {
    const log = await readFile(path.join(directory, 'postgres.log'), 'utf8').catch(() => '');
    console.error(log);
    throw error;
  } finally {
    if (initialized) {
      // Also handles a partially successful pg_ctl start.
      try { pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']); }
      catch (error) {
        if (await access(path.join(data, 'postmaster.pid')).then(() => true, () => false)) throw error;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  await access(path.join(root, 'dist/index.cjs'));
  await access(path.join(root, 'dist/public/index.html'));
  await withDisposableDatabase(async env => {
    const port = await freePort();
    await checkServer({
      port,
      env: {
        ...env,
        PORT: String(port),
        SESSION_SECRET: 'disposable-production-smoke-only',
        STRIPE_SYNC_ENABLED: 'false',
      },
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
