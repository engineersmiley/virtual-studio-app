import type { SessionRole } from "@shared/schema";
import type { WebSocket } from "ws";

interface SocketPeer {
  role: SessionRole;
  ws: Pick<WebSocket, "readyState" | "send">;
}
interface PollingPeer {
  role: SessionRole;
  messages: any[];
}

// A room is shared by both signaling transports, not partitioned by browser.
export function listRoomParticipants(
  sockets: Map<string, SocketPeer> | undefined,
  polling: Map<string, PollingPeer> | undefined,
  excludeUserId?: string,
) {
  const participants = new Map<string, SessionRole>();
  polling?.forEach((peer, userId) => participants.set(userId, peer.role));
  sockets?.forEach((peer, userId) => {
    if (peer.ws.readyState === 1) participants.set(userId, peer.role);
  });
  participants.delete(excludeUserId || "");
  return Array.from(participants, ([userId, role]) => ({ userId, role }));
}

export function relayRoomMessage(
  sockets: Map<string, SocketPeer> | undefined,
  polling: Map<string, PollingPeer> | undefined,
  message: Record<string, any>,
  senderUserId: string,
  targetUserId?: string,
) {
  const accepts = (userId: string) =>
    userId !== senderUserId && (!targetUserId || userId === targetUserId);
  // During transport changes a user can briefly have both entries. Deliver to
  // both; the browser ignores messages from its replaced transport.
  sockets?.forEach((peer, userId) => {
    if (accepts(userId) && peer.ws.readyState === 1) {
      peer.ws.send(JSON.stringify(message));
    }
  });
  polling?.forEach((peer, userId) => {
    if (accepts(userId)) peer.messages.push(message);
  });
}
