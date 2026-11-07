import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const helpers = {};
new Function('exports', ts.transpileModule(
  readFileSync(new URL('../../../server/signaling-room.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText)(helpers);
const source = ts.createSourceFile('routes.ts',
  readFileSync(new URL('../../../server/routes.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const find = (node, predicate) => predicate(node) ? node :
  ts.forEachChild(node, child => find(child, predicate));
const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const captures = [];
  const scope = {
    ...helpers,
    rooms: new Map(), pollingRooms: new Map(),
    agentConnections: new Map(), pollingAgents: new Map(), agentScreenInfo: new Map(),
    controlPermissions: new Map(), controlModes: new Map(), pollingControlMessageTypes: new Set(),
    captureStatus: () => ({ type: 'capture-status', supported: false }),
    updateCapture: (...args) => captures.push(args),
    wsConnectionData: new WeakMap(), WebSocket: { OPEN: 1 },
    POLL_TIMEOUT: 120000, console: { log() {}, error() {} },
  };
  const post = (path, body) => {
    const route = find(source, n => ts.isCallExpression(n) &&
      n.expression.getText(source) === 'app.post' && n.arguments[0]?.text === path);
    const handler = new Function(...Object.keys(scope),
      `return (${compile(`(${route.arguments[1].getText(source)})`).trim().replace(/;$/, '')})`)(...Object.values(scope));
    let status = 200, data;
    const res = {
      status(value) { status = value; return this; },
      json(value) { data = value; return this; },
    };
    handler({ body }, res);
    return { status, data };
  };
  const branch = name => find(source, n => ts.isCaseClause(n) && n.expression.text === name).statements[0];
  const join = new Function(...Object.keys(scope), 'ws', 'roomId', 'userId', 'role',
    `let currentRoom = null, currentUserId = null; ${compile(branch('join').getText(source).replace(/\bbreak;/, ''))}`);
  const signal = new Function(...Object.keys(scope), 'currentRoom', 'currentUserId', 'type', 'payload',
    compile(branch('ice-candidate').getText(source).replace(/\bbreak;/, 'return;')));
  return {
    scope, captures, post,
    join(transport, userId, role, roomId = 'ROOM') {
      const messages = [];
      if (transport === 'ws') {
        const ws = { readyState: 1, send: data => messages.push(JSON.parse(data)) };
        join(...Object.values(scope), ws, roomId, userId, role);
      } else {
        const response = post('/api/signal/join', { roomId, userId, role });
        assert.equal(response.status, 200);
        messages.push({ type: 'room-state', participants: response.data.participants });
      }
      return {
        receive() {
          if (transport === 'poll') {
            const { data } = post('/api/signal/poll', { roomId, userId });
            messages.push(...data.messages);
          }
          return messages.splice(0);
        },
        send(type, payload) {
          if (transport === 'ws') signal(...Object.values(scope), roomId, userId, type, payload);
          else return post('/api/signal/send', { roomId, userId, role, type, payload });
        },
      };
    },
    expire() {
      const timer = find(source, n => ts.isCallExpression(n) &&
        n.expression.getText(source) === 'setInterval' &&
        n.arguments[0]?.getText(source).includes('now - participant.lastPoll > POLL_TIMEOUT'));
      new Function(...Object.keys(scope), `return (${timer.arguments[0].getText(source)})`)(
        ...Object.values(scope))();
    },
  };
}

for (const artistTransport of ['ws', 'poll']) {
  for (const engineerTransport of ['ws', 'poll']) {
    test(`${artistTransport} artist and ${engineerTransport} engineer see each other and exchange offer, answer and ICE`, () => {
      const h = harness();
      const artist = h.join(artistTransport, 'artist', 'artist');
      artist.receive();
      const engineer = h.join(engineerTransport, 'engineer', 'engineer');
      assert.deepEqual(engineer.receive().find(m => m.type === 'room-state').participants,
        [{ userId: 'artist', role: 'artist' }]);
      assert.equal(artist.receive().filter(m => m.type === 'user-joined' && m.userId === 'engineer').length, 1);
      for (const [from, to, fromId, toId, type] of [
        [artist, engineer, 'artist', 'engineer', 'offer'],
        [engineer, artist, 'engineer', 'artist', 'answer'],
        [artist, engineer, 'artist', 'engineer', 'ice-candidate'],
        [engineer, artist, 'engineer', 'artist', 'ice-candidate'],
      ]) {
        const payload = { targetUserId: toId, sdp: 'synthetic-description', candidate: 'synthetic-candidate' };
        from.send(type, payload);
        assert.deepEqual(to.receive().filter(m => m.type === type)
          .map(({ type, userId, payload }) => ({ type, userId, payload })),
        [{ type, userId: fromId, payload }]);
      }
      if (engineerTransport === 'poll') {
        assert.deepEqual(h.post('/api/signal/poll', { roomId: 'ROOM', userId: 'engineer' }).data.participants,
          [{ userId: 'artist', role: 'artist' }]);
      }
    });
  }
}

test('targeted signals never broadcast when the target is absent or in another room', () => {
  const h = harness();
  const artist = h.join('poll', 'artist', 'artist');
  const observer = h.join('ws', 'observer', 'other');
  const stranger = h.join('ws', 'stranger', 'engineer', 'OTHER');
  artist.receive(); observer.receive(); stranger.receive();
  artist.send('offer', { targetUserId: 'stranger', sdp: 'private-description' });
  assert.deepEqual(observer.receive(), []);
  assert.deepEqual(stranger.receive(), []);
});

test('polling leave notifies WebSocket viewers and revokes artist capture', () => {
  const h = harness();
  h.join('poll', 'artist', 'artist');
  const engineer = h.join('ws', 'engineer', 'engineer');
  engineer.receive();
  h.post('/api/signal/leave', { roomId: 'ROOM', userId: 'artist' });
  assert.deepEqual(engineer.receive(), [{ type: 'user-left', userId: 'artist', roomId: 'ROOM' }]);
  assert.deepEqual(h.captures.at(-1), ['ROOM', 'artist', null]);
});

test('stale polling entry is removed by its room key and departure reaches WebSocket viewers', () => {
  const h = harness();
  h.join('poll', 'artist', 'artist');
  const engineer = h.join('ws', 'engineer', 'engineer');
  engineer.receive();
  h.scope.pollingRooms.get('ROOM').get('artist').lastPoll = 0;
  h.expire();
  assert.equal(h.scope.pollingRooms.has('ROOM'), false);
  assert.equal(engineer.receive()[0].type, 'user-left');
});

test('switching from polling to WebSocket does not falsely revoke capture or announce departure', () => {
  const h = harness();
  h.join('poll', 'artist', 'artist');
  h.join('ws', 'artist', 'artist');
  const engineer = h.join('ws', 'engineer', 'engineer');
  engineer.receive();
  const before = h.captures.length;
  h.post('/api/signal/leave', { roomId: 'ROOM', userId: 'artist' });
  assert.equal(h.captures.length, before);
  assert.deepEqual(engineer.receive(), []);
});

test('participant list deduplicates a transport switch and excludes closed sockets', () => {
  const sockets = new Map([
    ['artist', { role: 'artist', ws: { readyState: 1 } }],
    ['closed', { role: 'other', ws: { readyState: 3 } }],
  ]);
  const polling = new Map([['artist', { role: 'artist' }]]);
  assert.deepEqual(helpers.listRoomParticipants(sockets, polling, 'engineer'),
    [{ userId: 'artist', role: 'artist' }]);
});
