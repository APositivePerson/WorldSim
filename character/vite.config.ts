import { defineConfig, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
const scanFile = fileURLToPath(new URL("./artifacts/scanned-private/runtime/eric.glb", import.meta.url));
// Licensed scan data is served locally, never copied into the deployable dist/.
const localScans: Plugin = {
  name: "local-licensed-scans",
  configureServer(server) { server.middlewares.use(serveScan); },
  configurePreviewServer(server) { server.middlewares.use(serveScan); },
};
function serveScan(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.url?.split("?")[0].endsWith("/models/local-scan-status.json")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ available: existsSync(scanFile) }));
  }
  if (!req.url?.split("?")[0].endsWith("/local-scans/eric.glb") || !existsSync(scanFile)) return next();
  res.setHeader("Content-Type", "model/gltf-binary");
  res.setHeader("Content-Length", statSync(scanFile).size);
  res.setHeader("Cache-Control", "private, no-cache");
  if (req.method === "HEAD") return res.end();
  createReadStream(scanFile).on("error", () => res.destroy()).pipe(res);
}
export default defineConfig({
  plugins: [react(), localScans],
  base: "./",
  optimizeDeps: { exclude: ["@mujoco/mujoco"] },
});
