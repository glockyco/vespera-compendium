/**
 * Turns a Discord capture into a ranked list of question shapes, and applies the promotion rules
 * that decide which of them earn a surface on the compendium.
 *
 * The split of work here is deliberate. Everything mechanical — windowing, candidate detection,
 * counting, share arithmetic, the promotion cutoff — lives in this file so the result is
 * reproducible and can be re-derived from the capture at any time. The one judgement call, deciding
 * which shape a given message belongs to, is supplied from outside as a labels file, so a reader can
 * audit both halves separately: the labels for accuracy, this file for arithmetic.
 *
 * Nothing here reads or emits a display name, and no output quotes a message verbatim. Examples in
 * the findings are paraphrases written by the caller.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The taxonomy. `answerable` means the published dataset can answer the shape as it stands;
 * `buildable: false` marks a shape whose subject the pipeline does not model at all, which the
 * promotion rules exclude from the denominator rather than letting it absorb share.
 */
export const SHAPES = {
  acquisition: {
    question: "Where do I get this?",
    answerable: true,
    buildable: true,
    tables: ["items", "item_sources", "enemy_drops", "recipes", "gathering_nodes", "shop_listings"],
  },
  "item-compare": {
    question: "Which of these is actually better?",
    answerable: true,
    buildable: true,
    tables: ["items", "item_stats", "affixes"],
  },
  "build-loadout": {
    question: "What does my class use?",
    answerable: true,
    buildable: true,
    tables: ["abilities", "ability_effects", "ability_tags", "gems", "gem_stats", "items"],
  },
  progression: {
    question: "What should I be doing at my level?",
    answerable: true,
    buildable: true,
    tables: ["zones_dungeons", "quests", "quest_steps", "recipes", "gathering_nodes"],
  },
  "crafting-gathering": {
    question: "What do I need to craft or gather this?",
    answerable: true,
    buildable: true,
    tables: ["recipes", "recipe_inputs", "recipe_outputs", "gathering_nodes", "gathering_node_drops"],
  },
  "zone-dungeon": {
    question: "What is in this zone or dungeon?",
    answerable: true,
    buildable: true,
    tables: ["zones_dungeons", "zone_enemies", "zone_resources", "enemies", "enemy_drops"],
  },
  mechanics: {
    question: "How does this mechanic actually work?",
    // The published dataset carries values, not the formulas that combine them.
    answerable: false,
    buildable: true,
    tables: [],
  },
  "ui-client": {
    question: "How do I do this in the interface?",
    answerable: false,
    buildable: true,
    tables: [],
  },
  "unmodelled-system": {
    question: "How does one of the unmodelled systems work?",
    answerable: false,
    buildable: false,
    tables: [],
  },
  "bug-status": {
    question: "Is this a bug, or is it meant to be like this?",
    answerable: false,
    buildable: true,
    tables: [],
  },
  social: {
    question: "Conversation, not a question about the game.",
    answerable: false,
    buildable: true,
    tables: [],
  },
};

/** Loads every captured channel, keeping human prose inside the analysis window. */
export function loadCorpus(dir, { sinceIso }) {
  const start = Date.parse(sinceIso);
  const messages = [];
  const channels = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const record = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    channels.push({
      channel: record.channel,
      count: record.count,
      pins: record.pinCount,
      pinsEmptyState: record.pinsEmptyState ?? null,
      oldest: record.oldest,
      newest: record.newest,
      reachedNewest: record.reachedNewest,
    });
    for (const message of record.messages) {
      if (message.bot) continue;
      // 0 is a plain message and 19 a reply; joins, boosts and pins carry no prose.
      if (message.type !== 0 && message.type !== 19) continue;
      if (Date.parse(message.ts) < start) continue;
      const text = (message.content ?? "").trim();
      if (!text) continue;
      messages.push({
        id: message.id,
        channel: record.channel,
        ts: message.ts,
        authorId: message.authorId,
        text,
      });
    }
  }
  messages.sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  return { messages, channels };
}

/**
 * Messages that read as a question: punctuated as one, or opening with an interrogative. Cast wide
 * on purpose — the classifier below has a `social` bucket, so over-collecting here costs a label
 * rather than skewing a share, while under-collecting would silently drop real demand.
 */
