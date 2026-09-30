import {
  foldWalk,
  normalizeShopMapV2,
  stateAt,
  type ShopMapDocumentV2,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';

/**
 * The walks of a shop and their history (velista `0122`; backend `0168`).
 *
 * Rule D4: every type here is velista's own and is mapped from `unknown` in
 * `data-access`. The log's entries are the shared model's `WalkEntry`, because
 * the model folds them on the phone (`stateAt`, `foldWalk`, `walkTimeline`); the
 * mapper checks every entry and event before one reaches this type.
 */

/** What an account may do beyond shopping (backend `0175`). Unknown ones are dropped. */
export const ACCOUNT_PERMISSIONS = ['shopMap.record'] as const;
export type AccountPermission = (typeof ACCOUNT_PERMISSIONS)[number];

/** The kinds of a walk's entries (backend `0168`, model `0002`). */
export const SHOP_WALK_ENTRY_KINDS = [
  'started',
  'resumed',
  'continued',
  'stopped',
  'edited',
  'rewound',
  'confirmed',
  'discarded',
] as const;
export type ShopWalkEntryKind = (typeof SHOP_WALK_ENTRY_KINDS)[number];

/** Why a walk stopped. */
export const SHOP_WALK_STOP_REASONS = [
  'button',
  'left-page',
  'tracking-lost',
  'frame-moved',
] as const;
export type ShopWalkStopReason = (typeof SHOP_WALK_STOP_REASONS)[number];

/** The longest name a walk takes (`SHOP_WALK_LIMITS.nameMaxLength`). */
export const SHOP_WALK_NAME_MAX_LENGTH = 80;

/** One step of the rewind slider. The plan fixes it; there are no step buttons. */
export const REWIND_STEP_MS = 15_000;

/** One walk as the walks list draws it. */
export interface ShopWalkSummary {
  readonly id: string;
  readonly locationId: string;
  readonly name: string;
  /** The walk whose map shoppers see. At most one per shop. */
  readonly shown: boolean;
  /** The seq of the newest entry, which is the next append's base. */
  readonly lastSeq: number;
  readonly entryCount: number;
  readonly markCount: number;
  readonly createdAt: Date;
  readonly lastChangedAt: Date;
}

/** One entry of a walk's timeline, without its events. */
export interface ShopWalkTimelineEntry {
  readonly id: string;
  readonly seq: number;
  readonly kind: ShopWalkEntryKind;
  readonly at: Date;
  /** Where the slider puts it: `logFrom` for `started` and `resumed`, else `logTo`. */
  readonly logMs: number;
  readonly logFrom: number;
  readonly logTo: number;
  readonly rewoundTo: number | null;
  readonly reason: ShopWalkStopReason | null;
}

/** One walk with the map it folds to and its timeline (`GET /v1/catalog/walks/:walkId`). */
export interface ShopWalkDetail {
  readonly walk: ShopWalkSummary;
  /** The walk's real document, with the path and every mark: what a mapper sees. */
  readonly document: ShopMapDocumentV2;
  /** Oldest first. */
  readonly timeline: readonly ShopWalkTimelineEntry[];
}

/** A walk's log with its events (`GET /v1/catalog/walks/:walkId/log`). */
export interface ShopWalkLog {
  readonly walkId: string;
  /** Null when the log was read from its start, which a rewind preview always does. */
  readonly snapshot: {
    readonly seq: number;
    readonly document: ShopMapDocumentV2;
  } | null;
  /** In seq order. */
  readonly entries: readonly WalkEntry[];
  /** The next append's base, as read. */
  readonly lastSeq: number;
}

/** The fields of an entry the clock and the history read, from a log or a timeline. */
export interface WalkClockEntry {
  readonly seq: number;
  readonly kind: ShopWalkEntryKind;
  readonly at: Date | string;
  readonly logFrom: number;
  readonly logTo: number;
}

const RECORDING: ReadonlySet<ShopWalkEntryKind> = new Set([
  'started',
  'resumed',
  'continued',
  'stopped',
]);

function instant(at: Date | string): number {
  return typeof at === 'string' ? Date.parse(at) : at.getTime();
}

/** The end of the log: the largest `logTo`, or 0 for a walk with no entry. */
export function walkLogEnd(entries: readonly WalkClockEntry[]): number {
  return entries.reduce((end, entry) => Math.max(end, entry.logTo), 0);
}

/**
 * The wall clock at a point of the log, or null for a walk with no entry.
 *
 * The log keeps its own time, which only walking advances, so the clock is read
 * off the entries: inside a recording entry, its save time less the log time
 * still to come; at the moment of an edit, a rewind or a discard, that entry's
 * own time, since the map at that point already holds it. A point no entry
 * covers takes the time of the last entry before it.
 */
export function walkWallClock(
  entries: readonly WalkClockEntry[],
  logMs: number
): Date | null {
  if (entries.length === 0) {
    return null;
  }
  let recording: WalkClockEntry | null = null;
  let instantaneous: WalkClockEntry | null = null;
  let before: WalkClockEntry | null = null;
  for (const entry of entries) {
    if (
      RECORDING.has(entry.kind) &&
      entry.logTo > entry.logFrom &&
      entry.logFrom <= logMs &&
      logMs <= entry.logTo &&
      (recording === null || entry.seq > recording.seq)
    ) {
      recording = entry;
    }
    if (
      !RECORDING.has(entry.kind) &&
      entry.logTo === logMs &&
      (instantaneous === null || entry.seq > instantaneous.seq)
    ) {
      instantaneous = entry;
    }
    if (entry.logTo <= logMs && (before === null || entry.seq > before.seq)) {
      before = entry;
    }
  }
  if (
    instantaneous !== null &&
    (recording === null || instantaneous.seq > recording.seq)
  ) {
    return new Date(instant(instantaneous.at));
  }
  if (recording !== null) {
    return new Date(instant(recording.at) - (recording.logTo - logMs));
  }
  const first = [...entries].sort((a, b) => a.seq - b.seq)[0];
  const anchor = before ?? first;
  return new Date(
    anchor === first && before === null
      ? instant(first.at) - (first.logTo - logMs)
      : instant(anchor.at)
  );
}

/** What one row of a walk's history says happened. */
export type ShopWalkHistoryKind =
  | 'started'
  | 'resumed'
  | 'problem'
  | 'stopped'
  | 'edited'
  | 'rewound'
  | 'confirmed'
  | 'discarded';

/**
 * One row of a walk's history (velista `0122`, the `History` board).
 *
 * A walking session is **one row**: its `started` or `resumed` entry, every
 * `continued` save after it (one every 20 s) and the ordinary stop that ended it
 * (the Stop button, or leaving the page). A stop for a tracking problem is a row
 * of its own, and the automatic resume that follows it, with the path somebody
 * then threw away, is folded into that stop's row rather than drawn as walking.
 */
export interface ShopWalkHistoryRow {
  /** The id of the row's first entry. */
  readonly id: string;
  readonly kind: ShopWalkHistoryKind;
  /** Every entry the row stands for, oldest first. */
  readonly seqs: readonly number[];
  /** When it happened: a session's start, else the entry's own time. */
  readonly at: Date;
  /** Where the rewind slider puts it. */
  readonly logMs: number;
  /** A session's span of log time, else null. */
  readonly walkedMs: number | null;
  /** Marks a session put, or null while the log (with its events) is not read. */
  readonly marks: number | null;
  /** An edit's areas and marks changed, or null while the log is not read. */
  readonly changes: { readonly areas: number; readonly marks: number } | null;
  /** A session whose automatic resume somebody checked and kept. */
  readonly checked: boolean;
  /** A tracking stop whose automatic resume was thrown away. */
  readonly discarded: boolean;
  readonly reason: ShopWalkStopReason | null;
  /** A rewind: the wall clock of the moment it went back to. */
  readonly rewoundTo: Date | null;
  /** A rewind that went back past an earlier rewind: that rewind's time. */
  readonly undoes: Date | null;
  /** A rewind to just before a tracking problem. */
  readonly beforeProblem: boolean;
}

interface TimelineLike extends WalkClockEntry {
  readonly id: string;
  readonly rewoundTo?: number | null;
  readonly reason?: ShopWalkStopReason | null;
}

const ORDINARY_STOPS: ReadonlySet<string> = new Set(['button', 'left-page']);

function isProblemStop(entry: TimelineLike): boolean {
  return (
    entry.kind === 'stopped' &&
    entry.reason != null &&
    !ORDINARY_STOPS.has(entry.reason)
  );
}

function markerOf(entry: TimelineLike): number {
  return entry.kind === 'started' || entry.kind === 'resumed'
    ? entry.logFrom
    : entry.logTo;
}

function row(
  partial: Partial<ShopWalkHistoryRow> &
    Pick<ShopWalkHistoryRow, 'id' | 'kind' | 'seqs' | 'at' | 'logMs'>
): ShopWalkHistoryRow {
  return {
    walkedMs: null,
    marks: null,
    changes: null,
    checked: false,
    discarded: false,
    reason: null,
    rewoundTo: null,
    undoes: null,
    beforeProblem: false,
    ...partial,
  };
}

/**
 * A walk's history, **newest first** (velista `0122`, target 3).
 *
 * `events` names the log's entries by id, when the log has been read, for the
 * counts a row's detail line gives; without it every count is null.
 */
export function shopWalkHistory(
  timeline: readonly TimelineLike[],
  events: ReadonlyMap<string, WalkEntry> | null = null
): ShopWalkHistoryRow[] {
  const entries = [...timeline].sort((a, b) => a.seq - b.seq);
  const rows: ShopWalkHistoryRow[] = [];

  const count = (ids: readonly string[], test: (type: string) => boolean) => {
    if (events === null) {
      return null;
    }
    let n = 0;
    for (const id of ids) {
      for (const event of events.get(id)?.events ?? []) {
        if (test(event.type)) {
          n += 1;
        }
      }
    }
    return n;
  };

  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];

    if (entry.kind === 'started' || entry.kind === 'resumed') {
      const session = [entry];
      let j = i + 1;
      while (j < entries.length && entries[j].kind === 'continued') {
        session.push(entries[j]);
        j += 1;
      }
      if (
        j < entries.length &&
        entries[j].kind === 'stopped' &&
        !isProblemStop(entries[j])
      ) {
        session.push(entries[j]);
        j += 1;
      }
      const next = entries[j];
      const last = session[session.length - 1];
      const ids = session.map((one) => one.id);

      if (next?.kind === 'discarded') {
        // The automatic resume after a tracking stop, thrown away: the stop's
        // row says so, and the path is not drawn as walking.
        const previous = rows[rows.length - 1];
        if (previous !== undefined && previous.kind === 'problem') {
          rows[rows.length - 1] = {
            ...previous,
            seqs: [
              ...previous.seqs,
              ...session.map((one) => one.seq),
              next.seq,
            ],
            discarded: true,
          };
        } else {
          rows.push(
            row({
              id: entry.id,
              kind: 'discarded',
              seqs: [...session.map((one) => one.seq), next.seq],
              at: new Date(instant(next.at)),
              logMs: markerOf(next),
            })
          );
        }
        i = j + 1;
        continue;
      }

      const checked = next?.kind === 'confirmed';
      rows.push(
        row({
          id: entry.id,
          kind: entry.kind,
          seqs: [
            ...session.map((one) => one.seq),
            ...(checked ? [next.seq] : []),
          ],
          at: new Date(instant(entry.at) - (entry.logTo - entry.logFrom)),
          logMs: entry.logFrom,
          walkedMs: Math.max(0, last.logTo - entry.logFrom),
          marks: count(ids, (type) => type === 'mark-put'),
          checked,
        })
      );
      i = checked ? j + 1 : j;
      continue;
    }

    switch (entry.kind) {
      case 'stopped':
        rows.push(
          row({
            id: entry.id,
            kind: isProblemStop(entry) ? 'problem' : 'stopped',
            seqs: [entry.seq],
            at: new Date(instant(entry.at)),
            logMs: entry.logTo,
            reason: entry.reason ?? null,
          })
        );
        break;
      case 'edited': {
        const areas = count(
          [entry.id],
          (type) => type === 'area-put' || type === 'area-removed'
        );
        const marks = count(
          [entry.id],
          (type) => type === 'mark-put' || type === 'mark-removed'
        );
        rows.push(
          row({
            id: entry.id,
            kind: 'edited',
            seqs: [entry.seq],
            at: new Date(instant(entry.at)),
            logMs: entry.logTo,
            changes: areas === null || marks === null ? null : { areas, marks },
          })
        );
        break;
      }
      case 'rewound': {
        const target = entry.rewoundTo ?? 0;
        const earlier = entries.slice(0, i);
        // An earlier rewind this one undoes: it removed the moment this one
        // returns to, which is every moment after its own target and before
        // it happened. The newest such rewind is named.
        const undone = earlier
          .filter(
            (one) =>
              one.kind === 'rewound' &&
              one.rewoundTo != null &&
              one.rewoundTo < target &&
              target < one.logTo
          )
          .pop();
        const after = earlier
          .filter((one) => markerOf(one) > target)
          .sort((a, b) => markerOf(a) - markerOf(b) || a.seq - b.seq)[0];
        rows.push(
          row({
            id: entry.id,
            kind: 'rewound',
            seqs: [entry.seq],
            at: new Date(instant(entry.at)),
            logMs: entry.logTo,
            rewoundTo: walkWallClock(earlier, target),
            undoes: undone === undefined ? null : new Date(instant(undone.at)),
            beforeProblem:
              undone === undefined &&
              after !== undefined &&
              isProblemStop(after),
          })
        );
        break;
      }
      default:
        // A `continued` save with no session before it, a lone check or a lone
        // discard: drawn for what it is, so no entry goes unaccounted for.
        rows.push(
          row({
            id: entry.id,
            kind:
              entry.kind === 'discarded'
                ? 'discarded'
                : entry.kind === 'confirmed'
                  ? 'confirmed'
                  : 'resumed',
            seqs: [entry.seq],
            at: new Date(instant(entry.at)),
            logMs: markerOf(entry),
          })
        );
    }
    i += 1;
  }

  return rows.reverse();
}

