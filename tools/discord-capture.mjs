/**
 * Community-evidence capture from an already-authenticated Discord web client.
 *
 * Why this shape, rather than reading the DOM or calling the REST API directly:
 *
 * - The rendered client ships obfuscated class names that change between deploys, so any selector
 *   written against them rots. The client's own `/api/v9/channels/<id>/messages` responses are the
 *   same data before it reaches the DOM, and their shape is documented and stable. We attach a
 *   response listener and let the client fetch; nothing here forges a request.
 * - Calling the API ourselves would need the account token. The client holds it in module scope and
 *   attaches it per request, so lifting it is a deliberate act we decline: this module never reads,
 *   stores or transmits a credential. It only observes responses to requests the user's own client
 *   already made.
 * - Discord ids are snowflakes: `(unixMillis - 1420070400000) << 22`. That makes a date a position
 *   in the channel, so a bounded sweep deep-links to the cutoff instant and walks forward, instead
 *   of scrolling up through a history of unknown depth. This is the pagination model
 *   DiscordChatExporter uses (`before`/`after` snowflakes); we apply it to the client's scroller.
 *
 * Privacy: `normalizeMessage` keeps the author's numeric id and drops display name, nickname and
 * avatar. Captures belong in `research/discord/`, which `.gitignore` excludes, so third-party
 * messages stay on the machine that captured them and no published artifact quotes a user.
 *
 * Captures are incremental archives. Re-running adds the tail and preserves everything already
 * stored, so a rolling analysis window never costs a re-download of history already on disk.
 *
 * This module imports nothing beyond `node:fs` and `node:path`. It is driven by injecting a
 * puppeteer `page`, so it runs unchanged under the agent browser tool or a plain puppeteer script.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Discord's epoch: 2015-01-01T00:00:00Z, in Unix milliseconds. */
export const DISCORD_EPOCH = 1420070400000n;

/** The lowest snowflake that can name a message sent at or after `date`. */
export function snowflakeFor(date) {
  const millis = BigInt(date instanceof Date ? date.getTime() : Date.parse(date));
  return String((millis - DISCORD_EPOCH) << 22n);
}

