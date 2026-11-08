import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isSyntheticClickAfterTouch, mapVideoPointToScreen } from './remote-control-video.js';

// Execute production handlers, not copies of their logic. No DOM, WebRTC peer,
// desktop agent, or wall-clock delays are needed.
const source = ts.createSourceFile(
  'Session.tsx',
  readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);
const expressions = new Map();
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const video = attributes.some((attribute) =>
      attribute.name.getText(source) === 'ref' &&
      attribute.initializer?.expression?.getText(source) === 'fullscreenVideoRef');
    const rightButton = attributes.some((attribute) =>
      attribute.name.getText(source) === 'data-testid' &&
      attribute.initializer?.text === 'button-rightclick-fullscreen');
    if (video || rightButton) {
      for (const attribute of attributes) {
        const name = attribute.name.getText(source);
        if (name.startsWith('on')) {
          expressions.set(`${video ? 'video' : 'rightButton'}.${name}`,
            attribute.initializer.expression.getText(source));
        }
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of ['video.onClick', 'video.onMouseMove', 'rightButton.onClick']) {
  assert.ok(expressions.has(name), `missing production handler: ${name}`);
}
const compiled = new Map([...expressions].map(([name, expression]) => [
  name,
  ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText,
]));

function setup({ role = 'engineer', controlEnabled = true } = {}) {
  const commands = [];
  const timers = [];
  let now = 1_000;
  let lockRequests = 0;
  const video = {
    videoWidth: 1920, videoHeight: 1080,
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 1000, height: 1000 }),
    requestPointerLock() { lockRequests++; },
  };
  const scope = {
    role, controlEnabled,
    agentScreenSize: { width: 1920, height: 1080 },
    virtualCursorRef: { current: { x: 960, y: 540 } },
    lastRemoteVideoTouchTimeRef: { current: 0 },
    TOUCH_DELAY_MS: 500,
    document: { pointerLockElement: null },
    Date: { now: () => now },
    setTimeout: (callback, delay) => { timers.push({ callback, due: now + delay }); },
    queueFullControlClick: () => {
      timers.push({ callback: () => commands.push({ type: 'mouse-click', button: 'left' }), due: now + 50 });
    },
    sendFullControlCommand: (command) => commands.push(command),
    mapVideoPointToScreen, isSyntheticClickAfterTouch,
  };
  function run(name, overrides = {}) {
    assert.ok(compiled.has(name), `missing production handler: ${name}`);
    const handler = new Function(...Object.keys(scope), `return ${compiled.get(name)}`)(
      ...Object.values(scope),
    );
    handler({
      currentTarget: video, clientX: 350, clientY: 720.625,
      movementX: 0, movementY: 0, button: 0, detail: 1,
      preventDefault() {}, stopPropagation() {}, ...overrides,
    });
  }
  function advance(ms) {
    const until = now + ms;
    timers.sort((a, b) => a.due - b.due);
    while (timers.length && timers[0].due <= until) {
      const timer = timers.shift();
      now = timer.due;
      timer.callback();
    }
    now = until;
  }
  function changeLock(locked) {
    scope.document.pointerLockElement = locked ? video : null;
  }
  // Browser contextmenu/dblclick events do not imply an onClick invocation.
  function optionalEvent(name, overrides) {
    if (compiled.has(name)) run(name, overrides);
  }
  return {
    commands, timers, scope, video, run, advance, changeLock, optionalEvent,
    get lockRequests() { return lockRequests; },
    touchNow: () => { scope.lastRemoteVideoTouchTimeRef.current = now; },
  };
}

test('ordinary desktop click maps the video point, requests lock, then clicks after 50ms', () => {
  const state = setup();
  state.run('video.onClick');
  assert.equal(state.lockRequests, 1);
  assert.deepEqual(state.commands, [{ type: 'mouse-move', x: 480, y: 810 }]);
  state.advance(49);
  assert.equal(state.commands.length, 1, 'click must not precede cursor positioning');
  state.advance(1);
  assert.deepEqual(state.commands, [
    { type: 'mouse-move', x: 480, y: 810 },
    { type: 'mouse-click', button: 'left' },
  ]);
  assert.equal(state.timers.length, 0);
});

for (const failure of ['missing', 'throwing', 'rejecting']) {
  test(`${failure} pointer lock preserves absolute movement and the delayed left click`, async () => {
    const state = setup();
    let attempts = 0;
    if (failure === 'missing') {
      delete state.video.requestPointerLock;
    } else {
      state.video.requestPointerLock = function () {
        assert.equal(this, state.video, 'acquisition must retain the video receiver');
        attempts++;
        const error = new Error('Pointer lock unavailable');
        if (failure === 'throwing') throw error;
        return Promise.reject(error);
      };
    }

    assert.doesNotThrow(() => state.run('video.onClick'));
    assert.equal(attempts, failure === 'missing' ? 0 : 1);
    assert.deepEqual(state.commands, [{ type: 'mouse-move', x: 480, y: 810 }]);
    state.advance(49);
    assert.equal(state.commands.length, 1, 'click must still wait for cursor positioning');
    state.advance(1);
    // Let rejected promises settle. node:test also fails on unhandled rejections.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.scope.document.pointerLockElement, null);
    state.run('video.onMouseMove', {
      clientX: 850, clientY: 580, movementX: -10000, movementY: 10000,
    });
    assert.deepEqual(state.commands, [
      { type: 'mouse-move', x: 480, y: 810 },
      { type: 'mouse-click', button: 'left' },
      { type: 'mouse-move', x: 1440, y: 540 },
    ]);
    assert.equal(state.timers.length, 0);
  });
}

