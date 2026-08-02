/**
 * Defines the question cards that the home page promotes.
 *
 * This array is data, not markup. The home page shows any number of entries.
 * An empty array shows no card section. This array is empty.
 *
 * A shape earns a card when published tables can answer it and measured demand supports it.
 * The promoted set must cover more than half of player questions.
 * The official Discord produced 1,636 question-shaped messages over 35 days.
 * Of these, 1,093 were real game questions and 872 were addressable by the pipeline.
 * Six answerable shapes reach 37.0%. The threshold is 437, so no shape reaches half.
 *
 * The home page therefore leads with search and the browse strip.
 * Plausible cards invert the evidence. "Where do I get this?" ranks fourth at 3.6%.
 *
 * The full ranking and arithmetic stay in `research/discord/vespera-discord-findings.md`.
 * The file is gitignored because it uses third-party messages.
 * Re-derive it with `tools/discord-capture.mjs` and `tools/discord-analyse.mjs`.
 */
export type QuestionCard = {
  question: string;
  subtitle: string;
  href: string;
};

export const QUESTION_CARDS: QuestionCard[] = [];
