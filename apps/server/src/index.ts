import express from "express";
import { Server } from "colyseus";
import { createServer } from "http";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/", (_req, res) => {
    res.send("ok");
  });
  return app;
}

export function createGameServer(): {
  app: express.Express;
  httpServer: ReturnType<typeof createServer>;
  gameServer: Server;
} {
  const app = createApp();
  const httpServer = createServer(app);
  const gameServer = new Server({ server: httpServer });
  return { app, httpServer, gameServer };
}

const PORT = Number(process.env.PORT ?? 2567);

if (process.env.NODE_ENV !== "test") {
  const { httpServer } = createGameServer();
  httpServer.listen(PORT, () => {
    console.log(`server listening on ${PORT}`);
  });
}
