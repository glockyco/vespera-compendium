import { CLASSES } from "$lib/classes";
import { table } from "$lib/server/dataset";

export const load = () => {
  const abilities = table("abilities");
  const items = table("items");

  return {
    classes: CLASSES.map((id) => {
      const classAbilities = abilities.filter((ability) => ability.required_class === id);
      const ultimate = classAbilities.find((ability) => ability.category === "ultimate");
      return {
        id,
        abilityCount: classAbilities.length,
        itemCount: items.filter((item) => item.class_requirement === id).length,
        image: (ultimate?.image as string | null) ?? (classAbilities[0]?.image as string | null) ?? null,
      };
    }),
  };
};
