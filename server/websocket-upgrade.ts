import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";

// Only one application listener may accept an HTTP upgrade. Multiple ws
// servers attached directly to the HTTP server can write a 400 response after
// another server has already sent 101, corrupting the WebSocket frame stream.
export function routeWebSocketUpgrades(
  server: Server,
  routes: ReadonlyMap<string, WebSocketServer>,
) {
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url || "").split("?")[0];
    const target = routes.get(pathname);
    // Unowned paths, including Vite HMR, belong to their own upgrade listener.
    if (!target) return;
    target.handleUpgrade(req, socket, head, ws => {
      target.emit("connection", ws, req);
    });
  };
  server.on("upgrade", upgrade);
  return () => server.off("upgrade", upgrade);
}