/** The instant a snowflake was minted. */
export function dateOfSnowflake(id) {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/**
 * One captured message. Deliberately narrow: everything a question-shape analysis needs and nothing
 * that identifies a person beyond the id needed to tell two authors apart.
 */
export function normalizeMessage(raw, channelName) {
  return {
    id: raw.id,
    channel: channelName,
    channelId: raw.channel_id,
    ts: raw.timestamp,
    editedTs: raw.edited_timestamp ?? null,
    authorId: raw.author?.id ?? null,
    bot: Boolean(raw.author?.bot),
    // `type` 0 is a normal message and 19 is a reply; joins, pins and boosts are other values and
    // carry no prose, so the analyser filters on this rather than on empty content.
    type: raw.type,
    content: raw.content ?? "",
    replyToId: raw.referenced_message?.id ?? raw.message_reference?.message_id ?? null,
    threadId: raw.thread?.id ?? null,
    attachments: (raw.attachments ?? []).map((a) => ({
      name: a.filename,
      bytes: a.size,
      contentType: a.content_type ?? null,
    })),
    embedTitles: (raw.embeds ?? []).map((e) => e.title).filter(Boolean),
    pinned: Boolean(raw.pinned),
    reactionCount: (raw.reactions ?? []).reduce((sum, r) => sum + (r.count ?? 0), 0),
  };
}

const MESSAGES_ROUTE = /\/api\/v\d+\/channels\/(\d+)\/messages(?:\?|$)/;
const PINS_ROUTE = /\/api\/v\d+\/channels\/(\d+)\/(?:messages\/)?pins/;
const THREADS_ROUTE = /\/api\/v\d+\/channels\/(\d+)\/threads\/search/;

/**
 * Watches the client's traffic and accumulates every message it receives, deduplicated by id.
 *
 * Response bodies must be read while the response is still live, so parsing happens inside the
 * listener and failures are swallowed: a body already consumed by the client, or discarded by a
 * navigation, is normal and must not abort a sweep.
 */
export function attachCollector(page, channelName = null) {
  const messages = new Map();
  const pins = new Map();
  const threads = new Map();
  const errors = [];

  const onResponse = async (response) => {
    const url = response.url();
    if (response.status() !== 200) return;
    const isMessages = MESSAGES_ROUTE.test(url);
    const isPins = PINS_ROUTE.test(url);
    const isThreads = THREADS_ROUTE.test(url);
    if (!isMessages && !isPins && !isThreads) return;
    try {
      const body = await response.json();
      if (isThreads) {
        for (const thread of body?.threads ?? []) {
          threads.set(thread.id, {
            id: thread.id,
            name: thread.name,
            parentId: thread.parent_id,
            messageCount: thread.message_count ?? null,
            createdAt: thread.thread_metadata?.create_timestamp ?? null,
          });
        }
        return;
      }
      // Pins arrive either as a bare array (older route) or wrapped in `{ items: [{ message }] }`.
      const list = Array.isArray(body) ? body : (body?.items ?? []).map((i) => i.message ?? i);
      for (const raw of list) {
        if (!raw?.id) continue;
        const message = normalizeMessage(raw, channelName);
        if (isPins) pins.set(raw.id, { ...message, pinned: true });
        else messages.set(raw.id, message);
        // A reply embeds the message it answers; keeping it recovers context the scroller may
        // never render on its own.
        if (raw.referenced_message?.id && !messages.has(raw.referenced_message.id)) {
          messages.set(raw.referenced_message.id, normalizeMessage(raw.referenced_message, channelName));
        }
        if (raw.thread?.id) {
          threads.set(raw.thread.id, {
            id: raw.thread.id,
            name: raw.thread.name,
            parentId: raw.thread.parent_id ?? raw.channel_id,
            messageCount: raw.thread.message_count ?? null,
            createdAt: raw.thread.thread_metadata?.create_timestamp ?? null,
          });
        }
      }
    } catch (error) {
      if (errors.length < 8) errors.push(String(error).slice(0, 160));
    }
  };

  page.on("response", onResponse);
  return {
    messages,
    pins,
    threads,
    errors,
    detach: () => page.off("response", onResponse),
    /** Oldest captured instant, as Unix millis, or `Infinity` when nothing has arrived yet. */
    oldestMillis() {
      let oldest = Infinity;
      for (const message of messages.values()) oldest = Math.min(oldest, Date.parse(message.ts));
      return oldest;
    },
  };
}

/**
 * The client's message scroller. Found by structure — the element that both scrolls and contains
 * the message list — because every class name in the tree is a build-specific hash.
 */
async function scrollBy(page, ratio) {
  return page.evaluate((step) => {
    const list = document.querySelector('[data-list-id="chat-messages"]');
    if (!list) return { ok: false };
    let scroller = list.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 20) {
      scroller = scroller.parentElement;
    }
    // A channel short enough to fit the viewport has no scroller at all. That is the whole channel
    // on screen, not a broken lookup, so it reports as already at both ends.
    if (!scroller) return { ok: true, fits: true, moved: false, top: 0, atBottom: true, atTop: true };
    const before = scroller.scrollTop;
    scroller.scrollTop = before + Math.round(scroller.clientHeight * step);
    return {
      ok: true,
      fits: false,
      moved: scroller.scrollTop !== before,
      top: scroller.scrollTop,
      atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8,
      atTop: scroller.scrollTop <= 2,
    };
  }, ratio);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captures one channel from `sinceIso` to the present.
 *
 * Deep-links to the snowflake for `sinceIso` so the client loads that point in history directly,
 * then walks forward to the newest message. Falls back to scrolling up from the bottom when the
 * anchor does not resolve, which happens when the channel's history starts after the cutoff.
 *
 * Resumable: an existing capture whose `complete` flag is set is returned untouched, so a
 * multi-channel sweep can be run in slices without losing work.
 */
/**
 * Captures one channel incrementally, merging into whatever an earlier run already stored.
 *
 * The file on disk is an archive, not a snapshot of one run: messages accumulate, and the window a
 * given analysis cares about is applied when reading, never when writing. Re-running tomorrow with
 * a rolling cutoff therefore adds the new tail instead of discarding yesterday's history.
 *
 * Two things make that cheap. Every sweep walks *forward* to the newest message, and the anchor it
 * starts from is chosen from stored coverage:
 *
 * - Nothing stored, or stored history does not reach back to `sinceIso` yet, so anchor at the
 *   cutoff snowflake and backfill forward.
 * - History already reaches the cutoff, so anchor at the newest message we hold. The client opens
 *   at that point and the sweep only pages through what arrived since.
 *
 * When a backfill anchored at the cutoff returns nothing older than the anchor, the channel simply
 * has no history that old. That is recorded as `startsAfterCutoff` so later runs stop re-checking
 * a beginning that will never move.
 */
export async function sweepChannel({
  page,
  guildId,
  channelId,
  name,
  sinceIso,
  outDir,
  budgetMs = 120000,
  settleMs = 900,
  /** Skip a channel already refreshed this recently, so a budgeted multi-call sweep converges. */
  refreshAfterMs = 6 * 60 * 60 * 1000,
}) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}.json`);
  const prior = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const cutoffMillis = Date.parse(sinceIso);

  const covered = coverageOf(prior, cutoffMillis);
  if (
    prior &&
    covered.backfilled &&
    prior.reachedNewest &&
    Date.now() - Date.parse(prior.capturedAt) < refreshAfterMs
  ) {
    return { ...summarize(prior), skipped: "fresh" };
  }

  // Anchor: the cutoff while history is still short of it, otherwise the newest message we hold.
  const anchor = covered.backfilled && covered.newestId ? covered.newestId : snowflakeFor(sinceIso);
  const anchoredAtTail = anchor === covered.newestId;

  const collector = attachCollector(page, name);
  const deadline = Date.now() + budgetMs;
  let reachedNewest = false;
  let stagnant = 0;
  let iterations = 0;

  try {
    await page
      .goto(`https://discord.com/channels/${guildId}/${channelId}/${anchor}`, {
        waitUntil: "domcontentloaded",
      })
      .catch(() => {});
    await sleep(6000);

    while (Date.now() < deadline && stagnant < 8) {
      iterations++;
      const before = collector.messages.size;
      const step = await scrollBy(page, 0.8);
      await sleep(settleMs);
      if (!step.ok) {
        stagnant += 2;
        continue;
      }
      if (step.atBottom) {
        // Let anything still in flight append before declaring the end of the channel.
        await sleep(step.fits ? 700 : 1300);
        if (collector.messages.size === before) {
          reachedNewest = true;
          break;
        }
      }
      stagnant = collector.messages.size === before ? stagnant + 1 : 0;
    }

    await capturePins(page);
    await sleep(1500);
  } finally {
    collector.detach();
  }

  const merged = new Map();
  for (const message of prior?.messages ?? []) merged.set(message.id, message);
  const added = [];
  for (const [id, message] of collector.messages) {
    if (!merged.has(id)) added.push(id);
    merged.set(id, message);
  }
  const messages = [...merged.values()].sort((l, r) => Date.parse(l.ts) - Date.parse(r.ts));

  const mergedPins = new Map((prior?.pins ?? []).map((pin) => [pin.id, pin]));
  for (const [id, pin] of collector.pins) mergedPins.set(id, pin);
  const pins = [...mergedPins.values()].sort((l, r) => Date.parse(l.ts) - Date.parse(r.ts));

  const threads = new Map((prior?.threads ?? []).map((thread) => [thread.id, thread]));
  for (const thread of collector.threads.values()) {
    if (thread.parentId === channelId) threads.set(thread.id, thread);
  }

  // A cutoff-anchored pass that surfaced nothing older than the anchor proves the channel has no
  // history that far back, so the backfill is done for good rather than retried every run.
  const oldestMillis = messages.length > 0 ? Date.parse(messages[0].ts) : Infinity;
  const startsAfterCutoff =
    prior?.startsAfterCutoff || (!anchoredAtTail && iterations > 0 && oldestMillis > cutoffMillis);

  const record = {
    channel: name,
    channelId,
    capturedAt: new Date().toISOString(),
    /** Every sweep that touched this archive, so a partial capture is auditable rather than implied. */
    runs: [
      ...(prior?.runs ?? []),
      {
        at: new Date().toISOString(),
        anchor: anchoredAtTail ? "tail" : "cutoff",
        sinceIso,
        iterations,
        added: added.length,
        reachedNewest,
      },
    ].slice(-20),
    reachedNewest,
    startsAfterCutoff,
    /** The contiguous span this archive holds, which is what the next run resumes from. */
    coverage: {
      from: messages[0]?.ts ?? null,
      to: messages.at(-1)?.ts ?? null,
      newestId: messages.at(-1)?.id ?? null,
      reachesCutoff: startsAfterCutoff || oldestMillis <= cutoffMillis,
    },
    count: messages.length,
    addedThisRun: added.length,
    pinCount: pins.length,
    oldest: messages[0]?.ts ?? null,
    newest: messages.at(-1)?.ts ?? null,
    threads: [...threads.values()],
    collectorErrors: collector.errors,
    pins,
    messages,
  };
  writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`);
  return summarize(record);
}

/** What an archive already holds, which decides where the next sweep anchors. */
function coverageOf(prior, cutoffMillis) {
  if (!prior || !prior.messages?.length) return { backfilled: false, newestId: null };
  const oldest = Date.parse(prior.messages[0].ts);
  return {
    backfilled: Boolean(prior.startsAfterCutoff) || oldest <= cutoffMillis,
    newestId: prior.coverage?.newestId ?? prior.messages.at(-1).id,
  };
}

/**
 * Opens the pinned-message popout so the client fetches pins, which the collector then sees.
 *
 * The control is a `div[role="button"]`, and calling `.click()` on it does nothing: the client
 * drives this from pointer events, so the whole sequence has to be dispatched. Returns what the
 * popout said, which is what distinguishes a channel with no pins from a click that never landed.
 */
export async function capturePins(page) {
  const opened = await page
    .evaluate(() => {
      const button = document.querySelector('[role="button"][aria-label="Pinned Messages"]');
      if (!button) return false;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    })
    .catch(() => false);
  if (!opened) return { opened: false, empty: null };
  await sleep(2500);
  const empty = await page
    .evaluate(() => {
      const popout = document.querySelector('[class*="popout"], [role="dialog"]');
      const text = popout ? popout.innerText : "";
      // Dismiss it so the next channel's header is clickable.
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return /doesn't have any/i.test(text);
    })
    .catch(() => null);
  return { opened: true, empty };
}

/**
 * Collects pins for every already-captured channel and merges them into its archive.
 *
 * Pins are not time-bounded the way a message sweep is: a pin from before the cutoff is still the
 * highest-signal message in a channel, so this runs over the whole roster independently.
 */
export async function sweepPins({ page, guildId, outDir, budgetMs = 240000 }) {
  const rosterFile = path.join(outDir, "_roster.json");
  if (!existsSync(rosterFile)) throw new Error(`no roster in ${outDir} — run discoverChannels first`);
  const roster = JSON.parse(readFileSync(rosterFile, "utf8"));
  const deadline = Date.now() + budgetMs;
  const results = [];

  for (const channel of roster.channels) {
    if (channel.kind === "voice" || channel.kind === "forum") continue;
    if (Date.now() > deadline) {
      results.push({ channel: channel.name, deferred: true });
      continue;
    }
    const file = path.join(outDir, `${channel.name}.json`);
    if (!existsSync(file)) continue;
    const record = JSON.parse(readFileSync(file, "utf8"));
    if (record.pinsCheckedAt) {
      results.push({ channel: channel.name, pins: record.pinCount, skipped: "checked" });
      continue;
    }

    const collector = attachCollector(page, channel.name);
    let outcome;
    try {
      await page
        .goto(`https://discord.com/channels/${guildId}/${channel.id}`, { waitUntil: "domcontentloaded" })
        .catch(() => {});
      await sleep(5500);
      outcome = await capturePins(page);
      await sleep(1200);
    } finally {
      collector.detach();
    }

    const pins = new Map((record.pins ?? []).map((pin) => [pin.id, pin]));
    for (const [id, pin] of collector.pins) pins.set(id, pin);
    record.pins = [...pins.values()].sort((l, r) => Date.parse(l.ts) - Date.parse(r.ts));
    record.pinCount = record.pins.length;
    record.pinsCheckedAt = new Date().toISOString();
    record.pinsEmptyState = outcome?.empty ?? null;
    writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`);
    results.push({ channel: channel.name, pins: record.pinCount, empty: outcome?.empty, opened: outcome?.opened });
  }
  return results;
}

function summarize(record) {
  return {
    channel: record.channel,
    count: record.count,
    added: record.addedThisRun ?? 0,
    pins: record.pinCount,
    threads: record.threads?.length ?? 0,
    oldest: record.oldest,
    newest: record.newest,
    reachedNewest: record.reachedNewest,
    reachesCutoff: record.coverage?.reachesCutoff ?? false,
    iterations: record.runs?.at(-1)?.iterations ?? 0,
  };
}

/**
 * Lists a forum channel's posts. Each post is its own thread channel, so the caller sweeps them
 * with `sweepChannel` using the thread id — a forum's parent channel holds no messages of its own.
 */
export async function listForumThreads({ page, guildId, channelId }) {
  const collector = attachCollector(page, null);
  try {
    await page
      .goto(`https://discord.com/channels/${guildId}/${channelId}`, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    await sleep(6000);
    for (let index = 0; index < 6; index++) {
      await page
        .evaluate(() => {
          const scroller = [...document.querySelectorAll("div")].find(
            (node) => node.scrollHeight > node.clientHeight + 200 && node.clientHeight > 300,
          );
          if (scroller) scroller.scrollTop += scroller.clientHeight;
        })
        .catch(() => {});
      await sleep(1200);
    }
  } finally {
    collector.detach();
  }
  return [...collector.threads.values()];
}

