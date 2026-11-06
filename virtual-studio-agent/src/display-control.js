// Browser getDisplayMedia IDs cannot be matched to Electron display IDs.
// Never guess from a label, resolution, scale, or display ordering.
const closeEnough = (actual, expected) =>
  Number.isFinite(actual) && Number.isFinite(expected) &&
  Math.abs(actual - expected) <= Math.max(0.02, Math.abs(expected) * 0.02);

function getDisplayControlState(screen, platform = process.platform, inputScreenSize = null) {
  const displays = screen.getAllDisplays();
  const display = screen.getPrimaryDisplay();
  const { x, y } = display.bounds;
  const width = display.size.width;
  const height = display.size.height;
  let reason = null;
  let inputWidth = width;
  let inputHeight = height;
  let coordinateScaleX = 1;
  let coordinateScaleY = 1;
  if (displays.length !== 1) {
    reason = 'Full remote control requires exactly one connected display. Disconnect extra displays and share your entire screen.';
  } else if (x !== 0 || y !== 0) {
    reason = 'Full remote control requires a display at desktop origin (0, 0).';
  } else if (platform !== 'darwin' && display.scaleFactor !== 1) {
    const nativeWidth = inputScreenSize?.width;
    const nativeHeight = inputScreenSize?.height;
    if (!Number.isFinite(nativeWidth) || !Number.isFinite(nativeHeight) ||
        nativeWidth <= 0 || nativeHeight <= 0 || width <= 0 || height <= 0) {
      reason = 'The Agent could not verify scaled mouse coordinates. Update Virtual Studio Agent or use 100% display scaling.';
    } else {
      const scaleX = nativeWidth / width;
      const scaleY = nativeHeight / height;
      const robotUsesLogicalPixels = closeEnough(scaleX, 1) && closeEnough(scaleY, 1);
      const robotUsesPhysicalPixels =
        closeEnough(scaleX, display.scaleFactor) && closeEnough(scaleY, display.scaleFactor);
      if (!robotUsesLogicalPixels && !robotUsesPhysicalPixels) {
        reason = 'The Agent could not verify scaled mouse coordinates. Use a supported display scale or update Virtual Studio Agent.';
      } else {
        inputWidth = nativeWidth;
        inputHeight = nativeHeight;
        coordinateScaleX = scaleX;
        coordinateScaleY = scaleY;
      }
    }
  }
  return {
    supported: reason === null,
    reason,
    signature: JSON.stringify({
      displays: displays.map(d => ({
        id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor,
      })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      inputWidth, inputHeight, coordinateScaleX, coordinateScaleY,
    }),
    width,
    height,
    inputWidth,
    inputHeight,
    coordinateScaleX,
    coordinateScaleY,
    calibrationRequired: platform !== 'darwin' && display.scaleFactor !== 1,
  };
}

function mapInputPoint(x, y, displayState) {
  const clamp = (value, max) => Math.max(0, Math.min(max - 1, Math.round(value)));
  return {
    x: clamp(x * displayState.coordinateScaleX, displayState.inputWidth),
    y: clamp(y * displayState.coordinateScaleY, displayState.inputHeight),
  };
}

function canControlCapture(message) {
  return message.captureSurface === 'monitor' &&
    typeof message.captureId === 'string' && message.captureId.length > 0;
}

module.exports = { getDisplayControlState, mapInputPoint, canControlCapture };
