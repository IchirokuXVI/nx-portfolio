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

function rowAdds(target: AddTargetList | null, held: readonly HeldLine[]) {
  return rowAddsOf(target, held, pathOf);
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
    pending: false,
    itemIds: ['item-oil'],
    ...part,
  };
}

describe('rowAdds (velista 0134, section 4.1)', () => {
  it('draws no plus at all with no list to add to', () => {
    const adds = rowAdds(null, [line({ lineId: 'line-oil' })]);

    expect(adds.plain).toBeNull();
    expect(adds.byItem.size).toBe(0);
  });

  it('gives a product the list does not hold the plus alone, and the same one to every such row', () => {
    const adds = rowAdds(WEEKLY, [line({ lineId: 'line-oil' })]);

    expect(adds.plain).toEqual({ list: 'Weekly shop', lines: [] });
    expect(adds.byItem.has('item-rice')).toBe(false);
    // One object for all of them, so a row is redrawn only when its own lines move.
    expect(rowAdds(WEEKLY, []).plain).toEqual(adds.plain);
  });

  it('puts every line of the chosen list that holds a product under that product, in the order held', () => {
    const adds = rowAdds(WEEKLY, [
      line({ lineId: 'line-oil', quantity: 2 }),
      line({ lineId: 'line-rice', name: 'Rice', itemIds: ['item-rice'] }),
      line({ lineId: 'line-frying', name: 'Oil for frying', quantity: 3 }),
    ]);

    expect(adds.byItem.get('item-oil')).toEqual({
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
          editable: true,
          pending: false,
        },
        {
          lineId: 'line-frying',
          name: 'Oil for frying',
          quantity: 3,
          editable: true,
          pending: false,
        },
      ],
    });
    expect(
      adds.byItem.get('item-rice')?.lines.map((row) => row.lineId)
    ).toEqual(['line-rice']);
  });

  it('leaves out the lines of every other list', () => {
    const adds = rowAdds(WEEKLY, [
      line({ lineId: 'line-party', listId: 'list-party' }),
    ]);

    expect(adds.byItem.size).toBe(0);
  });

  it('puts a line that holds several products under each of them', () => {
    const adds = rowAdds(WEEKLY, [
      line({
        lineId: 'line-oils',
        name: 'Olive oil',
        itemIds: ['item-oil', 'item-oil-other'],
      }),
    ]);

    expect(adds.byItem.get('item-oil')?.lines).toHaveLength(1);
    expect(adds.byItem.get('item-oil-other')?.lines).toEqual(
      adds.byItem.get('item-oil')?.lines
    );
  });

  it('keeps a line whose add has not answered out of reach of its stepper', () => {
    const adds = rowAdds(WEEKLY, [
      line({ lineId: unsavedLineId('list-weekly', 'item-oil') }),
    ]);

    expect(adds.byItem.get('item-oil')?.lines[0]).toMatchObject({
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

      expect(adds.byItem.get('item-oil')?.onList).toEqual({
        lineId: 'line-oil',
        path: '/en/zones/zone-home/lists/list-weekly',
      });
      // The lines keep their steppers.
      expect(
        adds.byItem.get('item-oil')?.lines.map((row) => row.editable)
      ).toEqual([true, true, true]);
    });

    it('counts a line of several products that holds it', () => {
      const adds = rowAdds(WEEKLY, [
        line({
          lineId: 'line-fruit',
          itemIds: ['item-bananas', 'item-apples'],
        }),
      ]);

      expect(adds.byItem.get('item-bananas')?.onList?.lineId).toBe(
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

      expect(adds.byItem.get('item-oil')?.onList).toBeUndefined();
      expect(adds.byItem.get('item-rice')?.onList).toBeUndefined();
    });
  });

  it('follows the server’s rule for who may move a line: an approved one needs more than write', () => {
    const held = [
      line({ lineId: 'line-approved' }),
      line({ lineId: 'line-waiting', name: 'Oil, maybe', pending: true }),
    ];
    const editable = (permissions: AddTargetList['permissions']) =>
      rowAdds({ ...WEEKLY, permissions }, held)
        .byItem.get('item-oil')
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
});
