/**
 * Pi extension.
 *
 * Pi loads extensions in-process and awaits every handler in order, so a slow
 * handler slows the agent. Each handler therefore builds its envelope
 * synchronously, fires the inbox write without awaiting it, and swallows every
 * failure: a tracker must never delay or take down the harness.
 *
 * Pi has no permission prompt event, only UI prompts, so `ui_prompt_start` and
 * `ui_prompt_end` bracket the blocked span. `tool_call` and `user_bash` are
 * deliberately not subscribed to; they sit on Pi's hot path.
 */

import { appendEnvelope } from '../../store/inbox.js';
import { resolvePaths } from '../../store/paths.js';
import { ensureDaemon } from '../../daemon/spawn.js';
import { processStartTime } from '../../daemon/proc.js';
import type { Envelope } from '../../core/events.js';

/** The slice of Pi's extension context this uses, typed structurally to avoid a dependency. */
export interface PiContext {
  cwd?: string;
  sessionManager?: { getSessionId?: () => string };
}

export interface PiApi {
  on(name: string, handler: (event: unknown, ctx: PiContext) => unknown): unknown;
}

/** Every Pi event Playtime listens to. Its names are forwarded as the hook name. */
export const PI_EVENTS = [
  'session_start',
  'session_shutdown',
  'before_agent_start',
  'agent_settled',
  'ui_prompt_start',
  'ui_prompt_end',
] as const;

/** Events that should also bring a dead daemon back, like the shell hooks do. */
const WAKES_DAEMON: ReadonlySet<string> = new Set(['session_start', 'before_agent_start']);

export default function playtimeExtension(pi: PiApi): void {
  // Looked up on first use, not in the factory, so loading the extension does no work.
  let pidStart: number | null | undefined;

  for (const name of PI_EVENTS) {
    pi.on(name, (_event, ctx) => {
      try {
        const sessionId = ctx?.sessionManager?.getSessionId?.();
        if (typeof sessionId !== 'string' || sessionId === '') return;

        const paths = resolvePaths();
        if (pidStart === undefined) pidStart = processStartTime(process.pid);

        const envelope: Envelope = {
          v: 1,
          ts: Date.now(),
          harness: 'pi',
          hook: name,
          pid: process.pid,
          pidStart: pidStart ?? undefined,
          payload: { sessionId, cwd: ctx.cwd },
        };

        appendEnvelope(paths, envelope).catch(() => undefined);
        if (WAKES_DAEMON.has(name)) ensureDaemon(paths).catch(() => undefined);
      } catch {
        // Never let a tracker failure escape into Pi.
      }
    });
  }
}