/**
 * The document the rewind preview draws at a point of the log (velista `0122`,
 * target 4): the map as it stood then, with what the walk has now and did not
 * have then laid beside it, for the canvas to fade (`setFadedAfter`).
 *
 * The map now alone would not do: going back past a rewind reaches areas and
 * marks the walk no longer has, and those are exactly what continuing from there
 * brings back. So an area or a mark the moment holds is drawn as it was then,
 * and everything only the present holds is added, and the canvas fades it
 * because `stateAt` at that point does not hold it.
 */
export function rewindPreviewDocument(
  entries: readonly WalkEntry[],
  logMs: number
): ShopMapDocumentV2 {
  const then = stateAt(entries, logMs);
  const now = foldWalk(entries);
  const areaIds = new Set(then.areas.map((area) => area.id));
  const markIds = new Set(then.marks.map((mark) => mark.id));
  return normalizeShopMapV2({
    version: 2,
    areas: [...then.areas, ...now.areas.filter((a) => !areaIds.has(a.id))],
    marks: [...then.marks, ...now.marks.filter((m) => !markIds.has(m.id))],
    path: [...then.path, ...now.path],
  });
}

/** The walks list's order: the shown walk first, then the newest change first. */
export function sortShopWalks(
  walks: readonly ShopWalkSummary[]
): ShopWalkSummary[] {
  return [...walks].sort(
    (a, b) =>
      Number(b.shown) - Number(a.shown) ||
      b.lastChangedAt.getTime() - a.lastChangedAt.getTime()
  );
}

