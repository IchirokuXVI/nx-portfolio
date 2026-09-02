import { GatewayError } from '../errors';
import { BasketMemory } from './basket-memory';

/**
 * The fake, on the rules it exists to keep (velista `0054`, `0055` and `0056`).
 *
 * A spec over a fake looks odd until you remember what this one is for: every screen
 * in the three plans is developed and tested against it, so a fake that is kinder
 * than the server lets a bug through into a screen nobody can see is wrong until it
 * meets a real gateway.
 *
 * So what is asserted here is exactly the set of refusals and the arithmetic the
 * screens branch on, and nothing about the fixture's contents beyond what those need.
 */
const ID = 'basket-saturday';

/** The code on the refusal, or null when the call did not refuse at all. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof GatewayError ? error.code : 'not-a-gateway-error';
  }
}

describe('BasketMemory: saying how many are still to get', () => {
  it('refuses a `from` that is not where the line stands', async () => {
    const memory = new BasketMemory();

    expect(
      await refusal(() =>
        memory.setOutstanding(ID, 'line-milk', { outstanding: 1, from: 99 })
      )
    ).toBe('stale_quantity');
  });

  it('raises the quantity and settles nothing when it goes up', async () => {
    const memory = new BasketMemory();

    const result = await memory.setOutstanding(ID, 'line-milk', {
      outstanding: 5,
      from: 3,
    });

    expect(result.line.quantity).toBe(5);
    expect(result.line.settled).toBe(0);
    expect(result.line.lastOutcome).toBeNull();
    expect(result.skippedCount).toBe(0);
  });

  it('settles the difference as bought when it goes down', async () => {
    const memory = new BasketMemory();

    const result = await memory.setOutstanding(ID, 'line-milk', {
      outstanding: 1,
      from: 3,
    });

    expect(result.line.settled).toBe(2);
    expect(result.line.quantity).toBe(3);
    expect(result.line.lastOutcome).toBe('BOUGHT');
  });

  it('succeeds and changes nothing when it ends where it began', async () => {
    // A control that snapped back to where it started must not report a failure.
    const memory = new BasketMemory();

    const result = await memory.setOutstanding(ID, 'line-milk', {
      outstanding: 3,
      from: 3,
    });

    expect(result.line.quantity).toBe(3);
    expect(result.line.settled).toBe(0);
    expect(result.line.lastOutcome).toBeNull();
  });

  it('refuses a basket whose trip is over, with a code of its own', async () => {
    // Not a plain conflict: "this list is finished" and "somebody already finished
    // this line" are different sentences, and the screen picks between them by code.
    const memory = new BasketMemory();
    memory.status = 'COMPLETED';

    expect(
      await refusal(() =>
        memory.setOutstanding(ID, 'line-milk', { outstanding: 1, from: 3 })
      )
    ).toBe('generated_list_finished');
  });
});

describe('BasketMemory: the lists on a line', () => {
  it('refuses the whole read to a guest rather than answering it empty', async () => {
    // A redacted answer here would be an empty sheet, which reads as "no household
    // wants this" and is a worse lie than a refusal.
    const memory = new BasketMemory();
    memory.me = { ...memory.me, kind: 'GUEST' };

    expect(await refusal(() => memory.getLineOrigins(ID, 'line-milk'))).toBe(
      'forbidden'
    );
  });

  it('refuses a reader who does not pass the all or nothing rule', async () => {
    const memory = new BasketMemory();
    memory.seesZoneData = false;

    expect(await refusal(() => memory.getLineOrigins(ID, 'line-milk'))).toBe(
      'forbidden'
    );
  });

  it('answers the two households on the line, named, with their floors', async () => {
    const memory = new BasketMemory();

    const answer = await memory.getLineOrigins(ID, 'line-milk');

    expect(answer.origins.map((origin) => origin.listName)).toEqual([
      'Weekly shop',
      'Groceries',
    ]);
    expect(answer.origins.map((origin) => origin.zoneName)).toEqual([
      'Flat 3B',
      'Parents’ house',
    ]);
    expect(answer.origins.map((origin) => origin.contributed)).toEqual([2, 1]);
    expect(answer.origins.every((origin) => origin.settledHere === 0)).toBe(
      true
    );
  });

  it('offers the three kinds of candidate, so a sheet cannot draw them all alike', async () => {
    // One adoptable, one another basket is carrying, one waiting for its own list.
    // A fake with only the first would let a screen ship that draws every candidate
    // as a button.
    const memory = new BasketMemory();

    const answer = await memory.getLineOrigins(ID, 'line-milk');

    expect(answer.candidates.map((row) => row.unavailable)).toEqual([
      null,
      'CLAIMED',
      'NOT_APPROVED',
    ]);
  });

  it('carries a floor on the line that has already had some bought', async () => {
    const memory = new BasketMemory();

    const answer = await memory.getLineOrigins(ID, 'line-eggs');

    expect(answer.origins).toHaveLength(1);
    expect(answer.origins[0].settledHere).toBe(2);
  });

  it('answers empty on both sides for a line somebody typed here', async () => {
    // Not a redaction and not missing data: nobody's list asked for it, and the run
    // never looked.
    const memory = new BasketMemory();
    const added = await memory.addLine(ID, { content: 'Foil' });

    const answer = await memory.getLineOrigins(ID, added.id);

    expect(answer.origins).toEqual([]);
    expect(answer.candidates).toEqual([]);
  });
});

describe('BasketMemory: what one list asked for', () => {
  it('refuses a `from` that is not what the list is contributing', async () => {
    const memory = new BasketMemory();

    expect(
      await refusal(() =>
        memory.setOriginQuantity(ID, 'line-milk', {
          listId: 'list-weekly',
          lineId: 'zl-1',
          quantity: 4,
          from: 0,
        })
      )
    ).toBe('stale_quantity');
  });

  it('refuses a contribution under what has already been bought', async () => {
    // Two of the eggs having been bought for this list means the list cannot
    // retroactively have wanted one.
    const memory = new BasketMemory();

    expect(
      await refusal(() =>
        memory.setOriginQuantity(ID, 'line-eggs', {
          listId: 'list-weekly',
          lineId: 'zl-3',
          quantity: 1,
          from: 12,
        })
      )
    ).toBe('below_settled');
  });

  it('moves the line by the delta and buys nothing', async () => {
    const memory = new BasketMemory();

    const result = await memory.setOriginQuantity(ID, 'line-milk', {
      listId: 'list-weekly',
      lineId: 'zl-1',
      quantity: 4,
      from: 2,
    });

    expect(result.origin?.contributed).toBe(4);
    expect(result.listQuantity).toBe(4);
    expect(result.line.quantity).toBe(5);
    expect(result.line.settled).toBe(0);
    expect(result.line.lastOutcome).toBeNull();
  });

  it('takes the list off the line at zero, and says so with a null origin', async () => {
    // The sheet has to drop the row rather than leave it drawn at its old number.
    const memory = new BasketMemory();

    const result = await memory.setOriginQuantity(ID, 'line-milk', {
      listId: 'list-groceries',
      lineId: 'zl-2',
      quantity: 0,
      from: 1,
    });

    expect(result.origin).toBeNull();
    expect(result.line.origins?.map((origin) => origin.listId)).toEqual([
      'list-weekly',
    ]);
    expect(result.line.quantity).toBe(2);
  });

  it('adopts a candidate as an origin, carrying the ids it was handed', async () => {
    const memory = new BasketMemory();

    const result = await memory.setOriginQuantity(ID, 'line-milk', {
      listId: 'list-office',
      lineId: 'zl-office-milk',
      quantity: 2,
      from: 0,
    });

    expect(result.origin?.listId).toBe('list-office');
    expect(result.origin?.lineId).toBe('zl-office-milk');
    expect(result.line.quantity).toBe(5);

    // And it stops being a candidate, because it is on the line now.
    const after = await memory.getLineOrigins(ID, 'line-milk');
    expect(after.candidates.map((row) => row.listId)).not.toContain(
      'list-office'
    );
  });

  it('never lets a line ask for fewer than it has already bought', async () => {
    const memory = new BasketMemory();

    const result = await memory.setOriginQuantity(ID, 'line-eggs', {
      listId: 'list-weekly',
      lineId: 'zl-3',
      quantity: 2,
      from: 12,
    });

    expect(result.line.settled).toBe(2);
    expect(result.line.quantity).toBe(2);
  });
});

describe('BasketMemory: sending a line to a list', () => {
  it('offers the run’s own sources marked, and more beside them', async () => {
    const memory = new BasketMemory();

    const targets = await memory.getLineTargets(ID, 'line-milk');

    expect(targets.filter((target) => target.fromRun)).toHaveLength(2);
    expect(targets.filter((target) => !target.fromRun).length).toBeGreaterThan(
      1
    );
    expect(targets.every((target) => target.listName !== null)).toBe(true);
  });

  it('refuses the picker to a guest', async () => {
    const memory = new BasketMemory();
    memory.me = { ...memory.me, kind: 'GUEST' };

    expect(await refusal(() => memory.getLineTargets(ID, 'line-milk'))).toBe(
      'forbidden'
    );
  });

  it('binds an added line and keeps who put it there', async () => {
    const memory = new BasketMemory();
    const added = await memory.addLine(ID, { content: 'Foil', quantity: 2 });

    const result = await memory.bindLine(ID, added.id, 'list-weekly');

    expect(result.line.targetListId).toBe('list-weekly');
    expect(result.quantity).toBe(2);
    expect(result.pendingApproval).toBe(false);
    expect(result.createdLineId).not.toBe('');
    // Written once, at the add. Sending the line somewhere does not make somebody
    // else the person who put it there.
    expect(result.line.createdBy).toBe(added.createdBy);
  });

  it('says a line is waiting where the list does not accept on its own', async () => {
    const memory = new BasketMemory();
    const added = await memory.addLine(ID, { content: 'Foil' });

    const result = await memory.bindLine(ID, added.id, 'list-groceries');

    expect(result.pendingApproval).toBe(true);
  });

  it('refuses a line the run composed, as a validation failure', async () => {
    const memory = new BasketMemory();

    expect(
      await refusal(() => memory.bindLine(ID, 'line-milk', 'list-weekly'))
    ).toBe('validation_failed');
  });

  it('refuses a second bind, as a conflict', async () => {
    const memory = new BasketMemory();
    const added = await memory.addLine(ID, { content: 'Foil' });
    await memory.bindLine(ID, added.id, 'list-weekly');

    expect(
      await refusal(() => memory.bindLine(ID, added.id, 'list-office'))
    ).toBe('conflict');
  });

  it('refuses a basket whose trip is over', async () => {
    const memory = new BasketMemory();
    const added = await memory.addLine(ID, { content: 'Foil' });
    memory.status = 'COMPLETED';

    expect(
      await refusal(() => memory.bindLine(ID, added.id, 'list-weekly'))
    ).toBe('generated_list_finished');
  });
});

describe('BasketMemory: what a reader who may not see zone data gets', () => {
  it('strips `targetListId` beside `origins`, rather than nulling it', async () => {
    // The two are the same fact: which household's list a line reaches. Null is a
    // real answer here, meaning sent nowhere, and the send control is offered over
    // it, so a redacted line must not read that way.
    const memory = new BasketMemory();
    memory.seesZoneData = false;

    const basket = await memory.getBasket();

    for (const line of basket.lines) {
      expect('origins' in line).toBe(false);
      expect('targetListId' in line).toBe(false);
    }
  });

  it('marks a line a person typed as `ADDED`, and the run’s as `DERIVED`', async () => {
    // Not gated, unlike the two above: every reader is told what kind of line they
    // are looking at, and what is withheld is which household it touches.
    const memory = new BasketMemory();
    const added = await memory.addLine(ID, { content: 'Foil' });
    const basket = await memory.getBasket();

    expect(added.kind).toBe('ADDED');
    expect(added.targetListId).toBeNull();
    expect(
      basket.lines
        .filter((line) => line.id !== added.id)
        .every((line) => line.kind === 'DERIVED')
    ).toBe(true);
  });
});
