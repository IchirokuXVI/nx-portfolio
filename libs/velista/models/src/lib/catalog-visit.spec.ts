import {
  firstAddTarget,
  isCatalogUrl,
  visitAddition,
  visitAfterAdd,
  visitAfterQuantity,
  visitFloor,
  visitSections,
  visitTakeBack,
  visitWithout,
  type AddTargetList,
  type CatalogVisit,
  type VisitAddition,
} from './catalog-visit';

const MILK = {
  listId: 'weekly',
  itemId: 'milk',
  name: 'Leche semidesnatada',
  detail: '1 L · 1,09 € at Carrefour',
};

function list(listId: string, overrides: Partial<AddTargetList> = {}) {
  return {
    listId,
    zoneId: 'home',
    name: listId,
    zoneName: 'Home',
    wanted: 0,
    permissions: ['READ', 'WRITE', 'DECIDE'],
    ...overrides,
  } satisfies AddTargetList;
}

function entry(overrides: Partial<VisitAddition> = {}): VisitAddition {
  return {
    ...MILK,
    lineId: 'line-1',
    quantity: 1,
    before: 0,
    created: true,
    pending: false,
    ...overrides,
  };
}

describe('the record of a visit', () => {
  it('starts an entry for a new line at nothing before, made by the visit', () => {
    const visit = visitAfterAdd(
      [],
      MILK,
      { lineId: 'line-1', quantity: 1, pending: false },
      false
    );

    expect(visit).toEqual([entry()]);
  });

  it('works out what a merged line held before from the answer', () => {
    const visit = visitAfterAdd(
      [],
      MILK,
      { lineId: 'line-9', quantity: 3, pending: false },
      true
    );

    expect(visit[0]).toMatchObject({
      lineId: 'line-9',
      quantity: 3,
      before: 2,
      created: false,
    });
  });

  it('keeps what was before when the same product is added again', () => {
    const first = visitAfterAdd(
      [],
      MILK,
      { lineId: 'line-9', quantity: 3, pending: false },
      true
    );
    const second = visitAfterAdd(
      first,
      MILK,
      { lineId: 'line-9', quantity: 4, pending: false },
      true
    );

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ quantity: 4, before: 2, created: false });
  });

  it('keeps one entry for each list a product was added to', () => {
    const visit = visitAfterAdd(
      [entry()],
      { ...MILK, listId: 'barbecue' },
      { lineId: 'line-2', quantity: 1, pending: false },
      false
    );

    expect(visit.map((held) => held.listId)).toEqual(['weekly', 'barbecue']);
    expect(visitAddition(visit, 'barbecue', 'milk')?.lineId).toBe('line-2');
    expect(visitAddition(visit, 'weekly', 'bread')).toBeNull();
  });

  it('records a line that waits for approval', () => {
    const visit = visitAfterAdd(
      [],
      MILK,
      { lineId: 'line-1', quantity: 1, pending: true },
      false
    );

    expect(visit[0].pending).toBe(true);
  });

  it('moves the quantity of one entry and leaves the others alone', () => {
    const visit: CatalogVisit = [entry(), entry({ itemId: 'bread' })];

    const moved = visitAfterQuantity(visit, 'weekly', 'milk', {
      lineId: 'line-1',
      quantity: 2,
      pending: false,
    });

    expect(moved.map((held) => held.quantity)).toEqual([2, 1]);
  });

  it('drops one product from one list', () => {
    const visit: CatalogVisit = [
      entry(),
      entry({ listId: 'barbecue' }),
      entry({ itemId: 'bread' }),
    ];

    expect(
      visitWithout(visit, 'weekly', 'milk').map(
        (held) => `${held.listId}/${held.itemId}`
      )
    ).toEqual(['barbecue/milk', 'weekly/bread']);
  });
});

describe('the floor of the stepper', () => {
  it('is one for a line the visit made', () => {
    expect(visitFloor(entry())).toBe(1);
  });

  it('is one more than the line held before the visit', () => {
    expect(visitFloor(entry({ before: 2, created: false, quantity: 3 }))).toBe(
      3
    );
  });
});

