import { ConfigService } from '@nestjs/config';
import {
  GeneratedListStatus,
  LIVE_GENERATED_LIST_STATUSES,
  RealtimeEvent,
  isLiveGeneratedList,
  type LineClaimChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineClaimService } from './line-claim.service';
import {
  BASKET_CLAIMED_LINES_SQL,
  LINE_CLAIMS_SQL,
  readLineClaims,
} from './line-claim.sql';

const ANA = 'user-ana';
const ZONE_HOME = 'zone-home';
const ZONE_OFFICE = 'zone-office';

/** A window wide enough that nothing in these specs falls out of it. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface Emitted {
  event: RealtimeEvent;
  zoneId: string;
  payload: LineClaimChangedEvent;
  listId?: string;
}

function build(rows: unknown[] = [], basketRefs: unknown[] = []) {
  const emitted: Emitted[] = [];
  const queries: { sql: string; parameters: unknown[] }[] = [];

  const dataSource = {
    query: async (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return sql === BASKET_CLAIMED_LINES_SQL ? basketRefs : rows;
    },
  } as unknown as DataSource;

  const publisher = {
    emit: (
      event: RealtimeEvent,
      zoneId: string,
      payload: LineClaimChangedEvent,
      listId?: string
    ) => emitted.push({ event, zoneId, payload, listId }),
  } as unknown as CoreEventsPublisher;

  const config = {
    getOrThrow: () => ({ generatedList: { claimWindowMs: WINDOW_MS } }),
  } as unknown as ConfigService;

  return {
    emitted,
    queries,
    service: new LineClaimService(dataSource, publisher, config),
  };
}

describe('what counts as a live basket (plan 0052, section 3)', () => {
  it('includes DRAFT, because a run composes one', () => {
    // The whole reason the constant exists. Exit criterion 1 says generating a
    // basket claims the lines it took, and a run writes `DRAFT`, so a claim that
    // counted only `ACTIVE` would announce nothing at the one moment the
    // indicator is for.
    expect([...LIVE_GENERATED_LIST_STATUSES]).toEqual([
      GeneratedListStatus.DRAFT,
      GeneratedListStatus.ACTIVE,
    ]);
    expect(isLiveGeneratedList(GeneratedListStatus.DRAFT)).toBe(true);
    expect(isLiveGeneratedList(GeneratedListStatus.ACTIVE)).toBe(true);
  });

  it('excludes the two a trip is over in', () => {
    expect(isLiveGeneratedList(GeneratedListStatus.COMPLETED)).toBe(false);
    expect(isLiveGeneratedList(GeneratedListStatus.ARCHIVED)).toBe(false);
  });
});

describe('the claim query (plan 0052, sections 3 and 4)', () => {
  it('counts only baskets inside the window', () => {
    // Section 4.1: a basket generated on Tuesday that nobody shopped must stop
    // claiming, or the household reads "Ana is buying this" for a month.
    expect(LINE_CLAIMS_SQL).toContain(`gl."generatedAt" >= $3::timestamptz`);
  });

  it('releases a basket line that has been settled all the way through', () => {
    // Section 3.3, and the reason it is a predicate here rather than an event
    // the settle has to remember to send: a finished line is finished whether
    // it was bought or the shop did not have it.
    expect(LINE_CLAIMS_SQL).toContain(`gll."settledQuantity" < gll."quantity"`);
  });

  it('resolves two baskets holding one line to the newer one', () => {
    // Section 3.4. The last person to take it is the one named, and the read and
    // the event agree because both come from this ordering.
    expect(LINE_CLAIMS_SQL).toContain(`DISTINCT ON (o."lineId")`);
    expect(LINE_CLAIMS_SQL).toContain(
      `ORDER BY o."lineId", gl."generatedAt" DESC, gl.id DESC`
    );
  });

  it('never selects the basket, only its owner', () => {
    // Section 2's load bearing omission: an id in a payload is an invitation to
    // fetch it, so the id never leaves this query in the first place.
    expect(LINE_CLAIMS_SQL).toContain(`gl."ownerUserId"`);
    expect(LINE_CLAIMS_SQL).not.toContain(`gl.id AS`);
  });
});

describe('reading the claim', () => {
  const query = (rows: unknown[]) => async () => rows;

  it('defaults every line nothing carries', async () => {
    const claims = await readLineClaims(
      query([]),
      ['li1', 'li2'],
      LIVE_GENERATED_LIST_STATUSES,
      new Date()
    );

    expect(claims.get('li1')).toEqual({
      claimed: false,
      claimedByUserId: null,
    });
    expect(claims.get('li2')?.claimed).toBe(false);
  });

  it('names the basket owner', async () => {
    const claims = await readLineClaims(
      query([{ lineId: 'li1', ownerUserId: ANA, ownerInZone: true }]),
      ['li1'],
      LIVE_GENERATED_LIST_STATUSES,
      new Date()
    );

    expect(claims.get('li1')).toEqual({ claimed: true, claimedByUserId: ANA });
  });

  it('reports claimed without a name when the owner has left the zone', async () => {
    // Section 6's leaning, implemented: the same "access at request time" rule
    // everything else here uses. The household still needs to know somebody has
    // it; who that was is no longer theirs to read.
    const claims = await readLineClaims(
      query([{ lineId: 'li1', ownerUserId: ANA, ownerInZone: false }]),
      ['li1'],
      LIVE_GENERATED_LIST_STATUSES,
      new Date()
    );

    expect(claims.get('li1')).toEqual({ claimed: true, claimedByUserId: null });
  });

  it('asks nothing at all for an empty page', async () => {
    let asked = false;
    const claims = await readLineClaims(
      async () => {
        asked = true;
        return [];
      },
      [],
      LIVE_GENERATED_LIST_STATUSES,
      new Date()
    );

    expect(asked).toBe(false);
    expect(claims.size).toBe(0);
  });
});

describe('announcing a claim (plan 0052, section 3.1)', () => {
  it('sends one event per zone, not one per line', () => {
    const w = build();

    w.service.announce(true, ANA, [
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li1' },
      { zoneId: ZONE_HOME, listId: 'l2', lineId: 'li2' },
      { zoneId: ZONE_OFFICE, listId: 'l3', lineId: 'li3' },
    ]);

    expect(w.emitted).toHaveLength(2);
    expect(w.emitted.map((e) => e.zoneId)).toEqual([ZONE_HOME, ZONE_OFFICE]);
    expect(w.emitted[0].payload.lines).toEqual([
      { lineId: 'li1', listId: 'l1' },
      { lineId: 'li2', listId: 'l2' },
    ]);
    expect(w.emitted[0].event).toBe(RealtimeEvent.LineClaimChanged);
  });

  it('addresses the zone room and no list room', () => {
    // One basket draws from several lists of one zone at once, so the room is
    // the zone's and the list rides per line.
    const w = build();

    w.service.announce(true, ANA, [
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li1' },
    ]);

    expect(w.emitted[0].listId).toBeUndefined();
  });

  it('names the owner when claiming and nobody when releasing', () => {
    const w = build();

    w.service.announce(true, ANA, [
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li1' },
    ]);
    w.service.announce(false, ANA, [
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li1' },
    ]);

    expect(w.emitted[0].payload.claimedByUserId).toBe(ANA);
    expect(w.emitted[0].payload.claimed).toBe(true);
    // A name on a release would read as a claim to a client that looked at the
    // name before the flag.
    expect(w.emitted[1].payload.claimedByUserId).toBeNull();
    expect(w.emitted[1].payload.claimed).toBe(false);
  });

  it('carries no generated list id anywhere in the payload', () => {
    const w = build();

    w.service.announce(true, ANA, [
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li1' },
    ]);

    expect(Object.keys(w.emitted[0].payload).sort()).toEqual([
      'claimed',
      'claimedByUserId',
      'lines',
      'zoneId',
    ]);
  });

  it('says nothing when there is nothing to say', () => {
    const w = build();
    w.service.announce(true, ANA, []);
    expect(w.emitted).toHaveLength(0);
  });
});

describe('releasing a claim (plan 0052, section 3.4)', () => {
  it('leaves alone a line another basket still holds', async () => {
    // The transition is a correct write and the answer is still "somebody has
    // this", so telling the household otherwise would be a wrong answer produced
    // by a correct write.
    const w = build([{ lineId: 'li2', ownerUserId: ANA, ownerInZone: true }]);

    await w.service.announceReleased([
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li1' },
      { zoneId: ZONE_HOME, listId: 'l1', lineId: 'li2' },
    ]);

    expect(w.emitted).toHaveLength(1);
    expect(w.emitted[0].payload.lines).toEqual([
      { lineId: 'li1', listId: 'l1' },
    ]);
  });

  it('asks nothing when the transition freed nothing', async () => {
    const w = build();
    await w.service.announceReleased([]);
    expect(w.queries).toHaveLength(0);
    expect(w.emitted).toHaveLength(0);
  });
});
