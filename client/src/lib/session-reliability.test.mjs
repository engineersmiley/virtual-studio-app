import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, scope = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { exports: {}, console: { log() {}, error() {} }, ...scope };
  vm.runInNewContext(js, context);
  return context.exports;
}

test('signaling keepalive prevents idle sockets without retaining dead connections', () => {
  let tick, cleared = false;
  const server = new EventEmitter();
  server.clients = new Set();
  const { startSocketKeepalive } = load('../../../server/socket-keepalive.ts', {
    setInterval(fn, delay) { tick = fn; assert.equal(delay, 25000); return { unref() {} }; },
    clearInterval() { cleared = true; },
  });
  startSocketKeepalive(server);
  const socket = new EventEmitter();
  Object.assign(socket, { readyState: 1, pings: 0, dead: false,
    ping() { this.pings++; }, terminate() { this.dead = true; } });
  server.clients.add(socket);
  server.emit('connection', socket);
  for (let i = 0; i < 1000; i++) { tick(); socket.emit('pong'); }
  assert.equal(socket.pings, 1000, 'a live room has no elapsed-runtime cap');
  assert.equal(socket.dead, false);
  tick(); tick();
  assert.equal(socket.dead, true);
  server.emit('close');
  assert.equal(cleared, true);
});

test('mouse queue replaces stale moves but preserves click and grant boundaries', () => {
  const { enqueueControlMessage } = load('../../../server/control-message-queue.ts');
  const queue = [];
  const move = (x, captureId = 'A') => ({ type: 'mouse-move', x, y: 20,
    captureId, verifiedUserId: 'engineer', sessionCode: 'ROOM' });
  for (let x = 0; x < 100; x++) enqueueControlMessage(queue, move(x));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].x, 99);
  enqueueControlMessage(queue, { type: 'mouse-click' });
  enqueueControlMessage(queue, move(100));
  enqueueControlMessage(queue, move(101, 'B'));
  enqueueControlMessage(queue, { type: 'control-end' });
  assert.deepEqual(queue.map(m => m.type),
    ['mouse-move', 'mouse-click', 'mouse-move', 'mouse-move', 'control-end']);
  assert.equal(queue[2].captureId, 'A');
});

function pollingHarness(fetch) {
  const timers = new Map();
  let next = 0;
  const { PollingTransport } = load('./polling-transport.ts', {
    fetch, AbortController, ErrorEvent: class {},
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 123; }, clearInterval() {},
  });
  const transport = new PollingTransport();
  transport._readyState = 1;
  const messages = [];
  transport.onmessage = event => messages.push(JSON.parse(event.data));
  return { transport, timers, messages };
}
const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

test('a temporary polling join failure retries and explicit close cancels recovery', async () => {
  let calls = 0;
  const h = pollingHarness(async () => {
    calls++;
    return json(503, {});
  });
  await h.transport.handleJoin({ roomId: 'ROOM', userId: 'artist', role: 'artist' });
  assert.equal(calls, 1);
  assert.ok([...h.timers.values()].some(t => t.delay === 2000));
  h.transport.close();
  assert.equal([...h.timers.values()].some(t => t.delay === 2000), false);
});

test('expired polling membership rejoins the same room instead of ending it', async () => {
  const calls = [];
  const h = pollingHarness(async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return path.endsWith('/poll') ? json(404, { error: 'Not in room' })
      : json(200, { roomId: 'ROOM', participants: [] });
  });
  Object.assign(h.transport, { roomId: 'ROOM', userId: 'artist', role: 'artist' });
  await h.transport.poll();
  assert.equal(h.transport.readyState, 1);
  assert.equal(calls[1][0], '/api/signal/join');
  assert.equal(calls[1][1].roomId, 'ROOM');
  assert.equal(h.messages[0].controlActive, false, 'never retain consent across reconnect');
  assert.equal(h.messages[1].type, 'room-state');
});

test('a hung poll is aborted so later polls can renew the lease', async () => {
  let calls = 0;
  const h = pollingHarness((_path, options) => {
    calls++;
    return calls > 1 ? Promise.resolve(json(200, { messages: [] })) :
      new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  Object.assign(h.transport, { roomId: 'ROOM', userId: 'artist', role: 'artist' });
  const poll = h.transport.poll();
  [...h.timers.values()].find(t => t.delay === 10000).fn();
  await poll;
  await h.transport.poll();
  assert.equal(calls, 2);
});

test('closing during a slow poll cannot rejoin a room or restore control', async () => {
  let complete;
  const h = pollingHarness(path => path.endsWith('/poll')
    ? new Promise(resolve => { complete = resolve; })
    : Promise.resolve(json(200, {})));
  Object.assign(h.transport, { roomId: 'ROOM', userId: 'artist', role: 'artist' });
  const poll = h.transport.poll();
  h.transport.close();
  complete(json(404, {}));
  await poll;
  assert.equal(h.transport.readyState, 3);
  assert.equal(h.messages.length, 0);
});
