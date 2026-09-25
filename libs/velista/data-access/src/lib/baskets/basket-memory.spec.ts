import type { BasketRow } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { BasketMemory } from './basket-memory';

/**
 * The fake that stands in for the server (velista `0090`, section 5.4).
 *
 * It exists to be **no kinder than the server**, so a screen developed against it
 * meets the refusals the real one makes. What that means since backend `0136` is
 * mostly one thing: it stores no rows. It holds lists with lines and the
 * settlements this basket wrote, and derives the rows on every read by the table of
 * backend `0130` section 4.
 *
 * So the assertions here are about that derivation, in the table's own order, and
 * about the two guards every write on a row goes through: the `from` it names, and
 * whether the trip is over.
 */

const BASKET = 'basket-saturday';

function rowOf(rows: readonly BasketRow[], content: string): BasketRow {
  const found = rows.find((row) => row.content === content);
  if (found === undefined) {
    throw new Error(`no row for ${content}`);
  }
  return found;
}

async function rowsOf(memory: BasketMemory): Promise<readonly BasketRow[]> {
  return (await memory.getBasket(BASKET)).rows;
}

async function codeOf(act: Promise<unknown>): Promise<string> {
  try {
    await act;
  } catch (error) {
    return error instanceof GatewayError ? error.code : 'not-a-gateway-error';
  }
  return 'no-error';
}

describe('BasketMemory: a row is read, never stored', () => {
  /**
   * The whole shape of the rewrite in one assertion. Two households both asking
   * for milk are one thing to pick off one shelf, so they are one row with two
   * entries, and the row's numbers are the sum of theirs.
   */
  it('groups the lines that share a name into one row with an entry each', async () => {
    const rows = await rowsOf(new BasketMemory());

    const milk = rowOf(rows, 'Milk');
    expect(milk.entries).toHaveLength(2);
    expect(milk.left).toBe(3);
    expect(milk.asked).toBe(3);
  });

  /** The anchor is the oldest line of the group, and its id keys the row. */
  it('keys a row by its oldest line', async () => {
    const rows = await rowsOf(new BasketMemory());

    expect(rowOf(rows, 'Milk').rowKey).toBe('zl-1');
  });

  it('sums a row out of its entries and never out of a stored number', async () => {
    const memory = new BasketMemory();
    const before = rowOf(await rowsOf(memory), 'Eggs');

    await memory.settle(BASKET, before.rowKey, {
      outcome: 'BOUGHT',
      quantity: 2,
      from: before.left,
    });

    const after = rowOf(await rowsOf(memory), 'Eggs');
    expect(after.bought).toBe(before.bought + 2);
    expect(after.left).toBe(before.left - 2);
    // `bought + left`, by backend `0130` section 4, on every read.
    expect(after.asked).toBe(after.bought + after.left);
  });
});

/**
 * The state table of backend `0130` section 4, in the order it is tested.
 *
 * `SKIPPED` is absent because backend `0137` produces it and this fake models no
 * skip. Its place in the order is kept by the class, so the day it arrives it goes
 * where the table says rather than wherever it fits.
 */
describe('BasketMemory: the state of a row', () => {
  it('is WANTED while nothing has been said about it', async () => {
    expect(rowOf(await rowsOf(new BasketMemory()), 'Milk').state).toBe(
      'WANTED'
    );
  });

  it('is PARTLY when some units were bought and some are left', async () => {
    // Two of the eggs are bought in the fixture, and ten are still wanted.
    const eggs = rowOf(await rowsOf(new BasketMemory()), 'Eggs');

    expect(eggs.state).toBe('PARTLY');
    expect(eggs.bought).toBe(2);
    expect(eggs.left).toBeGreaterThan(0);
  });

  it('is DONE when nothing is left and something was bought', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');

    await memory.settle(BASKET, eggs.rowKey, {
      outcome: 'BOUGHT',
      quantity: eggs.left,
      from: eggs.left,
    });

    expect(rowOf(await rowsOf(memory), 'Eggs').state).toBe('DONE');
  });

  /**
   * It beats `DONE` in the order, and it has to: a close buys nothing, so a row
   * whose shop had none would otherwise read as a purchase the moment its units
   * went. The glyph and the caption both rest on the two being told apart.
   */
  it('is NOT_AVAILABLE when the newest act says the shop had none', async () => {
    const bread = rowOf(await rowsOf(new BasketMemory()), 'Sourdough loaf');

    expect(bread.state).toBe('NOT_AVAILABLE');
    expect(bread.bought).toBe(0);
  });

  it('is NOT_AVAILABLE again after a close over a purchase', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');

    await memory.settle(BASKET, eggs.rowKey, {
      outcome: 'NOT_AVAILABLE',
      from: eggs.left,
    });

    const after = rowOf(await rowsOf(memory), 'Eggs');
    expect(after.state).toBe('NOT_AVAILABLE');
    // The units somebody did buy are still bought: a close says the shop had no
    // more, not that the trolley was emptied.
    expect(after.bought).toBe(2);
  });
});

