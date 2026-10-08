/**
 * Oh My Pi extension.
 *
 * Oh My Pi forked Pi and kept its extension contract, but not all of its
 * events: there is no `agent_settled`, and no UI prompt events, so tool
 * approvals bracket the blocked span instead.
 *
 * A turn is each agent run, `agent_start` to `agent_end`, not each prompt. Runs
 * also start without a prompt (queued follow-ups, async job results), and an
 * `agent_end` flagged `willContinue` may wait on a background job for hours, so
 * pairing turns with prompts would count that wait as busy.
 *
 * Subagents run in-process with sessions of their own. Their time is already
 * the parent turn's, so only the top-level agent is recorded.
 */

import { createExtension } from '../pi/extension.js';

export const OMP_EVENTS = [
  'session_start',
  'session_shutdown',
  'before_agent_start',
  'agent_start',
  'agent_end',
  'tool_approval_requested',
  'tool_approval_resolved',
] as const;

const ompExtension = createExtension({
  harness: 'omp',
  events: OMP_EVENTS,
  wakes: ['session_start', 'before_agent_start'],
  accept: (_name, _event, ctx) => {
    const kind = ctx.agent?.kind;
    return typeof kind !== 'string' || kind === 'main';
  },
});

export default ompExtension;
