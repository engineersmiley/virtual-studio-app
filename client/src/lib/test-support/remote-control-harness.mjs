import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRemoteControlLifetime } from '../remote-control-lifetime.js';

const text = readFileSync(new URL('../../hooks/use-webrtc.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('use-webrtc.ts', text, ts.ScriptTarget.Latest, true);
const hook = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useWebRTC');
const js = ts.transpileModule(hook.getText(source).replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const session = ts.createSourceFile('Session.tsx',
  readFileSync(new URL('../../pages/Session.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let viewEffect;
function findViewEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(session) === 'useEffect' &&
      node.arguments[1]?.getText(session).includes('cancelPendingControlClicks')) {
    viewEffect = node.arguments[0].getText(session);
  }
  ts.forEachChild(node, findViewEffect);
}
findViewEffect(session);
if (!viewEffect) throw new Error('Session must cancel queued clicks on view teardown');

// Run the production hook with fake React primitives, transport and clock.
// Authorization messages and teardown callbacks are not reimplemented here.
export function remoteControlHarness() {
  let now = 1_000;
  let nextTimer = 0;
  const timers = new Map();
  const setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, due: now + delay });
    return id;
  };
  const clearTimeout = id => timers.delete(id);
  // Track authorization-bound input timers separately from signaling retries
  // and join deadlines, which are intentionally independent of control grants.
  const inputTimers = new Set();
  const setInputTimeout = (callback, delay) => {
    const id = setTimeout(() => {
      inputTimers.delete(id);
      callback();
    }, delay);
    inputTimers.add(id);
    return id;
  };
  const clearInputTimeout = id => {
    inputTimers.delete(id);
    clearTimeout(id);
  };
  const lifetimeFactory = new Function('setTimeout', 'clearTimeout',
    `return (${createRemoteControlLifetime.toString()})`)(setInputTimeout, clearInputTimeout);
  const commands = [];
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets.push(this); }
    send(data) {
      const command = JSON.parse(data);
      if (command.type.startsWith('mouse-') || command.type.startsWith('key-')) commands.push(command);
    }
    close(code = 1000) {
      this.readyState = 3;
      this.onclose?.({ code, reason: '' });
    }
  }
  const effects = [];
  const scope = {
    useState: initial => [initial, () => {}],
    useRef: current => ({ current }),
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
    createRemoteControlLifetime: lifetimeFactory,
    WebSocket: Socket, PollingTransport: Socket,
    isTransportOpen: socket => socket?.readyState === Socket.OPEN,
    window: { location: { protocol: 'https:', host: 'test.invalid' } },
    console: { log() {}, error() {} },
    Date: { now: () => now }, setTimeout, clearTimeout,
  };
  const useWebRTC = new Function(...Object.keys(scope), `${js}; return useWebRTC;`)(...Object.values(scope));
  const api = useWebRTC({ roomId: 'ROOM', userId: 'engineer', role: 'engineer' });
  const cleanups = effects.map(effect => effect()).filter(cleanup => typeof cleanup === 'function');
  const unmountView = new Function('cancelPendingControlClicks',
    `return (${viewEffect})();`)(api.cancelPendingControlClicks);
  api.connect();
  const message = data => sockets.at(-1).onmessage({ data: JSON.stringify(data) });
  message({ type: 'control-response', allowed: true });
  return {
    api, commands, message, unmountView,
    grant: () => message({ type: 'control-response', allowed: true }),
    close: () => sockets.at(-1).close(),
    reconnect: () => api.connect(),
    unmount: () => cleanups.forEach(cleanup => cleanup()),
    get pending() { return inputTimers.size; },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > until) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
    },
  };
}