describe('BasketMemory: the counts', () => {
  /** Over rows that are not `REMOVED`, which is the server's rule. */
  it('counts done, unavailable and the total', async () => {
    const basket = await new BasketMemory().getBasket(BASKET);

    expect(basket.progress).toEqual({ done: 0, unavailable: 1, total: 3 });
  });

  /** `total - done - unavailable`. The client never works it out. */
  it('answers pending beside the progress', async () => {
    const basket = await new BasketMemory().getBasket(BASKET);

    expect(basket.pending).toBe(2);
  });

  it('moves the counts as a row finishes', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');

    await memory.settle(BASKET, eggs.rowKey, {
      outcome: 'BOUGHT',
      quantity: eggs.left,
      from: eggs.left,
    });

    const basket = await memory.getBasket(BASKET);
    expect(basket.progress.done).toBe(1);
    expect(basket.pending).toBe(1);
  });
});

describe('BasketMemory: settling a row', () => {
  /**
   * Two phones in one shop moving one row is the ordinary case, and a gesture
   * whose meaning depends on where it started must be refused rather than
   * reinterpreted (velista `0054`).
   */
  it('refuses a `from` that is not where the row stands', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    expect(
      await codeOf(
        memory.settle(BASKET, milk.rowKey, {
          outcome: 'BOUGHT',
          quantity: 1,
          from: milk.left + 1,
        })
      )
    ).toBe('stale_quantity');
  });

  /** Oldest entry first, up to what it still asks for, which is the server's rule. */
  it('divides the units oldest entry first when the caller names none', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    await memory.settle(BASKET, milk.rowKey, {
      outcome: 'BOUGHT',
      quantity: 2,
      from: milk.left,
    });

    const after = rowOf(await rowsOf(memory), 'Milk');
    // The anchor asked for two and got both; the second household got none yet.
    expect(after.entries[0].bought).toBe(2);
    expect(after.entries[1].bought).toBe(0);
  });

  it('charges one named entry when the caller allocates by hand', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');
    const second = milk.entries[1];

    await memory.settle(BASKET, milk.rowKey, {
      outcome: 'BOUGHT',
      quantity: 1,
      from: milk.left,
      allocations: [{ lineId: second.lineId, quantity: 1 }],
    });

    const after = rowOf(await rowsOf(memory), 'Milk');
    expect(after.entries[0].bought).toBe(0);
    expect(
      after.entries.find((entry) => entry.lineId === second.lineId)?.bought
    ).toBe(1);
  });

  /**
   * The server does not cap an absent quantity at what the row asks for any more:
   * buying three of a row that says two records three, because the extra unit is
   * real and belongs in the consumption history.
   */
  it('records more than the row asked for rather than capping it', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    await memory.settle(BASKET, milk.rowKey, {
      outcome: 'BOUGHT',
      quantity: milk.left + 2,
      from: milk.left,
    });

    const after = rowOf(await rowsOf(memory), 'Milk');
    expect(after.bought).toBe(milk.left + 2);
    expect(after.left).toBe(0);
  });

  /**
   * A row whose anchor was just bought to zero must not turn the next tap on the
   * same row into a not found, which is why any entry's id addresses it.
   */
  it('answers a write addressed by any entry’s line id', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    const result = await memory.settle(BASKET, milk.entries[1].lineId, {
      outcome: 'BOUGHT',
      quantity: 1,
      from: milk.left,
    });

    expect(result.row.rowKey).toBe(milk.rowKey);
  });

  it('answers the row and the counts, never a delta', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');

    const result = await memory.settle(BASKET, eggs.rowKey, {
      outcome: 'BOUGHT',
      quantity: 1,
      from: eggs.left,
    });

    expect(result.row.content).toBe('Eggs');
    expect(result.progress.total).toBe(3);
    expect(result.pending).toBe(2);
    expect(result.replacedRowKey).toBeNull();
  });

  it('refuses a basket whose trip is over, with a code of its own', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');
    memory.status = 'FINISHED';

    expect(
      await codeOf(
        memory.settle(BASKET, eggs.rowKey, {
          outcome: 'BOUGHT',
          quantity: 1,
          from: eggs.left,
        })
      )
    ).toBe('basket_finished');
  });
});

