import {
  toBasketLine,
  toBasketLineOrigins,
  toBasketOriginQuantityResult,
  toBasketView,
} from './basket-mappers';

/**
 * The boundary, on the distinctions that cost a screen when they are flattened
 * (velista `0054`, `0055` and `0056`).
 *
 * Rule D4's usual assertions, that every parameter is `unknown` and a row that will
 * not map is dropped, are already covered by the mappers this file joins. What is
 * new here is one rule that has no visible symptom until it is wrong on somebody
 * else's phone: **absent, null and empty are three different answers**, and two of
 * the fields these mappers read are redacted by omission.
 */

/** The smallest wire line these mappers accept, for adding a field to. */
const LINE = {
  id: 'line-1',
  content: 'Milk',
  quantity: 3,
  settledQuantity: 0,
  itemId: null,
  options: [],
  position: 0,
  createdByParticipantId: null,
  lastEditedByParticipantId: null,
  lastEditedAt: null,
  lastOutcome: null,
};

describe('toBasketLine: what kind of line it is, and where it was sent', () => {
  it('reads a line somebody typed here as `ADDED`', () => {
    expect(toBasketLine({ ...LINE, origin: 'ADDED' })?.kind).toBe('ADDED');
  });

  it('reads a line with no kind at all as one the run composed', () => {
    // A backend from before luna `0055`, where every line was composed by a run, so
    // `DERIVED` is both the fallback and the truth. It offers no send control, which
    // is the quiet direction for a value this build cannot read either.
    expect(toBasketLine(LINE)?.kind).toBe('DERIVED');
    expect(toBasketLine({ ...LINE, origin: 'SOMETHING_NEW' })?.kind).toBe(
      'DERIVED'
    );
  });

  it('reads what a line has bought and not yet put on any list', () => {
    // Zero against a backend from before luna `0093`, which is the truth about one:
    // it wrote no waiting row, so nothing on its lines is unplaced.
    expect(toBasketLine({ ...LINE, waitingSettled: 4 })?.waitingSettled).toBe(
      4
    );
    expect(toBasketLine(LINE)?.waitingSettled).toBe(0);
  });

  it('keeps absent and null apart on `targetListId`', () => {
    // Absent is "you may not see this" and null is "it has been sent nowhere". The
    // send control is offered over the second and never over the first, so
    // collapsing them would draw it for exactly the reader who may not use it.
    const redacted = toBasketLine(LINE);
    const unsent = toBasketLine({ ...LINE, targetListId: null });
    const bound = toBasketLine({ ...LINE, targetListId: 'list-weekly' });

    expect(redacted !== null && 'targetListId' in redacted).toBe(false);
    expect(unsent !== null && 'targetListId' in unsent).toBe(true);
    expect(unsent?.targetListId).toBeNull();
    expect(bound?.targetListId).toBe('list-weekly');
  });
});

describe('toBasketLineOrigins', () => {
  it('reads the lists on a line, the lists that could be, and every other', () => {
    const answer = toBasketLineOrigins({
      generatedListId: 'b-1',
      lineId: 'line-1',
      origins: [
        {
          originId: 'o-1',
          listId: 'list-weekly',
          lineId: 'zl-1',
          zoneId: 'zone-flat',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
          contributed: 2,
          listQuantity: 2,
          settledHere: 1,
          writable: true,
          fromRun: true,
          approvalStatus: 'PENDING',
        },
      ],
      candidates: [
        {
          listId: 'list-office',
          lineId: 'zl-9',
          zoneId: 'zone-office',
          listName: 'Office kitchen',
          zoneName: 'The studio',
          listQuantity: 2,
          content: 'Milk',
          matchedOnText: true,
          fromRun: false,
        },
      ],
      others: [
        {
          listId: 'list-cabin',
          zoneId: 'zone-cabin',
          listName: 'Cabin trip',
          zoneName: 'Weekend away',
          fromRun: false,
        },
      ],
    });

    expect(answer?.origins[0].settledHere).toBe(1);
    expect(answer?.origins[0].writable).toBe(true);
    expect(answer?.origins[0].fromRun).toBe(true);
    expect(answer?.origins[0].approvalStatus).toBe('PENDING');
    // Absent means adoptable on the wire, and the model spends a value on it so the
    // sheet has one field to branch on.
    expect(answer?.candidates[0].unavailable).toBeNull();
    expect(answer?.candidates[0].matchedOnText).toBe(true);
    expect(answer?.others[0].listName).toBe('Cabin trip');
  });

  it('reads a reason this build has never heard of as not adoptable', () => {
    // Offering the row a reel anyway would be a control the server refuses, and
    // reading it as `CLAIMED` would put a sentence about somebody else's shopping
    // under a row nobody said that about. `UNAVAILABLE` says only that it cannot be
    // taken (velista `0068`, section 7).
    const answer = toBasketLineOrigins({
      lineId: 'line-1',
      origins: [],
      candidates: [
        {
          listId: 'list-office',
          lineId: 'zl-9',
          zoneId: 'zone-office',
          listName: null,
          zoneName: null,
          listQuantity: 1,
          content: 'Milk',
          matchedOnText: false,
          unavailable: 'SOMETHING_NEW',
        },
      ],
    });

    expect(answer?.candidates[0].unavailable).toBe('UNAVAILABLE');
  });

  it('reads a line the household has agreed to, and one it has not', () => {
    // The loud direction on purpose: `PENDING` is the fallback, because a caption a
    // reader can dismiss is better than somebody believing a household has agreed to
    // something it has not.
    const answer = toBasketLineOrigins({
      lineId: 'line-1',
      origins: [
        {
          originId: 'o-1',
          listId: 'list-weekly',
          lineId: 'zl-1',
          zoneId: 'zone-flat',
          approvalStatus: 'APPROVED',
        },
        {
          originId: 'o-2',
          listId: 'list-office',
          lineId: 'zl-2',
          zoneId: 'zone-office',
          approvalStatus: 'SOMETHING_NEW',
        },
      ],
      candidates: [],
      others: [],
    });

    expect(answer?.origins.map((row) => row.approvalStatus)).toEqual([
      'APPROVED',
      'PENDING',
    ]);
  });

  it('drops a row with half an identity rather than drawing it', () => {
    const answer = toBasketLineOrigins({
      lineId: 'line-1',
      origins: [{ originId: 'o-1', listId: 'list-weekly' }],
      candidates: [{ listId: 'list-office' }],
      others: [{ listId: 'list-cabin' }],
    });

    expect(answer?.origins).toEqual([]);
    expect(answer?.candidates).toEqual([]);
    expect(answer?.others).toEqual([]);
  });

  it('reads no other lists from a backend that answers none', () => {
    // A backend from before luna `0092`. Empty rather than absent, and it reads
    // correctly: such a server has a separate route for those lists, and this build
    // no longer draws one.
    const answer = toBasketLineOrigins({
      lineId: 'line-1',
      origins: [],
      candidates: [],
    });

    expect(answer?.others).toEqual([]);
  });

  it('refuses a report that cannot say which line it is about', () => {
    expect(
      toBasketLineOrigins({ origins: [], candidates: [], others: [] })
    ).toBeNull();
  });
});

