import express from "express";
import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";

/**
 * Mount static client files and SPA fallback onto the same HTTP server that
 * owns the WebSocket. Guarded by env STATIC_DIR so dev mode (no STATIC_DIR)
 * is unchanged. Called from createApp() after /healthz is registered.
 */
export function mountStatic(app: Express): void {
  const dir = process.env.STATIC_DIR;
  if (!dir) return;
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    console.warn(`[static] STATIC_DIR ${resolved} does not exist, skipping static mount`);
    return;
  }
  // Serve built client assets (index.html, /assets/*)
  app.use(express.static(resolved));
  // SPA fallback: any unmatched GET serves index.html so client routing works.
  // Must be registered after /healthz and static, so health check is not shadowed.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(resolved, "index.html"));
  });
}
