// Calendar arithmetic across a DST change. Each test file runs in its own
// process, so setting the zone here affects nothing else.
process.env['TZ'] = 'America/Santiago';

import test from 'node:test';
import assert from 'node:assert/strict';

const { daily } = await import('./daily.js');
const { rollup } = await import('./rollup.js');
const { windowFor } = await import('./window.js');
import type { SessionRecord } from './session.js';

function session(id: string, from: string, to: string): SessionRecord {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return { id, harness: 'codex', project: '/p', start, end, open: [[start, end]], busy: [], blocked: [], turns: 0 };
}

test('days add up to the window across a skipped midnight', () => {
  // 2026-09-06 jumps from 00:00 straight to 01:00 in Santiago.
  const records = [
    session('a', '2026-09-04T10:00:00', '2026-09-04T11:00:00'),
    session('b', '2026-09-07T00:30:00', '2026-09-07T12:00:00'),
  ];
  const window: [number, number] = [new Date('2026-09-03T00:00:00').getTime(), new Date('2026-09-10T00:00:00').getTime()];

  const days = daily(records, window, window[1]);
  const sum = days.reduce((acc, day) => acc + day.open, 0);
  assert.equal(sum, rollup(records, window).total.open);
  assert.equal(days.find((day) => day.date === '2026-09-07')?.start, new Date('2026-09-07T00:00:00').getTime());
});

test('the week starts at a local midnight across a DST change', () => {
  const [start] = windowFor('week', new Date('2026-09-09T15:00:00').getTime()) ?? [0];
  const date = new Date(start);
  assert.equal(date.getDate(), 3);
  assert.equal(date.getHours(), 0);
});
