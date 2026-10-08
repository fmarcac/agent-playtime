import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainInbox } from '../../store/inbox.js';
import { resolvePaths } from '../../store/paths.js';
import type { Envelope } from '../../core/events.js';
import playtimeExtension, { PI_EVENTS } from './extension.js';
import type { PiContext } from './extension.js';

type Handler = (event: unknown, ctx: PiContext) => unknown;

function fakePi(): { handlers: Map<string, Handler>; on: (name: string, handler: Handler) => void } {
  const handlers = new Map<string, Handler>();
  return { handlers, on: (name, handler) => void handlers.set(name, handler) };
}

const ctx: PiContext = { cwd: '/home/dev/work/api', sessionManager: { getSessionId: () => 'pi_1' } };

/** Writes are fire-and-forget, so wait for them to land. */
async function drainUntil(count: number, home: string): Promise<Envelope[]> {
  const paths = resolvePaths({ PLAYTIME_HOME: home });
  const seen: Envelope[] = [];
  for (let i = 0; i < 100 && seen.length < count; i++) {
    seen.push(...(await drainInbox(paths)).items);
    if (seen.length < count) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return seen;
}

test('the extension subscribes to the six lifecycle events and nothing on the hot path', () => {
  const pi = fakePi();
  playtimeExtension(pi);

  assert.deepEqual([...pi.handlers.keys()], [...PI_EVENTS]);
  assert.ok(!pi.handlers.has('tool_call'));
  assert.ok(!pi.handlers.has('user_bash'));
});

test('a handler writes an envelope to the inbox without being awaited', async () => {
  const home = await mkdtemp(join(tmpdir(), 'playtime-pi-'));
  const previous = process.env['PLAYTIME_HOME'];
  const previousNode = process.env['PLAYTIME_NODE'];
  process.env['PLAYTIME_HOME'] = home;
  // Waking the daemon must not start a real one from a test.
  process.env['PLAYTIME_NODE'] = '/bin/false';
  try {
    const pi = fakePi();
    playtimeExtension(pi);

    const result = pi.handlers.get('agent_settled')?.({}, ctx);
    assert.equal(result, undefined);

    const [envelope, ...rest] = await drainUntil(1, home);
    assert.equal(rest.length, 0);
    assert.equal(envelope?.harness, 'pi');
    assert.equal(envelope?.hook, 'agent_settled');
    assert.equal(envelope?.pid, process.pid);
    assert.deepEqual(envelope?.payload, { sessionId: 'pi_1', cwd: '/home/dev/work/api' });
  } finally {
    if (previous === undefined) delete process.env['PLAYTIME_HOME'];
    else process.env['PLAYTIME_HOME'] = previous;
    if (previousNode === undefined) delete process.env['PLAYTIME_NODE'];
    else process.env['PLAYTIME_NODE'] = previousNode;
    await rm(home, { recursive: true, force: true });
  }
});

test('a broken context cannot make a handler throw', () => {
  const pi = fakePi();
  playtimeExtension(pi);

  for (const handler of pi.handlers.values()) {
    assert.doesNotThrow(() => handler({}, {}));
    assert.doesNotThrow(() => handler({}, undefined as unknown as PiContext));
    assert.doesNotThrow(() =>
      handler({}, {
        sessionManager: {
          getSessionId: () => {
            throw new Error('boom');
          },
        },
      }),
    );
  }
});