describe('BasketMemory: taking a row back', () => {
  it('gives units back, newest purchase first', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');

    await memory.revert(BASKET, eggs.rowKey, {
      target: 'UNITS',
      units: 1,
      from: eggs.bought,
    });

    const after = rowOf(await rowsOf(memory), 'Eggs');
    expect(after.bought).toBe(1);
  });

  it('refuses a `from` that is not what the row has bought', async () => {
    const memory = new BasketMemory();
    const eggs = rowOf(await rowsOf(memory), 'Eggs');

    expect(
      await codeOf(
        memory.revert(BASKET, eggs.rowKey, {
          target: 'UNITS',
          units: 1,
          from: eggs.bought + 5,
        })
      )
    ).toBe('stale_quantity');
  });

  /**
   * A close holds no units, so that branch has no number to take back and no
   * `from` to check it against: the two targets are one gesture aimed twice.
   */
  it('takes a close back, which restores the row to what it asks for', async () => {
    const memory = new BasketMemory();
    const bread = rowOf(await rowsOf(memory), 'Sourdough loaf');

    await memory.revert(BASKET, bread.rowKey, { target: 'CLOSE' });

    const after = rowOf(await rowsOf(memory), 'Sourdough loaf');
    expect(after.state).toBe('WANTED');
    expect(after.left).toBe(bread.left);
  });

  it('refuses a close on a row that has none', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    expect(
      await codeOf(memory.revert(BASKET, milk.rowKey, { target: 'CLOSE' }))
    ).toBe('validation_failed');
  });
});

describe('BasketMemory: renaming a row', () => {
  it('renames every line inside the row', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    await memory.renameRow(BASKET, milk.rowKey, { content: 'Whole milk' });

    const after = rowOf(await rowsOf(memory), 'Whole milk');
    expect(after.entries).toHaveLength(2);
  });

  /**
   * A name already on the basket is refused until the same request carries the
   * confirmation, which is backend `0113`'s rule and what the sheet's merge
   * question exists to ask.
   */
  it('refuses a name another row already holds, until the merge is confirmed', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    expect(
      await codeOf(memory.renameRow(BASKET, milk.rowKey, { content: 'Eggs' }))
    ).toBe('line_merge_required');

    const result = await memory.renameRow(BASKET, milk.rowKey, {
      content: 'Eggs',
      confirmMerge: true,
    });
    expect(result.row.content).toBe('Eggs');
  });

  it('refuses a blank name', async () => {
    const memory = new BasketMemory();
    const milk = rowOf(await rowsOf(memory), 'Milk');

    expect(
      await codeOf(memory.renameRow(BASKET, milk.rowKey, { content: '   ' }))
    ).toBe('validation_failed');
  });
});

/**
 * Redaction, which is one collection since backend `0136`: the covered lists this
 * reader holds `WRITE` on, and no others.
 */
