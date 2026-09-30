import { normalizeShopMapV2 } from './normalize';
import type {
  MapArea,
  MapMark,
  ShopMapDocumentV2,
  WalkEntry,
  WalkEntryKind,
  WalkEvent,
  WalkTimelineMarker,
} from './types';

/**
 * The walk log (shop-map plan 0002, section 3). Every entry is flattened into
 * operations that carry a log time, and a fold applies them in `seq` order.
 *
 * - A recording entry (`started`, `resumed`, `continued`, `stopped`) gives
 *   each event its own log time: a path point its `logMs`, a mark its
 *   `logMs`, a `section-left` its `logMs`. An event without one (an area put
 *   or removed, a mark removed) takes the time of the event before it in the
 *   same entry, or the entry's `logFrom` when it is the first.
 * - Every other entry happens at its `logTo`, all of it.
 * - The first path point of a `started` or `resumed` entry begins a new
 *   polyline. Every other point continues the last one, so the `continued`
 *   saves of a session extend its polyline, and a `stopped` entry may carry
 *   the tail of the path before the stop.
 * - `rewound` replaces the state with `stateAt(the entries before it,
 *   rewoundTo)`.
 * - `discarded` drops the events of the unconfirmed segment whose log time is
 *   at or after its `logFrom` (the automatic resume): that segment's path,
 *   marks and areas. The segment is the entry just before the discard, and
 *   when that is a `continued` save or a `stopped` entry, every entry back to
 *   the `started` or `resumed` entry that opened the session. The drop holds
 *   in every fold of the entries after the discard, at any log time, so a
 *   rewind or the slider never shows the rejected segment. `confirmed`
 *   changes nothing.
 */

const RECORDING: ReadonlySet<WalkEntryKind> = new Set([
  'started',
  'resumed',
  'continued',
  'stopped',
]);

type Op =
  | {
      type: 'point';
      t: number;
      entry: number;
      x: number;
      y: number;
      /** Begins a new polyline when no point of this entry was applied yet. */
      opens: boolean;
    }
  | { type: 'event'; t: number; entry: number; event: WalkEvent }
  | { type: 'rewind'; t: number; entry: number; target: number }
  | { type: 'discard'; t: number; entry: number; from: number };

interface FoldState {
  areas: Map<string, MapArea>;
  marks: Map<string, MapMark>;
  path: [number, number][][];
  /** The entry whose points the last polyline holds, when that entry opened it. */
  lineEntry: number | null;
}

function sortEntries(entries: readonly WalkEntry[]): WalkEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.seq - b.entry.seq || a.index - b.index)
    .map((e) => e.entry);
}

function buildOps(entries: readonly WalkEntry[]): Op[] {
  const ops: Op[] = [];
  entries.forEach((entry, k) => {
    const recording = RECORDING.has(entry.kind);
    const opens = entry.kind === 'started' || entry.kind === 'resumed';
    let last = entry.logFrom;
    const timeOf = (own: number | undefined): number => {
      if (!recording) return entry.logTo;
      if (own !== undefined) last = own;
      return last;
    };
    for (const event of entry.events) {
      if (event.type === 'path') {
        for (const [logMs, x, y] of event.points) {
          ops.push({ type: 'point', t: timeOf(logMs), entry: k, x, y, opens });
        }
      } else if (event.type === 'mark-put') {
        ops.push({
          type: 'event',
          t: timeOf(event.mark.logMs),
          entry: k,
          event,
        });
      } else if (event.type === 'section-left') {
        ops.push({ type: 'event', t: timeOf(event.logMs), entry: k, event });
      } else {
        ops.push({ type: 'event', t: timeOf(undefined), entry: k, event });
      }
    }
    if (entry.kind === 'rewound' && entry.rewoundTo !== undefined) {
      ops.push({
        type: 'rewind',
        t: entry.logTo,
        entry: k,
        target: entry.rewoundTo,
      });
    } else if (entry.kind === 'discarded') {
      ops.push({
        type: 'discard',
        t: entry.logTo,
        entry: k,
        from: entry.logFrom,
      });
    }
  });
  return ops;
}

function stateOf(doc: ShopMapDocumentV2 | undefined): FoldState {
  return {
    areas: new Map((doc?.areas ?? []).map((a) => [a.id, a])),
    marks: new Map((doc?.marks ?? []).map((m) => [m.id, m])),
    path: (doc?.path ?? []).map((line) => [...line.points]),
    lineEntry: null,
  };
}

function copyState(s: FoldState): FoldState {
  return {
    areas: new Map(s.areas),
    marks: new Map(s.marks),
    path: s.path.map((line) => [...line]),
    lineEntry: s.lineEntry,
  };
}

function apply(state: FoldState, op: Op): void {
  if (op.type === 'point') {
    const line = state.path[state.path.length - 1];
    if (!line || (op.opens && state.lineEntry !== op.entry)) {
      state.path.push([[op.x, op.y]]);
      state.lineEntry = op.opens ? op.entry : null;
    } else {
      line.push([op.x, op.y]);
    }
    return;
  }
  if (op.type !== 'event') return;
  const event = op.event;
  switch (event.type) {
    case 'mark-put':
      state.marks.set(event.mark.id, event.mark);
      break;
    case 'mark-removed':
      state.marks.delete(event.id);
      break;
    case 'area-put':
      state.areas.set(event.area.id, event.area);
      break;
    case 'area-removed':
      state.areas.delete(event.id);
      break;
    default:
      // A path is split into points; `section-left` ends a section run in the
      // live rules and leaves the document as it is.
      break;
  }
}

