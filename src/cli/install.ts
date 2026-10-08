/**
 * Wiring Playtime into each harness.
 *
 * Every install is idempotent and additive: existing hooks are preserved and
 * only Playtime's own entries are replaced. Files are backed up before being
 * rewritten, since these are settings the user cares about.
 */

import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Harness } from '../core/events.js';
import { isMissingFile } from '../store/jsonl.js';
import {
  CLINE_EVENTS,
  EMIT_MARKER,
  clineHookScript,
  copilotHooksFile,
  gooseHooksFile,
  mergeHooks,
  playtimeHooks,
} from './hooks-config.js';
import type { HookMap } from './hooks-config.js';

export interface InstallResult {
  harness: Harness;
  target: string;
  status: 'installed' | 'unchanged' | 'would install' | 'not found' | 'failed';
  detail?: string;
}

/** dist/cli/install.js sits three levels below the package root. */
export function packageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function emitScriptPath(): string {
  return join(packageRoot(), 'adapters', 'shared', 'emit.sh');
}

export function daemonEntryPath(): string {
  return join(packageRoot(), 'dist', 'daemon', 'main.js');
}

/** The module OpenCode's plugin file re-exports, which is this copy of Playtime. */
export function openCodePluginSource(): string {
  return join(packageRoot(), 'dist', 'adapters', 'opencode', 'plugin.js');
}

/** The module Pi's extension file re-exports. */
export function piExtensionSource(): string {
  return join(packageRoot(), 'dist', 'adapters', 'pi', 'extension.js');
}

/**
 * How to recognise our wiring in a harness config.
 *
 * `marker` says the harness is wired to some copy of Playtime; `expected` says
 * it is wired to this one. OpenCode and Pi load a module rather than running a
 * shell hook, so they have nothing in common with the rest, and `executable`
 * says which check the doctor owes the referenced file.
 */
export interface Wiring {
  marker: string;
  expected: string;
  executable: boolean;
}

export function wiringFor(harness: Harness): Wiring {
  if (harness === 'opencode') {
    return { marker: 'PlaytimePlugin', expected: openCodePluginSource(), executable: false };
  }
  if (harness === 'pi') {
    return { marker: 'adapters/pi/extension.js', expected: piExtensionSource(), executable: false };
  }
  return { marker: EMIT_MARKER, expected: emitScriptPath(), executable: true };
}

/** A file to write, already known to differ from what is on disk. */
interface Change {
  path: string;
  contents: string;
  mode?: number;
  /** Whether the file may hold the user's own settings, so needs a backup first. */
  backup?: boolean;
}

/**
 * Everything that differs between harnesses, in one place.
 *
 * `presence` lists directories of which any one existing says the harness is
 * installed. `plan` returns only the files that need to change, so an empty
 * plan is 'unchanged' and a dry run reports on real state.
 */
interface Descriptor {
  /** What the doctor calls the thing that is wired up. */
  noun: 'hooks' | 'plugin' | 'extension';
  /** What install reports as its target. */
  target(env: NodeJS.ProcessEnv): string;
  /** The file whose contents show where the harness is pointed. */
  wiredFile(env: NodeJS.ProcessEnv): string;
  presence(env: NodeJS.ProcessEnv): string[];
  plan(env: NodeJS.ProcessEnv): Promise<Change[]>;
  /** Shown beside a successful result. */
  note?: string;
}

