/**
 * The question cards the home page promotes.
 *
 * This array is data, not markup: the home page lays out any number of entries from one upward, and
 * renders no card section at all when it is empty. Which is the case here.
 *
 * A shape earns a card by being answerable from the published tables and by carrying enough measured
 * demand that the promoted set covers more than half of what players actually ask. Measured against
 * the official Discord — 1636 question-shaped messages over 35 days, 1093 of them real questions
 * about the game, 872 addressable once the systems the pipeline does not model are set aside — the
 * six answerable shapes together reach 37.0%. The threshold of 437 is unreachable, so no set of them
 * passes half and there is no dominant question to lead with.
 *
 * The consequence is deliberate: the home page leads with search and promotes the browse strip to
 * primary content, ordered by that same ranking. Filling this array with plausible-sounding cards
 * would invert the evidence, since the most obvious candidate — "where do I get this?" — ranks
 * fourth among answerable shapes at 3.6%.
 *
 * The full ranking and arithmetic live in `research/discord/vespera-discord-findings.md`, which is
 * gitignored because it derives from third-party messages. Re-derive it with
 * `tools/discord-capture.mjs` and `tools/discord-analyse.mjs`.
 */
export type QuestionCard = {
  question: string;
  subtitle: string;
  href: string;
};

export const QUESTION_CARDS: QuestionCard[] = [];
