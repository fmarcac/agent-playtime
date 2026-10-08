import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HARNESSES } from '../core/events.js';
import { install } from './install.js';

/** Every harness directory pointed inside a throwaway home. */
async function scratch(): Promise<{ env: NodeJS.ProcessEnv; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'playtime-install-'));
  return { root, env: { HOME: root } };
}

async function withScratch(body: (env: NodeJS.ProcessEnv, root: string) => Promise<void>): Promise<void> {
  const { env, root } = await scratch();
  try {
    await body(env, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const PRESENCE = ['.claude', '.codex', '.config/opencode', '.pi/agent', '.omp/agent', '.copilot', '.gemini', '.cline', '.qwen', '.config/goose', '.factory'];

test('with nothing installed, onlyFound reports every harness as not found', async () => {
  await withScratch(async (env) => {
    for (const harness of HARNESSES) {
      assert.equal((await install(harness, { env, onlyFound: true })).status, 'not found', harness);
    }
  });
});

test('every harness installs, then reports unchanged, and a dry run reports real state', async () => {
  await withScratch(async (env, root) => {
    for (const dir of PRESENCE) await mkdir(join(root, dir), { recursive: true });

    for (const harness of HARNESSES) {
      assert.equal((await install(harness, { env, onlyFound: true, dryRun: true })).status, 'would install', harness);
    }
    for (const harness of HARNESSES) {
      assert.equal((await install(harness, { env, onlyFound: true })).status, 'installed', harness);
    }
    for (const harness of HARNESSES) {
      assert.equal((await install(harness, { env, onlyFound: true })).status, 'unchanged', harness);
      assert.equal((await install(harness, { env, onlyFound: true, dryRun: true })).status, 'unchanged', harness);
    }
  });
});

test('Goose is found by its data directory too', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.local', 'share', 'goose'), { recursive: true });

    assert.equal((await install('goose', { env, onlyFound: true })).status, 'installed');
  });
});

test('Droid keeps its events at the root and Gemini times out in milliseconds', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.factory'), { recursive: true });
    await mkdir(join(root, '.gemini'), { recursive: true });
    await install('droid', { env });
    await install('gemini', { env });

    const droid = JSON.parse(await readFile(join(root, '.factory', 'hooks.json'), 'utf8'));
    assert.ok(droid.SessionStart);
    assert.equal(droid.hooks, undefined);

    const gemini = JSON.parse(await readFile(join(root, '.gemini', 'settings.json'), 'utf8'));
    const entry = gemini.hooks.AfterTool[0].hooks[0];
    assert.equal(entry.timeout, 5000);
    assert.equal(entry.name, 'playtime');
  });
});

test('existing settings are backed up and other hooks survive', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.qwen'), { recursive: true });
    const original = JSON.stringify({ theme: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }] } });
    await writeFile(join(root, '.qwen', 'settings.json'), original);

    assert.equal((await install('qwen', { env })).status, 'installed');

    assert.equal(await readFile(join(root, '.qwen', 'settings.json.playtime-backup'), 'utf8'), original);
    const settings = JSON.parse(await readFile(join(root, '.qwen', 'settings.json'), 'utf8'));
    assert.equal(settings.theme, 'x');
    assert.equal(settings.hooks.Stop.length, 2);
  });
});

test('Cline hooks are executable scripts, and a hook of the user is never overwritten', async () => {
  await withScratch(async (env, root) => {
    const hooks = join(root, '.cline', 'hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, 'TaskError'), '#!/bin/sh\necho mine\n');

    const result = await install('cline', { env });
    assert.equal(result.status, 'failed');
    assert.match(result.detail ?? '', /TaskError/);
    assert.equal(await readFile(join(hooks, 'TaskError'), 'utf8'), '#!/bin/sh\necho mine\n');

    await rm(join(hooks, 'TaskError'));
    assert.equal((await install('cline', { env })).status, 'installed');
    assert.ok(((await stat(join(hooks, 'TaskStart'))).mode & 0o111) !== 0);
    assert.match(await readFile(join(hooks, 'TaskComplete'), 'utf8'), /^#!\/bin\/sh\nexec ".*emit\.sh" cline TaskComplete\n$/);
  });
});

test('Codex results remind the user to approve the hooks', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.codex'), { recursive: true });

    assert.match((await install('codex', { env })).detail ?? '', /hooks review/);
  });
});

test('Copilot gets its own file and never a preToolUse hook', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.copilot'), { recursive: true });
    await install('copilot', { env });

    const file = JSON.parse(await readFile(join(root, '.copilot', 'hooks', 'playtime.json'), 'utf8'));
    assert.equal(file.version, 1);
    assert.equal(file.hooks.preToolUse, undefined);
    assert.equal(file.hooks.agentStop[0].timeoutSec, 5);
  });
});

test('Goose gets a plugin directory with a manifest and bare-matcher hooks', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.config', 'goose'), { recursive: true });
    await install('goose', { env });

    const dir = join(root, '.agents', 'plugins', 'playtime');
    assert.equal(JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8')).name, 'playtime');
    const hooks = JSON.parse(await readFile(join(dir, 'hooks', 'hooks.json'), 'utf8')).hooks;
    assert.equal(hooks.PostToolUse[0].matcher, undefined);
  });
});

test('Pi gets a re-export of the extension', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.pi', 'agent'), { recursive: true });
    await install('pi', { env });

    assert.match(
      await readFile(join(root, '.pi', 'agent', 'extensions', 'playtime.js'), 'utf8'),
      /^export \{ default \} from ".*adapters\/pi\/extension\.js";\n$/,
    );
  });
});

test('Oh My Pi gets its own re-export, even when PI_CODING_AGENT_DIR points at Pi', async () => {
  await withScratch(async (env, root) => {
    await mkdir(join(root, '.omp', 'agent'), { recursive: true });
    await install('omp', { env: { ...env, PI_CODING_AGENT_DIR: join(root, 'pi') } });

    assert.match(
      await readFile(join(root, '.omp', 'agent', 'extensions', 'playtime.js'), 'utf8'),
      /^export \{ default \} from ".*adapters\/omp\/extension\.js";\n$/,
    );
  });
});

test('Droid keeps the hooks a user has in settings.json for events Playtime also hooks', async () => {
  await withScratch(async (env, root) => {
    const theirs = { hooks: [{ type: 'command', command: '/usr/local/bin/notify-done' }] };
    await mkdir(join(root, '.factory'), { recursive: true });
    await writeFile(join(root, '.factory', 'settings.json'), JSON.stringify({ hooks: { Stop: [theirs] } }));

    await install('droid', { env });

    // hooks.json replaces settings.json per event, so theirs has to come along.
    const written = JSON.parse(await readFile(join(root, '.factory', 'hooks.json'), 'utf8'));
    assert.deepEqual(written.Stop[0], theirs);
    assert.equal(written.Stop.length, 2);
  });
});

test('an absolute GOOSE_PATH_ROOT relocates the goose plugin', async () => {
  await withScratch(async (env, root) => {
    const gooseRoot = join(root, 'goose-root');
    await mkdir(join(gooseRoot, 'config'), { recursive: true });

    const result = await install('goose', { env: { ...env, GOOSE_PATH_ROOT: gooseRoot }, onlyFound: true });
    assert.equal(result.status, 'installed');
    assert.equal(result.target, join(gooseRoot, '.agents', 'plugins', 'playtime'));
  });
});
