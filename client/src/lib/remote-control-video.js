export function mapVideoPointToScreen(
  clientX,
  clientY,
  rect,
  videoWidth,
  videoHeight,
  screen,
) {
  const videoRatio = videoWidth > 0 && videoHeight > 0
    ? videoWidth / videoHeight
    : 16 / 9;
  const containerRatio = rect.width / rect.height;

  let displayWidth;
  let displayHeight;
  let offsetX;
  let offsetY;

  if (videoRatio > containerRatio) {
    displayWidth = rect.width;
    displayHeight = rect.width / videoRatio;
    offsetX = 0;
    offsetY = (rect.height - displayHeight) / 2;
  } else {
    displayHeight = rect.height;
    displayWidth = rect.height * videoRatio;
    offsetX = (rect.width - displayWidth) / 2;
    offsetY = 0;
  }

  const normalizedX = Math.max(0, Math.min(
    1,
    (clientX - rect.left - offsetX) / displayWidth,
  ));
  const normalizedY = Math.max(0, Math.min(
    1,
    (clientY - rect.top - offsetY) / displayHeight,
  ));

  return {
    x: normalizedX * screen.width,
    y: normalizedY * screen.height,
  };
}

export function isSyntheticClickAfterTouch(lastTouchAt, now, delayMs) {
  return lastTouchAt > 0 && now - lastTouchAt < delayMs;
}
