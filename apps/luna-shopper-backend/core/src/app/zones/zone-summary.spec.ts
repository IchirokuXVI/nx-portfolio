import {
  MembershipStatus,
  ZoneRole,
  type ZoneCounts,
} from '@portfolio/luna-shopper/contracts';
import type { Zone, ZoneMembership } from '../entities';
import {
  readZoneCounts,
  readZoneListsPreview,
  type SummaryRow,
} from './zone-summary.reader';
import {
  ZONE_LIST_PREVIEW_LIMIT,
  ZONE_SUMMARY_COLUMNS,
  selectZoneSummary,
} from './zone-summary.sql';
import { governanceFields, managesZone, toMyZoneView } from './zone.mappers';

/**
 * The zone summary (plan 0017, sections 3, 4 and 6), at the two seams a unit
 * test can reach honestly: the raw-columns-to-view reader, and the governance
 * gate. The numbers themselves are Postgres's answer, so proving them needs a
 * real database; that is `zone-summary.integration.spec.ts`.
 */

const ZONE = {
  id: 'z1',
  name: 'Weekly shop',
  joinCode: 'ABCD1234',
  status: 'ACTIVE',
  ownerUserId: 'u1',
  config: {},
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
} as unknown as Zone;

function viewer(role: ZoneRole, status = MembershipStatus.APPROVED) {
  return { role, status } as ZoneMembership;
}

function row(overrides: Record<string, unknown> = {}): SummaryRow {
  return {
    [ZONE_SUMMARY_COLUMNS.memberCounts]: {
      memberCount: 3,
      pendingRequestCount: 2,
    },
    [ZONE_SUMMARY_COLUMNS.firstPending]: 'Ines',
    [ZONE_SUMMARY_COLUMNS.listCount]: 2,
    [ZONE_SUMMARY_COLUMNS.listsPreview]: [
      { id: 'l1', name: 'Groceries', lineCount: 12, readyCount: 7 },
      { id: 'l2', name: 'Hardware', lineCount: 3, readyCount: 0 },
    ],
    ...overrides,
  };
}

describe('zone summary reader', () => {
  it('reads every number off the raw columns', () => {
    expect(readZoneCounts(row())).toEqual<ZoneCounts>({
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 2,
      firstPendingRequesterName: 'Ines',
    });
  });

  it('reads zeroes and a null name for a zone with nothing in it', () => {
    const empty = row({
      [ZONE_SUMMARY_COLUMNS.memberCounts]: {
        memberCount: 0,
        pendingRequestCount: 0,
      },
      [ZONE_SUMMARY_COLUMNS.firstPending]: null,
      [ZONE_SUMMARY_COLUMNS.listCount]: 0,
      [ZONE_SUMMARY_COLUMNS.listsPreview]: [],
    });

    expect(readZoneCounts(empty)).toEqual<ZoneCounts>({
      memberCount: 0,
      listCount: 0,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    });
    expect(readZoneListsPreview(empty)).toEqual([]);
  });

  it('accepts a bigint count that arrived as a string', () => {
    // node-postgres hands back bigint aggregates as strings unless they are
    // cast; the reader must not turn that into NaN on the wire.
    const counts = readZoneCounts(row({ [ZONE_SUMMARY_COLUMNS.listCount]: '7' }));
    expect(counts.listCount).toBe(7);
  });

  it('reads the preview, and gives an empty array rather than null', () => {
    expect(readZoneListsPreview(row())).toEqual([
      { id: 'l1', name: 'Groceries', lineCount: 12, readyCount: 7 },
      { id: 'l2', name: 'Hardware', lineCount: 3, readyCount: 0 },
    ]);
    expect(
      readZoneListsPreview(row({ [ZONE_SUMMARY_COLUMNS.listsPreview]: null }))
    ).toEqual([]);
    expect(readZoneListsPreview(undefined)).toEqual([]);
  });
});

