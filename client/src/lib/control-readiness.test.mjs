import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('routes.ts',
  readFileSync(new URL('../../../server/routes.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const find = (node, predicate) => predicate(node) ? node :
  ts.forEachChild(node, child => find(child, predicate));
const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const registry = {};
new Function('exports', compile(readFileSync(
  new URL('../../../server/capture-control.ts', import.meta.url), 'utf8')))(registry);

function harness(artistTransport, viewerTransport) {
  const scope = {
    rooms: new Map([['ROOM', new Map()]]),
    pollingRooms: new Map([['ROOM', new Map()]]),
    agentConnections: new Map(), pollingAgents: new Map(),
    remoteControlEnabled: new Map([['ROOM', { artistUserId: 'artist' }]]),
    controlPermissions: new Map(), controlModes: new Map(),
    captureControl: new registry.CaptureControl(),
    WebSocket: { OPEN: 1 }, URL,
    agentTokens: new Map([['fixture-token', {
      sessionCode: 'ROOM', userId: 'artist', expiresAt: Date.now() + 60_000,
    }]]),
    console: { log() {}, error() {} },
  };
  const evaluate = node => new Function(...Object.keys(scope),
    `return (${compile(`(${node.getText(source)})`).trim().replace(/;$/, '')})`)(...Object.values(scope));
  for (const name of ['liveCapture', 'captureStatus', 'revokeCaptureControl', 'broadcastCaptureStatus', 'updateCapture']) {
    scope[name] = evaluate(find(source, n => ts.isFunctionDeclaration(n) && n.name?.text === name));
  }
  const messages = [];
  const add = (transport, userId, role) => {
    if (transport === 'ws') {
      scope.rooms.get('ROOM').set(userId, {
        role, ws: { readyState: 1, send: json => {
          if (userId === 'engineer') messages.push(JSON.parse(json));
        } },
      });
    } else {
      scope.pollingRooms.get('ROOM').set(userId, { role, messages: userId === 'engineer' ? messages : [] });
    }
  };
  add(artistTransport, 'artist', 'artist');
  add(viewerTransport, 'engineer', 'engineer');
  return {
    scope, messages,
    capture(surface = 'monitor', owner = 'artist') {
      scope.updateCapture('ROOM', owner, { surface, captureId: 'track-one', sequence: 1 });
    },
    connect(kind) {
      if (kind === 'websocket') {
        const connection = find(source, n => ts.isCallExpression(n) &&
          n.expression.getText(source) === 'agentWss.on' && n.arguments[0]?.text === 'connection');
        evaluate(connection.arguments[1])({
          readyState: 1, on() {}, send() {},
          close() { throw new Error('valid fixture was rejected'); },
        }, { url: '/agent?session=ROOM&token=fixture-token', headers: { host: 'example.test' } });
      } else {
        const path = kind === 'simple' ? '/api/agent/simple-connect' : '/api/agent/connect';
        const route = find(source, n => ts.isCallExpression(n) &&
          n.expression.getText(source) === 'app.post' && n.arguments[0]?.text === path);
        let status = 200;
        evaluate(route.arguments[1])({ body: { sessionCode: 'ROOM', token: 'fixture-token' } }, {
          status(code) { status = code; return this; }, json() {},
        });
        assert.equal(status, 200);
      }
    },
  };
}

for (const artist of ['ws', 'poll']) {
  for (const engineer of ['ws', 'poll']) {
    for (const agent of ['simple', 'token', 'websocket']) {
      test(`existing ${engineer} engineer receives capture eligibility when ${agent} Agent joins after ${artist} artist shares`, () => {
        const h = harness(artist, engineer);
        h.capture();
        assert.equal(h.messages.at(-1).supported, false, 'no Agent owner before registration');
        h.messages.length = 0;
        h.connect(agent);
        const statuses = h.messages.filter(message => message.type === 'capture-status');
        assert.equal(statuses.length, 1);
        assert.equal(statuses[0].supported, true, 'existing capture becomes eligible without another share event');
        assert.notEqual(h.scope.controlPermissions.get('ROOM'), true, 'eligibility must not grant consent');
        const registered = h.scope.pollingAgents.get('ROOM') || h.scope.agentConnections.get('ROOM');
        assert.equal(registered.controlEnabled, false);
      });
    }
  }
}

for (const surface of ['window', 'browser', null, undefined]) {
  test(`Agent registration cannot make a ${String(surface)} capture controllable`, () => {
    const h = harness('ws', 'poll');
    if (surface !== undefined) h.capture(surface);
    h.messages.length = 0;
    h.connect('simple');
    assert.equal(h.messages.find(message => message.type === 'capture-status').supported, false);
  });
}

test('Agent registration does not authorize another artist’s capture', () => {
  const h = harness('poll', 'ws');
  h.capture('monitor', 'different-artist');
  h.connect('simple');
  assert.equal(h.messages.filter(message => message.type === 'capture-status').at(-1).supported, false);
});
