import {
  SHOP_WALK_LIMITS,
  type ShopMapDocument,
  type ShopWalkEntryKind,
  type ShopWalkEntryView,
  type ShopWalkTimelineEntry,
} from '@portfolio/luna-shopper/contracts';
import {
  foldWalk,
  normalizeShopMapV2,
  type ShopMapDocumentV2,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import type { ShopWalkEntry } from '../entities';

/**
 * The fold of plan 0168, section 2, with no database in it.
 *
 * The contract's shapes and the model library's are the same shapes written
 * twice; the two assignments below fail this file's build when one of them
 * drifts, which is the reason they exist.
 */
const toModelDocument = (doc: ShopMapDocument): ShopMapDocumentV2 => doc;
const toModelEntry = (entry: ShopWalkEntryView): WalkEntry => entry;

/** The document of a walk with no entries. */
export function emptyShopMapDocument(): ShopMapDocument {
  return normalizeShopMapV2({ version: 2, areas: [], marks: [], path: [] });
}

/** The kinds whose fold replaces the state, and so needs the log read back. */
export function replacesState(kind: ShopWalkEntryKind): boolean {
  return kind === 'rewound' || kind === 'discarded';
}

/** Whether the entry at `seq` stores its fold: every twentieth entry, and every rewind. */
export function needsSnapshot(seq: number, kind: ShopWalkEntryKind): boolean {
  return seq % SHOP_WALK_LIMITS.snapshotEvery === 0 || kind === 'rewound';
}

/** How many bytes a value takes as JSON, the unit both size caps are stated in. */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * The fold of one entry that only adds to the state (every kind but `rewound`
 * and `discarded`) onto the walk's current document. The document stands for
 * every entry before it, which is what `foldWalk`'s starting document means.
 */
export function foldOnto(
  document: ShopMapDocument,
  entry: ShopWalkEntryView
): ShopMapDocument {
  return foldWalk([toModelEntry(entry)], toModelDocument(document));
}

/** Where a replaying fold reads the log from: the stored snapshots and the entries. */
export interface ReplaySource {
  /** The `seq` of every entry that stored a snapshot, in any order. No documents. */
  snapshotSeqs: readonly number[];
  /** The snapshot stored on the entry `seq`. Read only when that start is tried. */
  snapshotAt(seq: number): Promise<ShopMapDocument>;
  /** Every entry after `seq`, with its events, in `seq` order. */
  entriesAfter(seq: number): Promise<ShopWalkEntryView[]>;
}

/**
 * The fold of an entry that replaces the state (a rewind or a discard): the
 * log read back from a snapshot, plus the new entry.
 *
 * Snapshots are tried newest first, and each document is read only when its
 * turn comes. `foldWalk` throws when the entry reaches before the first entry
 * it was given (a rewind to a time before the snapshot, or a discard of a
 * segment the snapshot already holds), and the next older start is tried
 * then. The start of the walk (`seq` 0, no document) never throws, so the loop
 * always ends with a document.
 */
export async function foldReplaying(
  source: ReplaySource,
  entry: ShopWalkEntryView
): Promise<ShopMapDocument> {
  const seqs = [...new Set(source.snapshotSeqs)]
    .filter((seq) => seq > 0)
    .sort((a, b) => b - a);
  let last: unknown;
  for (const seq of [...seqs, 0]) {
    const start = seq === 0 ? null : await source.snapshotAt(seq);
    const log = [...(await source.entriesAfter(seq)), entry].map(toModelEntry);
    try {
      return start === null
        ? foldWalk(log)
        : foldWalk(log, toModelDocument(start));
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** A stored row as the model's entry, with its events. */
export function toEntryView(row: ShopWalkEntry): ShopWalkEntryView {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    at: row.at.toISOString(),
    logFrom: Number(row.logFrom),
    logTo: Number(row.logTo),
    events: row.events,
    ...(row.rewoundTo !== null && row.rewoundTo !== undefined
      ? { rewoundTo: Number(row.rewoundTo) }
      : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

/** A stored row as a timeline row: no events, and where the slider draws it. */
export function toTimelineEntry(
  row: Pick<
    ShopWalkEntry,
    'id' | 'seq' | 'kind' | 'at' | 'logFrom' | 'logTo' | 'rewoundTo' | 'reason'
  >
): ShopWalkTimelineEntry {
  const logFrom = Number(row.logFrom);
  const logTo = Number(row.logTo);
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    at: row.at.toISOString(),
    logMs: row.kind === 'started' || row.kind === 'resumed' ? logFrom : logTo,
    logFrom,
    logTo,
    ...(row.rewoundTo !== null && row.rewoundTo !== undefined
      ? { rewoundTo: Number(row.rewoundTo) }
      : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}
