/**
 * Building and merging harness hook configuration.
 *
 * Kept separate from the file writing so installing is a pure, testable
 * transformation of whatever settings the user already has.
 */

import type { Harness } from '../core/events.js';

export interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
  name?: string;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

export type HookMap = Record<string, HookMatcher[]>;

/** The unique path suffix that identifies a hook as one of ours. */
export const EMIT_MARKER = 'adapters/shared/emit.sh';

export interface HookSpec {
  /** Events to subscribe to; a matcher is given where the harness needs one to see tool completions. */
  events: readonly { event: string; matcher?: string }[];
  /** Seconds, except Gemini which counts milliseconds. */
  timeout: number;
  /** Gemini wants a name on every entry. */
  named?: boolean;
}

/**
 * Tool completions are what close a permission wait, so they need a matcher.
 * Claude Code and Codex match on `*`; Qwen Code takes a regular expression.
 */
function claudeEvents(toolMatcher: string, extra: readonly string[]): HookSpec['events'] {
  return [
    { event: 'SessionStart' },
    { event: 'SessionEnd' },
    { event: 'UserPromptSubmit' },
    { event: 'Stop' },
    ...extra.map((event) => ({ event })),
    { event: 'PostToolUse', matcher: toolMatcher },
  ];
}

/**
 * The harnesses that read Claude Code's `{ matcher, hooks: [...] }` shape.
 *
 * Codex refuses anything longer than 3 seconds and warns about clamping.
 */
export const HOOK_SPECS: Partial<Record<Harness, HookSpec>> = {
  'claude-code': {
    events: [
      ...claudeEvents('*', ['PermissionRequest', 'Notification']),
      { event: 'PostToolUseFailure', matcher: '*' },
    ],
    timeout: 5,
  },
  codex: { events: claudeEvents('*', ['PermissionRequest']), timeout: 3 },
  qwen: {
    events: [
      ...claudeEvents('.*', ['PermissionRequest', 'Notification']),
      { event: 'PostToolUseFailure', matcher: '.*' },
    ],
    timeout: 5,
  },
  droid: { events: claudeEvents('*', ['Notification']), timeout: 5 },
  gemini: {
    events: [
      { event: 'SessionStart' },
      { event: 'SessionEnd' },
      { event: 'BeforeAgent' },
      { event: 'AfterAgent' },
      { event: 'Notification' },
      { event: 'AfterTool', matcher: '*' },
    ],
    // Gemini measures hook timeouts in milliseconds.
    timeout: 5000,
    named: true,
  },
};

/** Hooks of other types, such as prompt hooks, have no command and are never ours. */
export function isPlaytimeHook(entry: HookEntry): boolean {
  return typeof entry?.command === 'string' && entry.command.includes(EMIT_MARKER);
}

/** What a hook runs: the shim, which harness is calling, and which of its events. */
export function hookCommand(emitPath: string, harness: Harness, event: string): string {
  return `"${emitPath}" ${harness} ${event}`;
}

export function playtimeHooks(emitPath: string, harness: Harness): HookMap {
  const spec = HOOK_SPECS[harness];
  if (spec === undefined) throw new Error(`${harness} does not use Claude-style hooks`);

  const map: HookMap = {};

  for (const { event, matcher } of spec.events) {
    const entry: HookEntry = {
      type: 'command',
      command: hookCommand(emitPath, harness, event),
      timeout: spec.timeout,
    };
    if (spec.named) entry.name = 'playtime';
    map[event] = [matcher === undefined ? { hooks: [entry] } : { matcher, hooks: [entry] }];
  }

  return map;
}

/**
 * Copilot CLI hooks. `preToolUse` is left out on purpose: Copilot fails closed
 * on it, so a slow or broken hook there would block the agent's tools.
 */
export const COPILOT_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmitted',
  'agentStop',
  'permissionRequest',
  'postToolUse',
  'postToolUseFailure',
] as const;

/** A file that is entirely ours, so it is rewritten rather than merged. */
export function copilotHooksFile(emitPath: string): unknown {
  const hooks: Record<string, unknown[]> = {};
  for (const event of COPILOT_EVENTS) {
    hooks[event] = [{ type: 'command', bash: hookCommand(emitPath, 'copilot', event), timeoutSec: 5 }];
  }
  return { version: 1, hooks };
}

/** Cline runs the executable named after the event, so there is one file per event. */
export const CLINE_EVENTS = [
  'TaskStart',
  'TaskResume',
  'SessionShutdown',
  'UserPromptSubmit',
  'TaskComplete',
  'TaskError',
  'TaskCancel',
] as const;

export function clineHookScript(emitPath: string, event: string): string {
  return `#!/bin/sh\nexec "${emitPath}" cline ${event}\n`;
}

/**
 * Goose reads plugin hooks in the Claude shape. A bare `*` matcher is invalid
 * there, so tool events carry none at all.
 */
export const GOOSE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'PostToolUse',
  'PostToolUseFailure',
] as const;

export function gooseHooksFile(emitPath: string): unknown {
  const hooks: HookMap = {};
  for (const event of GOOSE_EVENTS) {
    hooks[event] = [
      { hooks: [{ type: 'command', command: hookCommand(emitPath, 'goose', event), timeout: 5 }] },
    ];
  }
  return { hooks };
}

/** Adds our hooks, replacing any we installed before and leaving everything else alone. */
export function mergeHooks(existing: HookMap | undefined, ours: HookMap): HookMap {
  const merged: HookMap = {};

  for (const [event, groups] of Object.entries(existing ?? {})) {
    // Strip only our own entries, keeping any group that still has other hooks in it.
    if (!Array.isArray(groups)) {
      merged[event] = groups;
      continue;
    }
    const kept = groups
      .map((group) =>
        Array.isArray(group?.hooks)
          ? { ...group, hooks: group.hooks.filter((hook) => !isPlaytimeHook(hook)) }
          : group,
      )
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);

    if (kept.length > 0) merged[event] = kept;
  }

  for (const [event, groups] of Object.entries(ours)) {
    merged[event] = [...(merged[event] ?? []), ...groups];
  }

  return merged;
}
