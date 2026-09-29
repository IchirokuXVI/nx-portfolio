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
 * - A recording entry (`started`, `resumed`, `stopped`) gives each event its
 *   own log time: a path point its `logMs`, a mark its `logMs`, a
 *   `section-left` its `logMs`. An event without one (an area put or removed,
 *   a mark removed) takes the time of the event before it in the same entry,
 *   or the entry's `logFrom` when it is the first.
 * - Every other entry happens at its `logTo`, all of it.
 * - The first path point of a `started` or `resumed` entry begins a new
 *   polyline. Every other point continues the last one, so a `stopped` entry
 *   may carry the tail of the path before the stop.
 * - `rewound` replaces the state with `stateAt(the entries before it,
 *   rewoundTo)`, and `discarded` replaces it with the fold of the entries
 *   before it without the events of the entry just before it whose log time
 *   is at or after its `logFrom` (the automatic resume): that segment's path,
 *   marks and areas. `confirmed` changes nothing.
 */

const RECORDING: ReadonlySet<WalkEntryKind> = new Set([
  'started',
  'resumed',
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

/** Folds one log. Replacing operations (rewinds, discards) are computed once. */
class Folder {
  private readonly ops: Op[];
  private readonly replaced = new Map<number, FoldState>();

  constructor(
    private readonly entries: WalkEntry[],
    private readonly start: ShopMapDocumentV2 | undefined
  ) {
    this.ops = buildOps(entries);
  }

  /** The state after the operations before `end` whose log time is at most `limit`. */
  run(end: number, limit: number, drop?: (op: Op) => boolean): FoldState {
    let from = 0;
    let state: FoldState | null = null;
    for (let i = end - 1; i >= 0; i--) {
      const op = this.ops[i];
      if ((op.type === 'rewind' || op.type === 'discard') && op.t <= limit) {
        state = copyState(this.replacedAt(i));
        from = i + 1;
        break;
      }
    }
    state ??= stateOf(this.start);
    for (let i = from; i < end; i++) {
      const op = this.ops[i];
      if (op.t > limit || drop?.(op)) continue;
      apply(state, op);
    }
    return state;
  }

  private replacedAt(i: number): FoldState {
    const known = this.replaced.get(i);
    if (known) return known;
    const op = this.ops[i];
    const firstFrom = this.entries[0]?.logFrom ?? 0;
    let state: FoldState;
    if (op.type === 'rewind') {
      if (this.start && op.target < firstFrom) {
        throw new Error(
          `The rewind of entry ${this.entries[op.entry].id} reaches before the starting document: fold from an earlier snapshot.`
        );
      }
      state = this.run(i, op.target);
    } else if (op.type === 'discard') {
      const before = op.entry - 1;
      if (this.start && before < 0) {
        throw new Error(
          `The discard of entry ${this.entries[op.entry].id} names an entry before the starting document: fold from an earlier snapshot.`
        );
      }
      state = this.run(
        i,
        op.t,
        (o) =>
          o.entry === before &&
          (o.type === 'point' || o.type === 'event') &&
          o.t >= op.from
      );
    } else {
      throw new Error('Only a rewind or a discard replaces the state.');
    }
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
