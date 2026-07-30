import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type ResolvedBundles = { index: string; gameView: string; all: string[] };

export function resolveBundles(dir: string): ResolvedBundles {
  const assets = path.join(dir, "assets");
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  const grab = (source: string): string[] =>
    [...source.matchAll(/(?:src|href|from\s+)["'](?:\.\/)?(?:assets\/)?([A-Za-z0-9._-]+\.js)/g)].map(
      (match) => match[1]!,
    );

  let hrefs = grab(html);
  for (const entry of hrefs.filter((href) => /bootstrap/.test(href))) {
    const file = path.join(assets, entry);
    if (existsSync(file)) hrefs = hrefs.concat(grab(readFileSync(file, "utf8")));
  }

  const files = readdirSync(assets);
  const pick = (pattern: RegExp): string | undefined =>
    hrefs.find((href) => pattern.test(href)) ?? files.find((file) => pattern.test(file));
  const index = pick(/^index-.*\.js$/);
  const gameView = pick(/^GameView-.*\.js$/);
  if (!index || !gameView) {
    throw new Error(`could not resolve bundles (index=${index}, gameView=${gameView})`);
  }
  return { index, gameView, all: [...new Set(hrefs)] };
}
