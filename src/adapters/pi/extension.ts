/**
 * Pi extension, shared with Oh My Pi.
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
import type { Envelope, Harness } from '../../core/events.js';

/** The slice of Pi's extension context this uses, typed structurally to avoid a dependency. */
export interface PiContext {
  cwd?: string;
  sessionManager?: { getSessionId?: () => string };
  /** Oh My Pi only: which agent the session runs, the top-level one or a subagent. */
  agent?: { kind?: string };
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

export interface ExtensionSpec {
  harness: Harness;
  events: readonly string[];
  /** Events that should also bring a dead daemon back, like the shell hooks do. */
  wakes: readonly string[];
  /** Returns false for an event that should not be recorded. */
  accept?: (name: string, event: unknown, ctx: PiContext) => boolean;
}

/** Builds an extension factory for Pi or a harness that shares its extension API. */
export function createExtension(spec: ExtensionSpec): (pi: PiApi) => void {
  const wakes: ReadonlySet<string> = new Set(spec.wakes);

  return (pi) => {
    // Looked up on first use, not in the factory, so loading the extension does no work.
    let pidStart: number | null | undefined;

    for (const name of spec.events) {
      pi.on(name, (event, ctx) => {
        try {
          const sessionId = ctx?.sessionManager?.getSessionId?.();
          if (typeof sessionId !== 'string' || sessionId === '') return;
          if (spec.accept !== undefined && !spec.accept(name, event, ctx)) return;

          const paths = resolvePaths();
          if (pidStart === undefined) pidStart = processStartTime(process.pid);

          const envelope: Envelope = {
            v: 1,
            ts: Date.now(),
            harness: spec.harness,
            hook: name,
            pid: process.pid,
            pidStart: pidStart ?? undefined,
            payload: { sessionId, cwd: ctx.cwd },
          };

          appendEnvelope(paths, envelope).catch(() => undefined);
          if (wakes.has(name)) ensureDaemon(paths).catch(() => undefined);
        } catch {
          // Never let a tracker failure escape into the harness.
        }
      });
    }
  };
}

const playtimeExtension = createExtension({
  harness: 'pi',
  events: PI_EVENTS,
  wakes: ['session_start', 'before_agent_start'],
});

export default playtimeExtension;
