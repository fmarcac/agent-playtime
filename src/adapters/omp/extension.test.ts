import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainInbox } from '../../store/inbox.js';
import { resolvePaths } from '../../store/paths.js';
import type { Envelope } from '../../core/events.js';
import type { PiContext } from '../pi/extension.js';
import ompExtension, { OMP_EVENTS } from './extension.js';

type Handler = (event: unknown, ctx: PiContext) => unknown;

function fakeOmp(): { handlers: Map<string, Handler>; on: (name: string, handler: Handler) => void } {
  const handlers = new Map<string, Handler>();
  return { handlers, on: (name, handler) => void handlers.set(name, handler) };
}

const main: PiContext = { cwd: '/w', sessionManager: { getSessionId: () => 'o1' }, agent: { kind: 'main' } };
const sub: PiContext = { cwd: '/w', sessionManager: { getSessionId: () => 'o2' }, agent: { kind: 'sub' } };

test('the extension subscribes to Oh My Pi lifecycle events only', () => {
  const omp = fakeOmp();
  ompExtension(omp);
  assert.deepEqual([...omp.handlers.keys()], [...OMP_EVENTS]);
});

test('subagents are not recorded, every top-level run end is', async () => {
  const home = await mkdtemp(join(tmpdir(), 'playtime-omp-'));
  const previous = process.env['PLAYTIME_HOME'];
  const previousNode = process.env['PLAYTIME_NODE'];
  process.env['PLAYTIME_HOME'] = home;
  process.env['PLAYTIME_NODE'] = '/bin/false';
  try {
    const omp = fakeOmp();
    ompExtension(omp);
    const agentEnd = omp.handlers.get('agent_end');

    agentEnd?.({ willContinue: true }, main);
    agentEnd?.({}, sub);
    agentEnd?.({ willContinue: false }, main);

    const paths = resolvePaths({ PLAYTIME_HOME: home });
    const seen: Envelope[] = [];
    for (let i = 0; i < 25; i++) {
      seen.push(...(await drainInbox(paths)).items);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // A run waiting on a background job has ended; the job's result starts a new one.
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.harness, 'omp');
    assert.equal(seen[0]?.hook, 'agent_end');
    assert.deepEqual(seen[0]?.payload, { sessionId: 'o1', cwd: '/w' });
  } finally {
    if (previous === undefined) delete process.env['PLAYTIME_HOME'];
    else process.env['PLAYTIME_HOME'] = previous;
    if (previousNode === undefined) delete process.env['PLAYTIME_NODE'];
    else process.env['PLAYTIME_NODE'] = previousNode;
    await rm(home, { recursive: true, force: true });
  }
});