test('touch suppression blocks commands and lock requests, but expires at 500ms', () => {
  const state = setup();
  state.touchNow();
  for (const delay of [0, 499]) {
    state.advance(delay);
    state.run('video.onClick');
    assert.deepEqual(state.commands, []);
    assert.equal(state.lockRequests, 0);
    assert.equal(state.timers.length, 0);
  }
  state.advance(1);
  state.run('video.onClick');
  state.advance(50);
  assert.equal(state.lockRequests, 1);
  assert.deepEqual(state.commands, [
    { type: 'mouse-move', x: 480, y: 810 },
    { type: 'mouse-click', button: 'left' },
  ]);
});

test('pointer lock preserves the cursor and relative moves accumulate with sensitivity', () => {
  const state = setup();
  state.changeLock(true);
  assert.deepEqual(state.scope.virtualCursorRef.current, { x: 960, y: 540 });
  state.run('video.onMouseMove', { movementX: 10, movementY: -20, clientX: 0, clientY: 0 });
  state.run('video.onMouseMove', { movementX: -4, movementY: 8, clientX: 9999, clientY: 9999 });
  state.run('video.onMouseMove');
  assert.deepEqual(state.commands, [
    { type: 'mouse-move', x: 975, y: 510 },
    { type: 'mouse-move', x: 969, y: 522 },
    { type: 'mouse-move', x: 969, y: 522 },
  ]);
  assert.deepEqual(state.scope.virtualCursorRef.current, { x: 969, y: 522 });
  assert.equal(state.lockRequests, 0);
});

test('pointer-locked movement allows 100px overreach but clamps all four edges', () => {
  const state = setup();
  state.changeLock(true);
  state.run('video.onMouseMove', { movementX: 10000, movementY: -10000 });
  state.run('video.onMouseMove', { movementX: -10000, movementY: 10000 });
  assert.deepEqual(state.commands, [
    { type: 'mouse-move', x: 2020, y: -100 },
    { type: 'mouse-move', x: -100, y: 1180 },
  ]);
});

test('unlocked mouse movement uses absolute coordinates, not relative deltas', () => {
  const state = setup();
  state.run('video.onMouseMove', { movementX: 10000, movementY: -10000 });
  assert.deepEqual(state.commands, [{ type: 'mouse-move', x: 480, y: 810 }]);
  assert.deepEqual(state.scope.virtualCursorRef.current, { x: 480, y: 810 });
  assert.equal(state.lockRequests, 0);
});

test('clicks do not reacquire an existing lock; the first click after lock loss does', () => {
  const state = setup();
  state.changeLock(true);
  state.run('video.onClick');
  state.advance(50);
  assert.equal(state.lockRequests, 0);
  assert.deepEqual(state.commands.map((command) => command.type), ['mouse-move', 'mouse-click']);
  state.changeLock(false);
  state.commands.length = 0;
  state.run('video.onMouseMove');
  state.run('video.onClick');
  assert.equal(state.lockRequests, 1);
  state.changeLock(true);
  state.run('video.onMouseMove', { movementX: 2, movementY: -2 });
  state.advance(50);
  assert.deepEqual(state.commands, [
    { type: 'mouse-move', x: 480, y: 810 },
    { type: 'mouse-move', x: 480, y: 810 },
    { type: 'mouse-move', x: 483, y: 807 },
    { type: 'mouse-click', button: 'left' },
  ]);
});

test('fullscreen R-Click sends exactly one right click without movement or lock acquisition', () => {
  const state = setup();
  state.run('rightButton.onClick');
  state.advance(100);
  assert.deepEqual(state.commands, [{ type: 'mouse-click', button: 'right' }]);
  assert.equal(state.lockRequests, 0);
  assert.equal(state.timers.length, 0);
});

test('native right-click on fullscreen video does not send a remote left or right click', () => {
  const state = setup();
  state.optionalEvent('video.onMouseDown', { button: 2 });
  state.optionalEvent('video.onMouseUp', { button: 2 });
  state.optionalEvent('video.onContextMenu', { button: 2 });
  state.advance(100);
  assert.deepEqual(state.commands, []);
  assert.equal(state.lockRequests, 0);
});

test('desktop double-click retains two left clicks, not an extra mouse-double-click command', () => {
  const state = setup();
  state.run('video.onClick', { detail: 1 });
  state.changeLock(true);
  state.advance(100);
  state.run('video.onClick', { detail: 2 });
  state.optionalEvent('video.onDoubleClick', { detail: 2 });
  state.advance(50);
  assert.deepEqual(state.commands, [
    { type: 'mouse-move', x: 480, y: 810 },
    { type: 'mouse-click', button: 'left' },
    { type: 'mouse-move', x: 480, y: 810 },
    { type: 'mouse-click', button: 'left' },
  ]);
  assert.equal(state.lockRequests, 1);
});

test('desktop video input requires an engineer with control enabled, locked or unlocked', () => {
  for (const options of [
    { role: 'artist' }, { role: 'producer' }, { role: 'other' }, { role: 'dj' }, { role: 'writer' }, { controlEnabled: false },
  ]) {
    for (const locked of [false, true]) {
      const state = setup(options);
      state.changeLock(locked);
      state.run('video.onClick');
      state.run('video.onMouseMove', { movementX: 10, movementY: 20 });
      state.advance(100);
      assert.deepEqual(state.commands, [], JSON.stringify({ ...options, locked }));
      assert.equal(state.lockRequests, 0);
      assert.equal(state.timers.length, 0);
    }
  }
});
