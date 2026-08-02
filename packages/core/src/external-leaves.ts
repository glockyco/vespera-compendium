/**
 * The boundary of every reviewed source closure.
 *
 * A closure hash is only a real approval if it stops somewhere honest. Traversal stops at exactly
 * three kinds of leaf, and each kind is declared here rather than discovered:
 *
 * - ECMAScript intrinsics, which are the language rather than a platform and carry no test
 *   obligation of their own;
 * - platform symbols (Node, Bun, WebSocket, and named CDP protocol operations), each of which must
 *   name at least one executable test that demonstrates the semantics the closure relies on;
 * - reviewed third-party packages, declared in `source-package-leaves.ts`.
 *
 * Anything else — an unlisted specifier, an unresolved identifier, a dynamic import, a module
 * outside the workspace — fails source hashing. That is the point: a closure cannot quietly grow a
 * dependency that no one reviewed.
 */

/**
 * Language built-ins. These are not platform surface, so they need no coverage row: a change to
 * `Math.min` is a change of JavaScript, not of this repository's dependencies.
 */
export const ECMASCRIPT_INTRINSICS: ReadonlySet<string> = new Set([
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "BigInt",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "Float32Array",
  "Float64Array",
  "Function",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "globalThis",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "structuredClone",
  "undefined",
]);

/**
 * Permitted platform symbols, keyed by specifier.
 *
 * `global` covers ambient platform values that are not imported; `bun` covers the Bun namespace;
 * `cdp` covers the exact Chrome DevTools Protocol operations the harness is allowed to send. Every
 * entry becomes a `<specifier>#<symbol>` token in the closure preimage when it is reached, so
 * adding a platform capability changes the hash and forces a review.
 */
export const SOURCE_CLOSURE_EXTERNAL_LEAVES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "node:child_process": Object.freeze(["spawn", "spawnSync"]),
    "node:crypto": Object.freeze(["createDecipheriv", "createHash", "default", "randomBytes"]),
    "node:fs": Object.freeze([
      "closeSync",
      "copyFileSync",
      "cpSync",
      "existsSync",
      "fstatSync",
      "fsyncSync",
      "lstatSync",
      "mkdirSync",
      "mkdtempSync",
      "openSync",
      "readFileSync",
      "readSync",
      "readdirSync",
      "realpathSync",
      "renameSync",
      "rmSync",
      "statSync",
      "unlinkSync",
      "writeFileSync",
      "writeSync",
    ]),
    "node:fs/promises": Object.freeze(["copyFile"]),
    "node:os": Object.freeze(["default", "homedir", "tmpdir"]),
    "node:path": Object.freeze(["default"]),
    "node:process": Object.freeze(["default"]),
    "node:url": Object.freeze(["fileURLToPath"]),
    "node:vm": Object.freeze(["default"]),
    "bun:sqlite": Object.freeze(["Database"]),
    bun: Object.freeze([
      "Bun.CryptoHasher",
      "Bun.file",
      "Bun.serve",
      "Bun.spawn",
      "Bun.spawnSync",
      "Bun.version",
      "Bun.write",
    ]),
    cdp: Object.freeze([
      "Debugger.enable",
      "Debugger.scriptParsed",
      "Network.enable",
      "Network.getResponseBody",
      "Network.loadingFinished",
      "Network.responseReceived",
      "Network.setCacheDisabled",
      "Page.enable",
      "Page.navigate",
      "Runtime.callFunctionOn",
      "Runtime.enable",
      "Runtime.evaluate",
      "Runtime.getProperties",
    ]),
    global: Object.freeze([
      "AbortController",
      "Buffer",
      "Response",
      "TextDecoder",
      "TextEncoder",
      "URL",
      "URLSearchParams",
      "WebSocket",
      "atob",
      "clearTimeout",
      "console",
      "crypto",
      "fetch",
      "performance",
      "process",
      "setTimeout",
    ]),
  });

/** `<specifier>#<symbol>` for one platform leaf. This exact spelling enters the closure preimage. */
export function externalLeafToken(specifier: string, symbol: string): string {
  return `${specifier}#${symbol}`;
}

/** Every declared platform leaf token, sorted. */
export function allExternalLeafTokens(): string[] {
  const tokens: string[] = [];
  for (const [specifier, symbols] of Object.entries(SOURCE_CLOSURE_EXTERNAL_LEAVES)) {
    for (const symbol of symbols) tokens.push(externalLeafToken(specifier, symbol));
  }
  return tokens.sort();
}

