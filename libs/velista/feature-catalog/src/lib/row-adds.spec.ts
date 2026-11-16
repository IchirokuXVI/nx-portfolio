import { UrlSegment, type ActivatedRouteSnapshot } from '@angular/router';
import {
  unsavedLineId,
  type AddTargetList,
  type HeldLine,
} from '@portfolio/velista/models';
import {
  addFailedCopy,
  coveredPageUrl,
  rowAdds as rowAddsOf,
} from './row-adds';

/** The list's URL as the pages build it, for a product already on it. */
const pathOf = (target: AddTargetList) =>
  `/en/zones/${target.zoneId}/lists/${target.listId}`;

function rowAdds(
  target: AddTargetList | null,
  held: readonly HeldLine[],
  productOf?: Parameters<typeof rowAddsOf>[3]
) {
  return rowAddsOf(target, held, pathOf, productOf);
}

const WEEKLY: AddTargetList = {
  listId: 'list-weekly',
  zoneId: 'zone-home',
  name: 'Weekly shop',
  zoneName: 'Home',
  wanted: 14,
  permissions: ['READ', 'WRITE', 'MANAGE'],
  autoApproveLines: true,
};

function line(part: Partial<HeldLine> & Pick<HeldLine, 'lineId'>): HeldLine {
  return {
    listId: 'list-weekly',
    name: 'Extra virgin olive oil',
    quantity: 1,
    unit: 'UNIT',
    pending: false,
    itemIds: ['item-oil'],
    ...part,
  };
}

describe("rowAdds: the product's step (velista 0186, decision E)", () => {
  const LOOSE = { unit: 'KILOGRAM', size: null, approxWeight: null };
  const weighed = line({
    lineId: 'line-chicken',
    unit: 'GRAM',
    quantity: 1000,
    itemIds: ['item-chicken'],
  });
  const rowOf = (adds: ReturnType<typeof rowAdds>) =>
    adds.of('item-chicken', 'GRAM')?.lines[0];

  it("steps a held row by the page's record of its product", () => {
    const adds = rowAdds(WEEKLY, [weighed], (itemId) =>
      itemId === 'item-chicken' ? { ...LOOSE, quantityStep: 250 } : null
    );
    expect(rowOf(adds)?.step).toBe(250);
  });

  it('prefers the step the store read for the line', () => {
    const adds = rowAdds(WEEKLY, [{ ...weighed, step: 100 }], () => ({
      ...LOOSE,
      quantityStep: 250,
    }));
    expect(rowOf(adds)?.step).toBe(100);
  });

  it('says nothing with no record, so the row steps by the default', () => {
    expect(rowOf(rowAdds(WEEKLY, [weighed], () => null))).not.toHaveProperty(
      'step'
    );
    expect(rowOf(rowAdds(WEEKLY, [weighed]))).not.toHaveProperty('step');
  });
});

