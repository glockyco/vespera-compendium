import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveBundles } from "@vespera/core";

const BRIDGE_SOURCE = `;globalThis.__VESPERA_BRIDGE__ = (() => { try { return {
  achievements: typeof mr !== "undefined" ? mr : null,
  incomingDefenseMitigation: typeof getIncomingDefenseMitigation === "function" ? getIncomingDefenseMitigation : null,
}; } catch (e) { return { error: String(e) }; } })();`;

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
};

export async function serveWithBridge(
  extractedDir: string,
  port: number,
): Promise<{ url: string; stop(): void }> {
  const root = path.resolve(extractedDir);
  const indexBundle = resolveBundles(root).index;
  const bridgedRelativePath = `assets/${indexBundle}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const filePath = path.resolve(root, requested);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        return new Response("forbidden", { status: 403 });
      }

      const headers = { "Content-Type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream" };
      if (requested === bridgedRelativePath) {
        try {
          return new Response(`${readFileSync(filePath, "utf8")}\n${BRIDGE_SOURCE}\n`, { headers });
        } catch {
          return new Response("not found", { status: 404 });
        }
      }

      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop(): void {
      void server.stop(true);
    },
  };
}
