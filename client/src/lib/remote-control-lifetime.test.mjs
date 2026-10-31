import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteControlHarness } from './test-support/remote-control-harness.mjs';
import { createRemoteControlLifetime } from './remote-control-lifetime.js';

test('revocation blocks even a retained sender before React rerenders', () => {
  const remote = remoteControlHarness();
  const retainedSender = remote.api.sendFullControlCommand;
  remote.message({ type: 'control-stopped' });
  retainedSender({ type: 'mouse-click', button: 'left' });
  remote.api.queueFullControlClick({ isConnected: true });
  remote.advance(100);
  assert.deepEqual(remote.commands, []);
  remote.grant();
  retainedSender({ type: 'mouse-click', button: 'left' });
  assert.equal(remote.commands.length, 1, 'fresh authorized input works');
});

for (const boundary of ['revoke', 'end', 'disconnect', 'unmount', 'reconnect']) {
  test(`throttled mouse move cannot outlive ${boundary}`, () => {
    const remote = remoteControlHarness();
    remote.api.sendFullControlCommand({ type: 'mouse-move', x: 10, y: 20 });
    remote.api.sendFullControlCommand({ type: 'mouse-move', x: 30, y: 40 });
    assert.equal(remote.pending, 1);
    if (boundary === 'revoke') remote.message({ type: 'control-stopped' });
    if (boundary === 'end') remote.api.endFullControl();
    if (boundary === 'disconnect') remote.api.disconnect();
    if (boundary === 'unmount') remote.unmount();
    if (boundary === 'reconnect') remote.reconnect();
    assert.equal(remote.pending, 0);
    if (['revoke', 'end', 'reconnect'].includes(boundary)) remote.grant();
    remote.advance(100);
    assert.equal(remote.commands.length, 1);
  });
}

test('canceling a view does not cancel authorized pointer movement', () => {
  const remote = remoteControlHarness();
  remote.api.sendFullControlCommand({ type: 'mouse-move', x: 10, y: 20 });
  remote.api.sendFullControlCommand({ type: 'mouse-move', x: 30, y: 40 });
  remote.api.queueFullControlClick({ isConnected: true });
  remote.unmountView();
  assert.equal(remote.pending, 1);
  remote.advance(100);
  assert.deepEqual(remote.commands.map(command => command.type), ['mouse-move', 'mouse-move']);
});

test('a callback already queued by the browser is harmless after cancellation', () => {
  let callback;
  const create = new Function('setTimeout', 'clearTimeout',
    `return (${createRemoteControlLifetime.toString()})`)(
    cb => { callback = cb; return 1; }, () => {},
  );
  const lifetime = create();
  lifetime.setAllowed(true);
  let clicks = 0;
  lifetime.schedule('click', () => clicks++, 50);
  lifetime.setAllowed(false);
  lifetime.setAllowed(true);
  callback();
  assert.equal(clicks, 0);
});
