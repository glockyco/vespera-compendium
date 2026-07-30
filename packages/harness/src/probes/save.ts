import { readFileSync } from "node:fs";
import { createDecipheriv, createHash } from "node:crypto";
import type { CdpClient } from "../cdp.ts";
import { winePathToHost } from "../launch.ts";
import type { ProbeResult } from "../types.ts";

type SaveEnvelope = {
  format?: unknown;
  cipher?: unknown;
  keyVersion?: unknown;
  iv?: unknown;
  tag?: unknown;
  data?: unknown;
};

type SaveSnapshot = {
  keys?: unknown;
  saveEra?: unknown;
};

function isNonEmptyBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, "base64").length > 0;
}

function decryptSave(envelope: SaveEnvelope): SaveSnapshot {
  const key = createHash("sha256")
    .update(
      [
        "Vespera",
        "watch.uptick.unnamedidle",
        "desktop-local-storage",
        "encrypted-save-v2",
        "2026-07",
      ].join("\0"),
    )
    .digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv as string, "base64"));
  decipher.setAAD(Buffer.from("vespera.desktop-save.v2:1", "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag as string, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data as string, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as SaveSnapshot;
}

export async function runSaveProbe(
  buildId: string,
  client: CdpClient,
  indexBundle: string,
): Promise<ProbeResult> {
  const identifyStore = `(async () => {
    const namespace = await import(new URL(${JSON.stringify(`./assets/${indexBundle}`)}, location.href).href);
    for (const [alias, value] of Object.entries(namespace)) {
      if (typeof value !== "function" || typeof value.getState !== "function" || typeof value.setState !== "function") continue;
      const state = value.getState();
      if (state && typeof state === "object" && "skills" in state && "inventory" in state) return alias;
    }
    return null;
  })()`;

  try {
    const storeAlias = await client.evaluate<string | null>(identifyStore, 120_000);
    if (!storeAlias) {
      return {
        buildId,
        id: "saveEnvelope",
        suite: "save",
        status: "SKIPPED",
        detail: "store not identifiable by shape",
      };
    }

    const windowsPath = await client.evaluate<string>(`(async () => {
      if (!globalThis.unnamedDesktop?.flushSave || !globalThis.unnamedDesktop?.getSavePath) {
        throw new Error("unnamedDesktop save bridge is unavailable");
      }
      await globalThis.unnamedDesktop.flushSave();
      return globalThis.unnamedDesktop.getSavePath();
    })()`, 120_000);
    const savePath = winePathToHost(windowsPath);
    const envelope = JSON.parse(readFileSync(savePath, "utf8")) as SaveEnvelope;
    const envelopeOk =
      envelope.format === "vespera.desktop-save.v2" &&
      envelope.cipher === "aes-256-gcm" &&
      envelope.keyVersion === 1 &&
      isNonEmptyBase64(envelope.iv) &&
      isNonEmptyBase64(envelope.tag) &&
      isNonEmptyBase64(envelope.data);
    if (!envelopeOk) {
      return {
        buildId,
        id: "saveEnvelope",
        suite: "save",
        status: "FAIL",
        detail: `saveEnvelope: invalid encrypted envelope at ${savePath}`,
        observed: envelope,
        expected: {
          format: "vespera.desktop-save.v2",
          cipher: "aes-256-gcm",
          keyVersion: 1,
          base64Fields: ["iv", "tag", "data"],
        },
      };
    }

    const snapshot = decryptSave(envelope);
    const keys = snapshot.keys;
    const validSnapshot =
      Boolean(keys) && typeof keys === "object" && !Array.isArray(keys) && snapshot.saveEra === "vespera-launch-1";
    const keyNames = validSnapshot ? Object.keys(keys as Record<string, unknown>).sort() : [];
    return {
      buildId,
      id: "saveEnvelope",
      suite: "save",
      status: validSnapshot ? "PASS" : "FAIL",
      detail: validSnapshot
        ? `saveEnvelope: store=${storeAlias} saveEra=${snapshot.saveEra} keys=${keyNames.join(", ")}`
        : `saveEnvelope: decrypted snapshot missing keys object or required saveEra`,
      observed: { savePath, storeAlias, saveEra: snapshot.saveEra, keyNames },
      expected: { saveEra: "vespera-launch-1", keys: "object" },
    };
  } catch (error) {
    return {
      buildId,
      id: "saveEnvelope",
      suite: "save",
      status: "FAIL",
      detail: `saveEnvelope: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