/**
 * The named executable test that covers each platform leaf.
 *
 * A leaf without a test is an unexamined assumption about the platform, so the key sets of this map
 * and {@link SOURCE_CLOSURE_EXTERNAL_LEAVES} must match exactly; `assertExternalLeafTestsComplete`
 * is a source-hash invariant rather than a lint. Node and Bun primitives are covered by byte-vector
 * tests in `tools/external-leaves.test.ts`; WebSocket and CDP operations are covered by the harness,
 * because only a real browser can demonstrate them.
 */
export const SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "node:child_process#spawn": Object.freeze(["node.child_process.spawn.roundtrip"]),
    "node:child_process#spawnSync": Object.freeze(["node.child_process.spawnSync.status"]),
    "node:crypto#createDecipheriv": Object.freeze(["node.crypto.aesGcm.roundtrip"]),
    "node:crypto#createHash": Object.freeze(["node.crypto.sha256.vectors"]),
    "node:crypto#default": Object.freeze(["node.crypto.namespace.present"]),
    "node:crypto#randomBytes": Object.freeze(["node.crypto.randomBytes.length"]),
    "node:fs#closeSync": Object.freeze(["node.fs.stableRead.identity"]),
    "node:fs#copyFileSync": Object.freeze(["node.fs.copyFile.bytes"]),
    "node:fs#cpSync": Object.freeze(["node.fs.cp.tree"]),
    "node:fs#existsSync": Object.freeze(["node.fs.exists.absent"]),
    "node:fs#fstatSync": Object.freeze(["node.fs.stableRead.identity"]),
    "node:fs#fsyncSync": Object.freeze(["node.fs.atomicWrite.rename"]),
    "node:fs#lstatSync": Object.freeze(["node.fs.lstat.symlink"]),
    "node:fs#mkdirSync": Object.freeze(["node.fs.mkdir.exclusive"]),
    "node:fs#mkdtempSync": Object.freeze(["node.fs.mkdtemp.unique"]),
    "node:fs#openSync": Object.freeze(["node.fs.stableRead.identity"]),
    "node:fs#readFileSync": Object.freeze(["node.fs.readFile.bytes"]),
    "node:fs#readSync": Object.freeze(["node.fs.stableRead.identity"]),
    "node:fs#readdirSync": Object.freeze(["node.fs.readdir.types"]),
    "node:fs#realpathSync": Object.freeze(["node.fs.realpath.canonical"]),
    "node:fs#renameSync": Object.freeze(["node.fs.atomicWrite.rename"]),
    "node:fs#rmSync": Object.freeze(["node.fs.rm.recursive"]),
    "node:fs#statSync": Object.freeze(["node.fs.stat.size"]),
    "node:fs#unlinkSync": Object.freeze(["node.fs.unlink.removes"]),
    "node:fs#writeFileSync": Object.freeze(["node.fs.atomicWrite.rename"]),
    "node:fs#writeSync": Object.freeze(["node.fs.writeSync.offset"]),
    "node:fs/promises#copyFile": Object.freeze(["node.fsPromises.copyFile.bytes"]),
    "node:os#default": Object.freeze(["node.os.namespace.present"]),
    "node:os#homedir": Object.freeze(["node.os.homedir.absolute"]),
    "node:os#tmpdir": Object.freeze(["node.os.tmpdir.writable"]),
    "node:path#default": Object.freeze(["node.path.join.normalize"]),
    "node:process#default": Object.freeze(["node.process.versions.present"]),
    "node:url#fileURLToPath": Object.freeze(["node.url.fileURLToPath.roundtrip"]),
    "node:vm#default": Object.freeze(["node.vm.runInNewContext.isolation"]),
    "bun:sqlite#Database": Object.freeze(["bun.sqlite.roundtrip"]),
    "bun#Bun.CryptoHasher": Object.freeze(["bun.cryptoHasher.sha256"]),
    "bun#Bun.file": Object.freeze(["bun.file.bytes"]),
    "bun#Bun.serve": Object.freeze(["bun.serve.exactBytes"]),
    "bun#Bun.spawn": Object.freeze(["bun.spawn.exitCode"]),
    "bun#Bun.spawnSync": Object.freeze(["bun.spawnSync.stdout"]),
    "bun#Bun.version": Object.freeze(["bun.version.semver"]),
    "bun#Bun.write": Object.freeze(["bun.write.bytes"]),
    "cdp#Debugger.enable": Object.freeze(["harness.cdp.debugger.enable"]),
    "cdp#Debugger.scriptParsed": Object.freeze(["harness.cdp.debugger.scriptParsed"]),
    "cdp#Network.enable": Object.freeze(["harness.cdp.network.enable"]),
    "cdp#Network.getResponseBody": Object.freeze(["harness.cdp.network.getResponseBody"]),
    "cdp#Network.loadingFinished": Object.freeze(["harness.cdp.network.loadingFinished"]),
    "cdp#Network.responseReceived": Object.freeze(["harness.cdp.network.responseReceived"]),
    "cdp#Network.setCacheDisabled": Object.freeze(["harness.cdp.network.setCacheDisabled"]),
    "cdp#Page.enable": Object.freeze(["harness.cdp.page.enable"]),
    "cdp#Page.navigate": Object.freeze(["harness.cdp.page.navigate"]),
    "cdp#Runtime.callFunctionOn": Object.freeze(["harness.cdp.runtime.callFunctionOn"]),
    "cdp#Runtime.enable": Object.freeze(["harness.cdp.runtime.enable"]),
    "cdp#Runtime.evaluate": Object.freeze(["harness.cdp.runtime.evaluate"]),
    "cdp#Runtime.getProperties": Object.freeze(["harness.cdp.runtime.getProperties"]),
    "global#AbortController": Object.freeze(["global.abortController.signal"]),
    "global#Buffer": Object.freeze(["global.buffer.base64"]),
    "global#Response": Object.freeze(["global.response.bytes"]),
    "global#TextDecoder": Object.freeze(["global.textDecoder.fatalUtf8"]),
    "global#TextEncoder": Object.freeze(["global.textEncoder.utf8"]),
    "global#URL": Object.freeze(["global.url.resolve"]),
    "global#URLSearchParams": Object.freeze(["global.urlSearchParams.get"]),
    "global#WebSocket": Object.freeze(["harness.websocket.cdpHandshake"]),
    "global#atob": Object.freeze(["global.atob.base64"]),
    "global#clearTimeout": Object.freeze(["global.timers.clear"]),
    "global#console": Object.freeze(["global.console.log"]),
    "global#crypto": Object.freeze(["global.crypto.subtleSha256"]),
    "global#fetch": Object.freeze(["global.fetch.localhost"]),
    "global#performance": Object.freeze(["global.performance.monotonic"]),
    "global#process": Object.freeze(["global.process.versions"]),
    "global#setTimeout": Object.freeze(["global.timers.resolve"]),
  });

