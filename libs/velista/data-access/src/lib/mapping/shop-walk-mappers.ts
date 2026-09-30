import type {
  AreaColour,
  AreaKind,
  AreaOrigin,
  MapArea,
  MapMark,
  MarkKind,
  ShopMapDocumentV2,
  WalkEntry,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  SHOP_WALK_ENTRY_KINDS,
  SHOP_WALK_STOP_REASONS,
  type ShopWalkDetail,
  type ShopWalkLog,
  type ShopWalkSummary,
  type ShopWalkTimelineEntry,
} from '@portfolio/velista/models';
import { date, isRecord, mapArray, oneOfOrNull, str } from './primitives';

/**
 * The walks of a shop off the wire (velista `0122`; backend `0168`), rule D4.
 *
 * Every mapper takes `unknown` and answers null for a record it cannot use.
 * Two strictness levels, on purpose:
 *
 * - A **row** (a walk in the list, an entry of the timeline) that cannot be read
 *   is dropped, and the rest of the list is drawn.
 * - The **log** is all or nothing. It is folded on the phone into the map a
 *   rewind would bring back, and a fold with one entry or one event missing is a
 *   different map. So a log with anything unreadable in it is no log at all, and
 *   the rewind screen says it would not load rather than show a wrong moment.
 */

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function whole(value: unknown): number | null {
  const n = finite(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** From `ShopWalkSummaryView`. */
export function toShopWalkSummary(raw: unknown): ShopWalkSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const locationId = str(raw['supermarketLocationId']);
  const name = str(raw['name']);
  const lastSeq = whole(raw['lastSeq']);
  const createdAt = date(raw['createdAt']);
  const lastChangedAt = date(raw['lastChangedAt']);
  if (
    id === null ||
    id === '' ||
    locationId === null ||
    name === null ||
    lastSeq === null ||
    createdAt === null
  ) {
    return null;
  }
  return {
    id,
    locationId,
    name,
    // Only an explicit true: a walk wrongly read as shown would tell a mapper
    // that shoppers see a map they do not.
    shown: raw['shown'] === true,
    lastSeq,
    entryCount: whole(raw['entryCount']) ?? lastSeq,
    markCount: whole(raw['markCount']) ?? 0,
    createdAt,
    lastChangedAt: lastChangedAt ?? createdAt,
  };
}

/** From `ShopWalkListView`, or null when the body is not a list at all. */
export function toShopWalkList(raw: unknown): ShopWalkSummary[] | null {
  if (!isRecord(raw) || !Array.isArray(raw['walks'])) {
    return null;
  }
  return mapArray(raw['walks'], toShopWalkSummary);
}

/** From `ShopWalkTimelineEntry`. An entry of a kind this build does not know is dropped. */
export function toShopWalkTimelineEntry(
  raw: unknown
): ShopWalkTimelineEntry | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const seq = whole(raw['seq']);
  const kind = oneOfOrNull(raw['kind'], SHOP_WALK_ENTRY_KINDS);
  const at = date(raw['at']);
  const logFrom = whole(raw['logFrom']);
  const logTo = whole(raw['logTo']);
  if (
    id === null ||
    seq === null ||
    kind === null ||
    at === null ||
    logFrom === null ||
    logTo === null
  ) {
    return null;
  }
  return {
    id,
    seq,
    kind,
    at,
    logMs:
      whole(raw['logMs']) ??
      (kind === 'started' || kind === 'resumed' ? logFrom : logTo),
    logFrom,
    logTo,
    rewoundTo: kind === 'rewound' ? whole(raw['rewoundTo']) : null,
    reason:
      kind === 'stopped'
        ? oneOfOrNull(raw['reason'], SHOP_WALK_STOP_REASONS)
        : null,
  };
}

/** From `ShopWalkView`: the walk, its real document and its timeline. */
export function toShopWalkDetail(raw: unknown): ShopWalkDetail | null {
  if (!isRecord(raw)) {
    return null;
  }
  const walk = toShopWalkSummary(raw['walk']);
  const document = toShopMapDocument(raw['document']);
  if (walk === null || document === null) {
    return null;
  }
  return {
    walk,
    document,
    timeline: mapArray(raw['timeline'], toShopWalkTimelineEntry).sort(
      (a, b) => a.seq - b.seq
    ),
  };
}

/** From `ShopWalkLogView`. All or nothing: see the file comment. */
export function toShopWalkLog(raw: unknown): ShopWalkLog | null {
  if (!isRecord(raw) || !Array.isArray(raw['entries'])) {
    return null;
  }
  const walkId = str(raw['walkId']);
  const lastSeq = whole(raw['lastSeq']);
  if (walkId === null || lastSeq === null) {
    return null;
  }
  const entries = raw['entries'].map(toWalkEntry);
  if (entries.some((entry) => entry === null)) {
    return null;
  }
  let snapshot: ShopWalkLog['snapshot'] = null;
  if (raw['snapshot'] != null) {
    const record = isRecord(raw['snapshot']) ? raw['snapshot'] : {};
    const seq = whole(record['seq']);
    const document = toShopMapDocument(record['document']);
    if (seq === null || document === null) {
      return null;
    }
    snapshot = { seq, document };
  }
  return {
    walkId,
    snapshot,
    entries: (entries as WalkEntry[]).sort((a, b) => a.seq - b.seq),
    lastSeq,
  };
}

