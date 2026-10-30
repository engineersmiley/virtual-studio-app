import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isSyntheticClickAfterTouch, mapVideoPointToScreen } from './remote-control-video.js';

// Exercise the real handlers without requiring a live WebRTC peer or desktop agent.
const source = ts.createSourceFile(
  'Session.tsx',
  readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);
const expressions = {};
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const ref = node.attributes.properties.find((attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'ref');
    const name = ref?.initializer?.expression?.getText(source);
    if (['fullscreenVideoRef', 'videoContainerRef', 'remoteVideoRef'].includes(name)) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(source).startsWith('on')) {
          expressions[`${name}.${attribute.name.getText(source)}`] =
            attribute.initializer.expression.getText(source);
        }
      }
    }
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleVideoTouchMove') {
    expressions.touchMove = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);

function setup() {
  const commands = [];
  let rect = { left: 100, top: 80, width: 1000, height: 1000 };
  const video = {
    videoWidth: 1920, videoHeight: 1080,
    getBoundingClientRect: () => rect,
    requestPointerLock() {},
  };
  const scope = {
    role: 'engineer', controlEnabled: true, controlMode: false, hasRemoteStream: true,
    isPointerLocked: false,
    remoteVideoRef: { current: video }, fullscreenTouchRef: { current: null },
    virtualCursorRef: { current: { x: 960, y: 540 } },
    lastTouchRef: { current: {} }, lastMouseMoveRef: { current: 0 },
    lastRemoteVideoTouchTimeRef: { current: 0 },
    agentScreenSize: { width: 1920, height: 1080 },
    MOUSE_THROTTLE_MS: 16, TOUCH_DELAY_MS: 500,
    Date: { now: () => 1000 }, setTimeout: (callback) => callback(),
    document: { pointerLockElement: null },
    sendFullControlCommand: (command) => commands.push(command),
    sendControlEvent: () => assert.fail('unexpected pointer-only command'),
    mapVideoPointToScreen, isSyntheticClickAfterTouch,
  };
  function run(name, clientX, clientY) {
    assert.ok(expressions[name], `missing handler ${name}`);
    scope.lastMouseMoveRef.current = 0;
    const js = ts.transpileModule(`(${expressions[name]})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const handler = new Function(...Object.keys(scope), `return ${js}`)(...Object.values(scope));
    // The container deliberately differs from the video: mapping must use the video bounds.
    const currentTarget = name.startsWith('videoContainerRef')
      ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 1400 }) }
      : video;
    handler({
      clientX, clientY, currentTarget, movementX: 10, movementY: -20,
      touches: [{ clientX, clientY }], preventDefault() {}, stopPropagation() {},
    });
    return commands.at(-1);
  }
  return {
    run, scope, video, commands,
    resize: (nextRect) => { rect = nextRect; },
  };
}

const movements = [
  'videoContainerRef.onMouseMove', 'touchMove',
  'fullscreenVideoRef.onMouseMove', 'fullscreenVideoRef.onTouchMove',
];
const clicks = [
  'videoContainerRef.onClick', 'remoteVideoRef.onClick', 'fullscreenVideoRef.onClick',
];

for (const [label, width, height] of [['wide', 1920, 1080], ['tall', 1080, 1920]]) {
  test(`${label} video movement and clicks agree before and after fullscreen resize`, () => {
    const state = setup();
    state.video.videoWidth = width;
    state.video.videoHeight = height;
    for (const rect of [
      { left: 100, top: 80, width: 1000, height: 1000 },
      { left: 0, top: 0, width: 1920, height: 1080 },
      { left: 0, top: 0, width: 800, height: 1200 },
    ]) {
      state.resize(rect);
      const scale = Math.min(rect.width / width, rect.height / height);
      const displayWidth = width * scale;
      const displayHeight = height * scale;
      const left = rect.left + (rect.width - displayWidth) / 2;
      const top = rect.top + (rect.height - displayHeight) / 2;
      for (const [clientX, clientY, expected] of [
        [left + displayWidth / 4, top + displayHeight * 0.75, { x: 480, y: 810 }],
        [rect.left, rect.top, { x: 0, y: 0 }],
        [rect.left + rect.width, rect.top + rect.height, { x: 1920, y: 1080 }],
      ]) {
        for (const name of [...movements, ...clicks]) {
          state.run(name, clientX, clientY);
          const move = state.commands.filter((command) => command.type === 'mouse-move').at(-1);
          assert.ok(Math.abs(move.x - expected.x) < 1e-8, `${name}: x`);
          assert.ok(Math.abs(move.y - expected.y) < 1e-8, `${name}: y`);
        }
      }
    }
  });
}

test('movement reads changed stream dimensions and the shared pre-metadata fallback', () => {
  const state = setup();
  for (const [width, height] of [[1920, 1080], [1080, 1920], [0, 0]]) {
    state.video.videoWidth = width;
    state.video.videoHeight = height;
    const expected = mapVideoPointToScreen(350, 400,
      state.video.getBoundingClientRect(), width, height, state.scope.agentScreenSize);
    for (const name of movements) {
      assert.deepEqual(state.run(name, 350, 400), { type: 'mouse-move', ...expected });
    }
  }
});

test('fullscreen pointer lock retains relative sensitivity and edge overreach', () => {
  const state = setup();
  state.scope.isPointerLocked = true;
  assert.deepEqual(state.run('fullscreenVideoRef.onMouseMove', 0, 0),
    { type: 'mouse-move', x: 975, y: 510 });
  state.scope.virtualCursorRef.current = { x: 2019, y: -99 };
  assert.deepEqual(state.run('fullscreenVideoRef.onMouseMove', 0, 0),
    { type: 'mouse-move', x: 2020, y: -100 });
});
