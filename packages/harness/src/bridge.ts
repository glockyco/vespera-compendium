import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CANONICAL_BRIDGE_SUFFIX,
  CANONICAL_BRIDGE_SUFFIX_SHA256,
  cdpResponseBytes,
  resolveBundles,
  sha256Hex,
} from "@vespera/core";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
};

export type BridgeServer = {
  url: string;
  indexBundle: string;
  cleanModuleSha256: string;
  servedResourceSha256: string;
  bridgeSuffixSha256: string;
  cleanBytesHash: string;
  servedBytesHash: string;
  stop(): void;
};

export async function serveWithBridge(extractedDir: string, port: number): Promise<BridgeServer> {
  const root = path.resolve(extractedDir);
  const indexBundle = resolveBundles(root).index;
  const bridgedRelativePath = `assets/${indexBundle}`;
  const indexPath = path.join(root, bridgedRelativePath);
  const cleanBytes = new Uint8Array(readFileSync(indexPath));
  const suffixBytes = cdpResponseBytes(CANONICAL_BRIDGE_SUFFIX, false);
  const servedBytes = new Uint8Array(cleanBytes.byteLength + suffixBytes.byteLength);
  servedBytes.set(cleanBytes, 0);
  servedBytes.set(suffixBytes, cleanBytes.byteLength);
  const cleanHash = sha256Hex(cleanBytes);
  const servedHash = sha256Hex(servedBytes);

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
      const headers = {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      };
      if (requested === bridgedRelativePath) {
        return new Response(servedBytes, { headers });
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    indexBundle,
    cleanModuleSha256: cleanHash,
    servedResourceSha256: servedHash,
    bridgeSuffixSha256: CANONICAL_BRIDGE_SUFFIX_SHA256,
    cleanBytesHash: cleanHash,
    servedBytesHash: servedHash,
    stop(): void {
      void server.stop(true);
    },
  };
}
