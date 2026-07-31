import type { CdpClient } from "./cdp.ts";

export type RuntimeTable = { id: string; alias: string; count: number };

export const RUNTIME_SHAPES: { id: string; probe: string }[] = [
  { id: "items", probe: '"rarity" in v && "stackable" in v' },
  { id: "enemies", probe: '"maxHp" in v && "attackInterval" in v && "drops" in v' },
  { id: "recipes", probe: '"inputs" in v && "outputs" in v && "levelReq" in v' },
  { id: "gatheringNodes", probe: '"requiredTool" in v && "baseXp" in v && "drops" in v' },
  { id: "quests", probe: '"steps" in v && "rewards" in v' },
  { id: "abilities", probe: '"manaCost" in v && "cooldown" in v && "effects" in v' },
  { id: "affixes", probe: '"statTarget" in v && ("weight" in v || "valueIsPercent" in v)' },
  { id: "gems", probe: '"family" in v && "tier" in v && "stats" in v' },
  { id: "shopListings", probe: '"itemId" in v && "price" in v && "levelReq" in v' },
  {
    id: "zonesDungeons",
    probe: '"levelReq" in v && "type" in v && (v.type === "zone" || v.type === "dungeon")',
  },
  {
    id: "achievements",
    probe:
      '"requirement" in v && v.requirement && typeof v.requirement === "object" && "type" in v.requirement && "target" in v.requirement && "category" in v',
  },
];

export async function identifyTables(
  client: CdpClient,
  indexBundle: string,
): Promise<RuntimeTable[]> {
  const shapes = JSON.stringify(RUNTIME_SHAPES);
  const moduleUrl = JSON.stringify(`./assets/${indexBundle}`);
  const expression = `(async () => {
    const namespace = await import(new URL(${moduleUrl}, location.href).href);
    const shapes = ${shapes};
    const matches = new Map(shapes.map(({ id }) => [id, null]));
    for (const [alias, value] of Object.entries(namespace)) {
      if (!value || typeof value !== "object") continue;
      const count = Array.isArray(value) ? value.length : Object.keys(value).length;
      if (count === 0) continue;
      const samples = (Array.isArray(value) ? value : Object.values(value)).slice(0, 3);
      if (samples.length === 0 || samples.some((v) => !v || typeof v !== "object")) continue;
      for (const { id, probe } of shapes) {
        let accepts = false;
        try {
          const test = new Function("v", "return Boolean(" + probe + ")");
          accepts = samples.every((v) => test(v));
        } catch {}
        const previous = matches.get(id);
        if (accepts && (!previous || count > previous.count)) matches.set(id, { id, alias, count });
      }
    }
    return [...matches.values()].filter(Boolean);
  })()`;
  return client.evaluate<RuntimeTable[]>(expression, 120_000);
}