describe('the preview cap is fixed server side (plan 0017, section 3.3)', () => {
  it('is three, and the SQL says so', () => {
    expect(ZONE_LIST_PREVIEW_LIMIT).toBe(3);
    const added: [string, string][] = [];
    const qb = {
      addSelect: jest.fn((sql: string, alias: string) => {
        added.push([sql, alias]);
        return qb;
      }),
    };
    selectZoneSummary(qb as never);

    const preview = added.find(
      ([, alias]) => alias === ZONE_SUMMARY_COLUMNS.listsPreview
    );
    expect(preview?.[0]).toContain(`LIMIT ${ZONE_LIST_PREVIEW_LIMIT}`);
    // Ordered by activity, so a preview shows the lists actually in use.
    expect(preview?.[0]).toContain('ORDER BY sl."updatedAt" DESC');
    // There is no caller supplied limit anywhere in the summary.
    expect(added.map(([sql]) => sql).join(' ')).not.toContain('previewLimit');
  });

  it('draws the count and the preview from one definition of readability', () => {
    const added: [string, string][] = [];
    const qb = {
      addSelect: jest.fn((sql: string, alias: string) => {
        added.push([sql, alias]);
        return qb;
      }),
    };
    selectZoneSummary(qb as never);

    const byAlias = new Map(added.map(([sql, alias]) => [alias, sql]));
    const readable = 'la."membershipId" = m.id';
    // A card reading "3 lists" over a preview showing one is a bug in the
    // user's eyes, so both must be filtered by the same predicate.
    expect(byAlias.get(ZONE_SUMMARY_COLUMNS.listCount)).toContain(readable);
    expect(byAlias.get(ZONE_SUMMARY_COLUMNS.listsPreview)).toContain(readable);
    for (const alias of [
      ZONE_SUMMARY_COLUMNS.listCount,
      ZONE_SUMMARY_COLUMNS.listsPreview,
    ]) {
      expect(byAlias.get(alias)).toContain(`m.status = 'APPROVED'`);
    }
  });
});

describe('governance gating (plan 0017, section 6)', () => {
  const counts: ZoneCounts = {
    memberCount: 3,
    listCount: 2,
    pendingRequestCount: 2,
    firstPendingRequesterName: 'Ines',
  };

  it.each([ZoneRole.OWNER, ZoneRole.ADMIN])(
    'fills both fields for an approved %s',
    (role) => {
      expect(managesZone(viewer(role))).toBe(true);
      const view = toMyZoneView(ZONE, viewer(role), counts, []);
      expect(view.counts.pendingRequestCount).toBe(2);
      expect(view.counts.firstPendingRequesterName).toBe('Ines');
    }
  );

  it('withholds both fields from a plain member', () => {
    const view = toMyZoneView(ZONE, viewer(ZoneRole.MEMBER), counts, []);
    expect(view.counts.pendingRequestCount).toBeNull();
    expect(view.counts.firstPendingRequesterName).toBeNull();
    // The rest of the card still renders.
    expect(view.counts.memberCount).toBe(3);
    expect(view.counts.listCount).toBe(2);
  });

  it('withholds both fields from a pending applicant, even an admin one', () => {
    const applicant = viewer(ZoneRole.ADMIN, MembershipStatus.PENDING);
    expect(managesZone(applicant)).toBe(false);
    const view = toMyZoneView(ZONE, applicant, counts, []);
    expect(view.counts.pendingRequestCount).toBeNull();
    expect(view.counts.firstPendingRequesterName).toBeNull();
  });

  it('nulls rather than zeroes, because the two mean different things', () => {
    // `null` is "not your business"; `0` is "nobody is waiting". A client
    // renders them differently, so the gate must never collapse one into the
    // other.
    const withheld = governanceFields(
      { pendingRequestCount: 0, firstPendingRequesterName: null },
      false
    );
    expect(withheld.pendingRequestCount).toBeNull();
    const shown = governanceFields(
      { pendingRequestCount: 0, firstPendingRequesterName: null },
      true
    );
    expect(shown.pendingRequestCount).toBe(0);
  });
});

describe('the my-zone view (plan 0017, sections 3 and 7)', () => {
  it('carries counts, the preview and ISO 8601 timestamps', () => {
    const view = toMyZoneView(
      ZONE,
      viewer(ZoneRole.OWNER),
      readZoneCounts(row()),
      readZoneListsPreview(row())
    );

    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(view.counts.memberCount).toBe(3);
    expect(view.lists).toHaveLength(2);
    expect(view.lists[0]).toEqual({
      id: 'l1',
      name: 'Groceries',
      lineCount: 12,
      readyCount: 7,
    });
  });

  it('reports an empty preview and a zero count together', () => {
    const view = toMyZoneView(
      ZONE,
      viewer(ZoneRole.MEMBER),
      { ...readZoneCounts(row()), listCount: 0 },
      []
    );
    // Not "the zone is empty": the caller can read no list in it.
    expect(view.lists).toEqual([]);
    expect(view.counts.listCount).toBe(0);
  });
});
