import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {
  isSyntheticClickAfterTouch,
  mapVideoPointToScreen,
  REMOTE_TOUCH_TAP_MAX_DURATION_MS,
  REMOTE_TOUCH_TAP_SLOP_PX,
} from './remote-control-video.js';
import { remoteControlHarness } from './test-support/remote-control-harness.mjs';

// Execute the real callbacks wired to the inline video, without a WebRTC session.
const source = ts.createSourceFile(
  'Session.tsx',
  readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);
const callbacks = new Map();
let video;
let container;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text.startsWith('handleVideoTouch') && ts.isCallExpression(node.initializer)) {
    callbacks.set(node.name.text, node.initializer.arguments[0]);
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'video' &&
      node.attributes.properties.some((attribute) =>
        attribute.name?.getText(source) === 'ref' &&
        attribute.initializer?.expression?.getText(source) === 'remoteVideoRef')) {
    video = node;
  }
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some((attribute) =>
      attribute.name?.getText(source) === 'ref' &&
      attribute.initializer?.expression?.getText(source) === 'videoContainerRef')) {
    container = node;
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(video, 'inline remote video must exist');
assert.ok(container, 'inline video container must exist');

function setup({ controlEnabled = true, videoPresent = true, remote } = {}) {
  const commands = remote?.commands ?? [];
  const touchStartRef = { current: null };
  const lastRemoteVideoTouchTimeRef = { current: 0 };
  const lastMouseMoveRef = { current: 0 };
  let now = 1_000;
  const remoteVideoRef = { current: videoPresent ? {
    isConnected: true,
    videoWidth: 1920, videoHeight: 1080,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
  } : null };
  const scope = {
    role: 'engineer', controlEnabled, touchStartRef, lastRemoteVideoTouchTimeRef,
    virtualCursorRef: { current: { x: 960, y: 540 } },
    hasRemoteStream: true, controlMode: false,
    remoteVideoRef,
    agentScreenSize: { width: 1920, height: 1080 },
    sendFullControlCommand: remote?.api.sendFullControlCommand ?? ((command) => commands.push(command)),
    queueFullControlClick: remote?.api.queueFullControlClick ??
      (() => commands.push({ type: 'mouse-click', button: 'left' })),
    sendControlEvent: () => assert.fail('unexpected pointer-only command'),
    mapVideoPointToScreen, isSyntheticClickAfterTouch, TOUCH_DELAY_MS: 500,
    REMOTE_TOUCH_TAP_SLOP_PX, REMOTE_TOUCH_TAP_MAX_DURATION_MS,
    Date: { now: () => now },
    setTimeout: (callback) => callback(),
  };
  const handlers = {};
  const containerClick = container.attributes.properties.find((attribute) =>
    attribute.name?.getText(source) === 'onClick');
  for (const attribute of [...video.attributes.properties, containerClick]) {
    const name = attribute.name?.getText(source);
    if (!['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel', 'onClick'].includes(name)) continue;
    const expression = attribute.initializer.expression;
    const callback = ts.isIdentifier(expression) ? callbacks.get(expression.text) : expression;
    assert.ok(callback, `${name} must resolve to a real handler`);
    const js = ts.transpileModule(`(${callback.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    handlers[attribute === containerClick ? 'containerClick' : name] =
      new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
  }
  for (const name of ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel', 'onClick']) {
    assert.equal(typeof handlers[name], 'function', `${name} must be wired to the inline video`);
  }
  const point = (x = 100, y = 200, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  const event = (touches = [point()], changedTouches = [point()]) => ({
    touches, changedTouches, preventDefault() {}, stopPropagation() {},
  });
  return {
    commands, handlers, point, event, touchStartRef, remoteVideoRef, lastMouseMoveRef,
    advance: (ms) => { now += ms; },
    syntheticClick: (target = 'onClick') => {
      now += 100;
      handlers[target]({ ...event(), clientX: 102, clientY: 203 });
    },
  };
}

const clickCount = (commands) => commands.filter((command) => command.type === 'mouse-click').length;

test('inline short tap clicks exactly once, including its synthetic browser click', () => {
  const { commands, handlers, event, point, advance, syntheticClick, touchStartRef } = setup();
  handlers.onTouchStart(event());
  advance(100);
  handlers.onTouchEnd(event([], [point(102, 203)]));
  syntheticClick();
  assert.deepEqual(commands, [
    { type: 'mouse-move', x: 102, y: 203 },
    { type: 'mouse-click', button: 'left' },
  ]);
  assert.equal(touchStartRef.current, null);
  handlers.onTouchEnd(event([]));
  assert.equal(clickCount(commands), 1, 'duplicate end cannot click again');
});

test('inline drags returning to their origin send both movement samples without clicking', () => {
  const { commands, handlers, event, point, syntheticClick } = setup();
  handlers.onTouchStart(event());
  handlers.onTouchMove(event([point(130, 200)]));
  handlers.onTouchMove(event());
  handlers.onTouchEnd(event([]));
  syntheticClick();
  assert.equal(clickCount(commands), 0);
  assert.equal(commands.filter(command => command.type === 'mouse-move').length, 2);
});

test('inline tap distance and duration limits still reject drags and long presses', () => {
  for (const [distance, duration] of [[24, 0], [0, 600], [100, 100]]) {
    const { commands, handlers, event, point, advance, syntheticClick } = setup();
    handlers.onTouchStart(event());
    advance(duration);
    handlers.onTouchEnd(event([], [point(100 + distance, 200)]));
    syntheticClick();
    assert.deepEqual(commands, []);
  }
});

test('inline tap tolerates small finger drift without turning a clear drag into a click', () => {
  const { commands, handlers, event, point, advance } = setup();
  handlers.onTouchStart(event());
  handlers.onTouchMove(event([point(118, 210)]));
  advance(100);
  handlers.onTouchEnd(event([], [point(118, 210)]));
  assert.equal(clickCount(commands), 1);
});

test('inline cancellation clears state, blocks synthetic clicks, and permits a fresh tap', () => {
  const { commands, handlers, event, syntheticClick, touchStartRef } = setup();
  handlers.onTouchStart(event());
  handlers.onTouchCancel();
  assert.equal(touchStartRef.current, null);
  syntheticClick();
  handlers.onTouchMove(event());
  handlers.onTouchEnd(event([]));
  assert.deepEqual(commands, []);
  handlers.onTouchStart(event());
  handlers.onTouchEnd(event([]));
  assert.equal(clickCount(commands), 1);
});

test('inline multi-finger gestures stay rejected after fingers lift', () => {
  for (const phase of ['start', 'move', 'end']) {
    const { commands, handlers, event, point, syntheticClick, touchStartRef } = setup();
    const multiple = [point(), point(300, 400, 2)];
    handlers.onTouchStart(event());
    if (phase === 'start') handlers.onTouchStart(event(multiple));
    if (phase === 'move') handlers.onTouchMove(event(multiple));
    handlers.onTouchEnd(event(phase === 'end' ? [point(300, 400, 2)] : []));
    assert.equal(touchStartRef.current, null);
    handlers.onTouchMove(event([point(300, 400, 2)]));
    handlers.onTouchEnd(event([], [point(300, 400, 2)]));
    syntheticClick();
    assert.deepEqual(commands, []);
    handlers.onTouchStart(event());
    handlers.onTouchEnd(event([]));
    assert.equal(clickCount(commands), 1, `${phase}: next single-finger tap works`);
  }
});

test('inline malformed, missing, and replaced touches cannot reuse stale state', () => {
  for (const phase of ['start', 'move', 'end', 'replacement-move', 'replacement-end', 'multiple-end']) {
    const { commands, handlers, event, point, touchStartRef } = setup();
    handlers.onTouchStart(event());
    if (phase === 'start') handlers.onTouchStart(event([]));
    if (phase === 'move') handlers.onTouchMove(event([]));
    if (phase === 'replacement-move') handlers.onTouchMove(event([point(100, 200, 2)]));
    const changed = phase === 'end' ? [] :
      phase === 'replacement-end' ? [point(100, 200, 2)] :
      phase === 'multiple-end' ? [point(), point(300, 400, 2)] : [point()];
    handlers.onTouchEnd(event([], changed));
    assert.equal(touchStartRef.current, null);
    handlers.onTouchEnd(event([]));
    assert.deepEqual(commands, [], phase);
  }
});

test('inline disabled control or missing video never leaves a pending tap', () => {
  for (const options of [{ controlEnabled: false }, { videoPresent: false }]) {
    const { commands, handlers, event, touchStartRef } = setup(options);
    handlers.onTouchStart(event());
    handlers.onTouchMove(event());
    handlers.onTouchEnd(event([]));
    assert.equal(touchStartRef.current, null);
    assert.deepEqual(commands, []);
  }
});

test('post-gesture clicks targeting the surrounding container cannot click remotely', () => {
  for (const gesture of ['tap', 'drag', 'cancel', 'multiple']) {
    const { commands, handlers, event, point, syntheticClick } = setup();
    handlers.onTouchStart(event());
    if (gesture === 'drag') {
      handlers.onTouchMove(event([point(200, 300)]));
      handlers.onTouchMove(event());
    }
    if (gesture === 'cancel') handlers.onTouchCancel();
    if (gesture === 'multiple') handlers.onTouchStart(event([point(), point(300, 400, 2)]));
    if (gesture !== 'cancel') handlers.onTouchEnd(event([]));
    syntheticClick('containerClick');
    assert.equal(clickCount(commands), gesture === 'tap' ? 1 : 0, gesture);
  }
});

test('container desktop clicks still work before touches and after the suppression window', () => {
  const { commands, handlers, event, advance } = setup();
  const click = { ...event(), clientX: 102, clientY: 203 };
  handlers.containerClick(click);
  assert.deepEqual(commands, [
    { type: 'mouse-move', x: 102, y: 203 },
    { type: 'mouse-click', button: 'left' },
  ]);
  handlers.onTouchStart(event());
  handlers.onTouchCancel();
  advance(500);
  handlers.containerClick(click);
  assert.equal(clickCount(commands), 2);
});

for (const input of ['tap', 'onClick', 'containerClick']) {
  function queue(state) {
    if (input === 'tap') {
      state.handlers.onTouchStart(state.event());
      state.handlers.onTouchEnd(state.event([]));
    } else {
      state.handlers[input]({ ...state.event(), clientX: 100, clientY: 200 });
    }
  }

  test(`inline ${input} moves immediately and clicks once after 50ms`, () => {
    const remote = remoteControlHarness();
    const state = setup({ remote });
    queue(state);
    assert.equal(remote.commands.length, 1);
    assert.equal(remote.commands[0].type, 'mouse-move');
    remote.advance(49);
    assert.equal(clickCount(remote.commands), 0);
    remote.advance(1);
    assert.equal(clickCount(remote.commands), 1);
    remote.advance(100);
    assert.equal(clickCount(remote.commands), 1);
    assert.equal(remote.pending, 0);
  });

  for (const boundary of ['revoke', 'deny', 'agent-disconnect', 'poll-revoke', 'end', 'disconnect',
    'transport-close', 'reconnect', 'unmount', 'view-unmount', 'view-detach']) {
    test(`inline ${input} cancels a pending click on ${boundary}`, () => {
      const remote = remoteControlHarness();
      const state = setup({ remote });
      queue(state);
      remote.advance(25);
      if (boundary === 'revoke') remote.message({ type: 'control-stopped' });
      if (boundary === 'deny') remote.message({ type: 'control-response', allowed: false });
      if (boundary === 'agent-disconnect') remote.message({ type: 'agent-disconnected' });
      if (boundary === 'poll-revoke') remote.message({ type: 'agent-status', connected: true, controlActive: false });
      if (boundary === 'end') remote.api.endFullControl();
      if (boundary === 'disconnect') remote.api.disconnect();
      if (boundary === 'transport-close') remote.close();
      if (boundary === 'reconnect') remote.reconnect();
      if (boundary === 'unmount') remote.unmount();
      if (boundary === 'view-unmount') remote.unmountView();
      if (boundary === 'view-detach') state.remoteVideoRef.current.isConnected = false;
      if (boundary !== 'view-detach') assert.equal(remote.pending, 0, 'cancel the timer, not just its send');
      // Re-grant before the original timer expires: old input must not cross grants.
      if (['revoke', 'deny', 'agent-disconnect', 'poll-revoke', 'end', 'reconnect'].includes(boundary)) remote.grant();
      remote.advance(100);
      assert.equal(clickCount(remote.commands), 0);
      assert.equal(remote.pending, 0);
    });
  }
}
