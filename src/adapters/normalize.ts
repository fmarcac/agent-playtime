/**
 * Translation from each harness's own hook vocabulary into Playtime's.
 *
 * Adapters stay dumb on purpose: the shell shims copy the harness payload
 * through untouched and every interpretation happens here, where it is testable
 * against captured fixtures.
 */

import { isHarness } from '../core/events.js';
import type { Envelope, EventKind, Harness, PlaytimeEvent } from '../core/events.js';

/**
 * Claude Code's vocabulary, which Codex and Qwen Code copy.
 *
 * `PermissionRequest` opens a blocked span and `PostToolUse` (or its failure
 * twin) closes it. That measures the permission prompt plus the run time of the
 * tool it was gating, since no harness emits an event at the moment you approve.
 * `Notification` is a second opener, filtered below to genuine permission prompts.
 */
const CLAUDE_STYLE: Record<string, EventKind> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'turn_start',
  Stop: 'turn_end',
  PermissionRequest: 'blocked_start',
  Notification: 'blocked_start',
  PostToolUse: 'blocked_end',
  PostToolUseFailure: 'blocked_end',
};

/** Codex has no Notification hook, so a stray one is not a block. */
const CODEX: Record<string, EventKind> = Object.fromEntries(
  Object.entries(CLAUDE_STYLE).filter(([hook]) => hook !== 'Notification'),
);

/** Factory Droid has Claude's names but no PermissionRequest or failure hook. */
const DROID: Record<string, EventKind> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'turn_start',
  Stop: 'turn_end',
  Notification: 'blocked_start',
  PostToolUse: 'blocked_end',
};

const GEMINI: Record<string, EventKind> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  BeforeAgent: 'turn_start',
  AfterAgent: 'turn_end',
  Notification: 'blocked_start',
  AfterTool: 'blocked_end',
};

const COPILOT: Record<string, EventKind> = {
  sessionStart: 'session_start',
  sessionEnd: 'session_end',
  userPromptSubmitted: 'turn_start',
  agentStop: 'turn_end',
  permissionRequest: 'blocked_start',
  postToolUse: 'blocked_end',
  postToolUseFailure: 'blocked_end',
};

/** Goose has no permission event, so its blocked time is always zero. */
const GOOSE: Record<string, EventKind> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'turn_start',
  Stop: 'turn_end',
  PostToolUse: 'blocked_end',
  PostToolUseFailure: 'blocked_end',
};

/** Cline names tasks, not sessions; a resumed task is a session starting again. */
const CLINE: Record<string, EventKind> = {
  TaskStart: 'session_start',
  TaskResume: 'session_start',
  SessionShutdown: 'session_end',
  UserPromptSubmit: 'turn_start',
  TaskComplete: 'turn_end',
  TaskError: 'turn_end',
  TaskCancel: 'turn_end',
};

/** The OpenCode plugin decides which message updates are prompts, and says so here. */
const OPENCODE: Record<string, EventKind> = {
  'session.created': 'session_start',
  'session.deleted': 'session_end',
  'user.prompt': 'turn_start',
  'session.idle': 'turn_end',
  'permission.asked': 'blocked_start',
  'permission.replied': 'blocked_end',
};

/** Pi's extension forwards its own event names untouched. */
const PI: Record<string, EventKind> = {
  session_start: 'session_start',
  session_shutdown: 'session_end',
  before_agent_start: 'turn_start',
  agent_settled: 'turn_end',
  ui_prompt_start: 'blocked_start',
  ui_prompt_end: 'blocked_end',
};

const HOOK_MAPS: Record<Harness, Record<string, EventKind>> = {
  'claude-code': CLAUDE_STYLE,
  codex: CODEX,
  qwen: CLAUDE_STYLE,
  droid: DROID,
  gemini: GEMINI,
  copilot: COPILOT,
  goose: GOOSE,
  cline: CLINE,
  opencode: OPENCODE,
  pi: PI,
};

/** Notification types that mean the agent is waiting on a permission decision. */
const PERMISSION_NOTIFICATIONS: readonly string[] = ['permission_prompt', 'ToolPermission'];

const SESSION_KEYS = [
  'session_id',
  'sessionId',
  'sessionID',
  'session-id',
  'taskId',
  'conversation_id',
  'id',
];
const CWD_KEYS = [
  'cwd',
  'workdir',
  'working_dir',
  'working_directory',
  'workingDirectory',
  'directory',
];
const ROOT_LIST_KEYS = ['workspaceRoots', 'workspace_roots'];

function pickString(payload: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** Most harnesses send a plain cwd; Cline sends workspace roots and others nest the root. */
function pickCwd(payload: Record<string, unknown>): string | undefined {
  const direct = pickString(payload, CWD_KEYS);
  if (direct !== undefined) return direct;

  for (const key of ROOT_LIST_KEYS) {
    const roots = payload[key];
    if (Array.isArray(roots)) {
      const first = roots.find((root): root is string => typeof root === 'string' && root !== '');
      if (first !== undefined) return first;
    }
  }

  const info = payload['workspaceInfo'];
  if (typeof info === 'object' && info !== null) {
    const root = (info as Record<string, unknown>)['rootPath'];
    if (typeof root === 'string' && root !== '') return root;
  }
  return undefined;
}

export function normalizeEnvelope(envelope: Envelope): PlaytimeEvent | null {
  if (!isHarness(envelope.harness)) return null;
  if (!Number.isFinite(envelope.ts)) return null;

  const kind = HOOK_MAPS[envelope.harness][envelope.hook];
  if (kind === undefined) return null;

  const payload =
    typeof envelope.payload === 'object' && envelope.payload !== null
      ? (envelope.payload as Record<string, unknown>)
      : {};

  // Only a permission prompt is the agent waiting on you. Harnesses also
  // notify when idle at the prompt or after auth; those are not blocks. A
  // notification with no type at all is let through.
  if (kind === 'blocked_start' && envelope.hook === 'Notification') {
    const type = payload['notification_type'] ?? payload['notificationType'];
    if (typeof type === 'string' && !PERMISSION_NOTIFICATIONS.includes(type)) return null;
  }

  // Time that cannot be attributed to a session is better dropped than guessed at.
  const sessionId = pickString(payload, SESSION_KEYS);
  if (sessionId === undefined) return null;

  return {
    ts: envelope.ts,
    harness: envelope.harness,
    event: kind,
    sessionId,
    pid: envelope.pid,
    pidStart: envelope.pidStart,
    cwd: pickCwd(payload),
  };
}
