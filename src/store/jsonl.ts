/** Append-only JSON Lines helpers. A corrupt line is skipped and counted, never fatal. */

import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ReadResult<T> {
  items: T[];
  corrupt: number;
}

export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export function parseJsonl<T>(text: string): ReadResult<T> {
  const items: T[] = [];
  let corrupt = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      items.push(JSON.parse(line) as T);
    } catch {
      corrupt += 1;
    }
  }

  return { items, corrupt };
}

export function toJsonl(items: readonly unknown[]): string {
  if (items.length === 0) return '';
  return `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
}

export async function appendJsonl(file: string, items: readonly unknown[]): Promise<void> {
  const text = toJsonl(items);
  if (text === '') return;

  await mkdir(dirname(file), { recursive: true });
  // After a write cut short, start on a fresh line, so the truncated line is
  // the only one lost rather than taking the next good record with it.
  const prefix = (await endsMidLine(file)) ? '\n' : '';
  await appendFile(file, prefix + text, 'utf8');
}

async function endsMidLine(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }

  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

export async function readJsonl<T>(file: string): Promise<ReadResult<T>> {
  try {
    return parseJsonl<T>(await readFile(file, 'utf8'));
  } catch (error) {
    if (isMissingFile(error)) return { items: [], corrupt: 0 };
    throw error;
  }
}

/** Writes via a temporary file and rename, so readers never see a half-written file. */
export async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });

  const staging = `${file}.writing.${process.pid}`;
  try {
    await writeFile(staging, text, 'utf8');
    await rename(staging, file);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}
