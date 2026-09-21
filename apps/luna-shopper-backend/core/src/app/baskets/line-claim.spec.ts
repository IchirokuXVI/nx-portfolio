import { ConfigService } from '@nestjs/config';
import {
  BasketStatus,
  RealtimeEvent,
  isOpenBasket,
  type LineClaimChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import { OPEN_GENERATED_BASKET } from '../baskets/open-basket.sql';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { WRITABLE_LIST } from './basket.sql';
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
    getOrThrow: () => ({
      basket: { claimWindowMs: WINDOW_MS },
      // The window a skip keeps a line free for (plan 0137, section 5.4). It
      // travels into the statement as a parameter, and nothing under test here
      // is about its value.
      basket: { skipWindowMs: 12 * 60 * 60 * 1000 },
    }),
  } as unknown as ConfigService;

  return {
    emitted,
    queries,
    service: new LineClaimService(dataSource, publisher, config),
  };
}

describe('what counts as a basket somebody is shopping (plan 0133, section 3)', () => {
  it('is OPEN, and only OPEN', () => {
    // Exit criterion 1 of plan 0052 says generating a basket claims the lines it
    // took, and a run composes an `OPEN` one, so this is the moment the
    // indicator exists for. There used to be a second spelling of this state,
    // `ACTIVE`, that nothing in core ever wrote.
    expect(isOpenBasket(BasketStatus.OPEN)).toBe(true);
  });

  it('excludes the two a trip is over in', () => {
    expect(isOpenBasket(BasketStatus.FINISHED)).toBe(false);
    expect(isOpenBasket(BasketStatus.ARCHIVED)).toBe(false);
  });

  it('asks the kind as well, so the permanent basket claims nothing', () => {
    // The status alone would say yes to a `LIVE` basket, which is always open
    // and holds every line its owner can write (plan 0133, section 6).
    expect(LINE_CLAIMS_SQL).toContain(OPEN_GENERATED_BASKET);
  });
});

describe('the claim query (plan 0052, sections 3 and 4)', () => {
  it('counts only baskets inside the window', () => {
    // Section 4.1: a basket generated on Tuesday that nobody shopped must stop
    // claiming, or the household reads "Ana is buying this" for a month.
    expect(LINE_CLAIMS_SQL).toContain(`gl."generatedAt" >= $2::timestamptz`);
  });

  it('stands on coverage rather than on rows of the basket', () => {
    // Plan 0136, section 7.1. A basket holds no lines any more, so what it is
    // carrying is the lines of the lists its sources name.
    expect(LINE_CLAIMS_SQL).toContain(`"basket_sources" bs`);
    expect(LINE_CLAIMS_SQL).not.toContain('basket_line_origins');
    expect(LINE_CLAIMS_SQL).not.toContain('basket_lines');
  });

  it('reads the same writable list predicate the coverage does', () => {
    // One definition, imported rather than restated, so the claim and the
    // basket cannot disagree about which lists a trip reads.
    expect(LINE_CLAIMS_SQL).toContain(WRITABLE_LIST.trim());
  });

  it('needs the owner to still be in the line zone', () => {
    // Section 7.1 again, and it is what replaces "claimed without a name": a
    // basket that cannot write a line is not out buying it.
    expect(LINE_CLAIMS_SQL).toContain(`"zone_memberships" m`);
    expect(LINE_CLAIMS_SQL).toContain(`m."userId" = gl."ownerUserId"`);
  });

  it('releases a line bought all the way down, and one deleted', () => {
    // What replaces `settledQuantity < quantity`, and the reason is the same: a
    // finished line is finished, and nobody is out buying a line the household
    // deleted (plan 0132).
    expect(LINE_CLAIMS_SQL).toContain(`ll.quantity > 0`);
    expect(LINE_CLAIMS_SQL).toContain(`ll."deletedAt" IS NULL`);
  });

  it('releases a line whose newest standing act said the shop had none', () => {
    // The other half of "done". A line the shop did not have keeps its
    // quantity, so only the newest settlement can say the shopper is finished
    // with it.
    expect(LINE_CLAIMS_SQL).toContain(`s."outcome" = 'NOT_AVAILABLE'`);
    expect(LINE_CLAIMS_SQL).toContain(
      `(s2."settledAt", s2.id) > (s."settledAt", s.id)`
    );
  });

  it('resolves two baskets holding one line to the newer one', () => {
    // Section 3.4. The last person to take it is the one named, and the read and
    // the event agree because both come from this ordering.
    expect(LINE_CLAIMS_SQL).toContain(`DISTINCT ON (ll.id)`);
    expect(LINE_CLAIMS_SQL).toContain(
      `ORDER BY ll.id, gl."generatedAt" DESC, gl.id DESC`
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
    const claims = await readLineClaims(query([]), ['li1', 'li2'], new Date());

    expect(claims.get('li1')).toEqual({
      claimed: false,
      claimedByUserId: null,
    });
    expect(claims.get('li2')?.claimed).toBe(false);
  });

  it('names the basket owner', async () => {
    const claims = await readLineClaims(
      query([{ lineId: 'li1', ownerUserId: ANA }]),
      ['li1'],
      new Date()
    );

    expect(claims.get('li1')).toEqual({ claimed: true, claimedByUserId: ANA });
  });

  it('always names the owner, because a row is proof of membership', async () => {
    // Plan 0136, section 7.1 ends plan 0052 section 6's "claimed without a
    // name". Coverage needs an approved membership, so an owner who left the
    // zone produces no row at all rather than a nameless claim.
    const claims = await readLineClaims(
      query([{ lineId: 'li1', ownerUserId: ANA }]),
      ['li1', 'li2'],
      new Date()
    );

    expect(claims.get('li1')?.claimedByUserId).toBe(ANA);
    expect(claims.get('li2')).toEqual({
      claimed: false,
      claimedByUserId: null,
    });
  });

  it('asks nothing at all for an empty page', async () => {
    let asked = false;
    const claims = await readLineClaims(
      async () => {
        asked = true;
        return [];
      },
      [],
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

  it('carries no basket id anywhere in the payload', () => {
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
    const w = build([{ lineId: 'li2', ownerUserId: ANA }]);

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

describe('the lines a basket could be releasing (plan 0136, section 7.1)', () => {
  it('is one read where there were two', () => {
    // `BASKET_LINE_CLAIMED_LINES_SQL` asked one basket line, and a basket has
    // none, so the narrow twin has nothing left to be narrow about.
    expect(BASKET_CLAIMED_LINES_SQL).toContain(`"basket_sources" bs`);
    expect(BASKET_CLAIMED_LINES_SQL).not.toContain(
      'basket_line_origins'
    );
  });

  it('names only lines the household still wants', () => {
    // Not redundant with the caller's transition: a basket being finished
    // covers lines that were released an hour ago, and announcing those again
    // would be an event saying nothing changed.
    expect(BASKET_CLAIMED_LINES_SQL).toContain(`ll.quantity > 0`);
    expect(BASKET_CLAIMED_LINES_SQL).toContain(`ll."deletedAt" IS NULL`);
  });

  it('carries the room each line goes to', () => {
    expect(BASKET_CLAIMED_LINES_SQL).toContain(`sl."zoneId" AS "zoneId"`);
    expect(BASKET_CLAIMED_LINES_SQL).toContain(`sl.id AS "listId"`);
    expect(BASKET_CLAIMED_LINES_SQL).toContain(`ll.id AS "lineId"`);
  });
});
