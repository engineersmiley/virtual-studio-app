import type { WebSocketServer } from "ws";

// Screen/audio travel peer-to-peer, so a healthy signaling socket can otherwise
// be idle for minutes and be closed by an intermediary.
export function startSocketKeepalive(server: WebSocketServer, intervalMs = 25000) {
  const alive = new WeakMap<object, boolean>();
  server.on("connection", socket => {
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));
  });
  const timer = setInterval(() => {
    server.clients.forEach(socket => {
      if (socket.readyState !== 1) return;
      if (alive.get(socket) === false) {
        socket.terminate();
        return;
      }
      alive.set(socket, false);
      socket.ping();
    });
  }, intervalMs);
  timer.unref();
  server.once("close", () => clearInterval(timer));
}