/** A discard, as the operations it drops from every later fold. */
interface Drop {
  /** Its operation's index: folds of the operations after it drop the segment. */
  at: number;
  /** The segment: entries `first` up to, not including, `entry`. */
  first: number;
  entry: number;
  /** The automatic resume: only operations at or after it are dropped. */
  from: number;
}

/** The kinds a discard walks back over to the entry that opened the session. */
const SEGMENT_TAIL: ReadonlySet<WalkEntryKind> = new Set([
  'continued',
  'stopped',
]);

/**
 * Folds one log. A rewind is computed once. A discard replaces nothing: it
 * drops its segment from every fold of the operations after it, whatever the
 * log time folded to, so neither the slider nor a rewind shows a rejected
 * segment again.
 */
class Folder {
  private readonly ops: Op[];
  private readonly drops: Drop[] = [];
  private readonly replaced = new Map<number, FoldState>();

  constructor(
    private readonly entries: WalkEntry[],
    private readonly start: ShopMapDocumentV2 | undefined
  ) {
    this.ops = buildOps(entries);
    this.ops.forEach((op, at) => {
      if (op.type !== 'discard') return;
      // The unconfirmed segment: the entry just before the discard, and every
      // save and stop before that, back to the entry that opened the session.
      let first = op.entry - 1;
      while (first > 0 && SEGMENT_TAIL.has(this.entries[first].kind)) first--;
      if (
        this.start &&
        (first < 0 || SEGMENT_TAIL.has(this.entries[first].kind))
      ) {
        throw new Error(
          `The discard of entry ${this.entries[op.entry].id} names an entry before the starting document: fold from an earlier snapshot.`
        );
      }
      this.drops.push({ at, first, entry: op.entry, from: op.from });
    });
  }

  private dropped(op: Op, end: number): boolean {
    if (op.type !== 'point' && op.type !== 'event') return false;
    return this.drops.some(
      (d) =>
        d.at < end &&
        op.entry >= d.first &&
        op.entry < d.entry &&
        op.t >= d.from
    );
  }

  /** The state after the operations before `end` whose log time is at most `limit`. */
  run(end: number, limit: number): FoldState {
    let from = 0;
    let state: FoldState | null = null;
    for (let i = end - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op.type === 'rewind' && op.t <= limit) {
        state = copyState(this.replacedAt(i));
        from = i + 1;
        break;
      }
    }
    state ??= stateOf(this.start);
    for (let i = from; i < end; i++) {
      const op = this.ops[i];
      if (op.type === 'discard') {
        if (op.t <= limit) state.lineEntry = null;
        continue;
      }
      if (op.t > limit || this.dropped(op, end)) continue;
      apply(state, op);
    }
    return state;
  }

  private replacedAt(i: number): FoldState {
    const known = this.replaced.get(i);
    if (known) return known;
    const op = this.ops[i];
    if (op.type !== 'rewind') {
      throw new Error('Only a rewind replaces the state.');
    }
    const firstFrom = this.entries[0]?.logFrom ?? 0;
    if (this.start && op.target < firstFrom) {
      throw new Error(
        `The rewind of entry ${this.entries[op.entry].id} reaches before the starting document: fold from an earlier snapshot.`
      );
    }
    const state = this.run(i, op.target);
    state.lineEntry = null;
    this.replaced.set(i, state);
    return state;
  }

  document(limit: number): ShopMapDocumentV2 {
    const s = this.run(this.ops.length, limit);
    return normalizeShopMapV2({
      version: 2,
      areas: [...s.areas.values()],
      marks: [...s.marks.values()],
      path: s.path.map((points) => ({ points })),
    });
  }
}

/**
 * The document a walk log folds to, normalized. The entries are applied in
 * `seq` order. `start` is a stored snapshot standing for every entry before
 * the first one given (backend 0168 keeps one every twenty entries and on
 * every rewind); a rewind or a discard that reaches before the first given
 * entry then throws, and the caller folds from an earlier snapshot.
 */
export function foldWalk(
  entries: readonly WalkEntry[],
  start?: ShopMapDocumentV2
): ShopMapDocumentV2 {
  return new Folder(sortEntries(entries), start).document(Infinity);
}

/**
 * The document at a point of the log: every event with a log time up to
 * `logMs`, and every edit, rewind, confirm or discard whose `logTo` is at most
 * `logMs`, folded as {@link foldWalk} folds. A point after a rewind answers
 * the state that rewind produced, and what came after it up to that point.
 */
export function stateAt(
  entries: readonly WalkEntry[],
  logMs: number
): ShopMapDocumentV2 {
  return new Folder(sortEntries(entries), undefined).document(logMs);
}

/** One marker per entry, in `seq` order, for the rewind slider. */
export function walkTimeline(
  entries: readonly WalkEntry[]
): WalkTimelineMarker[] {
  return sortEntries(entries).map((e) => ({
    id: e.id,
    seq: e.seq,
    kind: e.kind,
    at: e.at,
    logMs: e.kind === 'started' || e.kind === 'resumed' ? e.logFrom : e.logTo,
    logFrom: e.logFrom,
    logTo: e.logTo,
    ...(e.rewoundTo !== undefined ? { rewoundTo: e.rewoundTo } : {}),
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
  }));
}
