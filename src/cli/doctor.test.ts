import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkHarness, referencedPath } from './doctor.js';
import { install } from './install.js';
import { mergeHooks, playtimeHooks } from './hooks-config.js';

const EMIT = '/home/dev/.npm/_npx/abc123/node_modules/agent-playtime/adapters/shared/emit.sh';

/** Exactly what install writes, quoting and all. */
function settingsFile(emit: string): string {
  return `${JSON.stringify({ hooks: mergeHooks(undefined, playtimeHooks(emit, 'claude-code')) }, null, 2)}\n`;
}

test('the hook path is found even though its quotes are escaped inside the JSON', () => {
  // The path lives in a string inside a string. Matching on the quotes around
  // it finds nothing, and a doctor that finds nothing says everything is fine.
  assert.equal(referencedPath(settingsFile(EMIT), 'claude-code'), EMIT);
});

test('the same holds for Codex, which keeps the same shape', () => {
  const file = `${JSON.stringify({ hooks: playtimeHooks(EMIT, 'codex') }, null, 2)}\n`;

  assert.equal(referencedPath(file, 'codex'), EMIT);
});

test('a path with no surprises in it is still found', () => {
  const plain = '/usr/lib/node_modules/agent-playtime/adapters/shared/emit.sh';

  assert.equal(referencedPath(settingsFile(plain), 'claude-code'), plain);
});

test('the OpenCode plugin names its module in a plain re-export', () => {
  const source = '/usr/lib/node_modules/agent-playtime/dist/adapters/opencode/plugin.js';

  assert.equal(
    referencedPath(`export { PlaytimePlugin } from ${JSON.stringify(source)};\n`, 'opencode'),
    source,
  );
});

test('config with no wiring in it names nothing', () => {
  assert.equal(referencedPath('{\n  "hooks": {}\n}\n', 'claude-code'), null);
  assert.equal(referencedPath('export const Other = () => {};\n', 'opencode'), null);
});

/** A throwaway home, with every harness directory pointed inside it. */
async function scratchEnv(): Promise<{ env: NodeJS.ProcessEnv; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'playtime-doctor-'));
  return { root, env: { HOME: root, CLAUDE_CONFIG_DIR: join(root, '.claude'), CLINE_DIR: join(root, '.cline') } };
}

test('a harness with nothing installed is a warning, not a failure', async () => {
  const { env, root } = await scratchEnv();
  try {
    assert.equal((await checkHarness('claude-code', env)).status, 'warn');
    assert.equal((await checkHarness('cline', env)).status, 'warn');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an installed Claude-style harness checks out', async () => {
  const { env, root } = await scratchEnv();
  try {
    await mkdir(env['CLAUDE_CONFIG_DIR'] ?? '', { recursive: true });
    assert.equal((await install('claude-code', { env })).status, 'installed');

    const check = await checkHarness('claude-code', env);
    assert.equal(check.status, 'ok');
    assert.equal(check.name, 'Claude Code hooks');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Cline is judged by its TaskStart hook', async () => {
  const { env, root } = await scratchEnv();
  try {
    await mkdir(env['CLINE_DIR'] ?? '', { recursive: true });
    await install('cline', { env });
    assert.equal((await checkHarness('cline', env)).status, 'ok');

    const elsewhere = '/opt/old/adapters/shared/emit.sh';
    await writeFile(join(env['CLINE_DIR'] ?? '', 'hooks', 'TaskStart'), `#!/bin/sh\nexec "${elsewhere}" cline TaskStart\n`);

    const moved = await checkHarness('cline', env);
    assert.equal(moved.status, 'warn');
    assert.match(moved.detail, /another copy of Playtime at \/opt\/old/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Pi names its extension module in a re-export', () => {
  const source = '/usr/lib/node_modules/agent-playtime/dist/adapters/pi/extension.js';

  assert.equal(referencedPath(`export { default } from ${JSON.stringify(source)};\n`, 'pi'), source);
});
