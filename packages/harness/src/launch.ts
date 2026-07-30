import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, type CdpClient } from "./cdp.ts";

const GAME_DIR = path.join(
  os.homedir(),
  "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Vespera",
);
const MANIFEST = path.resolve(GAME_DIR, "../../appmanifest_4824420.acf");
const WINE = "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine";
const BOTTLE_DRIVE_C = path.join(
  os.homedir(),
  "Library/Application Support/CrossOver/Bottles/Steam/drive_c",
);

export type LaunchOptions = { devUrl?: string; port?: number; userDataName?: string };
export type Session = { client: CdpClient; buildId: string; stop(): Promise<void> };

export class HarnessUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HarnessUnavailableError";
  }
}

export function findGameDir(): string | null {
  return existsSync(path.join(GAME_DIR, "Vespera.exe")) ? GAME_DIR : null;
}

export function readBuildId(): string {
  let source: string;
  try {
    source = readFileSync(MANIFEST, "utf8");
  } catch (cause) {
    throw new HarnessUnavailableError(`Steam manifest not readable: ${MANIFEST}`, { cause });
  }
  const match = source.match(/"buildid"\s+"(\d+)"/);
  if (!match) throw new HarnessUnavailableError(`buildid not found in ${MANIFEST}`);
  return match[1]!;
}

export function winePathToHost(windowsPath: string): string {
  if (!/^C:/i.test(windowsPath)) return windowsPath;
  const relative = windowsPath.slice(2).replaceAll("\\", "/").replace(/^\/+/, "");
  return path.join(BOTTLE_DRIVE_C, relative);
}

function findGameProcessIds(port: number): number[] {
  const result = Bun.spawnSync(["pgrep", "-f", `Vespera.exe --remote-debugging-port=${port}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) return [];
  return new TextDecoder()
    .decode(result.stdout)
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function isAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessTree(processId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processId, signal);
  } catch {
    try {
      process.kill(processId, signal);
    } catch {
      // The process already exited.
    }
  }
}

async function terminateProcess(process: Bun.Subprocess, port: number): Promise<void> {
  const targets = (): number[] => [...new Set([process.pid, ...findGameProcessIds(port)])];
  for (const processId of targets()) signalProcessTree(processId, "SIGTERM");

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!targets().some(isAlive)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const processId of targets()) signalProcessTree(processId, "SIGKILL");
  await Promise.race([
    process.exited,
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
}

async function waitForRenderer(client: CdpClient, expectedUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const state = await client.evaluate<{ href: string; ready: string }>(
        "({ href: location.href, ready: document.readyState })",
        2_000,
      );
      if (state.href.includes(expectedUrl) && state.ready !== "loading") return;
    } catch {
      // Navigation can briefly replace the execution context.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`renderer did not become ready at ${expectedUrl}`);
}

export async function launchGame(opts: LaunchOptions = {}): Promise<Session> {
  const gameDir = findGameDir();
  if (!gameDir) throw new HarnessUnavailableError("game install not found");
  if (!existsSync(WINE)) throw new HarnessUnavailableError(`CrossOver wine not found: ${WINE}`);

  const port = opts.port ?? 9222;
  const buildId = readBuildId();
  const env: Record<string, string | undefined> = {
    ...process.env,
    UNNAMED_DESKTOP_USER_DATA_NAME: opts.userDataName ?? "Vespera Harness",
  };
  if (opts.devUrl) env.UNNAMED_DESKTOP_DEV_URL = opts.devUrl;

  let child: Bun.Subprocess;
  try {
    child = Bun.spawn(
      [WINE, "--bottle", "Steam", "--wait-children", "Vespera.exe", `--remote-debugging-port=${port}`],
      {
        cwd: gameDir,
        env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
      },
    );
  } catch (cause) {
    throw new HarnessUnavailableError("failed to launch Vespera through CrossOver", { cause });
  }

  let client: CdpClient;
  try {
    const expectedUrl = opts.devUrl ?? "unnamed://app";
    client = await connect(port, expectedUrl);
    await waitForRenderer(client, expectedUrl);
  } catch (cause) {
    await terminateProcess(child, port);
    throw new HarnessUnavailableError(
      `game launched but CDP was unavailable on port ${port}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  let stopped = false;
  return {
    client,
    buildId,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      client.close();
      await terminateProcess(child, port);
    },
  };
}
