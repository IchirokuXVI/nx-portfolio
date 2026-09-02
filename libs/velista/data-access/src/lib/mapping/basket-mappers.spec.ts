import {
  toBasketBindResult,
  toBasketLine,
  toBasketLineOrigins,
  toBasketLineTarget,
  toBasketOriginQuantityResult,
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
  it('reads the lists on a line and the lists that could be', () => {
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
        },
      ],
    });

    expect(answer?.origins[0].settledHere).toBe(1);
    expect(answer?.origins[0].writable).toBe(true);
    // Absent means adoptable on the wire, and the model spends a value on it so the
    // sheet has one field to branch on.
    expect(answer?.candidates[0].unavailable).toBeNull();
    expect(answer?.candidates[0].matchedOnText).toBe(true);
  });

  it('reads a reason this build has never heard of as not adoptable', () => {
    // Offering the row anyway would be a control the server refuses. `CLAIMED` is the
    // reading that says least about why.
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

    expect(answer?.candidates[0].unavailable).toBe('CLAIMED');
  });

  it('drops a row with half an identity rather than drawing it', () => {
    const answer = toBasketLineOrigins({
      lineId: 'line-1',
      origins: [{ originId: 'o-1', listId: 'list-weekly' }],
      candidates: [{ listId: 'list-office' }],
    });

    expect(answer?.origins).toEqual([]);
    expect(answer?.candidates).toEqual([]);
  });

  it('refuses a report that cannot say which line it is about', () => {
    expect(toBasketLineOrigins({ origins: [], candidates: [] })).toBeNull();
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

describe('toBasketLineTarget', () => {
  it('reads a list the run drew from', () => {
    const target = toBasketLineTarget({
      listId: 'list-weekly',
      zoneId: 'zone-flat',
      listName: 'Weekly shop',
      zoneName: 'Flat 3B',
      fromRun: true,
    });

    expect(target?.fromRun).toBe(true);
  });

  it('keeps a target whose flag it could not read, unordered rather than gone', () => {
    // Failing to read the flag costs the picker its ordering. Dropping the row would
    // cost somebody the list they meant.
    const target = toBasketLineTarget({
      listId: 'list-weekly',
      zoneId: 'zone-flat',
      listName: null,
      zoneName: null,
    });

    expect(target?.fromRun).toBe(false);
    expect(target?.listName).toBeNull();
  });

  it('drops a target with no list or no zone', () => {
    expect(toBasketLineTarget({ listId: 'list-weekly' })).toBeNull();
    expect(toBasketLineTarget({ zoneId: 'zone-flat' })).toBeNull();
  });
});

describe('toBasketBindResult', () => {
  it('reads the line, where it went, and whether it is waiting', () => {
    const result = toBasketBindResult({
      line: { ...LINE, origin: 'ADDED', targetListId: 'list-weekly' },
      listId: 'list-weekly',
      zoneId: 'zone-flat',
      createdLineId: 'zl-9',
      quantity: 2,
      pendingApproval: true,
    });

    expect(result?.line.targetListId).toBe('list-weekly');
    expect(result?.createdLineId).toBe('zl-9');
    expect(result?.pendingApproval).toBe(true);
  });

  it('says nothing is waiting unless the server said so', () => {
    // The quieter direction: a row that fails to say "waiting for that list to
    // approve it" is better than one that says it about a line already on the list.
    const result = toBasketBindResult({
      line: LINE,
      listId: 'list-weekly',
      zoneId: 'zone-flat',
      createdLineId: 'zl-9',
      quantity: 2,
    });

    expect(result?.pendingApproval).toBe(false);
    expect(result?.quantity).toBe(2);
  });

  it('refuses a result missing the line it created', () => {
    expect(
      toBasketBindResult({
        line: LINE,
        listId: 'list-weekly',
        zoneId: 'zone-flat',
        quantity: 0,
        pendingApproval: false,
      })
    ).toBeNull();
  });
});
