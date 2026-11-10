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

// Run the real fullscreen JSX handlers without mounting a WebRTC session.
const source = ts.createSourceFile(
  'Session.tsx',
  readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let video;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'video' &&
      node.attributes.properties.some((attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'ref' &&
        attribute.initializer?.expression?.getText(source) === 'fullscreenVideoRef')) {
    video = node;
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(video, 'fullscreen video must exist');

function setup({ role = 'engineer', controlEnabled = true, remote } = {}) {
  const commands = remote?.commands ?? [];
  const fullscreenTouchRef = { current: null };
  const lastRemoteVideoTouchTimeRef = { current: 0 };
  let now = 1_000;
  const scope = {
    role, controlEnabled, fullscreenTouchRef, lastRemoteVideoTouchTimeRef,
    virtualCursorRef: { current: { x: 960, y: 540 } },
    agentScreenSize: { width: 1920, height: 1080 },
    sendFullControlCommand: remote?.api.sendFullControlCommand ?? ((command) => commands.push(command)),
    queueFullControlClick: remote?.api.queueFullControlClick ??
      (() => commands.push({ type: 'mouse-click', button: 'left' })),
    mapVideoPointToScreen, isSyntheticClickAfterTouch, TOUCH_DELAY_MS: 500,
    REMOTE_TOUCH_TAP_SLOP_PX, REMOTE_TOUCH_TAP_MAX_DURATION_MS,
    Date: { now: () => now },
    setTimeout: (callback) => callback(),
  };
  const handlers = {};
  for (const attribute of video.attributes.properties) {
    const name = attribute.name?.getText(source);
    if (!['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel', 'onClick'].includes(name)) continue;
    const js = ts.transpileModule(`(${attribute.initializer.expression.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    handlers[name] = new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
  }
  const point = (x, y) => ({ clientX: x, clientY: y });
  const event = (x, y, ended = false) => ({
    touches: ended ? [] : [point(x, y)],
    changedTouches: [point(x, y)],
    preventDefault() {},
    currentTarget: {
      isConnected: true,
      videoWidth: 1920, videoHeight: 1080,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
    },
  });
  return {
    commands, handlers, event,
    advance: (ms) => { now += ms; },
    syntheticClick: () => {
      now += 100;
      handlers.onClick({});
    },
  };
}

test('fullscreen short tap sends exactly one click, including the synthetic browser click', () => {
  const { commands, handlers, event, advance, syntheticClick } = setup();
  handlers.onTouchStart(event(100, 200));
  advance(100);
  handlers.onTouchEnd(event(102, 203, true));
  syntheticClick();
  assert.deepEqual(commands, [
    { type: 'mouse-move', x: 102, y: 203 },
    { type: 'mouse-click', button: 'left' },
  ]);
});

test('fullscreen drag sends movement but no click, including the synthetic browser click', () => {
  const { commands, handlers, event, advance, syntheticClick } = setup();
  handlers.onTouchStart(event(100, 200));
  advance(100);
  handlers.onTouchMove(event(300, 400));
  handlers.onTouchEnd(event(300, 400, true));
  syntheticClick();
  assert.deepEqual(commands, [{ type: 'mouse-move', x: 300, y: 400 }]);
});

test('dragging away and returning to the start is not a tap', () => {
  const { commands, handlers, event } = setup();
  handlers.onTouchStart(event(100, 200));
  handlers.onTouchMove(event(300, 400));
  handlers.onTouchMove(event(100, 200));
  handlers.onTouchEnd(event(100, 200, true));
  assert.equal(commands.filter((command) => command.type === 'mouse-click').length, 0);
});

test('end displacement rejects a drag even without a touchmove event', () => {
  const { commands, handlers, event } = setup();
  handlers.onTouchStart(event(100, 200));
  handlers.onTouchEnd(event(124, 200, true));
  assert.deepEqual(commands, []);
});

test('long press and canceled or missing gestures do not click; the next tap still works', () => {
  const { commands, handlers, event, advance } = setup();
  handlers.onTouchStart(event(100, 200));
  advance(600);
  handlers.onTouchEnd(event(100, 200, true));
  handlers.onTouchStart(event(100, 200));
  handlers.onTouchCancel();
  handlers.onTouchEnd(event(100, 200, true));
  handlers.onTouchEnd(event(100, 200, true));
  assert.deepEqual(commands, []);
  handlers.onTouchStart(event(100, 200));
  handlers.onTouchEnd(event(100, 200, true));
  assert.equal(commands.filter((command) => command.type === 'mouse-click').length, 1);
});

test('fullscreen tap tolerates small finger drift on touchscreens', () => {
  const { commands, handlers, event, advance } = setup();
  handlers.onTouchStart(event(100, 200));
  handlers.onTouchMove(event(118, 210));
  advance(100);
  handlers.onTouchEnd(event(118, 210, true));
  assert.equal(commands.filter(command => command.type === 'mouse-click').length, 1);
});

test('multiple fingers do not produce a tap', () => {
  const { commands, handlers, event } = setup();
  handlers.onTouchStart(event(100, 200));
  const multiple = event(100, 200);
  multiple.touches.push({ clientX: 200, clientY: 300 });
  handlers.onTouchStart(multiple);
  handlers.onTouchEnd(event(100, 200, true));
  assert.deepEqual(commands, []);
});

test('touch control remains limited to engineers with control enabled', () => {
  for (const options of [{ role: 'artist' }, { controlEnabled: false }]) {
    const { commands, handlers, event } = setup(options);
    handlers.onTouchStart(event(100, 200));
    handlers.onTouchMove(event(300, 400));
    handlers.onTouchEnd(event(300, 400, true));
    assert.deepEqual(commands, []);
  }
});

test('fullscreen authorized tap waits 50ms and clicks once', () => {
  const remote = remoteControlHarness();
  const state = setup({ remote });
  state.handlers.onTouchStart(state.event(100, 200));
  state.handlers.onTouchEnd(state.event(100, 200, true));
  assert.equal(remote.commands.length, 1);
  assert.equal(remote.commands[0].type, 'mouse-move');
  remote.advance(49);
  assert.equal(remote.commands.length, 1);
  remote.advance(1);
  state.syntheticClick();
  assert.equal(remote.commands.length, 2);
  assert.equal(remote.commands[1].type, 'mouse-click');
  assert.equal(remote.pending, 0);
});

for (const boundary of ['revoke', 'end', 'disconnect', 'transport-close', 'reconnect',
  'unmount', 'view-unmount', 'view-detach']) {
  test(`fullscreen pending tap cannot click after ${boundary}`, () => {
    const remote = remoteControlHarness();
    const state = setup({ remote });
    state.handlers.onTouchStart(state.event(100, 200));
    const end = state.event(100, 200, true);
    state.handlers.onTouchEnd(end);
    remote.advance(25);
    if (boundary === 'revoke') remote.message({ type: 'control-stopped' });
    if (boundary === 'end') remote.api.endFullControl();
    if (boundary === 'disconnect') remote.api.disconnect();
    if (boundary === 'transport-close') remote.close();
    if (boundary === 'reconnect') remote.reconnect();
    if (boundary === 'unmount') remote.unmount();
    if (boundary === 'view-unmount') remote.unmountView();
    if (boundary === 'view-detach') end.currentTarget.isConnected = false;
    if (boundary !== 'view-detach') assert.equal(remote.pending, 0);
    if (['revoke', 'end', 'reconnect'].includes(boundary)) remote.grant();
    remote.advance(100);
    assert.equal(remote.commands.filter(command => command.type === 'mouse-click').length, 0);
    assert.equal(remote.pending, 0);
  });
}
