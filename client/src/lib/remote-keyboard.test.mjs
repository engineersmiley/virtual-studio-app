import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Run the entire production effect, including its guard and cleanup, without
// mounting Session or connecting to WebRTC/the desktop agent.
const source = ts.createSourceFile(
  'Session.tsx',
  readFileSync(new URL('../pages/Session.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
    const callback = node.arguments[0];
    let capturesKeyboard = false;
    function findListener(child) {
      if (ts.isCallExpression(child) &&
          child.expression.getText(source) === 'window.addEventListener' &&
          ts.isStringLiteral(child.arguments[0]) && child.arguments[0].text === 'keydown') {
        capturesKeyboard = true;
      }
      ts.forEachChild(child, findListener);
    }
    if (callback) findListener(callback);
    if (capturesKeyboard) effects.push(node);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(effects.length, 1, 'Session must wire exactly one keyboard capture effect');
const effect = effects[0];
assert.ok(effect.arguments[1], 'keyboard effect must declare its dependencies');
const compiled = ts.transpileModule(
  `({ effect: ${effect.arguments[0].getText(source)}, deps: ${effect.arguments[1].getText(source)} })`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

class HTMLInputElement {}
class HTMLTextAreaElement {}

function setup(initiallyActive = true) {
  const commands = [];
  const listeners = new Set();
  const added = [];
  const removed = [];
  const window = {
    addEventListener(type, listener) {
      assert.equal(type, 'keydown');
      added.push(listener);
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'keydown');
      assert.ok(listeners.delete(listener), 'cleanup must remove the installed listener');
      removed.push(listener);
    },
  };
  const defaultSender = (command) => commands.push(command);
  let dependencies;
  let cleanup;
  // React runs cleanup before re-running effects whose dependencies changed.
  // Evaluate the production dependency array too, so missing dependencies fail.
  function render(fullControlActive, sendFullControlCommand = defaultSender) {
    const evaluated = new Function(
      'fullControlActive', 'sendFullControlCommand', 'window',
      'HTMLInputElement', 'HTMLTextAreaElement', 'console',
      `return ${compiled}`,
    )(
      fullControlActive, sendFullControlCommand, window,
      HTMLInputElement, HTMLTextAreaElement, { log() {} },
    );
    if (!dependencies || dependencies.length !== evaluated.deps.length ||
        evaluated.deps.some((value, index) => !Object.is(value, dependencies[index]))) {
      cleanup?.();
      cleanup = evaluated.effect();
      dependencies = evaluated.deps;
    }
  }
  function keydown(key, overrides = {}) {
    const event = {
      key, target: {}, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    for (const listener of [...listeners]) listener(event);
    return event;
  }
  function unmount() {
    cleanup?.();
    cleanup = undefined;
    dependencies = undefined;
  }
  render(initiallyActive);
  return { commands, listeners, added, removed, render, keydown, unmount };
}

const noModifiers = { ctrl: false, alt: false, shift: false, cmd: false };

for (const [key, flags] of [
  ['a', {}], ['7', {}], [' ', {}], ['é', {}],
  ['A', { shiftKey: true }], ['!', { shiftKey: true }],
]) {
  test(`printable ${JSON.stringify(key)} dispatches key-type, including Shift-only input`, () => {
    const state = setup();
    const event = state.keydown(key, flags);
    assert.deepEqual(state.commands, [{ type: 'key-type', text: key }]);
    assert.equal(event.defaultPrevented, true);
  });
}

for (const key of ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowLeft', 'Home', 'F1']) {
  test(`${key} dispatches key-press and suppresses the browser action`, () => {
    const state = setup();
    const event = state.keydown(key);
    assert.deepEqual(state.commands, [{ type: 'key-press', key, modifiers: noModifiers }]);
    assert.equal(event.defaultPrevented, true);
  });
}

test('modified printable and special keys preserve every modifier combination', () => {
  for (const key of ['c', 'ArrowRight']) {
    for (let mask = 0; mask < 16; mask++) {
      const ctrl = Boolean(mask & 1);
      const alt = Boolean(mask & 2);
      const shift = Boolean(mask & 4);
      const cmd = Boolean(mask & 8);
      if (key === 'c' && !ctrl && !alt && !cmd) continue; // Covered as key-type above.
      const state = setup();
      const event = state.keydown(key, {
        ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: cmd,
      });
      assert.deepEqual(state.commands, [{
        type: 'key-press', key, modifiers: { ctrl, alt, shift, cmd },
      }], `${key}, modifier mask ${mask}`);
      assert.equal(event.defaultPrevented, true);
    }
  }
});

for (const Element of [HTMLInputElement, HTMLTextAreaElement]) {
  test(`typing or shortcuts in ${Element.name} are neither forwarded nor prevented`, () => {
    const state = setup();
    for (const [key, flags] of [
      ['a', {}], ['A', { shiftKey: true }], ['Enter', {}], ['Tab', {}],
      ['v', { ctrlKey: true }], ['a', { metaKey: true }], ['F5', {}], ['F12', {}],
    ]) {
      const event = state.keydown(key, { target: new Element(), ...flags });
      assert.equal(event.defaultPrevented, false, key);
    }
    assert.deepEqual(state.commands, []);
  });
}

for (const key of ['F5', 'F12']) {
  test(`${key} keeps browser default behavior while still forwarding key-press`, () => {
    for (const ctrlKey of [false, true]) {
      const state = setup();
      const event = state.keydown(key, { ctrlKey });
      assert.equal(event.defaultPrevented, false);
      assert.deepEqual(state.commands, [{
        type: 'key-press', key, modifiers: { ...noModifiers, ctrl: ctrlKey },
      }]);
    }
  });
}

test('inactive full control installs no listener and leaves keyboard events alone', () => {
  const state = setup(false);
  assert.equal(state.listeners.size, 0);
  assert.equal(state.added.length, 0);
  assert.equal(state.keydown('a').defaultPrevented, false);
  assert.equal(state.keydown('Enter').defaultPrevented, false);
  assert.deepEqual(state.commands, []);
  state.unmount();
});

test('ending full control removes the exact listener and reactivation does not duplicate it', () => {
  const state = setup();
  assert.equal(state.listeners.size, 1);
  state.keydown('a');
  state.render(false);
  assert.equal(state.listeners.size, 0);
  assert.equal(state.removed[0], state.added[0]);
  assert.equal(state.keydown('b').defaultPrevented, false);
  assert.equal(state.keydown('Tab').defaultPrevented, false);
  assert.deepEqual(state.commands, [{ type: 'key-type', text: 'a' }]);
  state.render(true);
  state.render(true); // Unchanged dependencies must not reinstall the listener.
  assert.equal(state.added.length, 2);
  assert.equal(state.listeners.size, 1);
  state.keydown('c');
  assert.deepEqual(state.commands, [
    { type: 'key-type', text: 'a' }, { type: 'key-type', text: 'c' },
  ]);
  state.unmount();
  assert.equal(state.listeners.size, 0);
});

test('unmount cleans up active keyboard capture, including a setup-cleanup-setup cycle', () => {
  const state = setup();
  state.unmount();
  assert.equal(state.listeners.size, 0);
  assert.equal(state.keydown('a').defaultPrevented, false);
  assert.deepEqual(state.commands, []);
  state.render(true);
  assert.equal(state.listeners.size, 1);
  state.keydown('b');
  assert.deepEqual(state.commands, [{ type: 'key-type', text: 'b' }]);
  state.unmount();
  assert.deepEqual(state.removed, state.added);
});

test('replacing the command sender cleans up the stale closure before capturing again', () => {
  const state = setup();
  const replacementCommands = [];
  state.render(true, (command) => replacementCommands.push(command));
  assert.equal(state.listeners.size, 1);
  assert.equal(state.removed[0], state.added[0]);
  state.keydown('x');
  assert.deepEqual(state.commands, []);
  assert.deepEqual(replacementCommands, [{ type: 'key-type', text: 'x' }]);
  state.unmount();
});
