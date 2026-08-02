/**
 * Serves the prerendered site like the CDN and measures what a visitor receives.
 *
 * The dev server is not a useful measure. It sends unminified modules and an HMR client.
 * A page then reads several times more data than the deployed build.
 * Cloudflare compresses text responses, so this server does too.
 * Without compression, a prerendered page with 900 cards looks 20 times worse than it is on the network.
 *
 * Usage: bun tools/serve-build.mjs [port] [dir]
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const port = Number(process.argv[2] ?? 5178);
const root = path.resolve(process.argv[3] ?? "site/build");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".sqlite": "application/octet-stream",
  ".woff2": "font/woff2",
};

/** Already-compressed formats gain no benefit from a second pass and cost CPU to re-encode. */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".csv", ".svg"]);

function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname.split("?")[0]);
  const candidate = path.join(root, clean);
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const indexed = path.join(candidate, "index.html");
  if (existsSync(indexed)) return indexed;
  return null;
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const file = resolveFile(url.pathname) ?? path.join(root, "404.html");
    if (!existsSync(file)) return new Response("Not found", { status: 404 });

    const extension = path.extname(file);
    const type = TYPES[extension] ?? "application/octet-stream";
    const body = await Bun.file(file).arrayBuffer();
    const wantsGzip = (request.headers.get("accept-encoding") ?? "").includes("gzip");

    if (wantsGzip && COMPRESSIBLE.has(extension)) {
      const compressed = gzipSync(Buffer.from(body));
      return new Response(compressed, {
        headers: { "content-type": type, "content-encoding": "gzip", "content-length": String(compressed.length) },
      });
    }
    return new Response(body, { headers: { "content-type": type, "content-length": String(body.byteLength) } });
  },
});

console.log(`serving ${root} on http://localhost:${port}/`);
