import {
  addedToLine,
  canDeleteLine,
  canStepLine,
  holdingRows,
  isUnsavedLine,
  lastListId,
  productListGroups,
  sameLineName,
  unsavedLineId,
  type HeldLine,
  type ItemList,
} from './catalog-holdings';

const MANAGES = ['READ', 'WRITE', 'DECIDE', 'MANAGE'] as const;
const DECIDES = ['READ', 'WRITE', 'DECIDE'] as const;
const WRITES = ['READ', 'WRITE'] as const;
const READS = ['READ'] as const;

const NAME = 'Leche semidesnatada';

function line(lineId: string, overrides: Partial<HeldLine> = {}): HeldLine {
  return {
    lineId,
    listId: 'weekly',
    name: NAME,
    quantity: 1,
    pending: false,
    itemIds: ['milk'],
    ...overrides,
  };
}

function list(listId: string, overrides: Partial<ItemList> = {}): ItemList {
  return {
    listId,
    zoneId: 'home',
    name: listId,
    zoneName: 'Home',
    autoApproveLines: false,
    permissions: DECIDES,
    ...overrides,
  };
}

describe('who may move the quantity of a line', () => {
  it('is always somebody who manages the list', () => {
    expect(canStepLine(['READ', 'MANAGE'], false)).toBe(true);
    expect(canStepLine(['READ', 'MANAGE'], true)).toBe(true);
  });

  it('needs to decide for an approved line', () => {
    expect(canStepLine(DECIDES, false)).toBe(true);
    expect(canStepLine(WRITES, false)).toBe(false);
  });

  it('needs to write for a line that still waits', () => {
    expect(canStepLine(WRITES, true)).toBe(true);
    // Deciding alone does not write: the waiting line belongs to who asked.
    expect(canStepLine(['READ', 'DECIDE'], true)).toBe(false);
  });

  it('is never somebody who only reads', () => {
    expect(canStepLine(READS, false)).toBe(false);
    expect(canStepLine(READS, true)).toBe(false);
  });
});

describe('who may delete a line', () => {
  it('is always somebody who manages the list', () => {
    for (const autoApproveLines of [false, true]) {
      for (const pending of [false, true]) {
        expect(canDeleteLine(MANAGES, autoApproveLines, pending)).toBe(true);
      }
    }
  });

  it('is somebody who writes, for a line that still waits', () => {
    expect(canDeleteLine(WRITES, false, true)).toBe(true);
  });

  it('is somebody who writes, on a list that approves lines by itself', () => {
    expect(canDeleteLine(WRITES, true, false)).toBe(true);
  });

  it('is not somebody who writes, for a line that somebody approved', () => {
    expect(canDeleteLine(WRITES, false, false)).toBe(false);
    // Deciding approves a line. It does not delete one.
    expect(canDeleteLine(DECIDES, false, false)).toBe(false);
  });

  it('is never somebody who cannot write', () => {
    expect(canDeleteLine(READS, true, true)).toBe(false);
    expect(canDeleteLine(['READ', 'DECIDE'], true, true)).toBe(false);
  });
});

describe('the last used list', () => {
  it('is the second part of what was stored', () => {
    expect(lastListId('home/weekly')).toBe('weekly');
  });

  it('is nothing when nothing was stored, or no list was', () => {
    expect(lastListId(null)).toBeNull();
    expect(lastListId('home')).toBeNull();
  });
});

describe('the lines of a list that hold a product', () => {
  const lines = [
    line('line-1'),
    line('line-2', { listId: 'barbecue' }),
    line('line-3', { itemIds: ['bread'] }),
    line('line-4', { name: 'Milk for the coffee', quantity: 3, pending: true }),
    line('line-5', { itemIds: ['oat-milk', 'milk'] }),
  ];

  it('keeps the lines of that list and that product, in the order handed over', () => {
    expect(
      holdingRows(lines, 'weekly', 'milk', DECIDES).map((row) => row.lineId)
    ).toEqual(['line-1', 'line-4', 'line-5']);
  });

  it('draws each line with its own name, quantity and state', () => {
    expect(holdingRows(lines, 'weekly', 'milk', DECIDES)[1]).toEqual({
      lineId: 'line-4',
      name: 'Milk for the coffee',
      quantity: 3,
      editable: true,
      pending: true,
    });
  });

  it('lets a person move only the lines the server would let them move', () => {
    // Write alone moves the waiting line and not the approved ones.
    expect(
      holdingRows(lines, 'weekly', 'milk', WRITES).map((row) => row.editable)
    ).toEqual([false, true, false]);
  });

  it('has no row for a list that does not hold the product', () => {
    expect(holdingRows(lines, 'weekly', 'eggs', MANAGES)).toEqual([]);
    expect(holdingRows(lines, 'party', 'milk', MANAGES)).toEqual([]);
  });

  it('holds a line still until its add answered, whoever asks', () => {
    const unsaved = line(unsavedLineId('weekly', 'milk'), { pending: true });

    expect(holdingRows([unsaved], 'weekly', 'milk', MANAGES)).toEqual([
      expect.objectContaining({ lineId: unsaved.lineId, editable: false }),
    ]);
  });
});

