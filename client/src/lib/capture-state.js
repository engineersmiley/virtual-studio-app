/**
 * Capture reporting follows the signaling session, not WebRTC peer connectivity.
 * Video can remain live while signaling reconnects through HTTP polling.
 *
 * @param {{ role: string, signalingJoined: boolean, transportOpen: boolean }} state
 */
export function shouldPublishCaptureState({ role, signalingJoined, transportOpen }) {
  return role === 'artist' && signalingJoined && transportOpen;
}

/**
 * Only accept the browser's explicit full-monitor identity. Never infer it from
 * the video dimensions, labels, or a user confirmation.
 *
 * @param {MediaStreamTrack | undefined} track
 * @param {boolean} [stopped]
 */
export function getIdentifiedCaptureSurface(track, stopped = false) {
  if (!track || stopped || track.readyState !== 'live' || track.muted) return null;
  return track.getSettings?.().displaySurface === 'monitor' ? 'monitor' : null;
}