describe('BasketMemory: what a reader is served', () => {
  it('serves the covered lists to a reader who writes them', async () => {
    const basket = await new BasketMemory().getBasket(BASKET);

    expect(basket.lists.map((ref) => ref.listId)).toEqual([
      'list-weekly',
      'list-groceries',
    ]);
  });

  /**
   * A guest is served no ref at all, so every entry they hold names no list: they
   * know how much and never where.
   */
  it('serves a guest no list, and no entry they can place', async () => {
    const memory = new BasketMemory();
    memory.servesLists = false;

    const basket = await memory.getBasket(BASKET);

    expect(basket.lists).toEqual([]);
    expect(
      basket.rows.flatMap((row) => row.entries.map((entry) => entry.listId))
    ).toEqual(basket.rows.flatMap((row) => row.entries.map(() => null)));
  });

  /**
   * A list the basket covers but the reader does not write. It is in the fixture
   * so the "Other lists" heading and the unplaceable entry are reachable without a
   * second fake.
   */
  it('leaves an entry on a covered list it served no ref for unplaceable', async () => {
    const basket = await new BasketMemory().getBasket(BASKET);

    const eggs = rowOf(basket.rows, 'Eggs');
    expect(eggs.entries.some((entry) => entry.listId === null)).toBe(true);
  });

  /**
   * Since backend `0163` section 4 a guest picks the shop they are standing in
   * from the same list the owner sees (velista `0102`), so the shops reach them.
   */
  it('serves a guest the same shops the owner sees', async () => {
    const memory = new BasketMemory();
    const owner = await memory.getBasket(BASKET);
    memory.servesLists = false;

    const guest = await memory.getBasket(BASKET);

    expect([...guest.scopes.values()]).toEqual([...owner.scopes.values()]);
    expect(
      [...guest.scopes.values()].some((scope) => scope.locations.length > 0)
    ).toBe(true);
  });

  /** A read at a shop carries what that shop says about every product. */
  it('answers atShop for a read at one of its shops, and none without one', async () => {
    const memory = new BasketMemory();

    const anywhere = await memory.getBasket(BASKET);
    const atShop = await memory.getBasket(BASKET, 'loc-dia-victoria');

    expect([...anywhere.products.values()].map((item) => item.atShop)).toEqual(
      [...anywhere.products.values()].map(() => null)
    );
    const milk = atShop.products.get('item-milk-hacendado');
    expect(milk?.atShop).toEqual({
      priceScopeId: milk?.offers.find((item) => item.price === 1.05)
        ?.priceScopeId,
      price: 1.05,
      currency: 'EUR',
      available: null,
    });
  });
});

describe('BasketMemory: what a row says about approval', () => {
  /**
   * A line raised onto a list that vets its lines is waiting, and the row is the
   * only thing standing there to say so. It stays buyable either way (backend
   * `0130`, section 3).
   */
  it('says a row is awaiting approval while any entry is', async () => {
    const rows = await rowsOf(new BasketMemory());

    const milk = rowOf(rows, 'Milk');
    expect(milk.awaitingApproval).toBe(true);
    expect(milk.entries.some((entry) => entry.awaitingApproval)).toBe(true);
    // And still a thing to buy.
    expect(milk.state).toBe('WANTED');
  });

  it('says nothing about approval on a row every household agreed to', async () => {
    expect(
      rowOf(await rowsOf(new BasketMemory()), 'Sourdough loaf').awaitingApproval
    ).toBe(false);
  });

  /**
   * No client can compute it: a reader never learns the owner's permissions, and a
   * guest has none of their own to ask about. So the server answers, per entry.
   */
  it('serves demandEditable per entry', async () => {
    const eggs = rowOf(await rowsOf(new BasketMemory()), 'Eggs');

    expect(eggs.entries.map((entry) => entry.demandEditable)).toEqual([
      true,
      false,
    ]);
  });
});

/**
 * A skip, its window, and what ends it (velista `0092`, section 3; backend
 * `0137`).
 *
 * The clock is the point of these. A skip is the one write on this screen whose
 * effect **expires**: twelve hours later the row is ordinary again and carries a
 * note saying when it was put off. `BasketMemory.now` is what lets a spec walk
 * past that edge, and without it only the half that happens immediately could be
 * tested at all.
 */
