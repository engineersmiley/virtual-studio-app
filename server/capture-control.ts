interface Capture {
  userId: string;
  trackId: string;
  captureId: string;
  captureSurface: 'monitor';
}

// A capture is bound to its artist and track, not inferred from video dimensions.
export class CaptureControl {
  private captures = new Map<string, Capture>();
  private sequences = new Map<string, number>();

  update(room: string, userId: string, payload: any): boolean {
    const key = JSON.stringify([room, userId]);
    if (payload !== null) {
      if (!Number.isSafeInteger(payload?.sequence) ||
          payload.sequence <= (this.sequences.get(key) ?? 0)) return false;
      this.sequences.set(key, payload.sequence);
    } else {
      this.sequences.delete(key);
    }
    const previous = this.captures.get(room);
    if (payload?.surface === 'monitor' && typeof payload.captureId === 'string' &&
        payload.captureId.length > 0 && payload.captureId.length <= 128) {
      if (previous?.userId !== userId || previous.trackId !== payload.captureId) {
        this.captures.set(room, {
          userId, trackId: payload.captureId,
          captureId: `${payload.captureId}:${payload.sequence}`,
          captureSurface: 'monitor',
        });
      }
    } else if (previous?.userId === userId) {
      this.captures.delete(room);
    }
    return JSON.stringify(previous) !== JSON.stringify(this.captures.get(room));
  }

  get(room: string, artistUserId: string | undefined, isLiveArtist: (id: string) => boolean) {
    const capture = this.captures.get(room);
    return capture && capture.userId === artistUserId && isLiveArtist(capture.userId)
      ? capture : undefined;
  }
}
