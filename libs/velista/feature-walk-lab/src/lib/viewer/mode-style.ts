import type { ModeId } from '@portfolio/luna-shopper/shop-map/recorder';

/** How one mode's track is drawn. */
export interface ModeStyle {
  color: string;
  /** An SVG `stroke-dasharray`, in screen pixels (strokes do not scale). */
  dash: string | null;
  width: number;
}

/**
 * Series colours for the fourteen modes, by what the mode is made of.
 *
 * Hue says where heading comes from (gyro amber, game sky, absolute magenta), the
 * darker shade of each hue is the hardware step detector, and a dashed line is a mode
 * without square turns. The camera track is the thick green one because it is the
 * closest thing the test has to the truth, and GPS is the dotted red one because it
 * is expected to be the worst. So a track is readable from its line before the legend
 * is read.
 *
 * These are data colours on a chart rather than interface colours, which is why they
 * live here in TypeScript and not as tokens: every one sits at a middle lightness so
 * it reads on both the day and the night surface.
 */
const HUES: Record<string, { own: string; hw: string }> = {
  gyro: { own: '#e8a33d', hw: '#b7791f' },
  game: { own: '#3fa7e0', hw: '#2b6cb0' },
  absolute: { own: '#c061cb', hw: '#8e44ad' },
};

export function modeStyle(mode: ModeId): ModeStyle {
  if (mode === 'vio') {
    return { color: '#2fbf71', dash: null, width: 4 };
  }
  if (mode === 'gps') {
    return { color: '#e5533d', dash: '2 6', width: 3 };
  }

  const [kind, steps, heading, snap] = mode.split(':');
  const hue = kind === 'pdr' ? HUES[heading] : undefined;
  if (!hue) {
    return { color: '#8a8f98', dash: '6 4', width: 2 };
  }

  const isSnap = snap === 'snap';
  return {
    color: steps === 'hw' ? hue.hw : hue.own,
    dash: isSnap ? null : '8 5',
    width: isSnap ? 3 : 2,
  };
}

/** Whether a mode snaps its turns, which is what the draft map needs (section 7.3). */
export function isSnapMode(mode: ModeId): boolean {
  return mode.startsWith('pdr:') && mode.endsWith(':snap');
}

/**
 * The order the legend and the table list modes in: the camera first, then the snap
 * modes, then the rest, then GPS, so the ground truth and the recorder of plan 0001
 * are at the top.
 */
export function modeRank(mode: ModeId): number {
  if (mode === 'vio') {
    return 0;
  }
  if (mode === 'gps') {
    return 4;
  }
  if (mode === 'pdr:own:gyro:snap') {
    return 1;
  }
  return isSnapMode(mode) ? 2 : 3;
}

export function sortModes(modes: readonly ModeId[]): ModeId[] {
  return [...modes].sort(
    (a, b) => modeRank(a) - modeRank(b) || a.localeCompare(b)
  );
}