/**
 * Reads the guild's channel roster from the client's own sidebar.
 *
 * Discovered rather than hardcoded: a roster committed to a file goes stale the first time the
 * server adds a channel, and a stale roster fails silently by capturing less than it claims to.
 * The sidebar's `aria-label` carries both the name and the channel kind, which is the one part of
 * this tree that is not a build-specific hash.
 */
export async function discoverChannels({ page, guildId }) {
  await page
    .goto(`https://discord.com/channels/${guildId}`, { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await sleep(7000);
  return page.evaluate(() => {
    const seen = new Map();
    for (const anchor of document.querySelectorAll('a[data-list-item-id^="channels___"]')) {
      const href = anchor.getAttribute("href") ?? "";
      const id = href.split("/").pop() ?? "";
      if (!/^\d+$/.test(id) || seen.has(id)) continue;
      const label = anchor.getAttribute("aria-label") ?? "";
      // The label carries unread state and the channel kind around the name, for example
      // "unread, new-player-questions (text channel)".
      const match = /^(?:unread,\s*)?(.*?)\s*\((\w+) channel\)$/.exec(label);
      const rawName = (match?.[1] ?? label).trim();
      seen.set(id, {
        id,
        // Leading emoji are decoration in the server's own taxonomy; the slug is what people cite.
        name: rawName.replace(/^[^\p{L}\p{N}]+/u, ""),
        displayName: rawName,
        kind: (anchor.innerText || "").trim().split("\n")[0].toLowerCase(),
        access: match?.[2] ?? "unknown",
      });
    }
    const sidebar = document.querySelector('nav[class*="sidebar"], div[class*="sidebarList"]');
    return { channels: [...seen.values()], sidebarText: sidebar ? sidebar.innerText : "" };
  });
}

/**
 * Sweeps a whole guild within one time budget, writing one file per channel plus a roster file.
 *
 * Callers run this repeatedly: every completed channel is skipped on the next pass, so a harness
 * that caps a single call at a few minutes still converges on a full capture.
 */
export async function runSweep({
  page,
  guildId,
  sinceIso,
  outDir,
  budgetMs = 240000,
  perChannelMs = 90000,
}) {
  mkdirSync(outDir, { recursive: true });
  const rosterFile = path.join(outDir, "_roster.json");
  let roster;
  if (existsSync(rosterFile)) {
    roster = JSON.parse(readFileSync(rosterFile, "utf8"));
  } else {
    roster = await discoverChannels({ page, guildId });
    writeFileSync(rosterFile, `${JSON.stringify(roster, null, 1)}\n`);
  }

  const deadline = Date.now() + budgetMs;
  const results = [];
  for (const channel of roster.channels) {
    if (channel.kind === "voice") continue;
    if (Date.now() > deadline) {
      results.push({ channel: channel.name, deferred: true });
      continue;
    }
    const budget = Math.min(perChannelMs, deadline - Date.now());
    if (channel.kind === "forum") {
      results.push(...(await sweepForum({ page, guildId, channel, sinceIso, outDir, budgetMs: budget })));
      continue;
    }
    results.push(
      await sweepChannel({
        page,
        guildId,
        channelId: channel.id,
        name: channel.name,
        sinceIso,
        outDir,
        budgetMs: budget,
      }),
    );
  }
  return { rosterSize: roster.channels.length, results };
}

/** A forum holds no messages of its own; each post is a thread channel swept in its own right. */
async function sweepForum({ page, guildId, channel, sinceIso, outDir, budgetMs }) {
  const deadline = Date.now() + budgetMs;
  const listFile = path.join(outDir, `_forum_${channel.name}.json`);
  let threads;
  if (existsSync(listFile)) {
    threads = JSON.parse(readFileSync(listFile, "utf8"));
  } else {
    threads = await listForumThreads({ page, guildId, channelId: channel.id });
    writeFileSync(listFile, `${JSON.stringify(threads, null, 1)}\n`);
  }
  const out = [];
  for (const thread of threads) {
    if (Date.now() > deadline) {
      out.push({ channel: `${channel.name}/${thread.id}`, deferred: true });
      continue;
    }
    out.push(
      await sweepChannel({
        page,
        guildId,
        channelId: thread.id,
        name: `${channel.name}__${thread.id}`,
        sinceIso,
        outDir,
        budgetMs: Math.min(40000, deadline - Date.now()),
      }),
    );
  }
  return out;
}

/**
 * Sweeps the threads a text channel spawned. Thread messages never appear in the parent scroller,
 * so a capture that skips them loses whole conversations.
 */
export async function sweepThreadsOf({ page, guildId, name, outDir, sinceIso, budgetMs = 90000 }) {
  const file = path.join(outDir, `${name}.json`);
  if (!existsSync(file)) return [];
  const parent = JSON.parse(readFileSync(file, "utf8"));
  const deadline = Date.now() + budgetMs;
  const out = [];
  for (const thread of parent.threads ?? []) {
    if (Date.now() > deadline) break;
    out.push(
      await sweepChannel({
        page,
        guildId,
        channelId: thread.id,
        name: `${name}__thread_${thread.id}`,
        sinceIso,
        outDir,
        budgetMs: Math.min(40000, deadline - Date.now()),
      }),
    );
  }
  return out;
}
