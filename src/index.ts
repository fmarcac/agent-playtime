/**
 * Package entry point.
 *
 * OpenCode loads npm plugins by importing the package root and calling every
 * export as a plugin, so the root exports the plugin and nothing else. The
 * library lives at `agent-playtime/lib`.
 */

export { PlaytimePlugin } from './adapters/opencode/plugin.js';
