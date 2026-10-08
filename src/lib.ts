/** Library entry point, `agent-playtime/lib`: the interval engine, rollups and stored data. */
export { normalize, union, total, sum, clip, intersect, span } from './core/intervals.js';
export type { Interval } from './core/intervals.js';
export { rollup, concurrency, measure } from './core/rollup.js';
export type { Rollup, Totals, HarnessRollup, ProjectRollup } from './core/rollup.js';
export { HARNESSES, HARNESS_LABELS } from './core/events.js';
export type { Harness, PlaytimeEvent, Envelope } from './core/events.js';
export type { SessionRecord, SessionState } from './core/session.js';
export { windowFor } from './core/window.js';
export type { WindowKind } from './core/window.js';
export { defaultSettings, parseSettings } from './core/settings.js';
export type { Settings, CountMode } from './core/settings.js';
export { resolvePaths } from './store/paths.js';
export { readSessions } from './store/sessions.js';
export { readLive } from './store/live.js';
export type { LiveSnapshot } from './store/live.js';
