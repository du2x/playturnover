import express from "express";
import { Server } from "./colyseus-compat.js";
import { createServer } from "http";
import { HotelRoom } from "./rooms/HotelRoom.js";
import { mountStatic } from "./static.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  mountStatic(app);
  // Fallback for dev mode (no STATIC_DIR): keep placeholder GET /.
  // When STATIC_DIR is set, mountStatic already serves index.html and the
  // SPA fallback, so this handler is shadowed (registered after static).
  if (!process.env.STATIC_DIR) {
    app.get("/", (_req, res) => {
      res.send("ok");
    });
  }
  return app;
}

export function createGameServer(): {
  app: express.Express;
  httpServer: ReturnType<typeof createServer>;
  gameServer: InstanceType<typeof Server>;
} {
  const app = createApp();
  const httpServer = createServer(app);
  const gameServer = new Server({ server: httpServer });
  gameServer.define("hotel", HotelRoom);
  return { app, httpServer, gameServer };
}

const PORT = Number(process.env.PORT ?? 2567);

if (process.env.NODE_ENV !== "test") {
  const { httpServer } = createGameServer();
  httpServer.listen(PORT, () => {
    console.log(`server listening on ${PORT}`);
  });
}
