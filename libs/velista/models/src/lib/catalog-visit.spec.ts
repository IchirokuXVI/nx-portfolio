import {
  firstAddTarget,
  isCatalogUrl,
  visitAddition,
  visitAfterAdd,
  visitAfterStep,
  visitFloor,
  visitSections,
  visitTakeBack,
  visitWithout,
  type AddTargetList,
  type CatalogVisit,
  type VisitAddition,
  type VisitLineState,
  type VisitList,
  type VisitProduct,
} from './catalog-visit';

const MILK: VisitProduct = {
  listId: 'weekly',
  itemId: 'milk',
  detail: '1 L · 1,09 € at Carrefour',
};

const NAME = 'Leche semidesnatada';

function list(listId: string, overrides: Partial<AddTargetList> = {}) {
  return {
    listId,
    zoneId: 'home',
    name: listId,
    zoneName: 'Home',
    wanted: 0,
    permissions: ['READ', 'WRITE', 'DECIDE'],
    autoApproveLines: false,
    ...overrides,
  } satisfies AddTargetList;
}

function line(overrides: Partial<VisitLineState> = {}): VisitLineState {
  return {
    lineId: 'line-1',
    name: NAME,
    quantity: 1,
    pending: false,
    ...overrides,
  };
}

function entry(overrides: Partial<VisitAddition> = {}): VisitAddition {
  return {
    ...MILK,
    lineId: 'line-1',
    name: NAME,
    quantity: 1,
    before: 0,
    created: true,
    pending: false,
    ...overrides,
  };
}

describe('the record of a visit', () => {
  it('starts an entry for a new line at nothing before, made by the visit', () => {
    const visit = visitAfterAdd([], MILK, line(), false);

    expect(visit).toEqual([entry()]);
  });

  it('works out what a merged line held before from the answer', () => {
    const visit = visitAfterAdd(
      [],
      MILK,
      line({ lineId: 'line-9', quantity: 3 }),
      true
    );

    expect(visit[0]).toMatchObject({
      lineId: 'line-9',
      quantity: 3,
      before: 2,
      created: false,
    });
  });

  it('takes off as many as the add put on a merged line', () => {
    const visit = visitAfterAdd(
      [],
      MILK,
      line({ lineId: 'line-9', quantity: 5 }),
      true,
      3
    );

    expect(visit[0]).toMatchObject({ quantity: 5, before: 2 });
  });

  it('keeps what was before when the same line is added to again', () => {
    const first = visitAfterAdd(
      [],
      MILK,
      line({ lineId: 'line-9', quantity: 3 }),
      true
    );
    const second = visitAfterAdd(
      first,
      MILK,
      line({ lineId: 'line-9', quantity: 4 }),
      true
    );

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ quantity: 4, before: 2, created: false });
  });

  it('keeps one entry for each line, also for two lines of one list', () => {
    // A list can hold a product twice: under its own name and under a typed one.
    const visit = visitAfterAdd(
      [entry()],
      MILK,
      line({ lineId: 'line-2', name: 'Milk for the coffee' }),
      false
    );

    expect(visit.map((held) => held.lineId)).toEqual(['line-1', 'line-2']);
    expect(visitAddition(visit, 'line-2')?.name).toBe('Milk for the coffee');
    expect(visitAddition(visit, 'line-3')).toBeNull();
  });

  it('records a line that waits for approval', () => {
    const visit = visitAfterAdd([], MILK, line({ pending: true }), false);

    expect(visit[0].pending).toBe(true);
  });

  it('drops one line and leaves the others alone', () => {
    const visit: CatalogVisit = [
      entry(),
      entry({ lineId: 'line-2', listId: 'barbecue' }),
      entry({ lineId: 'line-3', itemId: 'bread' }),
    ];

    expect(visitWithout(visit, 'line-1').map((held) => held.lineId)).toEqual([
      'line-2',
      'line-3',
    ]);
  });
});

