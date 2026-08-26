import { createRequire } from "module";

const require = createRequire(import.meta.url);
// colyseus is CJS, use require to get named exports reliably under Node ESM
const colyseusPkg = require("colyseus") as {
  Room: unknown;
  Server: unknown;
};

type Clock = {
  setTimeout(cb: () => void, ms: number, ...args: unknown[]): unknown;
  setInterval(cb: () => void, ms: number, ...args: unknown[]): unknown;
  clear(): void;
};

export const Room = colyseusPkg.Room as unknown as abstract new <T extends object>(...args: unknown[]) => {
  state: T;
  clock: Clock;
  maxClients: number;
  hasReachedMaxClients(): boolean;
  setPatchRate(ms: number): void;
  setSimulationInterval(callback: (deltaTime: number) => void, ms?: number): void;
  setState(state: T): void;
  onMessage(type: string, cb: (client: import("colyseus").Client, data: unknown) => void): void;
  onCreate(options: unknown): void | Promise<void>;
  onJoin(client: import("colyseus").Client, options?: unknown): void | Promise<void>;
  onLeave(client: import("colyseus").Client, consented?: boolean): void | Promise<void>;
};
export const Server = colyseusPkg.Server as unknown as new (options: { server: unknown }) => {
  define: (name: string, room: unknown) => void;
  gracefullyShutdown?: () => Promise<void>;
};
export type Client = import("colyseus").Client;
