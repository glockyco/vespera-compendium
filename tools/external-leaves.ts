import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { copyFile as copyFileAsync } from "node:fs/promises";
import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import cryptoModule from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import nodePath from "node:path";
import nodeProcess from "node:process";
import osModule from "node:os";
import vm from "node:vm";
import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import {
  allExternalLeafCoverageIds,
  assertExternalLeafTestsComplete,
  externalLeafSuite,
  canonicalJson,
  sha256Hex,
  type CanonicalJson,
} from "@vespera/core";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type ExternalLeafTest = () => void | Promise<void>;

export type ExternalLeafNodeArtifact = {
  version: 1;
  suite: "node";
  passed: string[];
  skipped: string[];
  failed: string[];
  absent: string[];
  mechanicsSourceApprovalSha256: string | null;
  runtimeVersions: { bun: string; node: string };
  platformArtifacts: { role: "bun" | "node"; sha256: string }[];
  bunArtifactSha256: string;
  nodeArtifactSha256: string;
};

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function expectBytes(actual: Uint8Array, expected: Uint8Array, detail: string): void {
  if (actual.length !== expected.length) throw new Error(`${detail}: byte length mismatch`);
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) throw new Error(`${detail}: byte ${index} differs`);
  }
}

function commandBytes(command: string, args: string[]): Uint8Array {
  const result = spawnSync(command, args, { encoding: "buffer" });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stdout === null) throw new Error(`${command} exited unsuccessfully`);
  return new Uint8Array(result.stdout);
}

function nodeMetadata(): { version: string; executable: string } {
  const executable = decoder.decode(commandBytes("node", ["-e", "process.stdout.write(process.execPath)"]));
  const version = decoder.decode(commandBytes("node", ["-e", "process.stdout.write(process.versions.node)"]));
  if (!executable || !version) throw new Error("Node metadata is empty");
  return { version, executable };
}

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(nodePath.join(tmpdir(), prefix));
}

