import initSqlJs, { type Database, type SqlValue } from "sql.js/dist/sql-wasm.js";

export type LoadProgress = { receivedBytes: number; totalBytes: number | null };

export type QueryOutcome =
  | { ok: true; columns: string[]; rows: SqlValue[][]; elapsedMs: number }
  | { ok: false; message: string; elapsedMs: number };

let dbPromise: Promise<Database> | undefined;

async function open(onProgress?: (progress: LoadProgress) => void): Promise<Database> {
  const wasm = initSqlJs({ locateFile: (file: string) => `/wasm/${file}` });
  const response = await fetch("/data/vespera.sqlite");
  if (!response.ok) {
    throw new Error(`database fetch failed: ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength === null ? null : Number(contentLength);
  const body = response.body;

  let bytes: Uint8Array;
  if (body === null) {
    bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ receivedBytes: bytes.byteLength, totalBytes: bytes.byteLength });
  } else {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.byteLength;
      onProgress?.({ receivedBytes, totalBytes });
    }

    bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  const SQL = await wasm;
  return new SQL.Database(bytes);
}

export function preloadDatabase(onProgress?: (progress: LoadProgress) => void): Promise<Database> {
  dbPromise ??= open(onProgress);
  return dbPromise;
}

export function resetDatabase(): void {
  dbPromise = undefined;
}

export async function runQuery(sql: string): Promise<QueryOutcome> {
  const db = await preloadDatabase();
  const startedAt = performance.now();

  try {
    const results = db.exec(sql);
    const elapsedMs = performance.now() - startedAt;
    if (results.length === 0) {
      return { ok: true, columns: [], rows: [], elapsedMs };
    }

    const result = results[results.length - 1];
    return { ok: true, columns: result.columns, rows: result.values, elapsedMs };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: performance.now() - startedAt,
    };
  }
}