describe('BasketMemory: putting a row off for now', () => {
  const NOON = new Date('2026-09-01T12:00:00.000Z');

  function at(when: Date): BasketMemory {
    const memory = new BasketMemory();
    memory.now = () => when;
    return memory;
  }

  it('makes the row SKIPPED, with nothing bought and nothing closed', async () => {
    const memory = at(NOON);
    await memory.skip(BASKET, 'zl-3');

    const eggs = rowOf(await rowsOf(memory), 'Eggs');
    expect(eggs.state).toBe('SKIPPED');
    // The list did not move and nothing was bought: a skip is a state of the row
    // on this trip and never an outcome of a settle. Two households ask for the
    // eggs, ten and two, and one purchase of two stands against the first.
    expect(eggs.left).toBe(12);
    expect(eggs.bought).toBe(2);
  });

  it('leaves a skipped row pending, which is what the counts say', async () => {
    const memory = at(NOON);
    const before = (await memory.getLiveSummary()).pending;
    await memory.skip(BASKET, 'zl-3');

    // It counts toward no `done` and toward no `unavailable`, so the number of
    // things still to buy does not move. Somebody walking past the bread has not
    // finished with the bread.
    expect((await memory.getLiveSummary()).pending).toBe(before);
  });

  it('takes the skip back on the same row', async () => {
    const memory = at(NOON);
    await memory.skip(BASKET, 'zl-3');
    await memory.unskip(BASKET, 'zl-3');

    expect(rowOf(await rowsOf(memory), 'Eggs').state).toBe('PARTLY');
  });

  it('refuses a skip on a row with nothing left to get', async () => {
    // What stands in for the `from` every other row write carries: a row already
    // bought out is not one anybody is walking past.
    const memory = at(NOON);
    await memory.settle(BASKET, 'zl-1', {
      outcome: 'BOUGHT',
      quantity: 3,
      from: 3,
    });

    expect(await codeOf(memory.skip(BASKET, 'zl-1'))).toBe('conflict');
  });

  it('is ordinary again once the window has passed, and says when', async () => {
    const memory = at(NOON);
    await memory.skip(BASKET, 'zl-1');

    // Thirteen hours later, by the server\u2019s clock and never the browser\u2019s.
    memory.now = () => new Date(NOON.getTime() + 13 * 60 * 60 * 1000);

    const milk = rowOf(await rowsOf(memory), 'Milk');
    expect(milk.state).toBe('WANTED');
    expect(milk.note).toBe('SKIPPED_EARLIER');
    expect(milk.noteAt?.toISOString()).toBe(NOON.toISOString());
  });

  it('holds the state right up to the edge of the window', async () => {
    const memory = at(NOON);
    await memory.skip(BASKET, 'zl-1');

    memory.now = () =>
      new Date(NOON.getTime() + 12 * 60 * 60 * 1000 - 1000);

    expect(rowOf(await rowsOf(memory), 'Milk').state).toBe('SKIPPED');
  });

  it('ends a skip with the first purchase, note and all', async () => {
    const memory = at(NOON);
    await memory.skip(BASKET, 'zl-1');
    memory.now = () => new Date(NOON.getTime() + 13 * 60 * 60 * 1000);

    // The purchase is what ends it, so the note goes with it: a person who
    // skipped the bread and then found it buys it, and the row has nothing left
    // to say about having been walked past.
    await memory.settle(BASKET, 'zl-1', {
      outcome: 'BOUGHT',
      quantity: 3,
      from: 3,
    });

    const milk = rowOf(await rowsOf(memory), 'Milk');
    expect(milk.state).toBe('DONE');
    expect(milk.note).toBeNull();
    expect(milk.noteAt).toBeNull();
  });
});

/**
 * Changing what a list asks for (velista `0092`, section 6).
 *
 * Three refusals and one disappearance, and each of the four is a rule the
 * screen rests on rather than a branch of this fake.
 */
