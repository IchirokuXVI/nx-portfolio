import { UrlSegment, type ActivatedRouteSnapshot } from '@angular/router';
import {
  unsavedLineId,
  type AddTargetList,
  type HeldLine,
} from '@portfolio/velista/models';
import { coveredPageUrl, rowAdds } from './row-adds';

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
