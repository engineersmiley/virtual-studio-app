import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const main = readFileSync(new URL('../../../virtual-studio-agent/src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../../virtual-studio-agent/src/index.html', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('main.js', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functionText(name) {
  const node = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing ${name}`);
  return node.getText(syntax);
}

function connectionHarness(request, socketBehavior = 'open') {
  const events = [];
  const sockets = [];
  const timers = [];
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        if (socketBehavior === 'open') {
          this.readyState = FakeWebSocket.OPEN;
          this.emit('open');
        } else {
          this.emit('error', new Error('WebSocket unavailable'));
          this.terminate();
        }
      });
    }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.readyState = 3; this.emit('close'); }
  }
  const context = {
    httpRequest: request,
    VIRTUAL_STUDIO_HTTP: 'https://example.test',
    VIRTUAL_STUDIO_URL: 'wss://example.test',
    WebSocket: FakeWebSocket,
    getAgentPollCadence: controlEnabled => ({
      timerIntervalMs: 16,
      minimumRequestIntervalMs: controlEnabled ? 16 : 500,
    }),
    connectionGeneration: 1,
    stopScreenInfoUpdates() {},
    updateTrayMenu() {},
    mainWindow: { webContents: { send: (...args) => events.push(args) } },
    console: { log() {}, error() {}, warn() {} },
    usePolling: false, isConnected: false, currentSession: null, currentToken: null,
    agentPollInFlight: false, agentSocketReconnectTimer: null,
    controlEnabled: false,
    consecutiveErrors: 0, pollingInterval: null,
    monitorScreenInfo: () => () => {},
    screen: {},
    getCurrentDisplayControlState() {},
    readScreenInfo: () => ({ screenWidth: 1920, screenHeight: 1080, displayControlSupported: true }),
    app: { getVersion: () => '1.20.4' },
    setInterval: (_fn, delay) => { context.pollDelay = delay; return 1; },
    clearInterval() {},
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
  };
  vm.createContext(context);
  for (const name of [
    'getCurrentAgentScreenInfo', 'sendCurrentAgentScreenInfo',
    'startAgentPolling', 'connectAgentWebSocket', 'scheduleAgentWebSocketReconnect',
  ]) vm.runInContext(functionText(name), context);
  vm.runInContext(functionText('connectViaPolling'), context);
  return { context, events, sockets, timers };
}

test('initial Agent connection waits for the server and bounds its wait', async () => {
  let options;
  const h = connectionHarness(async (_url, opts) => {
    options = opts;
    return { ok: true, json: async () => ({ websocketToken: 'session-ws-token' }) };
  });
  const result = await h.context.connectViaPolling('ABC123', 1);
  assert.equal(result.success, true, result.error);
  assert.equal(options.timeoutMs, 10000);
  assert.equal(h.context.isConnected, true);
  assert.equal(h.context.usePolling, false, 'successful Agent WebSocket avoids per-input HTTP polling');
  assert.equal(h.context.currentSession, 'ABC123');
  assert.equal(h.sockets[0].url, 'wss://example.test/agent?session=ABC123');
  assert.equal(h.sockets[0].options.headers.Authorization, 'Bearer session-ws-token');
  assert.equal(h.sockets[0].sent[0].type, 'screen-info');
  assert.equal(h.events.some(([type, payload]) => type === 'connection-status' && payload.connected), true);
});

test('rejected server connection returns failure and clears Agent state', async () => {
  const h = connectionHarness(async () => ({ ok: false, json: async () => ({ error: 'Session not found' }) }));
  const result = await h.context.connectViaPolling('ABC123', 1);
  assert.equal(result.success, false);
  assert.equal(result.error, 'Session not found');
  assert.equal(h.context.isConnected, false);
  assert.equal(h.context.currentSession, null);
  assert.equal(h.events.some(([type, payload]) => type === 'connection-status' && !payload.connected), true);
});

test('network failure is retryable without falsely connecting', async () => {
  const h = connectionHarness(async () => { throw new Error('Connection timed out'); });
  const result = await h.context.connectViaPolling('ABC123', 1);
  assert.equal(result.success, false);
  assert.match(result.error, /timed out/);
  assert.equal(h.context.isConnected, false);
  assert.equal(h.events.some(([type]) => type === 'error'), true);
});

test('failed Agent WebSocket falls back to HTTP polling', async () => {
  const h = connectionHarness(async url => url.endsWith('/simple-connect')
    ? { ok: true, json: async () => ({ websocketToken: 'session-ws-token' }) }
    : { ok: true, json: async () => ({ messages: [] }) }, 'error');
  const result = await h.context.connectViaPolling('ABC123', 1);
  assert.equal(result.success, true);
  assert.equal(h.context.isConnected, true);
  assert.equal(h.context.usePolling, true);
  assert.equal(h.context.pollingInterval, 1);
  assert.equal(h.events.some(([type, payload]) =>
    type === 'connection-status' && payload.mode === 'polling'), true);
});

test('Agent switches to polling automatically if its WebSocket drops', async () => {
  const h = connectionHarness(async url => url.endsWith('/simple-connect')
    ? { ok: true, json: async () => ({ websocketToken: 'session-ws-token' }) }
    : { ok: true, json: async () => ({ messages: [] }) });
  await h.context.connectViaPolling('ABC123', 1);
  h.sockets[0].close();
  assert.equal(h.context.usePolling, true);
  assert.equal(h.context.pollingInterval, 1);
  assert.equal(h.events.some(([type, payload]) =>
    type === 'connection-status' && payload.mode === 'polling'), true);
});

test('an obsolete connection cannot replace the current session', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const h = connectionHarness(() => pending);
  const resultPromise = h.context.connectViaPolling('OLD123', 1);
  h.context.connectionGeneration = 2;
  resolve({ ok: true });
  assert.equal((await resultPromise).success, false);
  assert.equal(h.context.currentSession, null);
  assert.equal(h.events.length, 0);
});

test('connect HTTP request has a wall-clock deadline even before socket opens', async () => {
  class Request extends EventEmitter {
    write() {}
    end() {}
    destroy(error) { this.emit('error', error); }
  }
  const request = new Request();
  let deadline;
  const context = {
    https: { Agent: class {}, request: () => request },
    URL,
    setTimeout(callback) { deadline = callback; return 1; },
    clearTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(functionText('httpRequest'), context);
  const pending = context.httpRequest('https://example.test/agent', { timeoutMs: 10000 });
  assert.equal(typeof deadline, 'function');
  deadline();
  await assert.rejects(pending, /timed out/);
});

test('successive Agent requests reuse one bounded keep-alive agent', async () => {
  const agents = [];
  let created = 0;
  const context = {
    https: {
      Agent: class {
        constructor(options) {
          created++;
          assert.equal(options.keepAlive, true);
          assert.equal(options.maxSockets, 4);
        }
      },
      request(options, callback) {
        agents.push(options.agent);
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {
          const res = new EventEmitter();
          res.statusCode = 200;
          callback(res);
          res.emit('data', '{}');
          res.emit('end');
        };
        return req;
      },
    },
    URL, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(functionText('httpRequest'), context);
  await context.httpRequest('https://example.test/poll');
  await context.httpRequest('https://example.test/send');
  assert.equal(created, 1);
  assert.equal(agents[0], agents[1]);
});

test('Agent UI resets Connect after failures and disconnects', () => {
  const click = html.slice(html.indexOf("connectBtn.addEventListener('click'"), html.indexOf("disconnectBtn.addEventListener('click'"));
  assert.match(click, /finally\s*\{[\s\S]*connectBtn\.disabled = false/);
  const status = html.slice(html.indexOf('window.agent.onConnectionStatus'), html.indexOf('window.agent.onControlStatus'));
  assert.match(status, /connectBtn\.disabled = false/);
  const error = html.slice(html.indexOf('window.agent.onError'), html.indexOf('function showError'));
  assert.match(error, /connectBtn\.disabled = false/);
});
