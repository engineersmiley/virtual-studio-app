// Only the network/media boundary is stubbed. Never replace event handlers,
// TouchLists, clocks, preventDefault, or CSS in the browser fixture.
const canvas = document.createElement('canvas');
canvas.width = 1920;
canvas.height = 1080;
const context = canvas.getContext('2d');
context.fillStyle = '#183348';
context.fillRect(0, 0, canvas.width, canvas.height);
const stream = canvas.captureStream(1);
const commands = [];
const pending = new Set();
const noop = () => {};
const controlAllowed = new URLSearchParams(location.search).get('control') !== 'off';

window.remoteTouchTest = { commands };
const sendFullControlCommand = command => commands.push(command);
const cancelPendingControlClicks = () => {
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
};
const queueFullControlClick = video => {
  const timer = setTimeout(() => {
    pending.delete(timer);
    if (video.isConnected && controlAllowed) {
      sendFullControlCommand({ type: 'mouse-click', button: 'left' });
    }
  }, 50);
  pending.add(timer);
};
const state = {
  connected: true,
  participants: [{ userId: 'fixture-artist', role: 'artist' }],
  error: null,
  localStream: null,
  hasRemoteStream: true,
  remoteStreams: new Map([['fixture-artist', {
    stream, hasVideo: true, fromRole: 'artist',
  }]]),
  agentConnected: true,
  controlAllowed,
  controlPending: false,
  audioConfirmations: new Map(),
  isMicActive: false,
  connect: noop,
  disconnect: cancelPendingControlClicks,
  clearError: noop,
  startSharing: noop,
  stopSharing: noop,
  startMic: noop,
  stopMic: noop,
  sendControlEvent: noop,
  requestFullControl: noop,
  endFullControl: noop,
  confirmAudio: noop,
  unconfirmAudio: noop,
  sendFullControlCommand,
  queueFullControlClick,
  cancelPendingControlClicks,
};

export const useWebRTC = () => state;
