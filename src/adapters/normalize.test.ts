import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEnvelope } from './normalize.js';
import type { Envelope } from '../core/events.js';

const TS = 1_753_440_000_000;

function claudeCode(hook: string, payload: Record<string, unknown> = {}): Envelope {
  return {
    v: 1,
    ts: TS,
    harness: 'claude-code',
    hook,
    pid: 4242,
    pidStart: 99,
    payload: {
      session_id: 'sess_abc',
      transcript_path: '/home/dev/.claude/projects/x/sess_abc.jsonl',
      cwd: '/home/dev/work/api',
      hook_event_name: hook,
      ...payload,
    },
  };
}

test('a Claude Code SessionStart becomes a session_start', () => {
  const result = normalizeEnvelope(claudeCode('SessionStart', { source: 'startup' }));

  assert.equal(result?.event, 'session_start');
  assert.equal(result?.harness, 'claude-code');
  assert.equal(result?.sessionId, 'sess_abc');
  assert.equal(result?.cwd, '/home/dev/work/api');
  assert.equal(result?.pid, 4242);
  assert.equal(result?.pidStart, 99);
  assert.equal(result?.ts, TS);
});

test('Claude Code turn boundaries map to turn_start and turn_end', () => {
  assert.equal(normalizeEnvelope(claudeCode('UserPromptSubmit'))?.event, 'turn_start');
  assert.equal(normalizeEnvelope(claudeCode('Stop'))?.event, 'turn_end');
});

test('a Claude Code SessionEnd becomes a session_end', () => {
  assert.equal(normalizeEnvelope(claudeCode('SessionEnd', { reason: 'exit' }))?.event, 'session_end');
});

test('a Claude Code Notification opens a blocked span and a finished tool closes it', () => {
  assert.equal(normalizeEnvelope(claudeCode('Notification'))?.event, 'blocked_start');
  assert.equal(normalizeEnvelope(claudeCode('PostToolUse'))?.event, 'blocked_end');
});

test('a subagent stopping does not end the parent turn', () => {
  // Subagent time belongs to the session that spawned it, so it must not close the turn.
  assert.equal(normalizeEnvelope(claudeCode('SubagentStop')), null);
});

test('an unrecognised hook is ignored rather than throwing', () => {
  assert.equal(normalizeEnvelope(claudeCode('SomethingNew')), null);
});

test('an envelope with no session id cannot be attributed and is dropped', () => {
  const envelope = claudeCode('SessionStart');
  envelope.payload = { cwd: '/home/dev' };

  assert.equal(normalizeEnvelope(envelope), null);
});

test('an envelope with no usable timestamp is dropped', () => {
  const envelope = claudeCode('SessionStart');
  envelope.ts = Number.NaN;

  assert.equal(normalizeEnvelope(envelope), null);
});

test('an envelope from an unknown harness is dropped', () => {
  const envelope = { ...claudeCode('SessionStart'), harness: 'emacs' } as unknown as Envelope;

  assert.equal(normalizeEnvelope(envelope), null);
});

test('Codex uses the same hook names as Claude Code', () => {
  const envelope: Envelope = {
    v: 1,
    ts: TS,
    harness: 'codex',
    hook: 'UserPromptSubmit',
    pid: 77,
    payload: { session_id: 'codex_1', cwd: '/home/dev/work/api' },
  };

  const result = normalizeEnvelope(envelope);

  assert.equal(result?.event, 'turn_start');
  assert.equal(result?.harness, 'codex');
  assert.equal(result?.sessionId, 'codex_1');
});

test('Codex has no Notification hook, so one is ignored', () => {
  const envelope: Envelope = {
    v: 1,
    ts: TS,
    harness: 'codex',
    hook: 'Notification',
    payload: { session_id: 'codex_2', cwd: '/tmp' },
  };

  assert.equal(normalizeEnvelope(envelope), null);
});

test('the retired Codex notify names no longer map', () => {
  const envelope: Envelope = {
    v: 1,
    ts: TS,
    harness: 'codex',
    hook: 'AfterAgent',
    payload: { session_id: 'codex_2' },
  };

  assert.equal(normalizeEnvelope(envelope), null);
});