describe('taking a product back', () => {
  const manages = ['READ', 'WRITE', 'DECIDE', 'MANAGE'] as const;
  const decides = ['READ', 'WRITE', 'DECIDE'] as const;
  const writes = ['READ', 'WRITE'] as const;

  it('deletes a line the visit made', () => {
    expect(visitTakeBack(entry({ quantity: 2 }), manages)).toEqual({
      kind: 'delete',
      lineId: 'line-1',
    });
  });

  it('puts a merged line back to the quantity it had, by a signed change', () => {
    expect(
      visitTakeBack(
        entry({ before: 2, created: false, quantity: 5, lineId: 'line-9' }),
        manages
      )
    ).toEqual({ kind: 'lower', lineId: 'line-9', by: 3 });
  });

  it('never deletes a line that was there before, whoever asks', () => {
    for (const permissions of [manages, decides, writes]) {
      expect(
        visitTakeBack(
          entry({ before: 1, created: false, quantity: 2 }),
          permissions
        ).kind
      ).toBe('lower');
    }
  });

  it('deletes its own line while it waits for approval, with write alone', () => {
    expect(visitTakeBack(entry({ pending: true }), writes)).toEqual({
      kind: 'delete',
      lineId: 'line-1',
    });
  });

  it('lowers an approved line it made to nothing when it cannot delete it', () => {
    // The server lets only somebody who manages the list delete an approved line.
    expect(visitTakeBack(entry({ quantity: 2 }), decides)).toEqual({
      kind: 'lower',
      lineId: 'line-1',
      by: 2,
    });
  });
});

describe('the sheet of what a visit added', () => {
  const visit: CatalogVisit = [
    entry({ listId: 'barbecue' }),
    entry(),
    entry({ itemId: 'bread' }),
  ];

  it('puts products of two lists under two headings', () => {
    const sections = visitSections(visit, null);

    expect(sections.map((section) => section.listId)).toEqual([
      'barbecue',
      'weekly',
    ]);
    expect(sections[1].entries.map((held) => held.itemId)).toEqual([
      'milk',
      'bread',
    ]);
  });

  it('puts the chosen list first', () => {
    expect(
      visitSections(visit, 'weekly').map((section) => section.listId)
    ).toEqual(['weekly', 'barbecue']);
  });

  it('has no section for an empty visit', () => {
    expect(visitSections([], 'weekly')).toEqual([]);
  });
});

describe('the list the plus adds to first', () => {
  const lists = [list('weekly'), list('barbecue')];

  it('is the last used list', () => {
    expect(firstAddTarget(lists, 'home/barbecue')?.listId).toBe('barbecue');
  });

  it('is the first list when the last used one is gone or cannot be written', () => {
    expect(firstAddTarget(lists, 'home/deleted')?.listId).toBe('weekly');
  });

  it('is the first list when nothing was stored', () => {
    expect(firstAddTarget(lists, null)?.listId).toBe('weekly');
  });

  it('is nothing for a person with no list to write to', () => {
    expect(firstAddTarget([], 'home/weekly')).toBeNull();
  });
});

describe('isCatalogUrl', () => {
  it.each([
    '/en/catalog',
    '/en/catalog?chain=m&order=name',
    '/velista/es/catalog/products/abc',
    '/en/catalog/categories/drinks',
    '/en/catalog/sheet/added',
    '/en/catalog/products/abc/sheet/add-list#top',
  ])('is true under the catalog: %s', (url) => {
    expect(isCatalogUrl(url)).toBe(true);
  });

  it.each([
    '/en/home',
    '/en/shopping-lists/live',
    '/velista/en/zones/z1/lists/l1',
    '/en/home?from=catalog',
  ])('is false anywhere else: %s', (url) => {
    expect(isCatalogUrl(url)).toBe(false);
  });
});
