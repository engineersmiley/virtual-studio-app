import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import policy from '../../../virtual-studio-agent/src/display-control.js';

const mainSource = readFileSync(new URL('../../../virtual-studio-agent/src/main.js', import.meta.url), 'utf8');
const serverText = readFileSync(new URL('../../../server/routes.ts', import.meta.url), 'utf8');
const serverSource = ts.createSourceFile('routes.ts', serverText, ts.ScriptTarget.Latest, true);
const registrySource = readFileSync(new URL('../../../server/capture-control.ts', import.meta.url), 'utf8');
const registryExports = {};
new Function('exports', ts.transpileModule(registrySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(registryExports);
const { CaptureControl } = registryExports;
const display = (id = 1, x = 0, y = 0, scaleFactor = 1) => ({
  id, bounds: { x, y, width: 1920, height: 1080 },
  size: { width: 1920, height: 1080 }, scaleFactor,
});

function desktop(displays = [display()]) {
  const screen = new EventEmitter();
  screen.displays = displays;
  screen.getAllDisplays = () => screen.displays;
  screen.getPrimaryDisplay = () => screen.displays[0];
  return screen;
}

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform}: secondary displays, mixed scales, negative origins and switching fail closed`, () => {
    const screen = desktop();
    assert.equal(policy.getDisplayControlState(screen, platform).supported, true);
    for (const second of [display(2, 1920), display(2, -1920, 0, 2), display(2, 0, -1080, 1.5)]) {
      screen.displays = [display(), second];
      assert.equal(policy.getDisplayControlState(screen, platform).supported, false);
      screen.displays.reverse();
      assert.equal(policy.getDisplayControlState(screen, platform).supported, false);
    }
    screen.displays = [display(2, -1920)];
    assert.equal(policy.getDisplayControlState(screen, platform).supported, false);
    screen.displays = [display(2)];
    assert.equal(policy.getDisplayControlState(screen, platform).supported, true);
    screen.displays = [display(2, 0, 0, 2)];
    assert.equal(policy.getDisplayControlState(screen, platform).supported, platform === 'darwin');
    assert.equal(policy.getDisplayControlState(screen, platform).width, 1920, 'no double scaling');
  });
}

test('scaled Windows input is mapped only when native dimensions match the reported scale', () => {
  const screen = desktop([{
    id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 },
    size: { width: 1280, height: 720 }, scaleFactor: 1.5,
  }]);
  const control = policy.getDisplayControlState(screen, 'win32', { width: 1920, height: 1080 });
  assert.equal(control.supported, true);
  assert.equal(control.calibrationRequired, true);
  assert.deepEqual(policy.mapInputPoint(640, 360, control), { x: 960, y: 540 });
  assert.deepEqual(policy.mapInputPoint(1280, 720, control), { x: 1919, y: 1079 });
  assert.equal(policy.getDisplayControlState(screen, 'win32', { width: 1920, height: 1200 }).supported, false);
  assert.equal(policy.getDisplayControlState(screen, 'win32').supported, false);
});

test('capture registry rejects unidentified surfaces, stale updates, wrong artists and replaced tracks', () => {
  const registry = new CaptureControl();
  const get = (owner = 'artist', live = true) => registry.get('ROOM', owner, () => live);
  let sequence = 0;
  const update = (surface, captureId = 'track-one') => registry.update('ROOM', 'artist', {
    surface, captureId, sequence: ++sequence,
  });
  for (const surface of [null, 'window', 'browser', undefined]) {
    update(surface);
    assert.equal(get(), undefined);
  }
  update('monitor');
  const first = get();
  assert.equal(first.captureSurface, 'monitor');
  assert.equal(get('someone-else'), undefined);
  assert.equal(get('artist', false), undefined);
  assert.equal(registry.get('OTHER', 'artist', () => true), undefined);
  assert.equal(update('monitor'), false, 'a harmless republish preserves approval');
  assert.equal(get().captureId, first.captureId);
  update('window');
  registry.update('ROOM', 'artist', { surface: 'monitor', captureId: 'track-one', sequence: sequence - 1 });
  assert.equal(get(), undefined, 'late HTTP request cannot restore eligibility');
  update('monitor');
  assert.notEqual(get().captureId, first.captureId, 'resume requires a new grant');
  const resumed = get().captureId;
  update('monitor', 'track-two');
  assert.notEqual(get().captureId, resumed, 'track switching requires a new grant');
  registry.update('ROOM', 'artist', null);
  assert.equal(get(), undefined);
  sequence = 0;
  update('monitor', 'new-page');
  assert.ok(get(), 'a fresh join can restart the sequence');
});

function agent(platform) {
  const screen = desktop();
  const calls = [];
  const statuses = [];
  const requests = [];
  const ipcHandlers = new Map();
  let robotScreenSize = { width: 1920, height: 1080 };
  let consent = async () => ({ response: 0 });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => ({ then() {} });
  const context = createContext({
    __dirname: '', process: { platform },
    console: { log() {}, error() {} },
    require(name) {
      if (name === 'electron') return {
        app, screen, ipcMain: { handle: (event, handler) => ipcHandlers.set(event, handler) },
        dialog: { showMessageBox: () => consent() },
      };
      if (name === './display-control') return {
        ...policy, getDisplayControlState: (s, p, size) => policy.getDisplayControlState(s, platform, size),
      };
      if (name === '@jitsi/robotjs') return {
        getScreenSize: () => robotScreenSize,
        moveMouse: (...args) => calls.push(['move', ...args]),
        mouseClick: (...args) => calls.push(['click', ...args]),
        keyTap: (...args) => calls.push(['key', ...args]),
      };
      return {};
    },
    fakeWindow: { webContents: { send: (...args) => statuses.push(args) } },
    fakeHttp: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    },
  });
  runInContext(mainSource, context);
  runInContext("mainWindow = fakeWindow; httpRequest = fakeHttp; usePolling = true; currentSession = 'ROOM';", context);
  const send = message => context.handleControlMessage(message);
  const grant = (captureId = 'capture-one') => send({
    type: 'control-request', captureSurface: 'monitor', captureId,
  });
  return { screen, calls, statuses, requests, grant, send,
    setRobotScreenSize: size => { robotScreenSize = size; },
    enableFullControl: () => ipcHandlers.get('enable-full-control')(),
    stage: () => runInContext('controlStage', context),
    consent: fn => { consent = fn; },
    allowed: () => runInContext('controlEnabled', context),
  };
}

test('scaled Windows Agent allows only pointer alignment until the artist enables full control', async () => {
  const state = agent('win32');
  state.screen.displays = [{
    id: 1,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    size: { width: 1280, height: 720 },
    scaleFactor: 1.5,
  }];
  state.setRobotScreenSize({ width: 1920, height: 1080 });
  await state.grant();
  assert.equal(state.allowed(), true);
  assert.equal(state.stage(), 'alignment');
  assert.equal(state.requests.at(-1).body.message.mode, 'alignment');

  await state.send({ type: 'mouse-move', x: 640, y: 360, captureSurface: 'monitor', captureId: 'capture-one' });
  await state.send({ type: 'mouse-click', captureSurface: 'monitor', captureId: 'capture-one' });
  await state.send({ type: 'key-press', key: 'a', captureSurface: 'monitor', captureId: 'capture-one' });
  assert.deepEqual(state.calls, [['move', 960, 540]]);

  assert.equal((await state.enableFullControl()).success, true);
  assert.equal(state.stage(), 'full');
  assert.equal(state.requests.at(-1).body.message.mode, 'full');
  await state.send({ type: 'mouse-click', captureSurface: 'monitor', captureId: 'capture-one' });
  assert.deepEqual(state.calls.at(-1), ['click', 'left']);
  await state.send({ type: 'key-press', key: 'Enter', captureSurface: 'monitor', captureId: 'capture-one' });
  assert.deepEqual(structuredClone(state.calls.at(-1)), ['key', 'enter', []]);
  await state.send({ type: 'key-type', text: 'Az', captureSurface: 'monitor', captureId: 'capture-one' });
  assert.deepEqual(structuredClone(state.calls.slice(-2)), [['key', 'a', ['shift']], ['key', 'z']]);
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform}: real input handler cannot control a secondary display or reuse approval after removal`, async () => {
    const state = agent(platform);
    await state.grant();
    assert.equal(state.allowed(), true);
    await state.send({ type: 'mouse-move', x: 1920, y: -50, captureSurface: 'monitor', captureId: 'capture-one' });
    assert.deepEqual(state.calls, [['move', 1919, 0]], 'clamp to the supported desktop, not its neighboring display');
    state.screen.displays.push(display(2, -1920, 0, 2));
    await state.send({ type: 'mouse-click', captureSurface: 'monitor', captureId: 'capture-one' });
    assert.equal(state.allowed(), false);
    assert.equal(state.calls.length, 1);
    state.screen.displays.pop();
    await state.send({ type: 'mouse-click', captureSurface: 'monitor', captureId: 'capture-one' });
    assert.equal(state.calls.length, 1, 'unplugging does not restore an old grant');
    await state.grant('capture-two');
    await state.send({ type: 'mouse-click', captureSurface: 'monitor', captureId: 'capture-one' });
    assert.equal(state.allowed(), false, 'old capture cannot use a new approval');
    assert.equal(state.calls.length, 1);
    assert.ok(state.requests.some(r => r.body.message.allowed === false));
  });

  test(`${platform}: display change or capture stop during the real approval dialog denies input`, async () => {
    const state = agent(platform);
    let resolve;
    state.consent(() => new Promise(done => { resolve = done; }));
    const pending = state.grant();
    state.screen.displays.push(display(2, 1920));
    resolve({ response: 0 });
    await pending;
    assert.equal(state.allowed(), false);
    state.screen.displays.pop();
    const stopped = state.grant();
    await state.send({ type: 'control-end' });
    resolve({ response: 0 });
    await stopped;
    assert.equal(state.allowed(), false);
  });
}