test('a Codex PermissionRequest opens a blocked span', () => {
  const envelope: Envelope = {
    v: 1,
    ts: TS,
    harness: 'codex',
    hook: 'PermissionRequest',
    payload: { session_id: 'codex_2' },
  };

  assert.equal(normalizeEnvelope(envelope)?.event, 'blocked_start');
});

test('Codex reports its working directory under a different key', () => {
  const envelope: Envelope = {
    v: 1,
    ts: TS,
    harness: 'codex',
    hook: 'SessionStart',
    payload: { session_id: 'codex_3', workdir: '/home/dev/work/api' },
  };

  assert.equal(normalizeEnvelope(envelope)?.cwd, '/home/dev/work/api');
});

test('OpenCode session events map onto the session lifecycle', () => {
  const opencode = (hook: string): Envelope => ({
    v: 1,
    ts: TS,
    harness: 'opencode',
    hook,
    pid: 900,
    payload: { sessionID: 'oc_1', directory: '/home/dev/work/api' },
  });

  assert.equal(normalizeEnvelope(opencode('session.created'))?.event, 'session_start');
  assert.equal(normalizeEnvelope(opencode('session.idle'))?.event, 'turn_end');
  assert.equal(normalizeEnvelope(opencode('session.deleted'))?.event, 'session_end');
  assert.equal(normalizeEnvelope(opencode('user.prompt'))?.event, 'turn_start');
  assert.equal(normalizeEnvelope(opencode('permission.asked'))?.event, 'blocked_start');
  assert.equal(normalizeEnvelope(opencode('permission.replied'))?.event, 'blocked_end');
  assert.equal(normalizeEnvelope(opencode('session.created'))?.sessionId, 'oc_1');
});

test('a missing pid is left undefined rather than guessed at', () => {
  const envelope: Envelope = {
    v: 1,
    ts: TS,
    harness: 'codex',
    hook: 'SessionStart',
    payload: { session_id: 'codex_4' },
  };

  const result = normalizeEnvelope(envelope);

  assert.equal(result?.pid, undefined);
  assert.equal(result?.cwd, undefined);
});

test('only a permission prompt notification opens a blocked span', () => {
  assert.equal(normalizeEnvelope(claudeCode('Notification', { notification_type: 'idle_prompt' })), null);
  assert.equal(
    normalizeEnvelope(claudeCode('Notification', { notification_type: 'permission_prompt' }))?.event,
    'blocked_start',
  );
});

function envelope(harness: Envelope['harness'], hook: string, payload: Record<string, unknown>): Envelope {
  return { v: 1, ts: TS, harness, hook, pid: 10, payload };
}

test('Qwen Code shares Claude Code hook names', () => {
  const result = normalizeEnvelope(envelope('qwen', 'PostToolUseFailure', { session_id: 'q1', cwd: '/w' }));

  assert.equal(result?.event, 'blocked_end');
  assert.equal(result?.sessionId, 'q1');
  assert.equal(result?.cwd, '/w');
});

test('Factory Droid maps its smaller set of hooks', () => {
  const droid = (hook: string) => normalizeEnvelope(envelope('droid', hook, { session_id: 'd1', cwd: '/w' }));

  assert.equal(droid('Notification')?.event, 'blocked_start');
  assert.equal(droid('PostToolUse')?.event, 'blocked_end');
  assert.equal(droid('Stop')?.event, 'turn_end');
  assert.equal(droid('PermissionRequest'), null);
});

test('Gemini CLI uses BeforeAgent and AfterAgent for turns', () => {
  const gemini = (hook: string, extra: Record<string, unknown> = {}) =>
    normalizeEnvelope(envelope('gemini', hook, { session_id: 'g1', cwd: '/w', ...extra }));

  assert.equal(gemini('BeforeAgent')?.event, 'turn_start');
  assert.equal(gemini('AfterAgent')?.event, 'turn_end');
  assert.equal(gemini('AfterTool')?.event, 'blocked_end');
  assert.equal(gemini('SessionEnd')?.event, 'session_end');
  assert.equal(gemini('SessionStart')?.sessionId, 'g1');
});

test('a Gemini ToolPermission notification is a block, any other type is not', () => {
  const notify = (type: string) =>
    normalizeEnvelope(envelope('gemini', 'Notification', { session_id: 'g1', notification_type: type }));

  assert.equal(notify('ToolPermission')?.event, 'blocked_start');
  assert.equal(notify('SomethingElse'), null);
});