function home(env: NodeJS.ProcessEnv): string {
  return env['HOME'] ?? homedir();
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw new Error(`${file} is not valid JSON, so it was left alone`);
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The change needed to make a file entirely ours hold `contents`, if any. */
async function wholeFile(path: string, contents: string, mode?: number): Promise<Change[]> {
  const existing = await readFile(path, 'utf8').catch(() => null);
  // A script that lost its execute bit would be skipped by the harness.
  const runnable = mode === undefined || (((await stat(path).catch(() => null))?.mode ?? 0) & 0o111) !== 0;
  if (existing === contents && runnable) return [];
  return [mode === undefined ? { path, contents } : { path, contents, mode }];
}

/**
 * A settings file shared with the user's own hooks. Compared as data, so a file
 * that only differs in formatting is left alone. Claude Code, Codex, Qwen and
 * Gemini keep their events under a top-level `hooks` key (Codex rejects events
 * at the root: "unknown field `SessionStart`, expected `description` or
 * `hooks`"); Factory Droid keeps them at the root.
 */
function sharedJson(
  harness: Harness,
  file: (env: NodeJS.ProcessEnv) => string,
  nested: boolean,
): Descriptor['plan'] {
  return async (env) => {
    const target = file(env);
    const settings = (await readJsonObject(target)) ?? {};
    const current = (nested ? settings['hooks'] : settings) as HookMap | undefined;

    const merged = mergeHooks(current, playtimeHooks(emitScriptPath(), harness));
    const next = nested ? { ...settings, hooks: merged } : merged;

    if (JSON.stringify(next) === JSON.stringify(settings)) return [];
    return [{ path: target, contents: json(next), backup: true }];
  };
}

/**
 * Droid reads `hooks.json` and `settings.json` and lets a key in the first
 * replace the same event's whole list in the second. Writing our `Stop` into
 * `hooks.json` would therefore silently switch off any `Stop` hooks the user
 * keeps in `settings.json`, so those are carried across before ours are added.
 */
const droidHooks: Descriptor['plan'] = async (env) => {
  const target = join(droidDir(env), 'hooks.json');
  const existing = (await readJsonObject(target)) ?? {};
  const settings = (await readJsonObject(join(droidDir(env), 'settings.json'))) ?? {};
  const fromSettings = (settings['hooks'] ?? {}) as HookMap;

  const ours = playtimeHooks(emitScriptPath(), 'droid');
  const current: HookMap = { ...(existing as HookMap) };
  for (const event of Object.keys(ours)) {
    if (current[event] === undefined && Array.isArray(fromSettings[event])) {
      current[event] = fromSettings[event];
    }
  }

  const next = mergeHooks(current, ours);
  if (JSON.stringify(next) === JSON.stringify(existing)) return [];
  return [{ path: target, contents: json(next), backup: true }];
};

const claudeDir = (env: NodeJS.ProcessEnv) => env['CLAUDE_CONFIG_DIR'] ?? join(home(env), '.claude');
const codexDir = (env: NodeJS.ProcessEnv) => env['CODEX_HOME'] ?? join(home(env), '.codex');
const qwenDir = (env: NodeJS.ProcessEnv) => env['QWEN_HOME'] ?? join(home(env), '.qwen');
const droidDir = (env: NodeJS.ProcessEnv) => join(home(env), '.factory');
const geminiDir = (env: NodeJS.ProcessEnv) =>
  env['GEMINI_CLI_HOME'] ? join(env['GEMINI_CLI_HOME'], '.gemini') : join(home(env), '.gemini');
const copilotDir = (env: NodeJS.ProcessEnv) => env['COPILOT_HOME'] ?? join(home(env), '.copilot');
const clineDir = (env: NodeJS.ProcessEnv) => env['CLINE_DIR'] ?? join(home(env), '.cline');
const openCodeDir = (env: NodeJS.ProcessEnv) =>
  join(env['XDG_CONFIG_HOME'] ?? join(home(env), '.config'), 'opencode');
const piDir = (env: NodeJS.ProcessEnv) =>
  env['PI_CODING_AGENT_DIR'] ?? join(home(env), '.pi', 'agent');
/** An absolute `GOOSE_PATH_ROOT` relocates everything goose keeps, plugins included. */
const gooseRoot = (env: NodeJS.ProcessEnv): string | undefined => {
  const root = env['GOOSE_PATH_ROOT'];
  return root !== undefined && isAbsolute(root) ? root : undefined;
};
/** Goose's plugin directory is shared by other tools, so ours gets a subdirectory. */
const goosePluginDir = (env: NodeJS.ProcessEnv) =>
  join(gooseRoot(env) ?? home(env), '.agents', 'plugins', 'playtime');

/** One file a Claude-style harness reads, so target and wired file are the same. */
function singleFile(
  noun: Descriptor['noun'],
  dir: (env: NodeJS.ProcessEnv) => string,
  relative: string[],
  plan: Descriptor['plan'],
  note?: string,
): Descriptor {
  const file = (env: NodeJS.ProcessEnv) => join(dir(env), ...relative);
  return {
    noun,
    target: file,
    wiredFile: file,
    presence: (env) => [dir(env)],
    plan,
    ...(note === undefined ? {} : { note }),
  };
}

const DESCRIPTORS: Record<Harness, Descriptor> = {
  'claude-code': singleFile(
    'hooks',
    claudeDir,
    ['settings.json'],
    sharedJson('claude-code', (env) => join(claudeDir(env), 'settings.json'), true),
  ),

  // Codex only runs hooks the user has trusted in its TUI, and asks again after any change.
  codex: singleFile(
    'hooks',
    codexDir,
    ['hooks.json'],
    sharedJson('codex', (env) => join(codexDir(env), 'hooks.json'), true),
    "approve the hooks in Codex's hooks review before they run",
  ),

  qwen: singleFile(
    'hooks',
    qwenDir,
    ['settings.json'],
    sharedJson('qwen', (env) => join(qwenDir(env), 'settings.json'), true),
  ),

  droid: singleFile(
    'hooks',
    droidDir,
    ['hooks.json'],
    droidHooks,
  ),

  gemini: singleFile(
    'hooks',
    geminiDir,
    ['settings.json'],
    sharedJson('gemini', (env) => join(geminiDir(env), 'settings.json'), true),
  ),

  copilot: singleFile('hooks', copilotDir, ['hooks', 'playtime.json'], async (env) =>
    wholeFile(join(copilotDir(env), 'hooks', 'playtime.json'), json(copilotHooksFile(emitScriptPath()))),
  ),

  cline: {
    noun: 'hooks',
    target: (env) => join(clineDir(env), 'hooks'),
    wiredFile: (env) => join(clineDir(env), 'hooks', 'TaskStart'),
    presence: (env) => [clineDir(env)],
    plan: async (env) => {
      const dir = join(clineDir(env), 'hooks');
      const changes: Change[] = [];
      const conflicts: string[] = [];

      for (const event of CLINE_EVENTS) {
        const file = join(dir, event);
        const existing = await readFile(file, 'utf8').catch(() => null);
        // A hook of that name that is not ours belongs to the user.
        if (existing !== null && !existing.includes(EMIT_MARKER)) {
          conflicts.push(file);
          continue;
        }
        changes.push(...(await wholeFile(file, clineHookScript(emitScriptPath(), event), 0o755)));
      }

      if (conflicts.length > 0) {
        throw new Error(`existing hooks that are not Playtime's were left alone: ${conflicts.join(', ')}`);
      }
      return changes;
    },
  },

  // Goose finds plugins by directory and enables them itself; hooks/hooks.json
  // is discovered without being named in plugin.json. It never fires
  // SessionEnd, so a session ends when its process does.
  goose: {
    noun: 'hooks',
    target: goosePluginDir,
    wiredFile: (env) => join(goosePluginDir(env), 'hooks', 'hooks.json'),
    presence: (env) => {
      const root = gooseRoot(env);
      if (root !== undefined) return [join(root, 'config'), join(root, 'data')];
      return [
        join(env['XDG_CONFIG_HOME'] ?? join(home(env), '.config'), 'goose'),
        join(env['XDG_DATA_HOME'] ?? join(home(env), '.local', 'share'), 'goose'),
      ];
    },
    plan: async (env) => {
      const dir = goosePluginDir(env);
      const manifest = { name: 'playtime', version: await packageVersion(), description: 'Playtime session tracking' };
      return [
        ...(await wholeFile(join(dir, 'plugin.json'), json(manifest))),
        ...(await wholeFile(join(dir, 'hooks', 'hooks.json'), json(gooseHooksFile(emitScriptPath())))),
      ];
    },
  },

  // Rather than copying the plugin, drop in a one-line re-export so `npm update`
  // moves the installation forward without a reinstall.
  opencode: {
    noun: 'plugin',
    target: (env) => join(openCodeDir(env), 'plugins', 'playtime.js'),
    wiredFile: (env) => join(openCodeDir(env), 'plugins', 'playtime.js'),
    presence: (env) => [openCodeDir(env)],
    plan: async (env) =>
      wholeFile(
        join(openCodeDir(env), 'plugins', 'playtime.js'),
        `export { PlaytimePlugin } from ${JSON.stringify(openCodePluginSource())};\n`,
      ),
  },

  // Pi loads every extension file it finds, and uses the default export.
  pi: {
    noun: 'extension',
    target: (env) => join(piDir(env), 'extensions', 'playtime.js'),
    wiredFile: (env) => join(piDir(env), 'extensions', 'playtime.js'),
    presence: (env) => [piDir(env)],
    plan: async (env) =>
      wholeFile(
        join(piDir(env), 'extensions', 'playtime.js'),
        `export { default } from ${JSON.stringify(piExtensionSource())};\n`,
      ),
  },
};

async function packageVersion(): Promise<string> {
  const text = await readFile(join(packageRoot(), 'package.json'), 'utf8');
  return (JSON.parse(text) as { version: string }).version;
}

export function installTarget(harness: Harness, env: NodeJS.ProcessEnv = process.env): string {
  return DESCRIPTORS[harness].target(env);
}

/** The file that shows where a harness is pointed, and what to call the wiring. */
export function wiredFile(harness: Harness, env: NodeJS.ProcessEnv = process.env): string {
  return DESCRIPTORS[harness].wiredFile(env);
}

export function wiringNoun(harness: Harness): Descriptor['noun'] {
  return DESCRIPTORS[harness].noun;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function apply(change: Change): Promise<void> {
  await mkdir(dirname(change.path), { recursive: true });
  if (change.backup) await copyFile(change.path, `${change.path}.playtime-backup`).catch(() => undefined);
  await writeFile(change.path, change.contents, 'utf8');
  if (change.mode !== undefined) await chmod(change.path, change.mode);
}

/** Whether the harness looks installed on this machine at all. */
export async function harnessPresent(harness: Harness, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const found = await Promise.all(DESCRIPTORS[harness].presence(env).map(exists));
  return found.some(Boolean);
}

export async function install(
  harness: Harness,
  options: { dryRun?: boolean; onlyFound?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<InstallResult> {
  const env = options.env ?? process.env;
  const descriptor = DESCRIPTORS[harness];
  const target = descriptor.target(env);
  const dryRun = options.dryRun ?? false;

  // Wiring up everything should not conjure config for a harness never installed.
  if (options.onlyFound) {
    if (!(await harnessPresent(harness, env))) return { harness, target, status: 'not found' };
  }

  try {
    const changes = await descriptor.plan(env);
    const status = changes.length === 0 ? 'unchanged' : dryRun ? 'would install' : 'installed';

    if (status === 'installed') {
      for (const change of changes) await apply(change);
    }

    return descriptor.note === undefined ? { harness, target, status } : { harness, target, status, detail: descriptor.note };
  } catch (error) {
    return { harness, target, status: 'failed', detail: (error as Error).message };
  }
}