describe('the record after a stepper moved a line', () => {
  it('moves a line the visit raised and keeps what was before', () => {
    const visit: CatalogVisit = [
      entry({ lineId: 'line-9', before: 2, created: false, quantity: 3 }),
      entry(),
    ];

    const moved = visitAfterStep(
      visit,
      MILK,
      line({ lineId: 'line-9', quantity: 5, pending: true }),
      3
    );

    expect(moved[0]).toMatchObject({
      quantity: 5,
      before: 2,
      created: false,
      pending: true,
    });
    expect(moved[1]).toEqual(entry());
  });

  it('drops a raised line that is back at what it held before', () => {
    const visit: CatalogVisit = [
      entry({ lineId: 'line-9', before: 2, created: false, quantity: 3 }),
    ];

    expect(
      visitAfterStep(visit, MILK, line({ lineId: 'line-9', quantity: 2 }), 3)
    ).toEqual([]);
  });

  it('drops a raised line that went under what it held before', () => {
    const visit: CatalogVisit = [
      entry({ lineId: 'line-9', before: 2, created: false, quantity: 3 }),
    ];

    expect(
      visitAfterStep(visit, MILK, line({ lineId: 'line-9', quantity: 1 }), 3)
    ).toEqual([]);
  });

  it('drops a line the visit made once it holds nothing', () => {
    expect(
      visitAfterStep([entry({ quantity: 2 })], MILK, line({ quantity: 0 }), 2)
    ).toEqual([]);
  });

  it('adds a line the visit had not touched when it went up, as one that was there', () => {
    const visit = visitAfterStep(
      [],
      MILK,
      line({ lineId: 'line-9', quantity: 4 }),
      3
    );

    // It was there before, so taking it back lowers it and never deletes it.
    expect(visit).toEqual([
      entry({ lineId: 'line-9', quantity: 4, before: 3, created: false }),
    ]);
  });

  it('leaves out a line the visit had not touched that went down or stayed', () => {
    const visit: CatalogVisit = [entry()];

    for (const quantity of [2, 3]) {
      expect(
        visitAfterStep(visit, MILK, line({ lineId: 'line-9', quantity }), 3)
      ).toBe(visit);
    }
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
  function on(
    permissions: VisitList['permissions'],
    autoApproveLines = false
  ): VisitList {
    return { permissions, autoApproveLines };
  }

  const manages = on(['READ', 'WRITE', 'DECIDE', 'MANAGE']);
  const decides = on(['READ', 'WRITE', 'DECIDE']);
  const writes = on(['READ', 'WRITE']);
  const writesUnasked = on(['READ', 'WRITE'], true);

  it('deletes a line the visit made', () => {
    expect(visitTakeBack(entry({ quantity: 2 }), manages)).toEqual({
      kind: 'delete',
      lineId: 'line-1',
    });
  });

  it('lowers a merged line by what the visit added, by a signed change', () => {
    expect(
      visitTakeBack(
        entry({ before: 2, created: false, quantity: 5, lineId: 'line-9' }),
        manages
      )
    ).toEqual({ kind: 'lower', lineId: 'line-9', by: 3 });
  });

  it('never deletes a line that was there before, whoever asks', () => {
    for (const asks of [manages, decides, writes, writesUnasked]) {
      expect(
        visitTakeBack(
          entry({ before: 1, created: false, quantity: 2, pending: true }),
          asks
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

  it('deletes its own approved line with write alone on a list that approves by itself', () => {
    // Nobody agreed to the line there, so nothing is undone behind anybody's back.
    expect(visitTakeBack(entry(), writesUnasked)).toEqual({
      kind: 'delete',
      lineId: 'line-1',
    });
  });

  it('lowers an approved line it made to nothing when it cannot delete it', () => {
    // Deciding is not managing: an approved line somebody agreed to stays a line.
    for (const asks of [decides, writes]) {
      expect(visitTakeBack(entry({ quantity: 2 }), asks)).toEqual({
        kind: 'lower',
        lineId: 'line-1',
        by: 2,
      });
    }
  });
});

describe('the sheet of what a visit added', () => {
  const visit: CatalogVisit = [
    entry({ lineId: 'line-2', listId: 'barbecue' }),
    entry(),
    entry({ lineId: 'line-3', itemId: 'bread' }),
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
    '/en/catalog?chain=m&order=price',
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
