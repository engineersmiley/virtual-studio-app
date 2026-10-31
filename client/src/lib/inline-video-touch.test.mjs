import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isSyntheticClickAfterTouch, mapVideoPointToScreen } from './remote-control-video.js';

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

function setup({ controlEnabled = true, videoPresent = true } = {}) {
  const commands = [];
  const touchStartRef = { current: null };
  const lastRemoteVideoTouchTimeRef = { current: 0 };
  const lastMouseMoveRef = { current: 0 };
  let now = 1_000;
  const remoteVideoRef = { current: videoPresent ? {
    videoWidth: 1920, videoHeight: 1080,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
  } : null };
  const scope = {
    role: 'engineer', controlEnabled, touchStartRef, lastRemoteVideoTouchTimeRef,
    virtualCursorRef: { current: { x: 960, y: 540 } },
    hasRemoteStream: true, controlMode: false,
    lastMouseMoveRef, MOUSE_THROTTLE_MS: 16, remoteVideoRef,
    agentScreenSize: { width: 1920, height: 1080 },
    sendFullControlCommand: (command) => commands.push(command),
    sendControlEvent: () => assert.fail('unexpected pointer-only command'),
    mapVideoPointToScreen, isSyntheticClickAfterTouch, TOUCH_DELAY_MS: 500,
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

test('inline drags returning to their origin never click, even with throttled moves', () => {
  for (const throttled of [false, true]) {
    const { commands, handlers, event, point, lastMouseMoveRef, syntheticClick } = setup();
    handlers.onTouchStart(event());
    if (throttled) lastMouseMoveRef.current = 1_000;
    handlers.onTouchMove(event([point(115, 200)]));
    handlers.onTouchMove(event());
    handlers.onTouchEnd(event([]));
    syntheticClick();
    assert.equal(clickCount(commands), 0);
    assert.equal(commands.length, throttled ? 0 : 1);
  }
});

test('inline tap distance and duration limits still reject drags and long presses', () => {
  for (const [distance, duration] of [[15, 0], [0, 400], [100, 100]]) {
    const { commands, handlers, event, point, advance, syntheticClick } = setup();
    handlers.onTouchStart(event());
    advance(duration);
    handlers.onTouchEnd(event([], [point(100 + distance, 200)]));
    syntheticClick();
    assert.deepEqual(commands, []);
  }
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
