import { CLASSES } from "$lib/classes";
import { rowsWhere, table } from "$lib/server/dataset";

export const load = () => {
  const abilities = table("abilities");
  const items = table("items");
  const classRows = table("classes");

  return {
    classes: CLASSES.map((id) => {
      const record = classRows.find((row) => row.id === id);
      return {
        id,
        name: (record?.name as string) ?? id,
        title: (record?.title as string) ?? "",
        worldRole: (record?.world_role as string) ?? "",
        image: (record?.image as string | null) ?? null,
        traits: rowsWhere("class_traits", "class_id", id).map((trait) => String(trait.label)),
        abilityCount: abilities.filter((ability) => ability.required_class === id).length,
        itemCount: items.filter((item) => item.class_requirement === id).length,
      };
    }),
  };
};
