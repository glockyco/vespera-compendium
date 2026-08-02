import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const STEAM_APP_ID = "4824420";

/** Error when the installed game or its Steam manifest cannot be read. */
export class GameUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GameUnavailableError";
  }
}

const MANIFEST = path.join(
  os.homedir(),
  "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps",
  `appmanifest_${STEAM_APP_ID}.acf`,
);

/** Reads the installed build ID from the Steam app manifest in the CrossOver bottle. */
export function readInstalledBuildId(): string {
  let source: string;
  try {
    source = readFileSync(MANIFEST, "utf8");
  } catch (cause) {
    throw new GameUnavailableError(`Steam manifest not readable: ${MANIFEST}`, { cause });
  }
  const match = source.match(/"buildid"\s+"(\d+)"/);
  if (!match) throw new GameUnavailableError(`buildid not found in ${MANIFEST}`);
  return match[1]!;
}