/** `POST /v1/catalog/locations/:id/walks`. */
export interface CreateShopWalkRequest {
  readonly name: string;
}

/** `PATCH /v1/catalog/walks/:walkId`: a new name, whether shoppers see it, or both. */
export interface UpdateShopWalkRequest {
  readonly name?: string;
  readonly shown?: boolean;
}

/**
 * `POST /v1/catalog/walks/:walkId/entries`: one entry, built on `baseSeq`.
 *
 * The next append's base is the `seq` the previous one answered, never the
 * walk's `lastSeq` (backend `0168`, the next base). The first append after a read
 * builds on the `lastSeq` that read gave.
 */
export interface AppendShopWalkEntryRequest {
  readonly id: string;
  readonly baseSeq: number;
  readonly kind: ShopWalkEntryKind;
  /** Wall clock, ISO. */
  readonly at: string;
  readonly logFrom: number;
  readonly logTo: number;
  readonly events: readonly WalkEntry['events'][number][];
  readonly rewoundTo?: number;
  readonly reason?: ShopWalkStopReason;
}

/** What an append answered. */
export interface ShopWalkAppendResult {
  readonly walk: ShopWalkSummary;
  readonly entry: ShopWalkTimelineEntry;
  /** The entry's id was stored already, and this is the first answer again. */
  readonly replayed: boolean;
}

/** The settings for every walk this device records (velista `0122`, target 6). */
export interface MappingSettings {
  /** Walking across a suggested shelf turns it back into path. On by default. */
  readonly walkingAcrossMakesPath: boolean;
}

export const DEFAULT_MAPPING_SETTINGS: MappingSettings = {
  walkingAcrossMakesPath: true,
};
