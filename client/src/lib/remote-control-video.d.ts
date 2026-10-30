export interface VideoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RemoteScreenSize {
  width: number;
  height: number;
}

export function mapVideoPointToScreen(
  clientX: number,
  clientY: number,
  rect: VideoRect,
  videoWidth: number,
  videoHeight: number,
  screen: RemoteScreenSize,
): { x: number; y: number };

export function isSyntheticClickAfterTouch(
  lastTouchAt: number,
  now: number,
  delayMs: number,
): boolean;
