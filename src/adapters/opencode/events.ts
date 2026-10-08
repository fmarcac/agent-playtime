/**
 * Reading OpenCode's events.
 *
 * Kept apart from plugin.ts because OpenCode calls every exported function of a
 * plugin module as a plugin. Anything exported there that is not a plugin gets
 * invoked with a plugin context and fails, so the helpers live here instead.
 */

/** OpenCode event names Playtime cares about, mapped to the shim's hook vocabulary. */
const DIRECT_EVENTS: Record<string, string> = {
  'session.created': 'session.created',
  'session.idle': 'session.idle',
  'session.deleted': 'session.deleted',
  'permission.asked': 'permission.asked',
  'permission.replied': 'permission.replied',
};

export interface OpenCodeEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** OpenCode nests identifiers differently per event, so probe the shapes it uses. */
export function readSessionId(properties: Record<string, unknown>): string | undefined {
  const info = asRecord(properties['info']);
  const candidates = [
    properties['sessionID'],
    properties['sessionId'],
    info['sessionID'],
    info['sessionId'],
    info['id'],
  ];

  return candidates.find((value): value is string => typeof value === 'string' && value !== '');
}

function isUserPrompt(event: OpenCodeEvent): boolean {
  if (event.type !== 'message.updated') return false;
  const info = asRecord(asRecord(event.properties)['info']);
  return info['role'] === 'user';
}

/**
 * `session.idle` is deprecated upstream in favour of `session.status` carrying
 * an idle status, so both end a turn.
 */
function isIdleStatus(event: OpenCodeEvent): boolean {
  if (event.type !== 'session.status') return false;
  const status = asRecord(asRecord(event.properties)['status']);
  return status['type'] === 'idle';
}

export function hookNameFor(event: OpenCodeEvent): string | null {
  if (isUserPrompt(event)) return 'user.prompt';
  if (isIdleStatus(event)) return 'session.idle';
  return DIRECT_EVENTS[event.type ?? ''] ?? null;
}
