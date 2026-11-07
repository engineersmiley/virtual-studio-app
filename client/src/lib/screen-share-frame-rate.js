export function getScreenShareFrameRate(controlActive) {
  return controlActive ? 60 : 30;
}

export async function applyScreenShareFrameRate(track, controlActive) {
  if (!track || track.readyState === 'ended') return false;

  const frameRate = getScreenShareFrameRate(controlActive);
  await track.applyConstraints({
    frameRate: { ideal: frameRate, max: frameRate },
  });
  return frameRate;
}
