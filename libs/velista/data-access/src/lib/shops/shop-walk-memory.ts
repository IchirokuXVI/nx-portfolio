import { Injectable } from '@angular/core';
import {
  foldWalk,
  walkTimeline,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  SHOP_WALK_NAME_MAX_LENGTH,
  type AppendShopWalkEntryRequest,
  type ShopWalkAppendResult,
  type ShopWalkSummary,
  type ShopWalkTimelineEntry,
  type UpdateShopWalkRequest,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type {
  ShopWalkAppendOptions,
  ShopWalkListRead,
  ShopWalkLogRead,
  ShopWalkRead,
  ShopWalkServiceI,
} from './shop-walk-service';

/** The walk `loc-tejares` shows, and one it does not. Ids are uuids, as the server's are. */
export const MEMORY_SHOWN_WALK_ID = '7a1c0f5e-0122-4a00-8000-000000000001';
export const MEMORY_OTHER_WALK_ID = '7a1c0f5e-0122-4a00-8000-000000000002';

const START = Date.parse('2026-09-29T10:42:00.000Z');

function at(ms: number): string {
  return new Date(START + ms).toISOString();
}

/**
 * The shown walk's log: a walk that stopped for a tracking problem, an automatic
 * resume that was thrown away, a resume by hand, an edit and a rewind. The same
 * story the `History` board tells, small enough to read.
 */
function shownLog(): WalkEntry[] {
  return [
    {
      id: 'e0122-01',
      seq: 1,
      kind: 'started',
      at: at(120_000),
      logFrom: 0,
      logTo: 120_000,
      events: [
        {
          type: 'path',
          points: [
            [0, 1, 7],
            [60_000, 1, 1],
            [120_000, 9, 1],
          ],
        },
        {
          type: 'mark-put',
          mark: {
            id: 'm-eggs',
            kind: 'section',
            x: 4,
            y: 2,
            heading: 180,
            text: 'Huevos',
            logMs: 70_000,
          },
        },
        {
          type: 'area-put',
          area: {
            id: 'a-eggs',
            kind: 'shelf',
            x: 2,
            y: 2,
            w: 6,
            h: 1,
            section: 'Huevos',
            colour: { mode: 'default' },
            origin: 'section-run',
          },
        },
      ],
    },
    {
      id: 'e0122-02',
      seq: 2,
      kind: 'continued',
      at: at(140_000),
      logFrom: 120_000,
      logTo: 140_000,
      events: [{ type: 'path', points: [[140_000, 9, 4]] }],
    },
    {
      id: 'e0122-03',
      seq: 3,
      kind: 'stopped',
      at: at(141_000),
      logFrom: 140_000,
      logTo: 140_000,
      events: [],
      reason: 'tracking-lost',
    },
    {
      id: 'e0122-04',
      seq: 4,
      kind: 'resumed',
      at: at(170_000),
      logFrom: 140_000,
      logTo: 170_000,
      events: [
        {
          type: 'path',
          points: [
            [140_000, 9, 4],
            [170_000, 20, 20],
          ],
        },
      ],
    },
    {
      id: 'e0122-05',
      seq: 5,
      kind: 'discarded',
      at: at(175_000),
      logFrom: 140_000,
      logTo: 170_000,
      events: [],
    },
    {
      id: 'e0122-06',
      seq: 6,
      kind: 'resumed',
      at: at(260_000),
      logFrom: 170_000,
      logTo: 260_000,
      events: [
        {
          type: 'path',
          points: [
            [170_000, 9, 4],
            [260_000, 1, 5],
          ],
        },
        {
          type: 'mark-put',
          mark: {
            id: 'm-pantry',
            kind: 'section',
            x: 4,
            y: 4.5,
            heading: 0,
            text: 'Despensa',
            logMs: 200_000,
          },
        },
        {
          type: 'area-put',
          area: {
            id: 'a-pantry',
            kind: 'shelf',
            x: 2,
            y: 4.5,
            w: 6,
            h: 1,
            section: 'Despensa',
            colour: { mode: 'default' },
            origin: 'section-run',
          },
        },
      ],
    },
    {
      id: 'e0122-07',
      seq: 7,
      kind: 'stopped',
      at: at(261_000),
      logFrom: 260_000,
      logTo: 260_000,
      events: [],
      reason: 'button',
    },
    {
      id: 'e0122-08',
      seq: 8,
      kind: 'edited',
      at: at(900_000),
      logFrom: 260_000,
      logTo: 260_000,
      events: [
        {
          type: 'area-put',
          area: {
            id: 'a-till',
            kind: 'checkout',
            x: 9.5,
            y: 6,
            w: 1.5,
            h: 1,
            colour: { mode: 'default' },
            origin: 'drawn',
          },
        },
      ],
    },
    {
      id: 'e0122-09',
      seq: 9,
      kind: 'rewound',
      at: at(1_200_000),
      logFrom: 260_000,
      logTo: 260_000,
      events: [],
      rewoundTo: 210_000,
    },
  ];
}

interface HeldWalk {
  summary: ShopWalkSummary;
  entries: WalkEntry[];
  deleted: boolean;
}

/**
 * The walks of a shop in memory (velista `0122`), the in memory twin of
 * `ShopWalkApi`. Every rule of the append is kept: a replayed id answers the
 * first result, a base that is not the walk's newest seq is `walk_changed`, and
 * nothing is ever removed from a log.
 */
@Injectable()
export class ShopWalkMemory implements ShopWalkServiceI {
  private readonly _walks = new Map<string, HeldWalk>();
  private readonly _answers = new Map<string, ShopWalkAppendResult>();
  private _made = 0;

  /** Every append, in order, so a spec can read what was sent. */
  readonly appended: AppendShopWalkEntryRequest[] = [];
  /** How each append was sent, in the same order. */
  readonly appendOptions: ShopWalkAppendOptions[] = [];

  constructor() {
    this._hold(
      {
        id: MEMORY_SHOWN_WALK_ID,
        locationId: 'loc-tejares',
        name: 'Autumn layout',
        shown: true,
        createdAt: new Date(START),
      },
      shownLog()
    );
    this._hold(
      {
        id: MEMORY_OTHER_WALK_ID,
        locationId: 'loc-tejares',
        name: 'First try',
        shown: false,
        createdAt: new Date(START - 86_400_000),
      },
      shownLog()
        .slice(0, 1)
        .map((entry) => ({ ...entry, id: `${entry.id}-first` }))
    );
  }

  async list(locationId: string): Promise<ShopWalkListRead> {
    const walks = [...this._walks.values()]
      .filter((walk) => !walk.deleted && walk.summary.locationId === locationId)
      .map((walk) => walk.summary);
    return { kind: 'walks', walks };
  }

  async walk(walkId: string): Promise<ShopWalkRead> {
    const walk = this._live(walkId);
    if (walk === null) {
      return { kind: 'missing' };
    }
    return {
      kind: 'walk',
      detail: {
        walk: walk.summary,
        document: foldWalk(walk.entries),
        timeline: timelineOf(walk.entries),
      },
    };
  }

  async log(walkId: string): Promise<ShopWalkLogRead> {
    const walk = this._live(walkId);
    return walk === null
      ? { kind: 'missing' }
      : {
          kind: 'log',
          log: {
            walkId,
            snapshot: null,
            entries: walk.entries.map((entry) => ({ ...entry })),
            lastSeq: walk.summary.lastSeq,
          },
        };
  }

  async create(locationId: string, name: string): Promise<ShopWalkSummary> {
    this._made += 1;
    const id = `7a1c0f5e-0122-4b00-8000-${String(this._made).padStart(12, '0')}`;
    return this._hold(
      {
        id,
        locationId,
        name: requireName(name),
        shown: false,
        createdAt: new Date(),
      },
      []
    ).summary;
  }

  async update(
    walkId: string,
    change: UpdateShopWalkRequest
  ): Promise<ShopWalkSummary> {
    const walk = this._require(walkId);
    if (change.shown === true) {
      for (const other of this._walks.values()) {
        if (other.summary.locationId === walk.summary.locationId) {
          other.summary = { ...other.summary, shown: false };
        }
      }
    }
    walk.summary = {
      ...walk.summary,
      ...(change.name !== undefined ? { name: requireName(change.name) } : {}),
      ...(change.shown !== undefined ? { shown: change.shown } : {}),
      lastChangedAt: new Date(),
    };
    return walk.summary;
  }

  async remove(walkId: string): Promise<void> {
    const walk = this._require(walkId);
    walk.deleted = true;
    walk.summary = { ...walk.summary, shown: false };
  }

  async append(
    walkId: string,
    entry: AppendShopWalkEntryRequest,
    options: ShopWalkAppendOptions = {}
  ): Promise<ShopWalkAppendResult> {
    const walk = this._require(walkId);
    this.appended.push(entry);
    this.appendOptions.push(options);
    const known = this._answers.get(entry.id);
    if (known !== undefined) {
      return { ...known, replayed: true };
    }
    if (entry.baseSeq !== walk.summary.lastSeq) {
      throw new GatewayError({
        code: 'walk_changed',
        status: 409,
        correlationId: 'memory',
        details: { lastSeq: walk.summary.lastSeq },
      });
    }
    const seq = walk.summary.lastSeq + 1;
    const stored: WalkEntry = {
      id: entry.id,
      seq,
      kind: entry.kind,
      at: entry.at,
      logFrom: entry.logFrom,
      logTo: entry.logTo,
      events: [...entry.events],
      ...(entry.rewoundTo !== undefined ? { rewoundTo: entry.rewoundTo } : {}),
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    };
    walk.entries.push(stored);
    walk.summary = summaryOf(walk.summary, walk.entries);
    const answer: ShopWalkAppendResult = {
      walk: walk.summary,
      entry: timelineOf([stored])[0],
      replayed: false,
    };
    this._answers.set(entry.id, answer);
    return answer;
  }

  /**
   * Somebody else's phone saved to a walk: one more entry this phone has not
   * read, which makes its next append `walk_changed`. For specs.
   */
  appendElsewhere(walkId: string): void {
    const walk = this._require(walkId);
    const end = walk.entries.reduce((max, one) => Math.max(max, one.logTo), 0);
    walk.entries.push({
      id: `elsewhere-${walk.entries.length + 1}`,
      seq: walk.summary.lastSeq + 1,
      kind: 'edited',
      at: new Date().toISOString(),
      logFrom: end,
      logTo: end,
      events: [],
    });
    walk.summary = summaryOf(walk.summary, walk.entries);
  }

  private _hold(
    head: Pick<
      ShopWalkSummary,
      'id' | 'locationId' | 'name' | 'shown' | 'createdAt'
    >,
    entries: WalkEntry[]
  ): HeldWalk {
    const walk: HeldWalk = {
      summary: summaryOf(
        {
          ...head,
          lastSeq: 0,
          entryCount: 0,
          markCount: 0,
          lastChangedAt: head.createdAt,
        },
        entries
      ),
      entries,
      deleted: false,
    };
    this._walks.set(head.id, walk);
    return walk;
  }

  private _live(walkId: string): HeldWalk | null {
    const walk = this._walks.get(walkId);
    return walk === undefined || walk.deleted ? null : walk;
  }

  private _require(walkId: string): HeldWalk {
    const walk = this._live(walkId);
    if (walk === null) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
      });
    }
    return walk;
  }
}

function summaryOf(
  summary: ShopWalkSummary,
  entries: readonly WalkEntry[]
): ShopWalkSummary {
  const lastSeq = entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
  const newest = entries.find((entry) => entry.seq === lastSeq);
  return {
    ...summary,
    lastSeq,
    entryCount: lastSeq,
    markCount: entries.length === 0 ? 0 : foldWalk(entries).marks.length,
    lastChangedAt:
      newest === undefined ? summary.lastChangedAt : new Date(newest.at),
  };
}

function timelineOf(entries: readonly WalkEntry[]): ShopWalkTimelineEntry[] {
  return walkTimeline(entries).map((marker) => ({
    id: marker.id,
    seq: marker.seq,
    kind: marker.kind,
    at: new Date(marker.at),
    logMs: marker.logMs,
    logFrom: marker.logFrom,
    logTo: marker.logTo,
    rewoundTo: marker.rewoundTo ?? null,
    reason: marker.reason ?? null,
  }));
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > SHOP_WALK_NAME_MAX_LENGTH) {
    throw new GatewayError({
      code: 'validation_failed',
      status: 400,
      correlationId: 'memory',
      fieldErrors: { name: ['length'] },
    });
  }
  return trimmed;
}