describe('the id of a line drawn before its add answered', () => {
  it('is its own for each list and each product', () => {
    expect(unsavedLineId('weekly', 'milk')).not.toBe(
      unsavedLineId('weekly', 'bread')
    );
    expect(unsavedLineId('weekly', 'milk')).not.toBe(
      unsavedLineId('barbecue', 'milk')
    );
  });

  it('is told apart from an id the server gave', () => {
    expect(isUnsavedLine(unsavedLineId('weekly', 'milk'))).toBe(true);
    expect(isUnsavedLine('7d0b1c7e-3b0f-4b53-9d0a-0c3f6a2f6a11')).toBe(false);
  });
});

describe('sameLineName', () => {
  it('is true for the same words', () => {
    expect(sameLineName(NAME, NAME)).toBe(true);
  });

  it('does not make another name of the case or the spaces around it', () => {
    expect(sameLineName('  leche SEMIDESNATADA ', NAME)).toBe(true);
  });

  it('is false for another name, also one that starts the same', () => {
    expect(sameLineName('Leche', NAME)).toBe(false);
    expect(sameLineName(`${NAME} sin lactosa`, NAME)).toBe(false);
  });

  it('keeps an accent, which a person reads as another letter', () => {
    expect(sameLineName('Cafe molido', 'Café molido')).toBe(false);
  });
});

describe('the line an add of a product lands on', () => {
  it('is the line that says the name of the product and is still wanted', () => {
    const wanted = line('line-2', { quantity: 2 });

    expect(
      addedToLine([line('line-1', { name: 'For the cake' }), wanted], NAME)
    ).toBe(wanted);
  });

  it('is not a line at zero, which the server leaves stocked and adds beside', () => {
    expect(addedToLine([line('line-1', { quantity: 0 })], NAME)).toBeNull();
  });

  it('is the wanted line when a stocked one of the same name comes first', () => {
    const wanted = line('line-2');

    expect(addedToLine([line('line-1', { quantity: 0 }), wanted], NAME)).toBe(
      wanted
    );
  });

  it('does not make another name of the case or the spaces around it', () => {
    const typed = line('line-1', { name: '  leche SEMIDESNATADA ' });

    expect(addedToLine([typed], ` ${NAME.toUpperCase()}  `)).toBe(typed);
  });

  it('is nothing with no line of that name, or with no line', () => {
    expect(addedToLine([line('line-1', { name: 'Leche' })], NAME)).toBeNull();
    expect(addedToLine([], NAME)).toBeNull();
  });
});