/**
 * Which suite owns each coverage ID. The Node command cannot demonstrate a browser realm and the
 * harness cannot run without the installed game, so the aggregate needs both to be complete.
 */
export function externalLeafSuite(coverageId: string): "node" | "harness" {
  return coverageId.startsWith("harness.") ? "harness" : "node";
}

/** Every declared coverage ID, sorted and deduplicated. */
export function allExternalLeafCoverageIds(): string[] {
  const ids = new Set<string>();
  for (const list of Object.values(SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS)) {
    for (const id of list) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Exact key equality between the leaf table and the test assignment map.
 *
 * Called from source hashing, not from a test, so a leaf can never be added without its coverage
 * row: the closure simply refuses to hash.
 */
export function assertExternalLeafTestsComplete(): void {
  const declared = allExternalLeafTokens();
  const assigned = Object.keys(SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS).sort();
  const missing = declared.filter((token) => !SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS[token]);
  const extra = assigned.filter((token) => !declared.includes(token));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `external leaf test assignment is incomplete (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"})`,
    );
  }
  for (const [token, tests] of Object.entries(SOURCE_CLOSURE_EXTERNAL_LEAF_TESTS)) {
    if (tests.length === 0) throw new Error(`external leaf ${token} has no assigned test`);
  }
}

/** True when the specifier is a declared platform leaf rather than a workspace or package module. */
export function isExternalLeafSpecifier(specifier: string): boolean {
  return Object.hasOwn(SOURCE_CLOSURE_EXTERNAL_LEAVES, specifier);
}

/** Whether one platform symbol is permitted for a specifier. */
export function isExternalLeaf(specifier: string, symbol: string): boolean {
  return SOURCE_CLOSURE_EXTERNAL_LEAVES[specifier]?.includes(symbol) ?? false;
}
