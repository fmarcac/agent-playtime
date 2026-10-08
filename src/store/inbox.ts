import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Envelope } from '../core/events.js';
import type { Paths } from './paths.js';
import { isMissingFile, parseJsonl, readJsonl, toJsonl } from './jsonl.js';
import type { ReadResult } from './jsonl.js';

/**
 * The inbox is a directory holding one file per event.
 *
 * Hooks fire concurrently, and a shell cannot promise a large payload goes out
 * in a single write, so appends to one shared file could interleave and tear
 * each other's lines. Each writer instead fills a dot-prefixed temporary file
 * and renames it into place, which is atomic, so the daemon only ever sees
 * whole events. `events.jsonl` is still drained for anything an older shim left.
 */
export function inboxDir(paths: Paths): string {
  return dirname(paths.inbox);
}

const EVENT_SUFFIX = '.json';

/** A writer killed between creating and renaming its file leaves this behind. */
const ABANDONED_MS = 10 * 60_000;

/** Breaks ties between events one process writes within the same millisecond. */
let sequence = 0;

/** Writes one envelope. Used by the in-process plugins and by tests; shell hooks write their own. */
export async function appendEnvelope(paths: Paths, envelope: Envelope): Promise<void> {
  // Taken before the first await, so the name records the order of the calls
  // even when the writes themselves finish out of order.
  sequence += 1;
  const name = `${envelope.ts}.${process.pid}.${String(sequence).padStart(9, '0')}`;

  const dir = inboxDir(paths);
  await mkdir(dir, { recursive: true });
  const staging = join(dir, `.${name}.tmp`);
  try {
    await writeFile(staging, toJsonl([envelope]), 'utf8');
    await rename(staging, join(dir, `${name}${EVENT_SUFFIX}`));
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

/** The legacy single-file inbox, renamed aside before being read. */
async function drainLegacy(paths: Paths): Promise<ReadResult<Envelope>> {
  const staging = `${paths.inbox}.draining.${process.pid}`;

  try {
    await rename(paths.inbox, staging);
  } catch (error) {
    if (isMissingFile(error)) return { items: [], corrupt: 0 };
    throw error;
  }

  try {
    return await readJsonl<Envelope>(staging);
  } finally {
    await rm(staging, { force: true });
  }
}

async function listInbox(paths: Paths): Promise<string[]> {
  try {
    return await readdir(inboxDir(paths));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

/** One event file, read; null if it could not be, in which case it is left for the next drain. */
async function readEvent(file: string): Promise<ReadResult<Envelope> | null> {
  try {
    return parseJsonl<Envelope>(await readFile(file, 'utf8'));
  } catch (error) {
    return isMissingFile(error) ? { items: [], corrupt: 0 } : null;
  }
}

/**
 * Takes everything currently in the inbox and clears it, oldest event first.
 *
 * A file is removed only once it has been read, and a file that cannot be read
 * is left where it is, so no failure part way through can lose an event.
 */
export async function drainInbox(paths: Paths, now: number = Date.now()): Promise<ReadResult<Envelope>> {
  const dir = inboxDir(paths);
  const legacy = await drainLegacy(paths);
  const names = await listInbox(paths);

  // Still being written, unless it has sat there far longer than any hook runs.
  await Promise.all(
    names
      .filter((name) => name.startsWith('.'))
      .map(async (name) => {
        const info = await stat(join(dir, name)).catch(() => null);
        if (info && now - info.mtimeMs > ABANDONED_MS) await rm(join(dir, name), { force: true });
      }),
  );

  const events = names.filter((name) => !name.startsWith('.') && name.endsWith(EVENT_SUFFIX));
  const read = await Promise.all(events.map((name) => readEvent(join(dir, name))));

  const keyed: { key: [number, string]; envelope: Envelope }[] = legacy.items.map((envelope) => ({
    key: [Number(envelope.ts) || 0, ''],
    envelope,
  }));
  let corrupt = legacy.corrupt;

  await Promise.all(
    events.map(async (name, index) => {
      const result = read[index];
      if (!result) return;
      for (const envelope of result.items) {
        keyed.push({ key: [Number(envelope.ts) || 0, name], envelope });
      }
      corrupt += result.corrupt;
      await rm(join(dir, name), { force: true }).catch(() => undefined);
    }),
  );

  // Files carry no order of their own. The stamp each writer took does, and a
  // writer's own names break ties within one millisecond.
  keyed.sort((a, b) => a.key[0] - b.key[0] || (a.key[1] < b.key[1] ? -1 : a.key[1] > b.key[1] ? 1 : 0));
  return { items: keyed.map((entry) => entry.envelope), corrupt };
}

/** Events waiting to be drained, and their size, for the doctor. */
export async function pendingInbox(paths: Paths): Promise<{ events: number; bytes: number }> {
  let events = 0;
  let bytes = await stat(paths.inbox).then(
    (info) => info.size,
    () => 0,
  );
  if (bytes > 0) events += 1;

  for (const name of await listInbox(paths)) {
    if (name.startsWith('.') || !name.endsWith(EVENT_SUFFIX)) continue;
    events += 1;
    bytes += await stat(join(inboxDir(paths), name)).then(
      (info) => info.size,
      () => 0,
    );
  }

  return { events, bytes };
}
