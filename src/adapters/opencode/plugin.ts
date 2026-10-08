/**
 * OpenCode plugin.
 *
 * Unlike the shell shims, this runs inside the harness process, so it knows its
 * own pid for free and can decide which message updates are actually prompts.
 * It still writes the same envelopes to the same inbox, so the daemon does not
 * need to know which harness it is talking to.
 */

import { appendEnvelope } from '../../store/inbox.js';
import { resolvePaths } from '../../store/paths.js';
import { ensureDaemon } from '../../daemon/spawn.js';
import { processStartTime } from '../../daemon/proc.js';
import type { Envelope } from '../../core/events.js';
import { asRecord, hookNameFor, readSessionId } from './events.js';
import type { OpenCodeEvent } from './events.js';

export interface PluginContext {
  directory?: string;
  worktree?: string;
}

export const PlaytimePlugin = async (context: PluginContext = {}) => {
  const paths = resolvePaths();
  const pid = process.pid;
  const pidStart = processStartTime(pid);
  // The worktree names the whole repository, but outside one OpenCode reports
  // it as `/`, and then the directory it was opened in is the better name.
  const worktree = context.worktree && context.worktree !== '/' ? context.worktree : undefined;
  const directory = worktree ?? context.directory ?? process.cwd();

  await ensureDaemon(paths).catch(() => undefined);

  return {
    event: async ({ event }: { event: OpenCodeEvent }): Promise<void> => {
      const hook = hookNameFor(event);
      if (hook === null) return;

      // The daemon exits when idle, which can happen between opening OpenCode
      // and the first prompt, and it can die. Like the shell hooks, every
      // session or prompt event brings it back.
      if (hook === 'session.created' || hook === 'user.prompt') {
        void ensureDaemon(paths).catch(() => undefined);
      }

      const sessionId = readSessionId(asRecord(event.properties));
      if (sessionId === undefined) return;

      const envelope: Envelope = {
        v: 1,
        ts: Date.now(),
        harness: 'opencode',
        hook,
        pid,
        pidStart: pidStart ?? undefined,
        payload: { sessionID: sessionId, directory },
      };

      // A tracker must never take the harness down with it.
      await appendEnvelope(paths, envelope).catch(() => undefined);
    },
  };
};

export default PlaytimePlugin;
