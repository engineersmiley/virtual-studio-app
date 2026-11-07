import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import ts from 'typescript';

function loadModule(path) {
  const exports = {};
  new Function('exports', ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText)(exports);
  return exports;
}
const { routeWebSocketUpgrades } = loadModule('../../../server/websocket-upgrade.ts');

test('browser, Agent and unrelated HMR upgrades receive clean frames through one dispatcher', async t => {
  const server = createServer();
  const browser = new WebSocketServer({ noServer: true });
  const agent = new WebSocketServer({ noServer: true });
  const hmr = new WebSocketServer({ noServer: true });
  const detach = routeWebSocketUpgrades(server, new Map([['/ws', browser], ['/agent', agent]]));
  // Simulate Vite's independent listener: application routes must not reject it.
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/vite-hmr')) {
      hmr.handleUpgrade(req, socket, head, ws => hmr.emit('connection', ws, req));
    }
  });
  for (const [name, wss] of [['browser', browser], ['agent', agent], ['hmr', hmr]]) {
    wss.on('connection', ws => {
      ws.send(name);
      ws.on('message', data => ws.send(`echo:${data}`));
    });
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    detach();
    for (const wss of [browser, agent, hmr]) {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    }
    await new Promise(resolve => server.close(resolve));
  });
  for (const [path, name] of [['/ws', 'browser'], ['/agent?sessionCode=TEST01', 'agent'], ['/vite-hmr?token=test', 'hmr']]) {
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}${path}`);
    const greeting = once(client, 'message');
    await once(client, 'open');
    assert.equal((await greeting)[0].toString(), name);
    const echo = once(client, 'message');
    client.send('clean-frame');
    assert.equal((await echo)[0].toString(), 'echo:clean-frame');
    const closed = once(client, 'close');
    client.close();
    await closed;
  }
  const routes = readFileSync(new URL('../../../server/routes.ts', import.meta.url), 'utf8');
  assert.equal((routes.match(/new WebSocketServer\(\{ noServer: true \}\)/g) || []).length, 2);
  assert.doesNotMatch(routes, /new WebSocketServer\(\{\s*server:\s*httpServer/);
});

const source = ts.createSourceFile('use-webrtc.ts',
  readFileSync(new URL('../hooks/use-webrtc.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
const declaration = find(source, n => ts.isVariableDeclaration(n) && n.name.getText(source) === 'connect');
const callback = declaration.initializer.arguments[0];
const compiled = ts.transpileModule(`(${callback.getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText.trim().replace(/;$/, '');

function retryHarness() {
  const sockets = [], timers = new Map(), retry = { current: 0 }, ref = { current: null };
  let fallbacks = 0;
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    constructor() { sockets.push(this); }
    send() {}
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    open() { this.readyState = 1; this.onopen?.(); }
    fail() {
      const close = this.onclose;
      this.onerror?.({ type: 'error' });
      close?.({ code: 1006 });
    }
    async join() { await this.onmessage?.({ data: JSON.stringify({ type: 'room-state' }) }); }
  }
  const scope = {
    setControlAllowed() {}, setSignalingJoined() {}, setConnected() {}, setError() {},
    retryCountRef: retry, retryTimeoutRef: { current: null }, usingPollingRef: { current: false },
    connectWithPolling() { fallbacks++; },
    wsRef: ref, maxRetries: 3, roomId: 'test01', userId: 'engineer', role: 'engineer',
    window: { location: { protocol: 'https:', host: 'example.test' } },
    WebSocket: FakeSocket, console: { log() {}, error() {} },
    isTransportOpen: socket => socket?.readyState === 1,
    handleSignalingMessage: async () => {},
    setTimeout(fn, delay) { const id = {}; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const connect = new Function(...Object.keys(scope),
    `return (() => { const connect = ${compiled}; return connect; })()`)(...Object.values(scope));
  return {
    connect, sockets, timers, retry,
    fallbacks: () => fallbacks,
    run(delay) {
      const [id, timer] = [...timers].find(([, timer]) => timer.delay === delay) || [];
      assert.ok(timer, `expected timer at ${delay}ms`);
      timers.delete(id);
      timer.fn();
    },
  };
}

for (const acknowledges of [false]) {
  test(`brief socket openings${acknowledges ? ' with brief join acknowledgments' : ''} cannot reset retries indefinitely`, async () => {
    const h = retryHarness();
    h.connect();
    for (let failure = 0; failure < 4; failure++) {
      const socket = h.sockets.at(-1);
      socket.open();
      if (acknowledges) await socket.join();
      assert.equal(h.retry.current, Math.min(failure, 3));
      socket.fail();
      if (failure < 3) {
        assert.equal(h.retry.current, failure + 1, 'error + close count as one attempt');
        h.run([1000, 2000, 4000][failure]);
      }
    }
    assert.equal(h.fallbacks(), 1);
    assert.equal(h.timers.size, 0);
  });
}

test('a joined socket immediately switches to polling instead of waiting through retries', async () => {
  const h = retryHarness();
  h.connect();
  const socket = h.sockets.at(-1);
  socket.open();
  await socket.join();
  socket.fail();
  assert.equal(h.fallbacks(), 1);
  assert.equal(h.timers.size, 0);
});

test('open socket without a room acknowledgment times out into a bounded retry', () => {
  const h = retryHarness();
  h.connect();
  h.sockets.at(-1).open();
  h.run(8000);
  assert.equal(h.retry.current, 1);
  assert.equal(h.sockets.at(-1).readyState, 3);
});

test('only a stable joined socket resets the retry budget', async () => {
  const h = retryHarness();
  h.retry.current = 2;
  h.connect();
  const socket = h.sockets.at(-1);
  socket.open();
  assert.equal(h.retry.current, 2);
  await socket.join();
  assert.equal(h.retry.current, 2);
  h.run(5000);
  assert.equal(h.retry.current, 0);
});

test('intentional cleanup clears join timers and never triggers fallback', () => {
  const h = retryHarness();
  const cleanup = h.connect();
  cleanup();
  assert.equal(h.timers.size, 0);
  assert.equal(h.fallbacks(), 0);
  assert.equal(h.retry.current, 0);
});