describe('toBasketOriginQuantityResult', () => {
  it('keeps a null origin, because the list came off the line', () => {
    // Dropped rather than kept would leave the row drawn at its old number.
    const result = toBasketOriginQuantityResult({
      line: LINE,
      origin: null,
      listQuantity: 0,
    });

    expect(result?.origin).toBeNull();
    expect(result?.listQuantity).toBe(0);
    expect(result?.line.id).toBe('line-1');
  });

  it('refuses a result whose line cannot be read', () => {
    expect(
      toBasketOriginQuantityResult({ origin: null, listQuantity: 0 })
    ).toBeNull();
  });
});

/**
 * The two fields velista `0077` reads that the client used to drop (section 2) or
 * that the wire does not carry yet (section 4.1).
 *
 * The category is required on `ItemView` and has been since the catalog existed, so
 * the grouping needed no server half at all: it was arriving on every basket and
 * being thrown away. `settled` per origin is backend `0109`'s, required on the wire
 * beside `quantity` and read the same way, because the reel under a list heading is
 * bound to the difference between the two and sends the second as its `from`.
 */
describe('toBasketView: the product’s aisle, and what each list got', () => {
  const VIEW = {
    id: 'gl-1',
    me: { id: 'p-1', kind: 'OWNER' },
    lines: [],
    participants: [],
    products: [],
  };

  function productsOf(products: readonly unknown[]) {
    return toBasketView({ ...VIEW, products })?.products;
  }

  it('reads the wire category into a one element list', () => {
    const read = productsOf([{ id: 'i-1', category: 'DAIRY' }]);

    expect(read?.get('i-1')?.categories).toEqual(['DAIRY']);
  });

  /**
   * A thirteenth category is a product this app cannot name, and the honest place
   * for one is the heading that says exactly that. Dropping it would take a line off
   * a screen somebody is shopping from.
   */
  it('reads a category it has never heard of as OTHER, and keeps the product', () => {
    const read = productsOf([
      { id: 'i-1', category: 'BABY_FOOD' },
      { id: 'i-2' },
    ]);

    expect(read?.get('i-1')?.categories).toEqual(['OTHER']);
    expect(read?.get('i-2')?.categories).toEqual(['OTHER']);
  });

  it('reads what each list has got, beside what it asked for', () => {
    const withOrigins = (origins: readonly unknown[]) =>
      toBasketView({
        ...VIEW,
        lines: [
          {
            id: 'line-1',
            content: 'Eggs',
            quantity: 12,
            settledQuantity: 0,
            itemId: null,
            options: [],
            position: 0,
            createdByParticipantId: null,
            lastEditedByParticipantId: null,
            lastEditedAt: null,
            lastOutcome: null,
            origins,
          },
        ],
      })?.lines[0].origins?.[0];

    const origin = {
      id: 'o-1',
      zoneId: 'z-1',
      listId: 'l-1',
      lineId: 'zl-1',
      quantity: 6,
    };

    expect(withOrigins([{ ...origin, settled: 2 }])?.settled).toBe(2);
    expect(withOrigins([{ ...origin, settled: 0 }])?.settled).toBe(0);
    expect(withOrigins([{ ...origin, settled: 2 }])?.quantity).toBe(6);
    // Zero on a value this build cannot read, exactly as `quantity` above it
    // defaults. The safe direction rather than an honest one: the row draws a full
    // reel, and the `from` it then sends is refused as stale rather than applied as
    // the opposite act.
    expect(withOrigins([origin])?.settled).toBe(0);
  });
});
