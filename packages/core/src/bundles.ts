/** Semantic bundle roles resolved by content, not by filename. */

/**
 * The game ships hashed filenames. They look content-addressed, but they are not.
 *
 * Vespera reused `index-D6527GFL.js` for different bytes across builds. A filename cannot identify a role or show that two byte sequences match.
 * Anchors identify each role by its content. The roles are the feature-flag document, the sell and Defense implementations, the Combat codex, and the Endgame guide.
 * The SHA-256 digest of the bytes identifies each role.
 *
 * One resolver reads files from disk and raw CDP response bodies. This lets the harness show that both paths read the same bytes.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BUNDLE_ROLES, type BundleIdentity, type BundleRole } from "./canonical-public-evidence.ts";

export type { BundleIdentity, BundleRole };
export { BUNDLE_ROLES };

/** One role's full fingerprint. `filename` is diagnostic and never enters a hash. */
export type BundleFingerprint = { filename: string; bytes: number; sha256: string };

export type BundleFingerprints = Record<BundleRole, BundleFingerprint>;

/**
 * The filename-free value used by every hash, comparison, and approval.
 *
 * No caller serializes a {@link BundleFingerprint} into a preimage. A renamed bundle must keep the `PASS` result when its bytes stay the same.
 * This projection removes the filename by construction. Callers do not need to remember to remove it.
 */
export function bundleIdentity(role: BundleRole, fingerprint: BundleFingerprint): BundleIdentity {
  return { role, bytes: fingerprint.bytes, sha256: fingerprint.sha256 };
}

/** Byte identities of all three roles, in fixed role order. */
export function bundleIdentities(fingerprints: BundleFingerprints): BundleIdentity[] {
  return BUNDLE_ROLES.map((role) => bundleIdentity(role, fingerprints[role]));
}

/** Two fingerprint sets name the same bytes for every role when filenames differ. */
export function sameBundleIdentities(left: BundleFingerprints, right: BundleFingerprints): boolean {
  return BUNDLE_ROLES.every(
    (role) => left[role].bytes === right[role].bytes && left[role].sha256 === right[role].sha256,
  );
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * These anchors identify each role.
 *
 * The resolver requires every anchor and exactly one candidate per role. Anchors use game-authored content and named implementations, not build artifacts.
 * If a bundler splits chunks differently, the resolver fails instead of selecting the wrong file.
 */
const ROLE_ANCHORS: Readonly<Record<BundleRole, readonly string[]>> = Object.freeze({
  indexHtml: Object.freeze(["__VESPERA_FEATURE_FLAGS__", '<div id="root">']),
  index: Object.freeze([
    "GRANDWORKS_ENABLED",
    "function getItemSellValue",
    "function getIncomingDefenseMitigation",
  ]),
  gameView: Object.freeze(["codex.math.normalMitigation", "guide.endgame.routeTitle"]),
});

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/**
 * Decoded text for one role's bytes.
 *
 * The decoder rejects invalid UTF-8. It compares re-encoded text with the input bytes.
 * Lossy decoding can make different byte sequences produce one string. That result breaks the parity claim.
 * The decoder preserves a BOM for the same reason.
 */
export function decodeBundleText(bytes: Uint8Array, describe: string): string {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (cause) {
    throw new Error(`${describe} is not valid UTF-8`, { cause });
  }
  const reencoded = encoder.encode(text);
  if (reencoded.byteLength !== bytes.byteLength) {
    throw new Error(`${describe} does not round-trip through UTF-8 (${bytes.byteLength} -> ${reencoded.byteLength})`);
  }
  for (let index = 0; index < bytes.byteLength; index++) {
    if (reencoded[index] !== bytes[index]) {
      throw new Error(`${describe} does not round-trip through UTF-8 at byte ${index}`);
    }
  }
  return text;
}

function matchRole(text: string): BundleRole | null {
  for (const role of BUNDLE_ROLES) {
    if (ROLE_ANCHORS[role].every((anchor) => text.includes(anchor))) return role;
  }
  return null;
}

/**
 * `indexHtml` and `index` can both contain text near `GRANDWORKS_ENABLED` in some builds.
 * `gameView` can contain the flag too. The resolver checks roles in order, so the most specific anchors win.
 * The caller still requires exactly one candidate per role.
 */
function classify(candidates: { key: string; text: string }[]): Record<BundleRole, string[]> {
  const found: Record<BundleRole, string[]> = { indexHtml: [], index: [], gameView: [] };
  for (const candidate of candidates) {
    for (const role of BUNDLE_ROLES) {
      if (ROLE_ANCHORS[role].every((anchor) => candidate.text.includes(anchor))) {
        found[role].push(candidate.key);
      }
    }
  }
  return found;
}

/**
 * The single candidate for a role, after identical bytes collapse into one candidate.
 *
 * A session can serve one asset twice. The harness navigates the page to force a fresh load, and a bridged session requests the same module again.
 * Two responses with the same bytes are one item of evidence. Treating them as ambiguous rejects a determined role.
 * Two responses with different bytes under one role are ambiguous and fail.
 */
function soleCandidate(
  role: BundleRole,
  keys: readonly string[],
  digest: (key: string) => string,
): string {
  if (keys.length === 0) throw new Error(`no candidate resolves the ${role} bundle role`);
  const byDigest = new Map<string, string>();
  for (const key of keys) {
    const hash = digest(key);
    if (!byDigest.has(hash)) byDigest.set(hash, key);
  }
  if (byDigest.size > 1) {
    throw new Error(
      `ambiguous ${role} bundle role: ${[...byDigest.values()].join(", ")} carry different bytes`,
    );
  }
  return [...byDigest.values()][0]!;
}

export type ResolvedBundleRoles = {
  fingerprints: BundleFingerprints;
  /** Decoded text for each role. Extraction parses the exact bytes that the fingerprints contain. */
  text: Record<BundleRole, string>;
};

/**
 * The three roles read from an extracted build directory.
 *
 * The resolver considers the main document and the JavaScript assets that it can reach. A stray file in `assets/` cannot become a candidate.
 */
export function readBundleRoles(extractedDir: string): ResolvedBundleRoles {
  const root = path.resolve(extractedDir);
  const documentPath = path.join(root, "index.html");
  if (!existsSync(documentPath)) throw new Error(`no index.html in ${root}`);
  const assetsDir = path.join(root, "assets");
  if (!existsSync(assetsDir)) throw new Error(`no assets directory in ${root}`);

  const files = new Map<string, Uint8Array>();
  files.set("index.html", new Uint8Array(readFileSync(documentPath)));
  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    files.set(`assets/${entry.name}`, new Uint8Array(readFileSync(path.join(assetsDir, entry.name))));
  }

  const candidates: { key: string; text: string }[] = [];
  for (const [key, bytes] of files) {
    let text: string;
    try {
      text = decodeBundleText(bytes, key);
    } catch {
      // A binary or non-UTF-8 asset cannot be a role. It is not an error by itself.
      continue;
    }
    candidates.push({ key, text });
  }

  const classified = classify(candidates);
  const digestOf = (key: string): string => sha256(files.get(key)!);
  const resolved = BUNDLE_ROLES.map((role) => {
    const key = soleCandidate(role, classified[role], digestOf);
    const bytes = files.get(key)!;
    return {
      role,
      fingerprint: { filename: key, bytes: bytes.byteLength, sha256: sha256(bytes) },
      text: candidates.find((candidate) => candidate.key === key)!.text,
    };
  });
  return {
    fingerprints: {
      indexHtml: resolved[0]!.fingerprint,
      index: resolved[1]!.fingerprint,
      gameView: resolved[2]!.fingerprint,
    },
    text: {
      indexHtml: resolved[0]!.text,
      index: resolved[1]!.text,
      gameView: resolved[2]!.text,
    },
  };
}