describe('rowAdds (velista 0134, section 4.1)', () => {
  it('draws no plus at all with no list to add to', () => {
    const adds = rowAdds(null, [line({ lineId: 'line-oil' })]);

    expect(adds.plain).toBeNull();
    expect(adds.of('item-oil', 'UNIT')).toBeNull();
  });

  it('gives a product the list does not hold the plus alone, and the same one to every such row', () => {
    const adds = rowAdds(WEEKLY, [line({ lineId: 'line-oil' })]);

    expect(adds.plain).toEqual({ list: 'Weekly shop', lines: [] });
    expect(adds.of('item-rice', 'UNIT')).toBe(adds.plain);
    // One object for all of them, so a row is redrawn only when its own lines move.
    expect(rowAdds(WEEKLY, []).plain).toEqual(adds.plain);
  });

  it('puts every line of the chosen list that holds a product under that product, in the order held', () => {
    const adds = rowAdds(WEEKLY, [
      line({ lineId: 'line-oil', quantity: 2 }),
      line({ lineId: 'line-rice', name: 'Rice', itemIds: ['item-rice'] }),
      line({ lineId: 'line-frying', name: 'Oil for frying', quantity: 3 }),
    ]);

    expect(adds.of('item-oil', 'UNIT')).toEqual({
      list: 'Weekly shop',
      onList: {
        lineId: 'line-oil',
        path: '/en/zones/zone-home/lists/list-weekly',
      },
      lines: [
        {
          lineId: 'line-oil',
          name: 'Extra virgin olive oil',
          quantity: 2,
          unit: 'UNIT',
          editable: true,
          pending: false,
        },
        {
          lineId: 'line-frying',
          name: 'Oil for frying',
          quantity: 3,
          unit: 'UNIT',
          editable: true,
          pending: false,
        },
      ],
    });
    expect(
      adds.of('item-rice', 'UNIT')?.lines.map((row) => row.lineId)
    ).toEqual(['line-rice']);
  });

  it('leaves out the lines of every other list', () => {
    const adds = rowAdds(WEEKLY, [
      line({ lineId: 'line-party', listId: 'list-party' }),
    ]);

    expect(adds.of('item-oil', 'UNIT')).toBe(adds.plain);
  });

  it('puts a line that holds several products under each of them', () => {
    const adds = rowAdds(WEEKLY, [
      line({
        lineId: 'line-oils',
        name: 'Olive oil',
        itemIds: ['item-oil', 'item-oil-other'],
      }),
    ]);

    expect(adds.of('item-oil', 'UNIT')?.lines).toHaveLength(1);
    expect(adds.of('item-oil-other', 'UNIT')?.lines).toEqual(
      adds.of('item-oil', 'UNIT')?.lines
    );
  });

  it('keeps a line whose add has not answered out of reach of its stepper', () => {
    const adds = rowAdds(WEEKLY, [
      line({ lineId: unsavedLineId('list-weekly', 'item-oil') }),
    ]);

    expect(adds.of('item-oil', 'UNIT')?.lines[0]).toMatchObject({
      quantity: 1,
      editable: false,
    });
  });

  /** Velista `0185`, C1 and decisions C and D. */
  describe('a product already on the list', () => {
    it('switches the plus off for a line above zero, naming the first in the order drawn', () => {
      const adds = rowAdds(WEEKLY, [
        line({ lineId: 'line-kept', quantity: 0 }),
        line({ lineId: 'line-oil', quantity: 2 }),
        line({ lineId: 'line-frying', quantity: 3 }),
      ]);

      expect(adds.of('item-oil', 'UNIT')?.onList).toEqual({
        lineId: 'line-oil',
        path: '/en/zones/zone-home/lists/list-weekly',
      });
      // The lines keep their steppers.
      expect(
        adds.of('item-oil', 'UNIT')?.lines.map((row) => row.editable)
      ).toEqual([true, true, true]);
    });

    it('counts a line of several products that holds it', () => {
      const adds = rowAdds(WEEKLY, [
        line({
          lineId: 'line-fruit',
          itemIds: ['item-bananas', 'item-apples'],
        }),
      ]);

      expect(adds.of('item-bananas', 'UNIT')?.onList?.lineId).toBe(
        'line-fruit'
      );
    });

    it('keeps the plus on for a product held only at zero, and for an add still on its way', () => {
      const adds = rowAdds(WEEKLY, [
        line({ lineId: 'line-kept', quantity: 0 }),
        line({
          lineId: unsavedLineId('list-weekly', 'item-rice'),
          itemIds: ['item-rice'],
        }),
      ]);

      expect(adds.of('item-oil', 'UNIT')?.onList).toBeUndefined();
      expect(adds.of('item-oil', 'UNIT')?.pickLine).toBeUndefined();
      expect(adds.of('item-rice', 'UNIT')?.onList).toBeUndefined();
    });

    it('switches the plus off with no link for two or more saved lines at zero (the ruling of 2026-11-16)', () => {
      const adds = rowAdds(WEEKLY, [
        line({ lineId: 'line-kept-a', quantity: 0 }),
        line({ lineId: 'line-kept-b', quantity: 0, name: 'Oil for frying' }),
      ]);

      const oil = adds.of('item-oil', 'UNIT');
      expect(oil?.pickLine).toBe(true);
      expect(oil?.onList).toBeUndefined();
      // Both lines stay under the card, each with its own stepper.
      expect(oil?.lines.map((held) => [held.lineId, held.editable])).toEqual([
        ['line-kept-a', true],
        ['line-kept-b', true],
      ]);
    });

    it('counts no add still on its way among the lines at zero, and a line above zero wins', () => {
      const unsaved = rowAdds(WEEKLY, [
        line({ lineId: 'line-kept', quantity: 0 }),
        line({ lineId: unsavedLineId('list-weekly', 'item-oil'), quantity: 0 }),
      ]);
      expect(unsaved.of('item-oil', 'UNIT')?.pickLine).toBeUndefined();

      const wanted = rowAdds(WEEKLY, [
        line({ lineId: 'line-kept-a', quantity: 0 }),
        line({ lineId: 'line-kept-b', quantity: 0 }),
        line({ lineId: 'line-wanted', quantity: 2 }),
      ]);
      expect(wanted.of('item-oil', 'UNIT')?.pickLine).toBeUndefined();
      expect(wanted.of('item-oil', 'UNIT')?.onList?.lineId).toBe('line-wanted');
    });

    it('counts only the lines in the unit the plus adds in, as the server matches them (backend 0260)', () => {
      // Sold by the kilo, so the plus adds in GRAM: one GRAM line at zero is the
      // one match the server raises, and the UNIT line at zero is no match.
      const held = [
        line({ lineId: 'line-grams', quantity: 0, unit: 'GRAM' }),
        line({ lineId: 'line-pieces', quantity: 0, unit: 'UNIT' }),
      ];
      const byWeight = rowAdds(WEEKLY, held).of('item-oil', 'GRAM');
      expect(byWeight?.pickLine).toBeUndefined();
      expect(byWeight?.onList).toBeUndefined();
      // Both lines are still drawn under the card.
      expect(byWeight?.lines.map((row) => row.lineId)).toEqual([
        'line-grams',
        'line-pieces',
      ]);

      // A wanted line of another unit is no line already on the list: the
      // server answers line_unit_differs, so the plus stays on and the press
      // says that sentence.
      const other = rowAdds(WEEKLY, [
        line({ lineId: 'line-pieces', quantity: 2, unit: 'UNIT' }),
      ]).of('item-oil', 'GRAM');
      expect(other?.onList).toBeUndefined();
      expect(other?.pickLine).toBeUndefined();

      // Two at zero in the plus's own unit still switch it off.
      const two = rowAdds(WEEKLY, [
        ...held,
        line({ lineId: 'line-grams-b', quantity: 0, unit: 'GRAM' }),
      ]).of('item-oil', 'GRAM');
      expect(two?.pickLine).toBe(true);
    });

    it('answers the same object for the same product and unit, so a row is not redrawn', () => {
      const adds = rowAdds(WEEKLY, [line({ lineId: 'line-oil' })]);
      expect(adds.of('item-oil', 'UNIT')).toBe(adds.of('item-oil', 'UNIT'));
    });
  });

  it('follows the server’s rule for who may move a line: an approved one needs more than write', () => {
    const held = [
      line({ lineId: 'line-approved' }),
      line({ lineId: 'line-waiting', name: 'Oil, maybe', pending: true }),
    ];
    const editable = (permissions: AddTargetList['permissions']) =>
      rowAdds({ ...WEEKLY, permissions }, held)
        .of('item-oil', 'UNIT')
        ?.lines.map((row) => row.editable);

    expect(editable(['READ', 'WRITE'])).toEqual([false, true]);
    expect(editable(['READ', 'WRITE', 'DECIDE'])).toEqual([true, true]);
    expect(editable(['READ', 'WRITE', 'MANAGE'])).toEqual([true, true]);
  });
});