function find(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, node => find(node, predicate));
}

function evaluate(node, scope) {
  const js = ts.transpileModule(`(${node.getText(serverSource)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
}

function signaling() {
  const queueModule = {};
  new Function('exports', ts.transpileModule(
    readFileSync(new URL('../../../server/control-message-queue.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText)(queueModule);
  const received = [];
  const artist = { userId: 'artist', role: 'artist', messages: [], ws: { readyState: 1, send() {} } };
  const engineer = { userId: 'engineer', role: 'engineer', messages: [], ws: { readyState: 1, send() {} } };
  const participants = new Map([['artist', artist], ['engineer', engineer]]);
  const agent = { userId: 'artist', controlEnabled: false, messages: [], ws: {
    readyState: 1, send: text => received.push(JSON.parse(text)),
  } };
  const scope = {
    enqueueControlMessage: queueModule.enqueueControlMessage,
    captureControl: new CaptureControl(),
    rooms: new Map([['ROOM', participants]]),
    pollingRooms: new Map([['ROOM', participants]]),
    pollingAgents: new Map([['ROOM', agent]]),
    agentConnections: new Map([['ROOM', agent]]),
    agentScreenInfo: new Map([['ROOM', { displayControlSupported: true }]]),
    controlPermissions: new Map([['ROOM', true]]),
    controlModes: new Map(),
    shouldDropBufferedMouseMove: (type, bufferedAmount) =>
      type === 'mouse-move' && Number.isFinite(bufferedAmount) && bufferedAmount > 8 * 1024,
    pollingControlMessageTypes: new Set(['control-request', 'control-end', 'mouse-move', 'mouse-click']),
    controlMessageTypes: new Set(['control-request', 'control-end', 'mouse-move', 'mouse-click']),
    wsConnectionData: new WeakMap(),
    WebSocket: { OPEN: 1 }, console: { log() {}, error() {} },
  };
  for (const name of ['liveCapture', 'revokeCaptureControl', 'captureStatus', 'updateCapture']) {
    const node = find(serverSource, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    scope[name] = evaluate(node, scope);
  }
  const post = (path, body) => {
    const route = find(serverSource, n => ts.isCallExpression(n) &&
      n.expression.getText(serverSource) === 'app.post' && n.arguments[0]?.text === path);
    let result;
    const res = { json: value => { result = value; }, status: () => res };
    evaluate(route.arguments[1], scope)({ body }, res);
    return result;
  };
  // Extract the actual dedicated WebSocket control listener, with live membership.
  const controlListener = find(serverSource, n => ts.isArrowFunction(n) &&
    n.parameters[0]?.name.getText(serverSource) === 'data' &&
    n.body.getText(serverSource).includes('controlMessageTypes.has(message.type)'));
  const ws = engineer.ws;
  scope.wsConnectionData.set(ws, { userId: 'engineer', roomId: 'ROOM', role: 'engineer' });
  const wsSend = message => evaluate(controlListener, { ...scope, ws })(JSON.stringify(message));
  return { scope, agent, received, post, wsSend,
    capture: (payload, userId = 'artist') => post('/api/signal/send', {
      roomId: 'ROOM', userId, role: 'artist', type: 'capture-state', payload,
    }),
  };
}

for (const transport of ['WebSocket', 'polling']) {
 for (const agentTransport of ['WebSocket', 'polling']) {
  test(`${transport} browser to ${agentTransport} agent: forwarding requires the artist capture and overrides engineer-supplied identity`, () => {
    const state = signaling();
    if (agentTransport === 'polling') state.scope.agentConnections.clear();
    const send = command => {
      if (transport === 'WebSocket') state.wsSend(command);
      else state.post('/api/signal/send', { roomId: 'ROOM', userId: 'engineer', role: 'engineer',
        type: command.type, payload: command });
    };
    send({ type: 'control-request' });
    assert.equal(state.received.length, 0);
    assert.equal(state.agent.messages.length, 0);
    state.capture({ surface: 'monitor', captureId: 'track-one', sequence: 1 }, 'engineer');
    assert.equal(state.scope.liveCapture('ROOM'), undefined, 'engineer cannot claim an artist screen');
    state.capture({ surface: 'monitor', captureId: 'track-one', sequence: 1 });
    const current = state.scope.liveCapture('ROOM');
    send({ type: 'control-request', captureId: 'forged', captureSurface: 'window' });
    const forwarded = agentTransport === 'WebSocket' ? state.received.at(-1) : state.agent.messages.at(-1);
    assert.equal(forwarded.captureId, current.captureId);
    assert.equal(forwarded.captureSurface, 'monitor');
    const approved = state.post('/api/agent/send', { sessionCode: 'ROOM',
      message: { type: 'control-response', allowed: true, captureId: current.captureId } });
    assert.equal(approved.success, true);
    assert.equal(state.scope.controlPermissions.get('ROOM'), true);
    state.capture({ surface: 'window', sequence: 2 });
    assert.equal(state.scope.controlPermissions.get('ROOM'), false);
    state.post('/api/agent/send', { sessionCode: 'ROOM',
      message: { type: 'control-response', allowed: true, captureId: current.captureId } });
    assert.equal(state.scope.controlPermissions.get('ROOM'), false, 'late approval cannot grant a stopped capture');
    const previous = state.received.length + state.agent.messages.length;
    send({ type: 'mouse-click', captureId: current.captureId });
    assert.equal(state.received.length + state.agent.messages.length, previous);
  });
 }
}

for (const transport of ['WebSocket', 'polling']) {
  test(`${transport} signaling blocks clicks and keys until scaled cursor alignment is confirmed`, () => {
    const state = signaling();
    if (transport === 'polling') state.scope.agentConnections.clear();
    state.capture({ surface: 'monitor', captureId: 'track-one', sequence: 1 });
    state.scope.controlPermissions.set('ROOM', true);
    state.scope.controlModes.set('ROOM', 'alignment');
    const send = type => {
      if (transport === 'WebSocket') state.wsSend({ type });
      else state.post('/api/signal/send', {
        roomId: 'ROOM', userId: 'engineer', role: 'engineer', type, payload: { type },
      });
    };
    const queued = () => state.received.length + state.agent.messages.length;

    const before = queued();
    send('mouse-click');
    send('key-press');
    assert.equal(queued(), before, 'no clicks or keys reach the Agent during alignment');
    send('mouse-move');
    assert.equal(queued(), before + 1, 'pointer movement remains available for the test');

    state.scope.controlModes.set('ROOM', 'full');
    send('mouse-click');
    assert.equal(queued(), before + 2, 'full input starts only after the artist confirms');
  });
}
