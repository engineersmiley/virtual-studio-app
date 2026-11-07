import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkServer, freePort, isolatedEnvironment } from './production-smoke.mjs';

test('isolated environment does not inherit credentials or Node injection', () => {
  for (const key of [
    'DATABASE_URL', 'STRIPE_SECRET_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY',
    'REPL_IDENTITY', 'WEB_REPL_RENEWAL', 'GITHUB_TOKEN', 'SESSION_SECRET',
    'NODE_OPTIONS', 'HTTPS_PROXY',
  ]) {
    assert.equal(Object.hasOwn(isolatedEnvironment(), key), false, key);
  }
});

async function fixture(source, run) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'smoke-runner-test-'));
  const port = await freePort();
  await mkdir(path.join(cwd, 'dist'));
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { start: 'NODE_ENV=production node dist/index.cjs' },
  }));
  await writeFile(path.join(cwd, 'dist/index.cjs'), source);
  try {
    await run({ cwd, port, env: { ...isolatedEnvironment(), PORT: String(port) }, timeoutMs: 1800 });
    // Cleanup must include the actual server, not just its npm parent.
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function server(healthStatus = 200, healthBody = '{"status":"ok"}', pageStatus = 200) {
  return `
    const http = require('node:http');
    if (process.env.NODE_ENV !== 'production') process.exit(2);
    http.createServer((req, res) => {
      const health = req.url === '/api/health';
      res.writeHead(health ? ${healthStatus} : ${pageStatus}, {
        'Content-Type': health ? 'application/json' : 'text/html'
      });
      res.end(health ? ${JSON.stringify(healthBody)} : '<html>built client</html>');
    }).listen(process.env.PORT, '127.0.0.1');
  `;
}

test('real npm start succeeds only for healthy server and built client, then cleans up', async () => {
  await fixture(server(), options => checkServer(options));
});

test('early server crash fails with captured startup diagnostics', async () => {
  await fixture("console.error('startup failure fixture'); process.exit(1);", options =>
    assert.rejects(checkServer(options), /exited before becoming healthy[\s\S]*startup failure fixture/));
});

test('hung startup is bounded and cleaned up', async () => {
  await fixture('setInterval(() => {}, 1000);', options =>
    assert.rejects(checkServer(options), /timed out/));
});

for (const [label, source] of [
  ['unavailable database health', server(503, '{"status":"unavailable"}')],
  ['SPA fallback instead of health JSON', server(200, '<html>not health</html>')],
  ['wrong health response', server(200, '{"status":"starting"}')],
  ['missing built client', server(200, '{"status":"ok"}', 404)],
]) {
  test(`rejects ${label} and cleans up`, async () => {
    await fixture(source, options => assert.rejects(checkServer(options), /timed out/));
  });
}
