import { guideContentLabel, hasLiveCheckedContent } from "$lib/mechanics-verification";
import { MECHANIC_CATEGORY_HEADINGS, mechanicDocuments } from "$lib/server/mechanics";
import type { PageServerLoad } from "./$types";

/**
 * Loads the guide index by system.
 * Compute the scoped label here so one rule controls every page.
 * A guide gets "selected content live checked" only when a formula or fact carries approved live evidence.
 * Deriving it in a component can make the index differ from the detail page.
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
