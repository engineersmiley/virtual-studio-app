import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueControlMessage,
  MAX_AGENT_CONTROL_BUFFER_BYTES,
  shouldDropBufferedMouseMove,
} from "./control-message-queue";

test("drops only cursor samples that would grow a congested Agent socket queue", () => {
  assert.equal(shouldDropBufferedMouseMove("mouse-move", MAX_AGENT_CONTROL_BUFFER_BYTES), false);
  assert.equal(shouldDropBufferedMouseMove("mouse-move", MAX_AGENT_CONTROL_BUFFER_BYTES + 1), true);
  assert.equal(shouldDropBufferedMouseMove("mouse-click", MAX_AGENT_CONTROL_BUFFER_BYTES + 1), false);
});

test("keeps only the newest consecutive mouse position from the same grant", () => {
  const queue: any[] = [];
  const move = (x: number) => ({
    type: "mouse-move", x, y: 1, sessionCode: "ROOM",
    verifiedUserId: "engineer", captureId: "capture-a",
  });
  enqueueControlMessage(queue, move(1));
  enqueueControlMessage(queue, move(2));
  enqueueControlMessage(queue, move(3));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].x, 3);
});

test("never coalesces mouse movement across a click or a changed grant", () => {
  const queue: any[] = [];
  const move = (x: number, captureId = "capture-a") => ({
    type: "mouse-move", x, y: 1, sessionCode: "ROOM",
    verifiedUserId: "engineer", captureId,
  });
  enqueueControlMessage(queue, move(1));
  enqueueControlMessage(queue, { type: "mouse-click" });
  enqueueControlMessage(queue, move(2));
  enqueueControlMessage(queue, move(3, "capture-b"));
  assert.deepEqual(queue.map(message => message.type), [
    "mouse-move", "mouse-click", "mouse-move", "mouse-move",
  ]);
  assert.equal(queue[2].x, 2);
  assert.equal(queue[3].x, 3);
});
