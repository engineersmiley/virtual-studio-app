export function shouldPublishCaptureState(state: {
  role: string;
  signalingJoined: boolean;
  transportOpen: boolean;
}): boolean;

export function getIdentifiedCaptureSurface(
  track: MediaStreamTrack | undefined,
  stopped?: boolean,
): 'monitor' | null;