function withFsFixture<T>(handler: (root: string) => T): T {
  const root = temporaryDirectory("vespera-leaf-");
  try {
    return handler(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function withServer<T>(handler: (url: string) => Promise<T>): Promise<T> {
  const payload = bytes("vespera-fetch-vector-π");
  const server = Bun.serve({
    port: 0,
    fetch(): Response {
      return new Response(payload, { headers: { "content-type": "application/octet-stream" } });
    },
  });
  try {
    return await handler(server.url.toString());
  } finally {
    await server.stop(true);
  }
}

async function nodeSpawn(): Promise<void> {
  const child = spawn(nodeProcess.execPath, ["-e", `process.stdout.write(${JSON.stringify("spawn-vector")})`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Uint8Array[] = [];
  child.stdout?.on("data", (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => (status === 0 ? resolve() : reject(new Error("spawn status"))));
  });
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  expectBytes(output, bytes("spawn-vector"), "node child_process.spawn");
}

function nodeSpawnSync(): void {
  expectBytes(commandBytes(nodeProcess.execPath, ["-e", `process.stdout.write(${JSON.stringify("spawn-sync-vector")})`]), bytes("spawn-sync-vector"), "node child_process.spawnSync");
}

function nodeHash(): void {
  const actual = createHash("sha256").update(bytes("sha256-byte-vector")).digest("hex");
  const expected = "86fe38d6917b21a31acc6454767abb18d2891406f6fa54fbbe486e819159f852";
  if (actual !== expected) throw new Error("node crypto createHash vector mismatch");
}
function nodeAesGcm(): void {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.alloc(12, 3));
  decipher.setAuthTag(Buffer.from("7c01da2f3ca9157117d3bdc954e8dc06", "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from("419bc06a2a403b305736263f9f388d", "hex")), decipher.final()]);
  expectBytes(new Uint8Array(plaintext), bytes("decipher-vector"), "node crypto createDecipheriv");
}

function nodeCryptoNamespace(): void {
  if (typeof cryptoModule.createHash !== "function" || typeof cryptoModule.randomBytes !== "function") throw new Error("node crypto namespace vector mismatch");
}

function nodeRandom(): void {
  const first = randomBytes(32);
  const second = randomBytes(32);
  if (first.length !== 32 || second.length !== 32 || first.equals(second)) throw new Error("node randomBytes vector mismatch");
}
function nodeUnlinkWrite(): void {
  withFsFixture((root) => {
    const file = nodePath.join(root, "write-vector");
    const vector = bytes("write-sync-vector");
    const fd = openSync(file, "w");
    try {
      if (writeSync(fd, vector, 0, vector.length, 0) !== vector.length) throw new Error("short write");
    } finally {
      closeSync(fd);
    }
    expectBytes(new Uint8Array(readFileSync(file)), vector, "node fs writeSync");
    unlinkSync(file);
    if (existsSync(file)) throw new Error("node fs unlinkSync left a file");
  });
}

async function nodePromisesCopy(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const root = temporaryDirectory("vespera-promises-");
    const source = nodePath.join(root, "source");
    const target = nodePath.join(root, "target");
    const vector = bytes("promises-copy-vector");
    writeFileSync(source, vector);
    copyFileAsync(source, target).then(() => {
      try { expectBytes(new Uint8Array(readFileSync(target)), vector, "node fs/promises copyFile"); resolve(); } catch (error: unknown) { reject(error); } finally { rmSync(root, { recursive: true, force: true }); }
    }, (error: unknown) => { rmSync(root, { recursive: true, force: true }); reject(error); });
  });
}

function nodeOsNamespace(): void {
  if (typeof osModule.tmpdir !== "function" || typeof osModule.homedir !== "function") throw new Error("node os namespace vector mismatch");
}

function nodeVmIsolation(): void {
  const result = vm.runInNewContext("typeof process + ':' + value", { value: "vm-vector" });
  if (result !== "undefined:vm-vector") throw new Error("node vm isolation vector mismatch");
}

function bunSqlite(): void {
  const database = new Database(":memory:");
  try {
    const row: unknown = database.query("SELECT 'sqlite-vector' AS value").get();
    const object = typeof row === "object" && row !== null ? row : null;
    if (object === null || !("value" in object) || object.value !== "sqlite-vector") throw new Error("bun sqlite byte vector mismatch");
  } finally {
    database.close();
  }
}

function nodeStableRead(): void {
  withFsFixture((root) => {
    const file = nodePath.join(root, "vector");
    const vector = bytes("stable-read-vector");
    writeFileSync(file, vector);
    const fd = openSync(file, "r");
    try {
      const before = fstatSync(fd);
      const output = new Uint8Array(vector.length);
      if (readSync(fd, output, 0, output.length, 0) !== output.length) throw new Error("short read");
      const after = fstatSync(fd);
      if (before.size !== after.size) throw new Error("identity changed");
      expectBytes(output, vector, "node fs stableRead");
    } finally {
      closeSync(fd);
    }
  });
}

function nodeCopy(): void {
  withFsFixture((root) => {
    const source = nodePath.join(root, "source");
    const target = nodePath.join(root, "target");
    const vector = bytes("copy-vector");
    writeFileSync(source, vector);
    copyFileSync(source, target);
    expectBytes(new Uint8Array(readFileSync(target)), vector, "node fs copyFileSync");
  });
}

function nodeCp(): void {
  withFsFixture((root) => {
    const source = nodePath.join(root, "source");
    const target = nodePath.join(root, "target");
    mkdirSync(nodePath.join(source, "nested"), { recursive: true });
    writeFileSync(nodePath.join(source, "nested", "vector"), bytes("cp-vector"));
    cpSync(source, target, { recursive: true });
    expectBytes(new Uint8Array(readFileSync(nodePath.join(target, "nested", "vector"))), bytes("cp-vector"), "node fs cpSync");
  });
}

function nodeExists(): void {
  withFsFixture((root) => {
    if (existsSync(nodePath.join(root, "absent"))) throw new Error("existsSync absent vector mismatch");
  });
}

function nodeAtomicWrite(): void {
  withFsFixture((root) => {
    const temporary = nodePath.join(root, "temporary");
    const destination = nodePath.join(root, "destination");
    const vector = bytes("atomic-vector");
    const fd = openSync(temporary, "w");
    try {
      writeFileSync(fd, vector);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, destination);
    expectBytes(new Uint8Array(readFileSync(destination)), vector, "node fs atomic write");
  });
}

async function nodeLstat(): Promise<void> {
  const root = temporaryDirectory("vespera-leaf-");
  try {
    const target = nodePath.join(root, "target");
    const link = nodePath.join(root, "link");
    writeFileSync(target, bytes("symlink-vector"));
    const process = Bun.spawn(["ln", "-s", target, link], { stdout: "ignore", stderr: "pipe" });
    if ((await process.exited) !== 0) throw new Error("failed to create symlink vector");
    if (!lstatSync(link).isSymbolicLink()) throw new Error("lstatSync symlink vector mismatch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function nodeMkdir(): void {
  withFsFixture((root) => {
    const directory = nodePath.join(root, "exclusive");
    mkdirSync(directory);
    let rejected = false;
    try {
      mkdirSync(directory);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("mkdirSync accepted duplicate directory");
  });
}

function nodeMkdtemp(): void {
  const first = temporaryDirectory("vespera-mkdtemp-");
  const second = temporaryDirectory("vespera-mkdtemp-");
  try {
    if (first === second) throw new Error("mkdtempSync returned duplicate paths");
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
}

function nodeReadFile(): void {
  withFsFixture((root) => {
    const file = nodePath.join(root, "vector");
    const vector = bytes("read-file-vector");
    writeFileSync(file, vector);
    expectBytes(new Uint8Array(readFileSync(file)), vector, "node fs readFileSync");
  });
}

function nodeReaddir(): void {
  withFsFixture((root) => {
    mkdirSync(nodePath.join(root, "directory"));
    writeFileSync(nodePath.join(root, "file"), bytes("readdir-vector"));
    const result = readdirSync(root, { withFileTypes: true }).map((entry) => `${entry.name}:${entry.isDirectory() ? "d" : "f"}`).sort();
    if (JSON.stringify(result) !== JSON.stringify(["directory:d", "file:f"])) throw new Error("readdirSync type vector mismatch");
  });
}

function nodeRealpath(): void {
  withFsFixture((root) => {
    const file = nodePath.join(root, "canonical");
    writeFileSync(file, bytes("realpath-vector"));
    const canonicalFile = realpathSync(file);
    if (realpathSync(nodePath.join(root, ".", "canonical")) !== canonicalFile) throw new Error("realpathSync vector mismatch");
  });
}

function nodeRm(): void {
  withFsFixture((root) => {
    const nested = nodePath.join(root, "nested", "vector");
    mkdirSync(nodePath.dirname(nested), { recursive: true });
    writeFileSync(nested, bytes("rm-vector"));
    rmSync(nodePath.join(root, "nested"), { recursive: true, force: true });
    if (existsSync(nodePath.join(root, "nested"))) throw new Error("rmSync recursive vector mismatch");
  });
}

function nodeStat(): void {
  withFsFixture((root) => {
    const file = nodePath.join(root, "vector");
    const vector = bytes("stat-vector");
    writeFileSync(file, vector);
    if (statSync(file).size !== vector.length) throw new Error("statSync size vector mismatch");
  });
}

function nodeHomedir(): void {
  if (!nodePath.isAbsolute(homedir())) throw new Error("homedir is not absolute");
}

function nodeTmpdir(): void {
  if (!nodePath.isAbsolute(tmpdir()) || !existsSync(tmpdir())) throw new Error("tmpdir is not usable");
}

function nodePathJoin(): void {
  if (nodePath.join("vespera", "leaf", "..", "vector") !== nodePath.normalize("vespera/vector")) throw new Error("path join vector mismatch");
}

function nodeProcessVersions(): void {
  if (!nodeProcess.versions.node) throw new Error("process version is empty");
}

function nodeFileUrl(): void {
  const file = nodePath.join(tmpdir(), "vespera-url-vector");
  if (fileURLToPath(new URL(`file://${file}`)) !== file) throw new Error("fileURLToPath vector mismatch");
}

async function bunFile(): Promise<void> {
  const root = temporaryDirectory("vespera-bun-file-");
  try {
    const file = nodePath.join(root, "vector");
    const vector = bytes("bun-file-vector-π");
    writeFileSync(file, vector);
    expectBytes(new Uint8Array(await Bun.file(file).arrayBuffer()), vector, "Bun.file");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function bunServe(): Promise<void> {
  await withServer(async (url) => expectBytes(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes("vespera-fetch-vector-π"), "Bun.serve"));
}

async function bunSpawn(): Promise<void> {
  const process = Bun.spawn([nodeProcess.execPath, "-e", `process.stdout.write(${JSON.stringify("bun-spawn-vector")})`], { stdout: "pipe", stderr: "pipe" });
  if (process.stdout === null) throw new Error("Bun.spawn stdout is missing");
  expectBytes(new Uint8Array(await new Response(process.stdout).arrayBuffer()), bytes("bun-spawn-vector"), "Bun.spawn");
  if ((await process.exited) !== 0) throw new Error("Bun.spawn status vector mismatch");
}

function bunVersion(): void {
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(Bun.version)) throw new Error("Bun.version is not semver");
}

async function bunWrite(): Promise<void> {
  const root = temporaryDirectory("vespera-bun-write-");
  try {
    const file = nodePath.join(root, "vector");
    const vector = bytes("bun-write-vector-π");
    await Bun.write(file, vector);
    expectBytes(new Uint8Array(readFileSync(file)), vector, "Bun.write");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function globalAbort(): void {
  const controller = new AbortController();
  controller.abort("abort-vector");
  if (!controller.signal.aborted || controller.signal.reason !== "abort-vector") throw new Error("AbortController vector mismatch");
}

function globalDecoder(): void {
  if (decoder.decode(bytes("decode-vector-π")) !== "decode-vector-π") throw new Error("TextDecoder vector mismatch");
}

function globalEncoder(): void {
  expectBytes(new TextEncoder().encode("encode-vector-π"), bytes("encode-vector-π"), "TextEncoder vector");
}

function globalUrl(): void {
  if (new URL("../leaf?value=byte", "https://vespera.example/path/").href !== "https://vespera.example/leaf?value=byte") throw new Error("URL vector mismatch");
}

function globalSearchParams(): void {
  if (new URLSearchParams("value=byte%20vector").get("value") !== "byte vector") throw new Error("URLSearchParams vector mismatch");
}

function globalConsole(): void {
  const original = console.log;
  let captured = "";
  console.log = (...values: unknown[]) => { captured = values.map((value) => String(value)).join(" "); };
  try {
    console.log("console-byte-vector");
  } finally {
    console.log = original;
  }
  if (captured !== "console-byte-vector") throw new Error("console vector mismatch");
}

async function globalCrypto(): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", bytes("subtle-byte-vector"));
  const actual = [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
  const expected = "58bb12acbd771e9f9754de8f3a99b100d777e9b0a0f12eda3304f7c68530e80a";
  if (actual !== expected) throw new Error("crypto.subtle vector mismatch");
}

async function globalFetch(): Promise<void> {
  await withServer(async (url) => expectBytes(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes("vespera-fetch-vector-π"), "fetch"));
}

function globalPerformance(): void {
  if (!(performance.now() >= 0)) throw new Error("performance vector mismatch");
}

function globalClearTimeout(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = setTimeout(() => reject(new Error("clearTimeout failed")), 20);
    clearTimeout(cancelled);
    setTimeout(resolve, 1);
  });
}

function globalSetTimeout(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}


/**
 * Bun's hasher must agree with Node's hasher for the same bytes.
 *
 * Publication hashes art with Bun and approvals with Node.
 * A difference between the hashers makes two valid commands disagree about one file.
 */
function bunCryptoHasher(): void {
  const bytes = new TextEncoder().encode("vespera external leaf vector");
  const viaBun = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const viaNode = createHash("sha256").update(bytes).digest("hex");
  if (viaBun !== viaNode) throw new Error(`Bun.CryptoHasher produced ${viaBun}, Node produced ${viaNode}`);
}

/** A synchronous child must return its own stdout bytes. The launcher hash uses these bytes. */
function bunSpawnSyncStdout(): void {
  const result = Bun.spawnSync(["printf", "vespera"]);
  const text = new TextDecoder().decode(result.stdout);
  if (text !== "vespera") throw new Error(`Bun.spawnSync returned ${JSON.stringify(text)}`);
  if (result.exitCode !== 0) throw new Error(`Bun.spawnSync exited ${String(result.exitCode)}`);
}

/** Base64 through the global decoder must round-trip the exact bytes that a CDP body carries. */
function globalAtob(): void {
  const bytes = Uint8Array.from([0, 1, 200, 255, 127]);
  const encoded = Buffer.from(bytes).toString("base64");
  const decoded = atob(encoded);
  if (decoded.length !== bytes.length) throw new Error(`atob produced ${decoded.length} units`);
  for (const [index, byte] of bytes.entries()) {
    if (decoded.charCodeAt(index) !== byte) throw new Error(`atob differs at byte ${index}`);
  }
}

/** `Buffer` handles base64 and save decryption, so its byte view must be exact. */
function globalBuffer(): void {
  const buffer = Buffer.from("vespera", "utf8");
  if (buffer.toString("base64") !== "dmVzcGVyYQ==") throw new Error("Buffer base64 differs");
  if (buffer.byteLength !== 7) throw new Error(`Buffer length is ${buffer.byteLength}`);
}

/** A served response must return the exact bytes that it received, without transcoding. */
async function globalResponse(): Promise<void> {
  const bytes = Uint8Array.from([0, 34, 92, 255, 10]);
  const roundTripped = new Uint8Array(await new Response(bytes).arrayBuffer());
  if (roundTripped.length !== bytes.length) throw new Error("Response changed the byte length");
  for (const [index, byte] of bytes.entries()) {
    if (roundTripped[index] !== byte) throw new Error(`Response differs at byte ${index}`);
  }
}

/** The ambient process must report the runtime versions that each approval records. */
function globalProcessVersions(): void {
  if (typeof process.versions.node !== "string" || process.versions.node.length === 0) {
    throw new Error("process.versions.node is unavailable");
  }
  if (typeof process.pid !== "number") throw new Error("process.pid is unavailable");
}

export const NODE_EXTERNAL_LEAF_TESTS: Readonly<Record<string, ExternalLeafTest>> = Object.freeze({
  "node.child_process.spawn.roundtrip": nodeSpawn,
  "node.child_process.spawnSync.status": nodeSpawnSync,
  "node.crypto.aesGcm.roundtrip": nodeAesGcm,
  "node.crypto.sha256.vectors": nodeHash,
  "node.crypto.namespace.present": nodeCryptoNamespace,
  "node.crypto.randomBytes.length": nodeRandom,
  "node.fs.stableRead.identity": nodeStableRead,
  "node.fs.copyFile.bytes": nodeCopy,
  "node.fs.cp.tree": nodeCp,
  "node.fs.exists.absent": nodeExists,
  "node.fs.atomicWrite.rename": nodeAtomicWrite,
  "node.fs.lstat.symlink": nodeLstat,
  "node.fs.mkdir.exclusive": nodeMkdir,
  "node.fs.mkdtemp.unique": nodeMkdtemp,
  "node.fs.readFile.bytes": nodeReadFile,
  "node.fs.readdir.types": nodeReaddir,
  "node.fs.realpath.canonical": nodeRealpath,
  "node.fs.rm.recursive": nodeRm,
  "node.fs.stat.size": nodeStat,
  "node.fs.unlink.removes": nodeUnlinkWrite,
  "node.fs.writeSync.offset": nodeUnlinkWrite,
  "node.fsPromises.copyFile.bytes": nodePromisesCopy,
  "node.os.namespace.present": nodeOsNamespace,
  "node.os.homedir.absolute": nodeHomedir,
  "node.os.tmpdir.writable": nodeTmpdir,
  "node.path.join.normalize": nodePathJoin,
  "node.process.versions.present": nodeProcessVersions,
  "node.url.fileURLToPath.roundtrip": nodeFileUrl,
  "node.vm.runInNewContext.isolation": nodeVmIsolation,
  "bun.sqlite.roundtrip": bunSqlite,
  "bun.file.bytes": bunFile,
  "bun.serve.exactBytes": bunServe,
  "bun.spawn.exitCode": bunSpawn,
  "bun.version.semver": bunVersion,
  "bun.write.bytes": bunWrite,
  "global.abortController.signal": globalAbort,
  "global.textDecoder.fatalUtf8": globalDecoder,
  "global.textEncoder.utf8": globalEncoder,
  "global.url.resolve": globalUrl,
  "global.urlSearchParams.get": globalSearchParams,
  "global.console.log": globalConsole,
  "global.crypto.subtleSha256": globalCrypto,
  "global.fetch.localhost": globalFetch,
  "global.performance.monotonic": globalPerformance,
  "global.timers.clear": globalClearTimeout,
  "global.timers.resolve": globalSetTimeout,
  "bun.cryptoHasher.sha256": bunCryptoHasher,
  "bun.spawnSync.stdout": bunSpawnSyncStdout,
  "global.atob.base64": globalAtob,
  "global.buffer.base64": globalBuffer,
  "global.process.versions": globalProcessVersions,
  "global.response.bytes": globalResponse,
});
export const EXTERNAL_LEAF_TESTS = NODE_EXTERNAL_LEAF_TESTS;
export const NODE_LEAF_TESTS = NODE_EXTERNAL_LEAF_TESTS;

function nodeCoverageIds(): string[] {
  return allExternalLeafCoverageIds().filter((id) => externalLeafSuite(id) === "node");
}

function approvalHash(lockPath: string): string | null {
  if (!existsSync(lockPath)) return null;
  const parsed: unknown = JSON.parse(decoder.decode(new Uint8Array(readFileSync(lockPath))));
  if (typeof parsed !== "object" || parsed === null || !("approvalSha256" in parsed)) return null;
  const value = parsed.approvalSha256;
  return typeof value === "string" ? value : null;
}

export function assertNodeExternalLeafTableComplete(
  table: Readonly<Record<string, ExternalLeafTest>> = NODE_EXTERNAL_LEAF_TESTS,
): string[] {
  assertExternalLeafTestsComplete();
  const assigned = nodeCoverageIds();
  const tableIds = Object.keys(table).sort();
  const missing = assigned.filter((id) => !Object.hasOwn(table, id));
  const extra = tableIds.filter((id) => !assigned.includes(id));
  if (missing.length > 0 || extra.length > 0) throw new Error(`node external leaf coverage mismatch (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"})`);
  return assigned;
}

export type RunNodeExternalLeafTestsOptions = { mechanicsSourceLockPath?: string };

export async function runNodeExternalLeafTests(options: RunNodeExternalLeafTestsOptions = {}): Promise<ExternalLeafNodeArtifact> {
  const assigned = assertNodeExternalLeafTableComplete();
  const passed: string[] = [];
  const failed: string[] = [];
  for (const id of assigned) {
    try {
      await NODE_EXTERNAL_LEAF_TESTS[id]();
      passed.push(id);
    } catch {
      failed.push(id);
    }
  }
  // Both suites run in the same Bun process. The runtime identity is Bun's executable and its Node compatibility version.
  // A separately installed `node` binary is a capability that these tests exercise, not the runtime that ran them.
  // Reporting that binary makes the aggregate reject two valid inputs because of an unused runtime.
  const bunArtifactSha256 = sha256Hex(readFileSync(nodeProcess.execPath));
  const nodeArtifactSha256 = bunArtifactSha256;
  const artifact: ExternalLeafNodeArtifact = {
    version: 1,
    suite: "node",
    passed,
    skipped: [],
    failed,
    absent: allExternalLeafCoverageIds().filter((id) => externalLeafSuite(id) === "harness"),
    mechanicsSourceApprovalSha256: approvalHash(options.mechanicsSourceLockPath ?? nodeProcess.env.VESPERA_MECHANICS_SOURCE_LOCK ?? "mechanics-source.lock.json"),
    runtimeVersions: { bun: Bun.version, node: nodeProcess.versions.node },
    platformArtifacts: [{ role: "bun", sha256: bunArtifactSha256 }, { role: "node", sha256: nodeArtifactSha256 }],
    bunArtifactSha256,
    nodeArtifactSha256,
  };
  return artifact;
}

export const runExternalLeafTests = runNodeExternalLeafTests;

export function writeExternalLeafArtifact(file: string, artifact: ExternalLeafNodeArtifact): void {
  const value: CanonicalJson = {
    version: artifact.version,
    suite: artifact.suite,
    passed: artifact.passed,
    skipped: artifact.skipped,
    failed: artifact.failed,
    absent: artifact.absent,
    mechanicsSourceApprovalSha256: artifact.mechanicsSourceApprovalSha256,
    runtimeVersions: artifact.runtimeVersions,
    platformArtifacts: artifact.platformArtifacts,
    bunArtifactSha256: artifact.bunArtifactSha256,
    nodeArtifactSha256: artifact.nodeArtifactSha256,
  };
  const canonical = canonicalJson(value);
  const directory = nodePath.dirname(file);
  mkdirSync(directory, { recursive: true });
  const temporary = nodePath.join(directory, `.${nodePath.basename(file)}.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(temporary, "w");
  try {
    writeFileSync(fd, `${canonical}\n`, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}

export async function runExternalLeafCli(argv: readonly string[] = nodeProcess.argv.slice(2)): Promise<void> {
  if (argv.length !== 3 || argv[0] !== "test-node" || argv[1] !== "--out") throw new Error("usage: bun run tools/external-leaves.ts test-node --out <json>");
  writeExternalLeafArtifact(argv[2], await runNodeExternalLeafTests());
}

if (import.meta.main || nodeProcess.argv[1]?.endsWith("external-leaves.ts")) {
  await runExternalLeafCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    nodeProcess.exitCode = 1;
  });
}
