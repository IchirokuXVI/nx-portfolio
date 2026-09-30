import type {
  MapArea,
  MapMark,
  ShopMapDocumentV2,
  WalkEntry,
  WalkEntryKind,
  WalkEvent,
} from './types';

/** Small builders for the version 2 specs. Not exported from the library. */

export function area(id: string, extra: Partial<MapArea> = {}): MapArea {
  return {
    id,
    kind: 'shelf',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    colour: { mode: 'default' },
    origin: 'drawn',
    ...extra,
  };
}

export function mark(
  id: string,
  logMs: number,
  extra: Partial<MapMark> = {}
): MapMark {
  return {
    id,
    kind: 'section',
    x: 0,
    y: 0,
    heading: 0,
    text: id,
    logMs,
    ...extra,
  };
}

export function entry(
  seq: number,
  kind: WalkEntryKind,
  logFrom: number,
  logTo: number,
  events: WalkEvent[] = [],
  extra: Partial<WalkEntry> = {}
): WalkEntry {
  return {
    id: `e${seq}`,
    seq,
    kind,
    at: '2026-09-29T10:00:00.000Z',
    logFrom,
    logTo,
    events,
    ...extra,
  };
}

/** A path event from `[logMs, x, y]` triples. */
export function path(...points: [number, number, number][]): WalkEvent {
  return { type: 'path', points };
}

export function doc(
  parts: Partial<Omit<ShopMapDocumentV2, 'version'>> = {}
): ShopMapDocumentV2 {
  return { version: 2, areas: [], marks: [], path: [], ...parts };
}

/** A straight walked line from `(x0, y)` to `(x1, y)`, one point per metre. */
export function line(x0: number, x1: number, y: number): [number, number][] {
  const points: [number, number][] = [];
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0; step > 0 ? x <= x1 : x >= x1; x += step) points.push([x, y]);
  return points;
}