/** From `ShopWalkEntryView`: one entry with its events, or null. */
export function toWalkEntry(raw: unknown): WalkEntry | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const seq = whole(raw['seq']);
  const kind = oneOfOrNull(raw['kind'], SHOP_WALK_ENTRY_KINDS);
  const at = str(raw['at']);
  const logFrom = whole(raw['logFrom']);
  const logTo = whole(raw['logTo']);
  if (
    id === null ||
    seq === null ||
    kind === null ||
    at === null ||
    date(at) === null ||
    logFrom === null ||
    logTo === null ||
    !Array.isArray(raw['events'])
  ) {
    return null;
  }
  const events = raw['events'].map(toWalkEvent);
  if (events.some((event) => event === null)) {
    return null;
  }
  const rewoundTo = whole(raw['rewoundTo']);
  if (kind === 'rewound' && rewoundTo === null) {
    return null;
  }
  const reason = oneOfOrNull(raw['reason'], SHOP_WALK_STOP_REASONS);
  return {
    id,
    seq,
    kind,
    at,
    logFrom,
    logTo,
    events: events as WalkEvent[],
    ...(kind === 'rewound' && rewoundTo !== null ? { rewoundTo } : {}),
    ...(kind === 'stopped' && reason !== null ? { reason } : {}),
  };
}

function toWalkEvent(raw: unknown): WalkEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  switch (raw['type']) {
    case 'path': {
      if (!Array.isArray(raw['points'])) {
        return null;
      }
      const points = raw['points'].map((point: unknown) => {
        if (!Array.isArray(point) || point.length !== 3) {
          return null;
        }
        const [t, x, y] = point.map(finite);
        return t === null || x === null || y === null
          ? null
          : ([t, x, y] as [number, number, number]);
      });
      return points.some((point) => point === null)
        ? null
        : {
            type: 'path',
            points: points as [number, number, number][],
          };
    }
    case 'mark-put': {
      const mark = toMapMark(raw['mark']);
      return mark === null ? null : { type: 'mark-put', mark };
    }
    case 'area-put': {
      const area = toMapArea(raw['area']);
      return area === null ? null : { type: 'area-put', area };
    }
    case 'mark-removed':
    case 'area-removed': {
      const id = str(raw['id']);
      return id === null ? null : { type: raw['type'], id };
    }
    case 'section-left': {
      const logMs = finite(raw['logMs']);
      return logMs === null ? null : { type: 'section-left', logMs };
    }
    default:
      return null;
  }
}

const AREA_KINDS: readonly AreaKind[] = [
  'shelf',
  'counter',
  'checkout',
  'entrance',
  'blocked',
  'path',
];
const AREA_ORIGINS: readonly AreaOrigin[] = [
  'suggested',
  'section-run',
  'counter-mark',
  'drawn',
];
const MARK_KINDS: readonly MarkKind[] = ['section', 'counter', 'note'];

function toColour(raw: unknown): AreaColour {
  if (isRecord(raw)) {
    if (raw['mode'] === 'category') {
      return { mode: 'category' };
    }
    const value = str(raw['value']);
    if (raw['mode'] === 'custom' && value !== null) {
      return { mode: 'custom', value };
    }
  }
  return { mode: 'default' };
}

function toMapArea(raw: unknown): MapArea | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const kind = oneOfOrNull(raw['kind'], AREA_KINDS);
  const x = finite(raw['x']);
  const y = finite(raw['y']);
  const w = finite(raw['w']);
  const h = finite(raw['h']);
  if (
    id === null ||
    kind === null ||
    x === null ||
    y === null ||
    w === null ||
    h === null
  ) {
    return null;
  }
  const section = str(raw['section']);
  const label = str(raw['label']);
  return {
    id,
    kind,
    x,
    y,
    w,
    h,
    ...(section !== null ? { section } : {}),
    ...(label !== null ? { label } : {}),
    colour: toColour(raw['colour']),
    origin: oneOfOrNull(raw['origin'], AREA_ORIGINS) ?? 'drawn',
  };
}

function toMapMark(raw: unknown): MapMark | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const kind = oneOfOrNull(raw['kind'], MARK_KINDS);
  const x = finite(raw['x']);
  const y = finite(raw['y']);
  const heading = finite(raw['heading']);
  const logMs = finite(raw['logMs']);
  if (
    id === null ||
    kind === null ||
    x === null ||
    y === null ||
    heading === null ||
    logMs === null
  ) {
    return null;
  }
  return { id, kind, x, y, heading, text: str(raw['text']) ?? '', logMs };
}

/**
 * From `ShopMapDocument` (version 2), or null. An area or a mark that cannot be
 * read makes the document unreadable, for the log's reason.
 */
export function toShopMapDocument(raw: unknown): ShopMapDocumentV2 | null {
  if (
    !isRecord(raw) ||
    raw['version'] !== 2 ||
    !Array.isArray(raw['areas']) ||
    !Array.isArray(raw['marks']) ||
    !Array.isArray(raw['path'])
  ) {
    return null;
  }
  const areas = raw['areas'].map(toMapArea);
  const marks = raw['marks'].map(toMapMark);
  const path = raw['path'].map((line: unknown) => {
    if (!isRecord(line) || !Array.isArray(line['points'])) {
      return null;
    }
    const points = line['points'].map((point: unknown) => {
      if (!Array.isArray(point) || point.length !== 2) {
        return null;
      }
      const [x, y] = point.map(finite);
      return x === null || y === null ? null : ([x, y] as [number, number]);
    });
    return points.some((point) => point === null)
      ? null
      : { points: points as [number, number][] };
  });
  if (
    areas.some((one) => one === null) ||
    marks.some((one) => one === null) ||
    path.some((one) => one === null)
  ) {
    return null;
  }
  return {
    version: 2,
    areas: areas as MapArea[],
    marks: marks as MapMark[],
    path: path as { points: [number, number][] }[],
  };
}