describe('coveredPageUrl', () => {
  function sheet(covered: readonly (readonly string[])[]) {
    return {
      parent: {
        pathFromRoot: [
          { url: [] },
          ...covered.map((paths) => ({
            url: paths.map((path) => new UrlSegment(path, {})),
          })),
        ],
      },
    } as unknown as ActivatedRouteSnapshot;
  }

  it('is every segment down to the page the sheet covers, under the mount or without one', () => {
    expect(coveredPageUrl(sheet([['velista'], ['en'], ['catalog']]))).toBe(
      '/velista/en/catalog'
    );
    expect(
      coveredPageUrl(sheet([['en'], ['catalog'], ['products', 'item-oil']]))
    ).toBe('/en/catalog/products/item-oil');
  });

  it('encodes a segment, and answers the root for a sheet with no parent', () => {
    expect(coveredPageUrl(sheet([['en'], ['products', 'a b/c']]))).toBe(
      '/en/products/a%20b%2Fc'
    );
    expect(coveredPageUrl({ parent: null } as ActivatedRouteSnapshot)).toBe(
      '/'
    );
  });
});

describe('addFailedCopy (velista 0185, section 4)', () => {
  it('says the generic sentence for any failure but a unit refusal', () => {
    expect(addFailedCopy(null)).toEqual({
      key: 'catalog.add.failed',
      args: {},
    });
  });

  it('says why for a product the list counts in another unit', () => {
    expect(
      addFailedCopy({ lineId: 'l1', name: 'Leche entera', unit: 'MILLILITER' })
    ).toEqual({
      key: 'list.error.addUnitDiffers.MILLILITER',
      args: { name: 'Leche entera' },
    });
    expect(addFailedCopy({ lineId: null, name: 'Leche', unit: null }).key).toBe(
      'list.error.addUnitDiffers.unknown'
    );
  });

  it('says why a stale card’s plus did nothing, in the card’s own words', () => {
    expect(
      addFailedCopy(null, { kind: 'pickLine', list: 'Weekly shop' })
    ).toEqual({
      key: 'catalog.held.pickLine',
      args: { list: 'Weekly shop' },
    });
    expect(
      addFailedCopy(null, { kind: 'onList', list: 'Weekly shop' })
    ).toEqual({
      key: 'catalog.held.alreadyOn',
      args: { list: 'Weekly shop' },
    });
  });
});