describe('BasketMemory: what a list asks for', () => {
  it('moves one household\u2019s ask and leaves the other alone', async () => {
    const memory = new BasketMemory();
    await memory.setDemand(BASKET, 'zl-1', {
      lineId: 'zl-1',
      quantity: 5,
      from: 2,
    });

    const milk = rowOf(await rowsOf(memory), 'Milk');
    expect(milk.entries[0].left).toBe(5);
    // The other household asked for one and still asks for one: a row is two
    // lists, and this write names one of them.
    expect(milk.entries[1].left).toBe(1);
  });

  it('refuses a `from` that is not where the entry stands', async () => {
    const memory = new BasketMemory();
    expect(
      await codeOf(
        memory.setDemand(BASKET, 'zl-1', {
          lineId: 'zl-1',
          quantity: 5,
          from: 9,
        })
      )
    ).toBe('stale_quantity');
  });

  it('refuses an entry the owner may not change', async () => {
    // The one field no client can compute: the rule is asked of the basket\u2019s
    // owner on the entry\u2019s list, and a reader never learns those permissions.
    const memory = new BasketMemory();
    expect(
      await codeOf(
        memory.setDemand(BASKET, 'zl-5', {
          lineId: 'zl-5',
          quantity: 1,
          from: 2,
        })
      )
    ).toBe('forbidden');
  });

  it('allows zero, which is the line asking for nothing', async () => {
    const memory = new BasketMemory();
    // Zero is not a removal: the line stays on its list asking for nothing,
    // which is backend `0047`\u2019s "stocked". The row stays too, because the other
    // household on it still asks for two.
    await memory.setDemand(BASKET, 'zl-3', {
      lineId: 'zl-3',
      quantity: 0,
      from: 10,
    });

    const eggs = rowOf(await rowsOf(memory), 'Eggs');
    expect(eggs.entries[0].left).toBe(0);
    expect(eggs.left).toBe(2);
  });

  it('answers no row when nothing is left of it and nothing was bought', async () => {
    const memory = new BasketMemory();
    // The loaf: one household, one unit, and this basket bought none of it.
    // Taking the ask to zero leaves nothing to buy, so the row is not a thing to
    // buy any more and it leaves the view.
    const result = await memory.setDemand(BASKET, 'zl-4', {
      lineId: 'zl-4',
      quantity: 0,
      from: 1,
    });

    expect(result.row).toBeNull();
    expect(
      (await rowsOf(memory)).some((row) => row.content === 'Sourdough loaf')
    ).toBe(false);
  });
});

/** Adding a line, which names a list and goes through that list\u2019s own rules. */
describe('BasketMemory: adding a line', () => {
  it('puts a new line on the named list and answers its row', async () => {
    const memory = new BasketMemory();
    const result = await memory.addLine(BASKET, {
      targetListId: 'list-weekly',
      content: 'Batteries',
      quantity: 1,
    });

    expect(result.row?.content).toBe('Batteries');
    expect(result.row?.entries[0].listId).toBe('list-weekly');
  });

  it('merges onto a line the list already holds, under its own key', async () => {
    // The list\u2019s own add merges by the same key (backend `0091`), so the answer
    // is a row that was already on the screen under a key nobody named. That is
    // exactly what the store has to fold correctly.
    const memory = new BasketMemory();
    const result = await memory.addLine(BASKET, {
      targetListId: 'list-weekly',
      content: '  milk ',
      quantity: 2,
    });

    expect(result.row?.rowKey).toBe('zl-1');
    expect(result.row?.entries[0].left).toBe(4);
  });

  it('refuses a list this reader was not served', async () => {
    const memory = new BasketMemory();
    expect(
      await codeOf(
        memory.addLine(BASKET, {
          targetListId: 'list-office',
          content: 'Paper',
          quantity: 1,
        })
      )
    ).toBe('forbidden');
  });

  it('refuses an add on a finished trip', async () => {
    const memory = new BasketMemory();
    memory.status = 'FINISHED';
    expect(
      await codeOf(
        memory.addLine(BASKET, {
          targetListId: 'list-weekly',
          content: 'Batteries',
          quantity: 1,
        })
      )
    ).toBe('basket_finished');
  });
});
