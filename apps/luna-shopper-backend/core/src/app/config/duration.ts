/**
 * Parses a short duration string (`15m`, `24h`, `7d`, `60s`, `2w`) into
 * milliseconds, for the reaper grace periods and intervals (plan 0011). Kept
 * local to core rather than imported from auth: cross-app imports are disallowed,
 * so each service that needs it carries its own copy.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}
