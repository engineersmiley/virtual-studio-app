import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import ts from 'typescript';
import monitorModule from '../../../virtual-studio-agent/src/screen-info.js';
import { mapVideoPointToScreen } from './remote-control-video.js';

const { monitorScreenInfo } = monitorModule;
const flush = () => new Promise(resolve => setImmediate(resolve));
const events = ['display-metrics-changed', 'display-added', 'display-removed'];

function setup(publish = async () => ({ ok: true })) {
  const screen = new EventEmitter();
  let display = { id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  screen.getPrimaryDisplay = () => display;
  const sent = [];
  const errors = [];
  const stop = monitorScreenInfo({
    screen,
    publish: (info, signal) => {
      sent.push({ info, signal });
      return publish(info, signal);
    },
    onError: error => errors.push(error),
    retryMs: 5,
  });
  return {
    screen, sent, errors, stop,
    change(next, event = 'display-metrics-changed') {
      display = { ...display, ...next };
      screen.emit(event, {}, display, ['bounds', 'scaleFactor']);
    },
  };
}

test('publishes initial geometry, resolution, scale-only and primary display changes', async t => {
  const state = setup();
  t.after(state.stop);
  await flush();
  assert.deepEqual(state.sent[0].info, { screenWidth: 1920, screenHeight: 1080, scaleFactor: 1 });
  state.change({ size: { width: 2560, height: 1440 } });
  await flush();
  state.change({ scaleFactor: 2 });
  await flush();
  assert.deepEqual(state.sent[2].info, { screenWidth: 2560, screenHeight: 1440, scaleFactor: 2 });
  state.change({ id: 2 }, 'display-added');
  await flush();
  assert.equal(state.sent.length, 4);
  state.change({});
  await flush();
  assert.equal(state.sent.length, 4, 'unchanged metrics are not republished');
  state.change({ id: 3, size: { width: 1280, height: 720 } }, 'display-removed');
  await flush();
  assert.equal(state.sent[4].info.screenWidth, 1280);
});

test('serializes in-flight updates and publishes latest dimensions after a burst', async t => {
  let finish;
  const state = setup(() => new Promise(resolve => { finish = resolve; }));
  t.after(state.stop);
  state.change({ size: { width: 2560, height: 1440 } });
  state.change({ size: { width: 3840, height: 2160 } });
  assert.equal(state.sent.length, 1);
  finish({ ok: true });
  await flush();
  assert.equal(state.sent.length, 2);
  assert.equal(state.sent[1].info.screenWidth, 3840);
  finish({ ok: true });
  await flush();
  assert.equal(state.sent.length, 2);
});

for (const failure of ['http', 'network']) {
  test(`retries ${failure} failures without needing a new display event`, async t => {
    let attempts = 0;
    let retried;
    const done = new Promise(resolve => { retried = resolve; });
    const state = setup(async () => {
      if (++attempts === 1) {
        if (failure === 'network') throw new Error('offline');
        return { ok: false, status: 503 };
      }
      retried();
      return { ok: true };
    });
    t.after(state.stop);
    await done;
    assert.equal(state.errors.length, 1);
    assert.equal(state.sent.length, 2);
    assert.deepEqual(state.sent[0].info, state.sent[1].info);
  });
}

test('cleanup removes listeners, aborts pending publishing, and cancels retries', async () => {
  const state = setup(async () => ({ ok: false, status: 503 }));
  await flush();
  state.stop();
  state.stop();
  for (const event of events) assert.equal(state.screen.listenerCount(event), 0);
  assert.equal(state.sent[0].signal.aborted, true);
  state.change({ scaleFactor: 2 });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(state.sent.length, 1);
  const next = setup();
  next.stop();
  assert.equal(next.screen.listenerCount('display-metrics-changed'), 0);
});

test('real agent connection lifecycle removes monitoring on reconnect, disconnect, session end, and quit', async t => {
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => ({ then() {} });
  const screen = new EventEmitter();
  screen.getPrimaryDisplay = () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 });
  const handlers = new Map();
  const requests = [];
  const intervals = new Set();
  const context = createContext({
    __dirname: '',
    process: { platform: 'linux' },
    console: { log() {}, error() {} },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
    fakeHttp: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
    require(name) {
      if (name === 'electron') return {
        app, screen,
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        dialog: { showMessageBox: async () => ({ response: 0 }) },
      };
      if (name === './screen-info') return monitorModule;
      if (name === '@jitsi/robotjs') throw new Error('native dependency unavailable');
      return {};
    },
  });
  const main = readFileSync(new URL('../../../virtual-studio-agent/src/main.js', import.meta.url), 'utf8');
  runInContext(main, context);
  runInContext(`
    httpRequest = fakeHttp;
    mainWindow = { webContents: { send() {} } };
  `, context);
  t.after(() => app.emit('before-quit'));
  const connect = async code => {
    runInContext(`connectToServer('${code}')`, context);
    await flush();
    for (const event of events) assert.equal(screen.listenerCount(event), 1);
    assert.equal(intervals.size, 1);
  };
  await connect('ABC123');
  const firstSignal = requests.find(request => request.url.endsWith('/screen-info')).options.signal;
  await connect('DEF456');
  assert.equal(firstSignal.aborted, true);
  await handlers.get('disconnect')();
  for (const event of events) assert.equal(screen.listenerCount(event), 0);
  assert.equal(intervals.size, 0);
  await connect('ABC123');
  await runInContext(`handleControlMessage({ type: 'session-ended' })`, context);
  for (const event of events) assert.equal(screen.listenerCount(event), 0);
  assert.equal(intervals.size, 0);
  await connect('ABC123');
  app.emit('before-quit');
  for (const event of events) assert.equal(screen.listenerCount(event), 0);
});

