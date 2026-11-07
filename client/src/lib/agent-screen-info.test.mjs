import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import ts from 'typescript';
import monitorModule from '../../../virtual-studio-agent/src/screen-info.js';
import displayControlModule from '../../../virtual-studio-agent/src/display-control.js';
import { mapVideoPointToScreen } from './remote-control-video.js';

const { monitorScreenInfo } = monitorModule;
const roomHelpers = {};
new Function('exports', ts.transpileModule(
  readFileSync(new URL('../../../server/signaling-room.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText)(roomHelpers);
const flush = () => new Promise(resolve => setImmediate(resolve));
const events = ['display-metrics-changed', 'display-added', 'display-removed'];

function setup(publish = async () => ({ ok: true })) {
  const screen = new EventEmitter();
  let display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  screen.getPrimaryDisplay = () => display;
  screen.getAllDisplays = () => [display];
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
  assert.deepEqual(state.sent[0].info, {
    screenWidth: 1920, screenHeight: 1080, scaleFactor: 1,
    displayControlSupported: true, displayControlReason: null,
    controlCalibrationRequired: false,
  });
  state.change({ size: { width: 2560, height: 1440 } });
  await flush();
  state.change({ scaleFactor: 2 });
  await flush();
  assert.equal(state.sent[2].info.screenWidth, 2560);
  assert.equal(state.sent[2].info.screenHeight, 1440);
  assert.equal(state.sent[2].info.scaleFactor, 2);
  assert.equal(state.sent[2].info.displayControlSupported, process.platform === 'darwin');
  assert.equal(state.sent[2].info.controlCalibrationRequired, process.platform !== 'darwin');
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
  app.getVersion = () => '1.20.3';
  app.whenReady = () => ({ then() {} });
  const screen = new EventEmitter();
  screen.getPrimaryDisplay = () => ({
    id: 1, size: { width: 1920, height: 1080 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1,
  });
  screen.getAllDisplays = () => [screen.getPrimaryDisplay()];
  const handlers = new Map();
  const requests = [];
  const intervals = new Set();
  let pausePoll = false;
  let now = 1000;
  let finishPoll;
  const context = createContext({
    __dirname: '',
    process: { platform: 'linux' },
    console: { log() {}, error() {}, warn() {} },
    Date: { now: () => now },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
    setTimeout: (callback, delay) => ({ callback, delay }),
    clearTimeout() {},
    fakeHttp: async (url, options) => {
      requests.push({ url, options });
      if (pausePoll && url.endsWith('/poll')) {
        await new Promise(resolve => { finishPoll = resolve; });
        return { ok: true, json: async () => ({ messages: [{ type: 'session-ended' }] }) };
      }
      return { ok: true, json: async () => ({ messages: [] }) };
    },
    require(name) {
      if (name === 'electron') return {
        app, screen,
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        dialog: { showMessageBox: async () => ({ response: 0 }) },
      };
      if (name === './screen-info') return monitorModule;
      if (name === './display-control') return displayControlModule;
      if (name === './poll-cadence') return {
        getAgentPollCadence: controlEnabled => ({
          timerIntervalMs: 16,
          minimumRequestIntervalMs: controlEnabled ? 16 : 500,
        }),
      };
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
  await [...intervals][0]();
  const heartbeat = JSON.parse(requests.find(request => request.url.endsWith('/poll')).options.body);
  assert.equal(heartbeat.screenInfo.agentVersion, '1.20.3');
  assert.equal(heartbeat.screenInfo.displayControlSupported, true);
  assert.equal(heartbeat.screenInfo.screenWidth, 1920);
  assert.equal(requests.some(request => request.url.endsWith('/screen-info')), false,
    'geometry is renewed through the Agent heartbeat, not an independent POST');
  const count = () => requests.filter(request => request.url.endsWith('/poll')).length;
  const initialCount = count();
  now += 100;
  await [...intervals][0]();
  assert.equal(count(), initialCount, 'idle Agent keeps the 500ms request cadence');
  runInContext('controlEnabled = true', context);
  await [...intervals][0]();
  assert.equal(count(), initialCount + 1, 'authorized cursor/full control polls at 16ms cadence');
  now += 15;
  await [...intervals][0]();
  assert.equal(count(), initialCount + 1, 'active polls wait until the 16ms frame boundary');
  now += 1;
  await [...intervals][0]();
  assert.equal(count(), initialCount + 2);
  runInContext('controlEnabled = false', context);
  pausePoll = true;
  now += 500;
  const poll = [...intervals][0];
  const inFlight = poll();
  const pollCount = requests.filter(request => request.url.endsWith('/poll')).length;
  await poll();
  assert.equal(requests.filter(request => request.url.endsWith('/poll')).length, pollCount,
    'slow heartbeat cannot overlap a second poll');
  await connect('DEF456');
  finishPoll();
  await inFlight;
  assert.equal(intervals.size, 1, 'old response cannot disconnect the replacement connection');
  assert.equal(runInContext('currentSession', context), 'DEF456');
  pausePoll = false;
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
  const scope = {
    agentScreenInfo: stored,
    revokeCaptureControl() {},
    rooms: new Map([['ABC123', [{ ws: { readyState: 1, send: data => wsMessages.push(JSON.parse(data)) } }]]]),
    pollingRooms: new Map([['ABC123', [pollingParticipant]]]),
    WebSocket: { OPEN: 1 },
    console: { log() {}, error() {} },
  };
  scope.updateAgentScreenInfo = evaluate(find(source, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'updateAgentScreenInfo'), source, scope);
  const handler = evaluate(route.arguments[1], source, scope);
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
    controlMode: 'alignment',
    agentScreenInfo: latest,
    onAgentStatusRef: { current: value => { status = value; } },
  })();
  assert.equal(status.controlAllowed, true);
  assert.equal(status.controlMode, 'alignment');
  assert.equal(status.screenWidth, 2560);
  const target = mapVideoPointToScreen(500, 250,
    { left: 0, top: 0, width: 1000, height: 500 }, 2560, 1440,
    { width: status.screenWidth, height: status.screenHeight });
  assert.deepEqual(target, { x: 1280, y: 720 });
});

function signalingHarness() {
  const source = parse('../../../server/routes.ts');
  const scope = {
    ...roomHelpers,
    agentScreenInfo: new Map(),
    controlModes: new Map(),
    rooms: new Map(),
    pollingRooms: new Map(),
    agentConnections: new Map(),
    pollingAgents: new Map(),
    controlPermissions: new Map(),
    revokeCaptureControl() {},
    captureStatus: () => ({ type: 'capture-status', supported: false }),
    wsConnectionData: new WeakMap(),
    WebSocket: { OPEN: 1 },
    console: { log() {}, error() {} },
  };
  scope.updateAgentScreenInfo = evaluate(find(source, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'updateAgentScreenInfo'), source, scope);
  const route = (method, path) => {
    const node = find(source, node => ts.isCallExpression(node)
      && node.expression.getText(source) === `app.${method}`
      && node.arguments[0]?.text === path);
    return evaluate(node.arguments[1], source, scope);
  };
  const publish = info => route('post', '/api/agent/screen-info')({
    body: { sessionCode: 'abc123', ...info },
  }, { json: data => assert.equal(data.success, true) });
  const joinBranch = find(source, node => ts.isCaseClause(node) && node.expression.text === 'join');
  const joinJs = ts.transpileModule(joinBranch.statements[0].getText(source).replace(/\bbreak;/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const wsJoin = new Function(...Object.keys(scope), 'ws', 'roomId', 'userId', 'role',
    `let currentRoom = null, currentUserId = null; ${joinJs}`);
  return {
    publish,
    joinWebSocket(userId = 'late-engineer', roomId = 'abc123') {
      const messages = [];
      const ws = { readyState: 1, send: data => messages.push(JSON.parse(data)) };
      wsJoin(...Object.values(scope), ws, roomId, userId, 'engineer');
      return messages;
    },
    joinPolling(userId = 'late-engineer', roomId = 'abc123') {
      route('post', '/api/signal/join')({ body: { roomId, userId, role: 'engineer' } }, {
        json: data => assert.equal(data.success, true),
      });
    },
    poll(userId = 'late-engineer', roomId = 'abc123') {
      let result;
      route('post', '/api/signal/poll')({ body: { roomId, userId } }, {
        json: data => { result = data; },
      });
      return result.messages;
    },
  };
}

for (const transport of ['WebSocket', 'polling']) {
  test(`${transport} late join and reconnect replay the latest non-default geometry`, () => {
    const signaling = signalingHarness();
    const initial = { screenWidth: 2560, screenHeight: 1440, scaleFactor: 2, displayControlSupported: false, displayControlReason: null, controlCalibrationRequired: true, agentVersion: '1.20.3' };
    const updated = { screenWidth: 3440, screenHeight: 1440, scaleFactor: 1.5, displayControlSupported: false, displayControlReason: null, controlCalibrationRequired: true, agentVersion: '1.20.3' };
    const join = () => {
      if (transport === 'WebSocket') return signaling.joinWebSocket();
      signaling.joinPolling();
      return signaling.poll();
    };
    const geometry = messages => messages.filter(message => message.type === 'agent-screen-info');
    signaling.publish(initial);
    assert.deepEqual(geometry(join()), [{ type: 'agent-screen-info', ...initial }]);
    assert.deepEqual(geometry(join()), [{ type: 'agent-screen-info', ...initial }],
      'reconnecting needs no display event or agent reconnect');
    signaling.publish(updated);
    assert.deepEqual(geometry(join()), [{ type: 'agent-screen-info', ...updated }],
      'reconnect uses the current geometry, not the original publication');
    if (transport === 'polling') {
      assert.deepEqual(signaling.poll(), [], 'replay is delivered only once per join');
    }
  });

  test(`${transport} join does not invent geometry or leak another session's screen size`, () => {
    const signaling = signalingHarness();
    signaling.publish({ screenWidth: 2560, screenHeight: 1440 });
    let messages;
    if (transport === 'WebSocket') {
      messages = signaling.joinWebSocket('other-engineer', 'xyz789');
    } else {
      signaling.joinPolling('other-engineer', 'xyz789');
      messages = signaling.poll('other-engineer', 'xyz789');
    }
    assert.deepEqual(messages.filter(message => message.type === 'agent-screen-info'), []);
  });
}