describe('the table of lists of a product page', () => {
  const lists = [
    list('weekly'),
    list('barbecue'),
    list('office', { zoneId: 'work', zoneName: 'Work' }),
    list('snacks', { zoneId: 'work', zoneName: 'Work' }),
  ];

  function groups(
    lines: readonly HeldLine[] = [],
    lastList: string | null = null,
    read: readonly ItemList[] = lists
  ) {
    return productListGroups(read, lines, 'milk', NAME, lastList);
  }

  it('puts every list under the name of its group, in the order read', () => {
    expect(
      groups().map((group) => [
        group.zoneId,
        group.zoneName,
        group.lists.map((row) => row.listId),
      ])
    ).toEqual([
      ['home', 'Home', ['weekly', 'barbecue']],
      ['work', 'Work', ['office', 'snacks']],
    ]);
  });

  it('puts the group of the last used list first, and that list first in it', () => {
    const table = groups([], 'work/snacks');

    expect(table.map((group) => group.lists.map((row) => row.listId))).toEqual([
      ['snacks', 'office'],
      ['weekly', 'barbecue'],
    ]);
    expect(
      table.flatMap((group) => group.lists).map((row) => row.lastUsed)
    ).toEqual([true, false, false, false]);
  });

  it('marks no list when the last used one is not among them', () => {
    const table = groups([], 'home/deleted');

    expect(table.map((group) => group.zoneId)).toEqual(['home', 'work']);
    expect(
      table.flatMap((group) => group.lists).some((row) => row.lastUsed)
    ).toBe(false);
  });

  describe('the start value of the stepper of a list', () => {
    it('is the line that says exactly the name of the product', () => {
      const [home] = groups([
        line('line-1', { quantity: 2 }),
        line('line-2', { listId: 'barbecue', name: `  ${NAME.toUpperCase()}` }),
      ]);

      expect(home.lists[0].main).toEqual({
        lineId: 'line-1',
        name: NAME,
        quantity: 2,
        editable: true,
        pending: false,
      });
      expect(home.lists[0].others).toEqual([]);
      expect(home.lists[1].main?.lineId).toBe('line-2');
    });

    it('is nothing with no such line, which starts the stepper at zero', () => {
      const [home] = groups([line('line-1', { listId: 'barbecue' })]);

      expect(home.lists[0].main).toBeNull();
      expect(home.lists[0].others).toEqual([]);
    });

    it('is not a line that holds the product under another name', () => {
      const [home] = groups([
        line('line-1', { name: 'Milk for the coffee', quantity: 3 }),
      ]);

      expect(home.lists[0].main).toBeNull();
      expect(home.lists[0].others.map((row) => row.quantity)).toEqual([3]);
    });

    it('is not a stocked line of that name, which goes on a row of its own', () => {
      // An add does not raise a line at zero. It makes a line beside it, so the
      // stepper of the list starts at zero and the stocked line keeps its row.
      const [home] = groups([line('line-1', { quantity: 0 })]);

      expect(home.lists[0].main).toBeNull();
      expect(home.lists[0].others).toEqual([
        {
          lineId: 'line-1',
          name: NAME,
          quantity: 0,
          editable: true,
          pending: false,
        },
      ]);
    });

    it('is the wanted line of that name when a stocked one stands before it', () => {
      const [home] = groups([
        line('line-1', { quantity: 0 }),
        line('line-2', { quantity: 1 }),
      ]);

      expect(home.lists[0].main?.lineId).toBe('line-2');
      expect(home.lists[0].others.map((row) => row.lineId)).toEqual(['line-1']);
    });

    it('is not a line of that name that holds another product', () => {
      const [home] = groups([line('line-1', { itemIds: ['bread'] })]);

      expect(home.lists[0].main).toBeNull();
    });
  });

  it('puts each line under another name on its own row, beside the main one', () => {
    const [home] = groups([
      line('line-1', { name: 'Milk for the coffee' }),
      line('line-2', { quantity: 2 }),
      line('line-3', { name: 'For the cake', pending: true }),
    ]);

    expect(home.lists[0].main?.lineId).toBe('line-2');
    expect(home.lists[0].others.map((row) => row.lineId)).toEqual([
      'line-1',
      'line-3',
    ]);
  });

  it('keeps one main line when two lines say the name of the product', () => {
    const [home] = groups([line('line-1'), line('line-2', { quantity: 4 })]);

    expect(home.lists[0].main?.lineId).toBe('line-1');
    expect(home.lists[0].others.map((row) => row.lineId)).toEqual(['line-2']);
  });

  it('lets a person add to a list they can write to, and to no other', () => {
    const [home] = groups([], null, [
      list('weekly', { permissions: WRITES }),
      list('barbecue', { permissions: READS }),
      list('party', { permissions: ['READ', 'DECIDE'] }),
    ]);

    expect(home.lists.map((row) => row.canAdd)).toEqual([true, false, false]);
  });

  it('holds the lines of a list still for a person who only reads it', () => {
    const [home] = groups(
      [line('line-1'), line('line-2', { name: 'For the cake' })],
      null,
      [list('weekly', { permissions: READS })]
    );

    expect(home.lists[0].main?.editable).toBe(false);
    expect(home.lists[0].others[0].editable).toBe(false);
  });

  it('is empty for a person with no list', () => {
    expect(groups([line('line-1')], 'home/weekly', [])).toEqual([]);
  });
});
