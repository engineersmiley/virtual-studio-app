export function getScreenShareFrameRate(controlActive: boolean): number;

export function applyScreenShareFrameRate(
  track: MediaStreamTrack | null | undefined,
  controlActive: boolean,
): Promise<number | false>;