function parse(path) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function find(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, node => find(node, predicate));
}

function evaluate(node, source, scope) {
  const js = ts.transpileModule(`(${node.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
}

test('server broadcasts new geometry on both transports and retains it for the session', () => {
  const source = parse('../../../server/routes.ts');
  const route = find(source, node => ts.isCallExpression(node)
    && node.expression.getText(source) === 'app.post'
    && node.arguments[0]?.text === '/api/agent/screen-info');
  const wsMessages = [];
  const pollingParticipant = { messages: [] };
  const stored = new Map();
  const handler = evaluate(route.arguments[1], source, {
    agentScreenInfo: stored,
    rooms: new Map([['ABC123', [{ ws: { readyState: 1, send: data => wsMessages.push(JSON.parse(data)) } }]]]),
    pollingRooms: new Map([['ABC123', [pollingParticipant]]]),
    WebSocket: { OPEN: 1 },
    console: { log() {}, error() {} },
  });
  for (const width of [1920, 2560]) {
    handler({ body: { sessionCode: 'abc123', screenWidth: width, screenHeight: 1440, scaleFactor: 2 } }, {
      json: data => assert.equal(data.success, true),
    });
  }
  assert.equal(stored.get('ABC123').screenWidth, 2560);
  assert.deepEqual(wsMessages, pollingParticipant.messages);
  assert.equal(wsMessages[1].screenWidth, 2560);
});

test('geometry reaches status callback without resetting active control and rescales input', () => {
  const source = parse('../hooks/use-webrtc.ts');
  const branch = find(source, node => ts.isCaseClause(node) && node.expression.text === 'agent-screen-info');
  const info = { screenWidth: 2560, screenHeight: 1440, scaleFactor: 2 };
  let latest;
  // Run the actual signaling branch, not a duplicate of its implementation.
  const block = branch.statements[0];
  const js = ts.transpileModule(block.getText(source).replace(/\bbreak;/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('message', 'setAgentScreenInfo', js)(info, value => { latest = value; });
  const effect = find(source, node => ts.isCallExpression(node)
    && node.expression.getText(source) === 'useEffect'
    && node.arguments[1]?.getText(source).includes('agentScreenInfo'));
  let status;
  evaluate(effect.arguments[0], source, {
    agentConnected: true, controlAllowed: true, controlPending: false,
    agentScreenInfo: latest,
    onAgentStatusRef: { current: value => { status = value; } },
  })();
  assert.equal(status.controlAllowed, true);
  assert.equal(status.screenWidth, 2560);
  const target = mapVideoPointToScreen(500, 250,
    { left: 0, top: 0, width: 1000, height: 500 }, 2560, 1440,
    { width: status.screenWidth, height: status.screenHeight });
  assert.deepEqual(target, { x: 1280, y: 720 });
});
