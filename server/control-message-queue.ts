export const MAX_AGENT_CONTROL_BUFFER_BYTES = 8 * 1024;

// Drop new cursor samples rather than letting a congested socket replay stale
// positions. Discrete clicks and keys are never dropped by this check.
export function shouldDropBufferedMouseMove(type: string, bufferedAmount: number) {
  return type === "mouse-move" &&
    Number.isFinite(bufferedAmount) &&
    bufferedAmount > MAX_AGENT_CONTROL_BUFFER_BYTES;
}

// Replace only consecutive moves from the same grant/capture. Clicks, keys,
// approval and revocation are ordering boundaries and must never be dropped.
export function enqueueControlMessage(queue: any[], message: any) {
  const previous = queue.at(-1);
  if (message.type === "mouse-move" && previous?.type === "mouse-move" &&
      previous.verifiedUserId === message.verifiedUserId &&
      previous.captureId === message.captureId &&
      previous.sessionCode === message.sessionCode) {
    queue[queue.length - 1] = message;
  } else {
    queue.push(message);
  }
}
