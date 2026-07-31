/**
 * Published table names are snake_case identifiers. Replacing the underscores reads correctly for
 * all but the compound names, where a mechanical rewrite drops the conjunction, so those are listed.
 */
const OVERRIDES: Record<string, string> = {
  zones_dungeons: "Zones and dungeons",
  gathering_node_drops: "Gathering node drops",
};

export function tableLabel(name: string): string {
  const override = OVERRIDES[name];
  if (override) return override;
  const label = name.replace(/_/g, " ");
  return label.length === 0 ? label : `${label[0]!.toUpperCase()}${label.slice(1)}`;
}
