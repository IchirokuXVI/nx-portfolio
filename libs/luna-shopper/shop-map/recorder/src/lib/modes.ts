import type { ModeDescription, ModeId } from './track-types';
import type { WalkFile } from './walk-file';

const STEP_SOURCES = ['own', 'hw'] as const;
const HEADING_SOURCES = ['gyro', 'game', 'absolute'] as const;

function hasRows(rows: unknown[] | undefined): boolean {
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Every mode the file's streams allow, section 4, in a stable order: `vio`,
 * `gps`, then the PDR modes with `own` before `hw`, then `gyro`, `game`,
 * `absolute`, and `snap` before free. A stream counts when it has a row.
 */
export function availableModes(walk: WalkFile): ModeId[] {
  const s = walk.streams ?? {};
  const modes: ModeId[] = [];
  if (hasRows(s.pose)) modes.push('vio');
  if (hasRows(s.location)) modes.push('gps');
  const steps = {
    own: hasRows(s.motion),
    hw: hasRows(s.steps),
  };
  const headings = {
    gyro: hasRows(s.motion),
    game: hasRows(s.game),
    absolute: hasRows(s.absolute),
  };
  for (const st of STEP_SOURCES) {
    if (!steps[st]) continue;
    for (const h of HEADING_SOURCES) {
      if (!headings[h]) continue;
      modes.push(`pdr:${st}:${h}:snap`, `pdr:${st}:${h}`);
    }
  }
  return modes;
}

/** What a mode id names. Throws on an id that is not one of section 4. */
export function describeMode(mode: ModeId): ModeDescription {
  if (mode === 'vio') return { snap: false, kind: 'vio' };
  if (mode === 'gps') return { snap: false, kind: 'gps' };
  const parts = mode.split(':');
  const [kind, steps, heading, snap] = parts;
  if (
    kind === 'pdr' &&
    (parts.length === 3 || (parts.length === 4 && snap === 'snap')) &&
    (STEP_SOURCES as readonly string[]).includes(steps) &&
    (HEADING_SOURCES as readonly string[]).includes(heading)
  ) {
    return {
      kind: 'pdr',
      steps: steps as ModeDescription['steps'],
      heading: heading as ModeDescription['heading'],
      snap: parts.length === 4,
    };
  }
  throw new Error(`Unknown positioning mode "${mode}"`);
}