test('a camelCase notificationType is read too, and a missing one passes', () => {
  const camel = envelope('droid', 'Notification', { session_id: 'd1', notificationType: 'idle' });
  const bare = envelope('droid', 'Notification', { session_id: 'd1' });

  assert.equal(normalizeEnvelope(camel), null);
  assert.equal(normalizeEnvelope(bare)?.event, 'blocked_start');
});

test('Copilot CLI reads a camelCase sessionId and its own hook names', () => {
  const copilot = (hook: string) =>
    normalizeEnvelope(envelope('copilot', hook, { sessionId: 'cp1', cwd: '/w' }));

  assert.equal(copilot('sessionStart')?.sessionId, 'cp1');
  assert.equal(copilot('userPromptSubmitted')?.event, 'turn_start');
  assert.equal(copilot('agentStop')?.event, 'turn_end');
  assert.equal(copilot('permissionRequest')?.event, 'blocked_start');
  assert.equal(copilot('postToolUseFailure')?.event, 'blocked_end');
  assert.equal(copilot('preToolUse'), null);
});

test('Goose maps lifecycle and tool completions, but has no block opener', () => {
  const goose = (hook: string) => normalizeEnvelope(envelope('goose', hook, { session_id: 'go1', cwd: '/w' }));

  assert.equal(goose('SessionStart')?.event, 'session_start');
  assert.equal(goose('Stop')?.event, 'turn_end');
  assert.equal(goose('PostToolUseFailure')?.event, 'blocked_end');
  assert.equal(goose('PermissionRequest'), null);
});

test('Cline takes its session from taskId and its project from workspaceRoots', () => {
  const cline = (hook: string) =>
    normalizeEnvelope(
      envelope('cline', hook, { taskId: 'task_9', workspaceRoots: ['/home/dev/api', '/home/dev/web'] }),
    );

  const start = cline('TaskStart');
  assert.equal(start?.event, 'session_start');
  assert.equal(start?.sessionId, 'task_9');
  assert.equal(start?.cwd, '/home/dev/api');
  assert.equal(cline('TaskResume')?.event, 'session_start');
  assert.equal(cline('SessionShutdown')?.event, 'session_end');
  assert.equal(cline('UserPromptSubmit')?.event, 'turn_start');
  for (const hook of ['TaskComplete', 'TaskError', 'TaskCancel']) {
    assert.equal(cline(hook)?.event, 'turn_end');
  }
});

test('the workspace root is found under snake_case and workspaceInfo too', () => {
  const snake = envelope('cline', 'TaskStart', { taskId: 't', workspace_roots: ['/a'] });
  const info = envelope('cline', 'TaskStart', { taskId: 't', workspaceInfo: { rootPath: '/b' } });
  const none = envelope('cline', 'TaskStart', { taskId: 't', workspaceRoots: [] });

  assert.equal(normalizeEnvelope(snake)?.cwd, '/a');
  assert.equal(normalizeEnvelope(info)?.cwd, '/b');
  assert.equal(normalizeEnvelope(none)?.cwd, undefined);
});

test('a conversation_id identifies a session when nothing better is sent', () => {
  const result = normalizeEnvelope(envelope('goose', 'Stop', { conversation_id: 'c1', working_dir: '/w' }));

  assert.equal(result?.sessionId, 'c1');
  assert.equal(result?.cwd, '/w');
});

test('Pi forwards its own event names', () => {
  const pi = (hook: string) => normalizeEnvelope(envelope('pi', hook, { sessionId: 'p1', cwd: '/w' }));

  assert.equal(pi('session_start')?.event, 'session_start');
  assert.equal(pi('session_shutdown')?.event, 'session_end');
  assert.equal(pi('before_agent_start')?.event, 'turn_start');
  assert.equal(pi('agent_settled')?.event, 'turn_end');
  assert.equal(pi('ui_prompt_start')?.event, 'blocked_start');
  assert.equal(pi('ui_prompt_end')?.event, 'blocked_end');
  assert.equal(pi('tool_call'), null);
  assert.equal(pi('session_start')?.cwd, '/w');
});
