import { guideContentLabel, hasLiveCheckedContent } from "$lib/mechanics-verification";
import { MECHANIC_CATEGORY_HEADINGS, mechanicDocuments } from "$lib/server/mechanics";
import type { PageServerLoad } from "./$types";

/**
 * The guide index, grouped by system.
 *
 * The scoped label is computed here rather than in the component so one rule decides it: a guide
 * says "selected content live checked" only when a formula or fact inside it actually carries
 * approved live evidence. A component that re-derived this could drift from the detail page.
 */
export const load: PageServerLoad = async () => {
  const documents = await mechanicDocuments();

  const groups = MECHANIC_CATEGORY_HEADINGS.map(({ category, heading }) => ({
    category,
    heading,
    guides: documents
      .filter((document) => document.category === category)
      .map((document) => ({
        id: document.id,
        title: document.title.text,
        summary: document.summary.text,
        label: guideContentLabel(document),
        live: hasLiveCheckedContent(document),
        sections: document.sections.length,
      })),
  })).filter((group) => group.guides.length > 0);

  return { groups, guideCount: documents.length };
};
