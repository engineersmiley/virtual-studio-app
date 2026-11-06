import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import screenInfoModule from '../../../virtual-studio-agent/src/screen-info.js';
import displayControlModule from '../../../virtual-studio-agent/src/display-control.js';

const source = ts.createSourceFile('routes.ts',
  readFileSync(new URL('../../../server/routes.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
function evaluate(node, scope) {
  const js = ts.transpileModule(`(${node.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
}
function harness() {
  const sent = [];
  let revoked = 0;
  const scope = {
    agentScreenInfo: new Map(),
    pollingAgents: new Map([['ROOM', { lastPoll: 0, messages: [], controlEnabled: false }]]),
    remoteControlEnabled: new Map([['ROOM', {}]]),
    rooms: new Map([['ROOM', [{ ws: { readyState: 1, send: value => sent.push(JSON.parse(value)) } }]]]),
    pollingRooms: new Map(),
    revokeCaptureControl() { revoked++; },
    WebSocket: { OPEN: 1 },
    console: { log() {}, error() {} },
  };
  scope.updateAgentScreenInfo = evaluate(find(source, n => ts.isFunctionDeclaration(n) &&
    n.name?.text === 'updateAgentScreenInfo'), scope);
  const route = find(source, n => ts.isCallExpression(n) &&
    n.expression.getText(source) === 'app.post' && n.arguments[0]?.text === '/api/agent/poll');
  const handler = evaluate(route.arguments[1], scope);
  return {
    scope, sent,
    revoked: () => revoked,
    poll(screenInfo) {
      let status = 200, body;
      const res = {
        status(code) { status = code; return this; },
        json(value) { body = value; return this; },
      };
      handler({ body: { sessionCode: 'room', screenInfo } }, res);
      return { status, body };
    },
  };
}
const supported = {
  screenWidth: 1280, screenHeight: 720, scaleFactor: 1.5,
  displayControlSupported: true, displayControlReason: null,
  controlCalibrationRequired: true, agentVersion: '1.20.3',
};

test('active heartbeat replaces incomplete compatibility without granting control', () => {
  const h = harness();
  h.scope.agentScreenInfo.set('ROOM', {
    screenWidth: 1280, screenHeight: 720, scaleFactor: 1.5,
    displayControlSupported: false, displayControlReason: null,
    controlCalibrationRequired: false,
  });
  assert.equal(h.poll(supported).status, 200);
  assert.deepEqual(h.scope.agentScreenInfo.get('ROOM'), supported);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'agent-screen-info');
  assert.equal(h.scope.pollingAgents.get('ROOM').controlEnabled, false);
  assert.equal(h.revoked(), 0);
  h.poll(supported);
  assert.equal(h.sent.length, 1, 'unchanged heartbeat does not broadcast or reset consent');
});

test('missing or malformed compatibility never enables input', () => {
  const h = harness();
  h.poll();
  assert.equal(h.scope.agentScreenInfo.size, 0);
  h.poll({ ...supported, screenWidth: NaN });
  assert.equal(h.scope.agentScreenInfo.size, 0);
  h.poll({ screenWidth: 1280, screenHeight: 720, agentVersion: '1.20.3' });
  assert.equal(h.scope.agentScreenInfo.get('ROOM').displayControlSupported, false);
  assert.equal(h.revoked(), 1);
});

test('unregistered or disabled Agent heartbeat cannot write compatibility', () => {
  for (const map of ['pollingAgents', 'remoteControlEnabled']) {
    const h = harness();
    h.scope[map].clear();
    assert.ok(h.poll(supported).status >= 400);
    assert.equal(h.scope.agentScreenInfo.size, 0);
  }
});

test('lost server geometry is restored by next heartbeat and explicit rejection revokes control', () => {
  const h = harness();
  h.poll(supported);
  h.scope.agentScreenInfo.clear();
  h.poll(supported);
  assert.equal(h.scope.agentScreenInfo.get('ROOM').agentVersion, '1.20.3');
  h.poll({ ...supported, displayControlSupported: false, displayControlReason: 'Display changed' });
  assert.equal(h.revoked(), 1);
  assert.equal(h.sent.at(-1).displayControlReason, 'Display changed');
});

test('scaled Windows heartbeat uses verified native dimensions, never inferred compatibility', () => {
  const display = { id: 1, bounds: { x: 0, y: 0 }, size: { width: 1280, height: 720 }, scaleFactor: 1.5 };
  const screen = { getPrimaryDisplay: () => display, getAllDisplays: () => [display] };
  const read = native => screenInfoModule.readScreenInfo({
    screen,
    getControlState: () => displayControlModule.getDisplayControlState(screen, 'win32', native),
  });
  assert.deepEqual(read({ width: 1920, height: 1080 }), {
    screenWidth: 1280, screenHeight: 720, scaleFactor: 1.5,
    displayControlSupported: true, displayControlReason: null, controlCalibrationRequired: true,
  });
  assert.equal(read(null).displayControlSupported, false);
  assert.ok(read(null).displayControlReason);
});
