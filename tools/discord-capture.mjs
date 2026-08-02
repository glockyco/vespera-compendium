/**
 * Captures community evidence from an authenticated Discord web client.
 *
 * The client sends API responses before it shows them in the DOM. The module listens for those responses and lets the client fetch them.
 * It does not forge requests. Generated class names change between deploys, so selectors based on them become stale.
 *
 * The client holds the account token in module scope and adds it to each request. This module does not read, store, or transmit that credential.
 * It observes responses to requests that the user's client already made.
 *
 * Discord IDs are snowflakes: `(unixMillis - 1420070400000) << 22`.
 * A date maps to a channel position. A bounded sweep opens at the cutoff and walks forward instead of scrolling through unknown history.
 * This is the pagination model that DiscordChatExporter uses with (`before`/`after` snowflakes).
 *
 * `normalizeMessage` keeps the author's numeric ID and drops display name, nickname, and avatar.
 * `.gitignore` excludes `research/discord/`, so captures stay on the capture machine and published artifacts quote no user.
 *
 * Captures are incremental archives. A new run adds the tail and preserves stored messages.
 * A rolling analysis window then avoids a new download of stored history.
 *
 * This module imports only `node:fs` and `node:path`.
 * It receives an injected puppeteer `page`, so it runs under the agent browser tool or a plain puppeteer script.
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
 * A captured message. The record contains the fields that question-shape analysis needs.
 * It identifies a person only by the ID that separates two authors.
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
    // Type 0 is a normal message and 19 is a reply. Other values carry no prose, so the analyser filters them out.
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
 * Watches client traffic and accumulates each message that it receives.
 *
 * Read response bodies while the response is live. The listener parses each body and ignores normal read errors.
 * The client can consume a body first, or a navigation can discard it. Neither event stops a sweep.
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
      // Pins use a bare array on the older route. The newer route wraps them in `{ items: [{ message }] }`.
      const list = Array.isArray(body) ? body : (body?.items ?? []).map((i) => i.message ?? i);
      for (const raw of list) {
        if (!raw?.id) continue;
        const message = normalizeMessage(raw, channelName);
        if (isPins) pins.set(raw.id, { ...message, pinned: true });
        else messages.set(raw.id, message);
        // A reply embeds its target. Keep that target to recover context that the scroller does not show.
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
 * Finds the client's message scroller by structure.
 * It selects the element that scrolls and contains the message list because class names change between builds.
 */
async function scrollBy(page, ratio) {
  return page.evaluate((step) => {
    const list = document.querySelector('[data-list-id="chat-messages"]');
    if (!list) return { ok: false };
    let scroller = list.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 20) {
      scroller = scroller.parentElement;
    }
    // A short channel fits the viewport and has no scroller. The whole channel is on screen, so both ends are already visible.
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
 * Captures one channel from `sinceIso` to now.
 *
 * Opens at the snowflake for `sinceIso`, then walks forward to the newest message.
 * If the anchor does not resolve, scrolls up from the bottom. This occurs when channel history starts after the cutoff.
 *
 * If an existing capture has `complete` set, returns it unchanged. A multi-channel sweep can then run in slices without losing work.
 */
/**
 * Captures one channel incrementally and merges the result into the stored archive.
 *
 * The file on disk is an archive, not a snapshot of one run. Messages accumulate.
 * The analysis window applies when the tool reads the archive, never when it writes it.
 * A new run adds the new tail instead of discarding the previous history.
 *
 * Every sweep walks forward to the newest message. The anchor comes from stored coverage.
 *
 * - If no history is stored, or it does not reach `sinceIso`, anchor at the cutoff snowflake and backfill forward.
 * - If history reaches the cutoff, anchor at the newest stored message. The client opens there and the sweep pages through new messages.
 *
 * If a cutoff-anchored backfill returns no message older than the anchor, the channel has no older history.
 * Record `startsAfterCutoff` so later runs do not repeat that search.
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
  /** Skip a channel that the tool refreshed less than this interval ago. */
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

  // Use the cutoff while history is short of it. Otherwise, use the newest stored message.
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
        // Let in-flight responses append before the tool declares the channel end.
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

  // A cutoff-anchored pass with no message older than the anchor proves that the channel has no older history.
  // The backfill then ends instead of repeating on every run.
  const oldestMillis = messages.length > 0 ? Date.parse(messages[0].ts) : Infinity;
  const startsAfterCutoff =
    prior?.startsAfterCutoff || (!anchoredAtTail && iterations > 0 && oldestMillis > cutoffMillis);

  const record = {
    channel: name,
    channelId,
    capturedAt: new Date().toISOString(),
    /** Records every sweep that touched this archive. A partial capture is then auditable. */
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
    /** Records the contiguous span that this archive holds for the next run. */
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

/** Describes the coverage that an archive already holds and selects the next anchor. */
function coverageOf(prior, cutoffMillis) {
  if (!prior || !prior.messages?.length) return { backfilled: false, newestId: null };
  const oldest = Date.parse(prior.messages[0].ts);
  return {
    backfilled: Boolean(prior.startsAfterCutoff) || oldest <= cutoffMillis,
    newestId: prior.coverage?.newestId ?? prior.messages.at(-1).id,
  };
}

/**
 * Opens the pinned-message popout so the client fetches pins for the collector.
 *
 * The control is a `div[role="button"]`. `.click()` has no effect because the client uses pointer events.
 * Dispatch the complete pointer sequence. Return the popout state to distinguish no pins from an ineffective click.
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
      // Dismiss the popout so the next channel header is clickable.
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return /doesn't have any/i.test(text);
    })
    .catch(() => null);
  return { opened: true, empty };
}

/**
 * Collects pins for every captured channel and merges them into its archive.
 *
 * Pins are not time-bounded like a message sweep. A pin from before the cutoff remains a high-signal message.
 * This operation runs over the whole roster independently.
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
 * Lists posts in a forum channel.
 * Each post is a thread channel, so the caller sweeps it with `sweepChannel` and its thread ID.
 * The forum parent channel has no messages of its own.
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
 * Reads the guild channel roster from the client's sidebar.
 *
 * Discover the roster instead of hardcoding it. A committed roster becomes stale when the server adds a channel.
 * A stale roster silently captures less data than it claims.
 * The sidebar `aria-label` carries the name and channel kind. This field is not a build-specific hash.
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
      // The label carries unread state and the channel kind around the name, for example:
      // "unread, new-player-questions (text channel)".
      const match = /^(?:unread,\s*)?(.*?)\s*\((\w+) channel\)$/.exec(label);
      const rawName = (match?.[1] ?? label).trim();
      seen.set(id, {
        id,
        // Leading emoji are decoration in the server taxonomy. The slug is the name that people cite.
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
 * Sweeps a whole guild within one time budget and writes one file per channel plus a roster file.
 *
 * Call this operation repeatedly. Each completed channel is skipped on the next pass.
 * A harness that limits one call to a few minutes can then reach a full capture.
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

/** A forum has no messages of its own. Sweep each post as a separate thread channel. */
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
 * Sweeps the threads that a text channel spawned.
 * Thread messages never appear in the parent scroller, so skipping them loses whole conversations.
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
