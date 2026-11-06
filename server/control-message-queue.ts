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
