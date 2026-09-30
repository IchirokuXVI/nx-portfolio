import { toUserProfile } from './mappers';
import {
  toShopMapDocument,
  toShopWalkDetail,
  toShopWalkList,
  toShopWalkLog,
  toShopWalkSummary,
  toShopWalkTimelineEntry,
} from './shop-walk-mappers';

const SUMMARY = {
  id: 'w1',
  supermarketLocationId: 'loc-1',
  name: 'Autumn layout',
  shown: true,
  lastSeq: 9,
  entryCount: 9,
  markCount: 57,
  createdAt: '2026-09-29T10:00:00.000Z',
  lastChangedAt: '2026-09-30T11:24:00.000Z',
};

const DOCUMENT = {
  version: 2,
  areas: [
    {
      id: 'a1',
      kind: 'shelf',
      x: 1,
      y: 2,
      w: 3,
      h: 1,
      section: 'Lácteos',
      colour: { mode: 'default' },
      origin: 'section-run',
    },
  ],
  marks: [
    {
      id: 'm1',
      kind: 'section',
      x: 1,
      y: 1,
      heading: 90,
      text: 'Lácteos',
      logMs: 1000,
    },
  ],
  path: [
    {
      points: [
        [0, 0],
        [1, 1],
      ],
    },
  ],
};

/** Velista `0122`, rule D4: the walks off the wire. */
describe('toShopWalkSummary', () => {
  it('reads a walk', () => {
    expect(toShopWalkSummary(SUMMARY)).toEqual({
      id: 'w1',
      locationId: 'loc-1',
      name: 'Autumn layout',
      shown: true,
      lastSeq: 9,
      entryCount: 9,
      markCount: 57,
      createdAt: new Date(SUMMARY.createdAt),
      lastChangedAt: new Date(SUMMARY.lastChangedAt),
    });
  });

  it('reads shown only from an explicit true, and refuses a walk with no id', () => {
    expect(toShopWalkSummary({ ...SUMMARY, shown: 'yes' })?.shown).toBe(false);
    expect(toShopWalkSummary({ ...SUMMARY, id: '' })).toBeNull();
    expect(toShopWalkSummary({ ...SUMMARY, lastSeq: -1 })).toBeNull();
  });

  it('drops an unreadable walk from a list and keeps the rest', () => {
    expect(
      toShopWalkList({ walks: [SUMMARY, { id: 3 }] })?.map((walk) => walk.id)
    ).toEqual(['w1']);
    expect(toShopWalkList({})).toBeNull();
  });
});

describe('toShopWalkTimelineEntry', () => {
  it('reads an entry, with a reason only on a stop and a target only on a rewind', () => {
    expect(
      toShopWalkTimelineEntry({
        id: 'e2',
        seq: 2,
        kind: 'stopped',
        at: '2026-09-29T10:58:02.771Z',
        logMs: 920513,
        logFrom: 920513,
        logTo: 920513,
        reason: 'tracking-lost',
        rewoundTo: 5,
      })
    ).toEqual({
      id: 'e2',
      seq: 2,
      kind: 'stopped',
      at: new Date('2026-09-29T10:58:02.771Z'),
      logMs: 920513,
      logFrom: 920513,
      logTo: 920513,
      rewoundTo: null,
      reason: 'tracking-lost',
    });
  });

  it('drops an entry of a kind this build does not know', () => {
    expect(
      toShopWalkTimelineEntry({
        id: 'e',
        seq: 1,
        kind: 'teleported',
        at: '2026-09-29T10:00:00.000Z',
        logFrom: 0,
        logTo: 0,
      })
    ).toBeNull();
  });
});

describe('toShopWalkDetail', () => {
  it('reads the walk, its document and its timeline in seq order', () => {
    const detail = toShopWalkDetail({
      walk: SUMMARY,
      document: DOCUMENT,
      timeline: [
        {
          id: 'b',
          seq: 2,
          kind: 'edited',
          at: '2026-09-29T11:00:00.000Z',
          logFrom: 5,
          logTo: 5,
        },
        {
          id: 'a',
          seq: 1,
          kind: 'started',
          at: '2026-09-29T10:00:00.000Z',
          logFrom: 0,
          logTo: 5,
        },
      ],
    });

    expect(detail?.walk.id).toBe('w1');
    expect(detail?.document.areas[0].section).toBe('Lácteos');
    expect(detail?.timeline.map((one) => one.id)).toEqual(['a', 'b']);
  });

  it('refuses a document with an area it cannot read', () => {
    expect(
      toShopMapDocument({ ...DOCUMENT, areas: [{ id: 'x', kind: 'wall' }] })
    ).toBeNull();
    expect(toShopMapDocument({ ...DOCUMENT, version: 1 })).toBeNull();
  });
});

describe('toShopWalkLog', () => {
  const ENTRY = {
    id: 'e1',
    seq: 1,
    kind: 'started',
    at: '2026-09-29T10:00:00.000Z',
    logFrom: 0,
    logTo: 10,
    events: [
      {
        type: 'path',
        points: [
          [0, 1, 1],
          [10, 2, 2],
        ],
      },
      { type: 'mark-put', mark: DOCUMENT.marks[0] },
      { type: 'area-put', area: DOCUMENT.areas[0] },
      { type: 'section-left', logMs: 9 },
    ],
  };

  it('reads a whole log', () => {
    const log = toShopWalkLog({
      walkId: 'w1',
      snapshot: null,
      entries: [ENTRY],
      lastSeq: 1,
    });

    expect(log?.lastSeq).toBe(1);
    expect(log?.snapshot).toBeNull();
    expect(log?.entries[0].events).toHaveLength(4);
  });

  it('is all or nothing: one unreadable event is no log', () => {
    expect(
      toShopWalkLog({
        walkId: 'w1',
        entries: [{ ...ENTRY, events: [{ type: 'teleport' }] }],
        lastSeq: 1,
      })
    ).toBeNull();
    expect(
      toShopWalkLog({
        walkId: 'w1',
        entries: [{ ...ENTRY, kind: 'rewound' }],
        lastSeq: 1,
      })
    ).toBeNull();
  });
});

describe('toUserProfile: permissions (backend 0175)', () => {
  const ME = { userId: 'u1', kind: 'REGISTERED', username: 'Marta' };

  it('keeps the permissions this build knows and drops the rest', () => {
    expect(
      toUserProfile({
        ...ME,
        permissions: ['shopMap.record', 'prices.trusted'],
      })?.permissions
    ).toEqual(['shopMap.record']);
  });

  it('leaves them off a body that carries none, which a rename answers', () => {
    expect(toUserProfile(ME)).not.toHaveProperty('permissions');
  });
});
