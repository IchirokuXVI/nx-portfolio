import { TestBed } from '@angular/core/testing';
import type { CatalogItem } from '@portfolio/velista/models';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';
import { GroupMembers, type GroupMembersScope } from './group-members';
import { ItemNames } from './item-names';

function product(id: string, groupId: string): CatalogItem {
  return {
    id,
    name: { es: id, en: id },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: groupId,
    category: 'DAIRY',
    offer: null,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
  };
}

/** A catalog that records every group read and answers two members for each. */
function setup(fail: (groupId: string) => boolean = () => false) {
  const requests: { groupId: string; scope?: GroupMembersScope }[] = [];
  const catalog: Partial<CatalogServiceI> = {
    groupMembers: async (groupId, scope) => {
      requests.push({ groupId, scope });
      return fail(groupId)
        ? null
        : [product(`${groupId}-a`, groupId), product(`${groupId}-b`, groupId)];
    },
    itemsByIds: async () => [],
  };

  TestBed.configureTestingModule({
    providers: [
      GroupMembers,
      ItemNames,
      { provide: CATALOG_SERVICE, useValue: catalog },
    ],
  });

  return {
    members: TestBed.inject(GroupMembers),
    names: TestBed.inject(ItemNames),
    requests,
  };
}

describe('GroupMembers', () => {
  it('reads each group once per scope', async () => {
    const { members, requests } = setup();

    await members.ensure(['milk', 'milk', 'eggs']);
    await members.ensure(['milk']);

    expect(requests.map((request) => request.groupId)).toEqual([
      'milk',
      'eggs',
    ]);
    expect(members.membersOf('milk')?.map((member) => member.id)).toEqual([
      'milk-a',
      'milk-b',
    ]);
  });

  it('holds a group priced at other scopes as a different answer', async () => {
    const { members, requests } = setup();
    const basket = { priceScopeIds: ['s2', 's1'] };

    await members.ensure(['milk']);
    await members.ensure(['milk'], basket);
    // The same scopes in another order are the same question.
    await members.ensure(['milk'], { priceScopeIds: ['s1', 's2'] });

    expect(requests).toEqual([
      { groupId: 'milk', scope: undefined },
      { groupId: 'milk', scope: basket },
    ]);
    expect(members.membersOf('milk', basket)).not.toBeNull();
  });

  it('says a read failed, and asks again next time', async () => {
    let failing = true;
    const { members, requests } = setup(() => failing);

    await members.ensure(['milk']);
    expect(members.entry('milk')).toEqual({ status: 'failed' });
    expect(members.membersOf('milk')).toBeNull();

    failing = false;
    await members.ensure(['milk']);

    expect(requests).toHaveLength(2);
    expect(members.entry('milk')?.status).toBe('ready');
  });

  it('names every member it read, so a changed line has its name at once', async () => {
    const { members, names } = setup();

    await members.ensure(['milk']);

    expect(names.nameOf('milk-b')?.id).toBe('milk-b');
  });
});