/** The three roles' fingerprints read from disk. */
export function fingerprintBundles(extractedDir: string): BundleFingerprints {
  return readBundleRoles(extractedDir).fingerprints;
}

export type RawResource = { url: string; bytes: Uint8Array };

/**
 * The three roles identified from raw response bodies.
 *
 * The harness passes the bytes that the browser received. The URL does not affect the role.
 * The bytes identify the role. The diagnostic `filename` records the URL that supplied them.
 */
export function fingerprintBundleSources(resources: readonly RawResource[]): BundleFingerprints {
  const candidates: { key: string; text: string }[] = [];
  const byKey = new Map<string, Uint8Array>();
  for (const resource of resources) {
    let text: string;
    try {
      text = decodeBundleText(resource.bytes, resource.url);
    } catch {
      continue;
    }
    candidates.push({ key: resource.url, text });
    byKey.set(resource.url, resource.bytes);
  }
  const classified = classify(candidates);
  const digestOf = (key: string): string => sha256(byKey.get(key)!);
  const resolved = BUNDLE_ROLES.map((role) => {
    const key = soleCandidate(role, classified[role], digestOf);
    const bytes = byKey.get(key)!;
    return { filename: key, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  return { indexHtml: resolved[0]!, index: resolved[1]!, gameView: resolved[2]! };
}

/**
 * Bytes of one CDP response body.
 *
 * A base64 body decodes directly. A text body is encoded with `TextEncoder` and no other operation.
 * Any normalization silently changes the hash that the parity claim depends on.
 */
export function cdpResponseBytes(body: string, base64Encoded: boolean): Uint8Array {
  if (!base64Encoded) return encoder.encode(body);
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type ResolvedBundles = { index: string; gameView: string; all: string[] };

/**
 * Asset-relative filenames for the composition path, which still reads files by name.
 *
 * Content-resolved roles provide the names, not a filename pattern. Composition and the mechanics pipeline therefore agree on each file when the game renames one.
 */
export function resolveBundles(dir: string): ResolvedBundles {
  const { fingerprints } = readBundleRoles(dir);
  const strip = (key: string): string => (key.startsWith("assets/") ? key.slice("assets/".length) : key);
  const assetsDir = path.join(path.resolve(dir), "assets");
  const all = readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();
  return {
    index: strip(fingerprints.index.filename),
    gameView: strip(fingerprints.gameView.filename),
    all,
  };
}
