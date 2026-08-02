import { error } from "@sveltejs/kit";
import { ABILITY_CATEGORY_ORDER, CLASSES, isClassId, SLOTS } from "$lib/classes";
import { rowsWhere, table } from "$lib/server/dataset";
import { mechanicDocuments, mechanicLinksFor } from "$lib/server/mechanics";

export const entries = () => CLASSES.map((id) => ({ class: id }));

/**
 * One class: its ability ladder and its gear, slot by slot.
 *
 * All nine slots are returned even when a class has no restricted item for one. In the current data
 * `ring2` and `relic1` are empty for every class, and omitting them would make the page look like
 * the game has seven slots.
 */
export const load = async ({ params }: { params: { class: string } }) => {
  if (!isClassId(params.class)) throw error(404, `Unknown class: ${params.class}`);
  const classId = params.class;

  const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

  const abilities = table("abilities")
    .filter((ability) => ability.required_class === classId)
    .map((ability) => ({
      id: String(ability.id),
      name: String(ability.name ?? ability.id),
      image: (ability.image as string | null) ?? null,
      category: String(ability.category ?? "normal"),
      subclass: (ability.required_subclass as string | null) ?? null,
      combatLevel: num(ability.combat_level),
      manaCost: num(ability.mana_cost),
      cooldown: num(ability.cooldown),
      description: (ability.description as string | null) ?? null,
      effects: rowsWhere("ability_effects", "ability_id", String(ability.id)).map((effect) => ({
        type: String(effect.type ?? ""),
        value: num(effect.value),
        isPercent: effect.is_percent === true,
        stat: (effect.stat as string | null) ?? null,
        target: (effect.target as string | null) ?? null,
        duration: num(effect.duration),
      })),
    }))
    .sort((left, right) => {
      const rank = (category: string): number => {
        const index = (ABILITY_CATEGORY_ORDER as readonly string[]).indexOf(category);
        return index === -1 ? ABILITY_CATEGORY_ORDER.length : index;
      };
      return rank(left.category) - rank(right.category) || (left.combatLevel ?? 0) - (right.combatLevel ?? 0);
    });

  const classItems = table("items").filter((item) => item.class_requirement === classId);

  const record = table("classes").find((row) => row.id === classId);
  const profile = {
    name: (record?.name as string) ?? classId,
    title: (record?.title as string) ?? "",
    description: (record?.description as string) ?? "",
    focus: (record?.focus as string) ?? "",
    worldRole: (record?.world_role as string) ?? "",
    image: (record?.image as string | null) ?? null,
    traits: rowsWhere("class_traits", "class_id", classId).map((trait) => ({
      label: String(trait.label ?? ""),
      tip: String(trait.tip ?? ""),
    })),
  };

  const slots = SLOTS.map((slot) => ({
    slot,
    items: classItems
      .filter((item) => item.slot === slot)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name ?? item.id),
        image: (item.image as string | null) ?? null,
        rarity: (item.rarity as string | null) ?? null,
        level: num(item.level),
        levelSource: String(item.level_source ?? "unknown"),
      }))
      .sort((left, right) => (left.level ?? 0) - (right.level ?? 0)),
  }));

  // The class page is a bespoke route rather than the generic record detail, so it has to ask for its guide
  // links explicitly. The map is the same exhaustive one every mapped table uses.
  const guides = mechanicLinksFor("classes", { id: classId }, await mechanicDocuments());

  return { classId, profile, abilities, slots, itemCount: classItems.length, guides };
};
