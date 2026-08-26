export type SpawnedServer = {
  url: string;
  port: number;
  close: () => Promise<void>;
  shiftLengthSOverride?: number;
};

export async function spawnServer(options?: { shiftLengthSOverride?: number }): Promise<SpawnedServer> {
  // Prevent server's auto-listen (NODE_ENV !== 'test' triggers listen on 2567)
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const { createGameServer } = await import("../../../apps/server/src/index.js");
  // restore (keep test for subsequent spawns)
  process.env.NODE_ENV = prevEnv;
  const { httpServer, gameServer } = createGameServer();

  await new Promise<void>((resolve, reject) => {
    const errHandler = (e: unknown): void => {
      reject(e);
    };
    httpServer.once("error", errHandler);
    httpServer.listen(0, () => {
      httpServer.off("error", errHandler);
      resolve();
    });
  });

  const addr = httpServer.address() as unknown as { port: number } | string | null;
  const port = typeof addr === "object" && addr !== null && "port" in addr ? (addr as { port: number }).port : 0;
  const url = `http://localhost:${port}`;

  // wait briefly for server readiness (colyseus defines matchmaking routes async)
  await new Promise<void>((r) => setTimeout(r, 200));

  const close = async (): Promise<void> => {
    try {
      const gs = gameServer as unknown as { gracefullyShutdown?: () => Promise<void>; shutDown?: () => Promise<void> };
      if (typeof gs.gracefullyShutdown === "function") {
        await gs.gracefullyShutdown();
      } else if (typeof gs.shutDown === "function") {
        await gs.shutDown();
      }
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      try {
        httpServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
  };

  return { url, port, close, shiftLengthSOverride: options?.shiftLengthSOverride };
}

export async function waitForHealth(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  throw new Error(`healthz not ready at ${url} within ${timeoutMs}ms`);
}