const OPENER =
  /^(how|where|what|which|when|why|who|can|could|do|does|did|is|are|am|should|would|will|any(one|body|way)?|has|have|whats|wheres|hows|need help|help)\b/i;

export function questionCandidates(messages) {
  return messages.filter((message) => message.text.includes("?") || OPENER.test(message.text));
}

/**
 * Counts labels into ranked shapes.
 *
 * Two denominators matter and both are reported. `classified` is every candidate that named a real
 * question about the game, which is what a share is quoted against. `addressable` removes the
 * shapes whose subject the pipeline does not model, because a system with no data cannot be built
 * and must not absorb share that would otherwise promote a shape that can.
 */
export function aggregate(candidates, labels) {
  const counts = new Map();
  const examples = new Map();
  let unlabelled = 0;
  for (const candidate of candidates) {
    const label = labels[candidate.id];
    if (!label || !SHAPES[label]) {
      unlabelled++;
      continue;
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (!examples.has(label)) examples.set(label, []);
    if (examples.get(label).length < 6) examples.get(label).push(candidate);
  }

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const social = counts.get("social") ?? 0;
  const classified = total - social;
  const unbuildable = [...counts.entries()]
    .filter(([label]) => !SHAPES[label].buildable)
    .reduce((sum, [, n]) => sum + n, 0);
  const addressable = classified - unbuildable;

  const ranked = [...counts.entries()]
    .filter(([label]) => label !== "social")
    .map(([label, count]) => ({
      shape: label,
      question: SHAPES[label].question,
      count,
      shareOfClassified: count / classified,
      shareOfAddressable: SHAPES[label].buildable ? count / addressable : null,
      answerable: SHAPES[label].answerable,
      buildable: SHAPES[label].buildable,
      tables: SHAPES[label].tables,
      examples: examples.get(label) ?? [],
    }))
    .sort((left, right) => right.count - left.count);

  return { ranked, totals: { candidates: candidates.length, labelled: total, unlabelled, social, classified, unbuildable, addressable } };
}

/**
 * Applies the plan's promotion rules.
 *
 * Rule 1: rank answerable shapes by share and promote in descending order until the promoted set
 * covers more than half of the addressable volume. Rule 2: if that takes more than eight shapes
 * there is no dominant question, and cards are the wrong device entirely.
 */
export function promote(ranked, totals) {
  const eligible = ranked.filter((shape) => shape.answerable && shape.buildable);
  const steps = [];
  const promoted = [];
  let covered = 0;
  for (const shape of eligible) {
    promoted.push(shape);
    covered += shape.count;
    steps.push({
      shape: shape.shape,
      count: shape.count,
      cumulative: covered,
      cumulativeShare: covered / totals.addressable,
    });
    if (covered / totals.addressable > 0.5) break;
  }
  const dominant = covered / totals.addressable > 0.5 && promoted.length <= 8;
  return {
    promoted: dominant ? promoted : [],
    steps,
    covered,
    coveredShare: covered / totals.addressable,
    // Rule 2 fires when no set of eight or fewer answerable shapes reaches half the volume.
    ruleTwoFired: !dominant,
  };
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;

/** The findings document: ranked shapes, the arithmetic, and what it decides. */
export function renderFindings({ ranked, totals, promotion, window, channels, paraphrases }) {
  const lines = [];
  lines.push("# Vespera Discord — question shapes");
  lines.push("");
  lines.push(
    `Guild \`1519844431996391484\` (Vespera - Official Discord). Analysis window ${window.sinceIso} to ` +
      `${window.capturedTo}. Captured with \`tools/discord-capture.mjs\`, analysed with ` +
      `\`tools/discord-analyse.mjs\`.`,
  );
  lines.push("");
  lines.push("No message is quoted. Examples are paraphrases and no author is named.");
  lines.push("");
  lines.push("## Volume");
  lines.push("");
  lines.push(`- Channels captured: ${channels.length}`);
  lines.push(`- Human prose messages in window: ${window.prose}`);
  lines.push(`- Question-shaped candidates: ${totals.candidates}`);
  lines.push(`- Labelled: ${totals.labelled}${totals.unlabelled ? ` (${totals.unlabelled} unlabelled)` : ""}`);
  lines.push(`- Conversation rather than a question about the game: ${totals.social}`);
  lines.push(`- **Classified questions: ${totals.classified}**`);
  lines.push(`- Of those, about a system the pipeline does not model: ${totals.unbuildable}`);
  lines.push(`- **Addressable denominator: ${totals.addressable}**`);
  lines.push("");
  lines.push("## Ranked shapes");
  lines.push("");
  lines.push("| # | Shape | Count | Share of classified | Answerable | Tables |");
  lines.push("|---|---|---|---|---|---|");
  ranked.forEach((shape, index) => {
    const answerable = !shape.buildable ? "no — unmodelled" : shape.answerable ? "yes" : "no";
    lines.push(
      `| ${index + 1} | ${shape.question} | ${shape.count} | ${percent(shape.shareOfClassified)} | ` +
        `${answerable} | ${shape.tables.length ? shape.tables.slice(0, 4).join(", ") : "—"} |`,
    );
  });
  lines.push("");
  lines.push("## Paraphrased examples");
  lines.push("");
  for (const shape of ranked) {
    const notes = paraphrases[shape.shape];
    if (!notes) continue;
    lines.push(`- **${shape.question}** (${shape.shape}) — ${notes}`);
  }
  lines.push("");
  lines.push("## Promotion arithmetic");
  lines.push("");
  lines.push(
    `Answerable shapes promoted in descending share until the promoted set passes half of the ` +
      `addressable ${totals.addressable}, so the threshold is ${Math.floor(totals.addressable / 2) + 1}.`,
  );
  lines.push("");
  lines.push("| Step | Shape | Count | Cumulative | Cumulative share |");
  lines.push("|---|---|---|---|---|");
  promotion.steps.forEach((step, index) => {
    lines.push(
      `| ${index + 1} | ${step.shape} | ${step.count} | ${step.cumulative} | ${percent(step.cumulativeShare)} |`,
    );
  });
  lines.push("");
  if (promotion.ruleTwoFired) {
    lines.push(
      `**Rule 2 fired.** No set of eight or fewer answerable shapes reaches half the addressable ` +
        `volume (best was ${percent(promotion.coveredShare)}). There is no dominant question, so the ` +
        `home page drops question cards, leads with search, and promotes the browse strip to primary ` +
        `content ordered by this ranking.`,
    );
  } else {
    lines.push(
      `**Promoted: ${promotion.promoted.length} shapes**, covering ${promotion.covered} of ` +
        `${totals.addressable} addressable questions (${percent(promotion.coveredShare)}). These become ` +
        `the home-page cards, in this order.`,
    );
    lines.push("");
    promotion.promoted.forEach((shape, index) => {
      lines.push(`${index + 1}. ${shape.question} — ${shape.count} (${percent(shape.shareOfClassified)})`);
    });
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/** The capture document: what was collected, from where, and how completely. */
export function renderCapture({ channels, window, totals }) {
  const lines = [];
  lines.push("# Vespera Discord — raw capture");
  lines.push("");
  lines.push(
    `Guild \`1519844431996391484\`. Captured with \`tools/discord-capture.mjs\` by observing the ` +
      `authenticated web client's own message responses. Archives live in \`research/discord/\`, ` +
      `which is gitignored: these are third-party messages and none is quoted downstream.`,
  );
  lines.push("");
  lines.push(`Window: ${window.sinceIso} to ${window.capturedTo}. Human prose in window: ${window.prose}.`);
  lines.push("");
  lines.push("## Channels");
  lines.push("");
  lines.push("| Channel | Messages | Oldest | Newest | Reached newest | Pins |");
  lines.push("|---|---|---|---|---|---|");
  for (const channel of [...channels].sort((l, r) => r.count - l.count)) {
    const pins = channel.pins > 0 ? String(channel.pins) : channel.pinsEmptyState ? "0 (verified empty)" : "0";
    lines.push(
      `| ${channel.channel} | ${channel.count} | ${channel.oldest?.slice(0, 10) ?? "—"} | ` +
        `${channel.newest?.slice(0, 10) ?? "—"} | ${channel.reachedNewest ? "yes" : "no"} | ${pins} |`,
    );
  }
  lines.push("");
  lines.push(`Total captured messages: ${window.captured}. Question-shaped candidates: ${totals.candidates}.`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
