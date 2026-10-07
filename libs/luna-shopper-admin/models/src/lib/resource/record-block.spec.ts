import {
  isRecordChildList,
  RECORD_DETAILS_TAB,
  recordChildCount,
  recordLayout,
  recordTabs,
  type RecordBlock,
  type RecordChild,
} from './record-block';
import {
  hasDetailScreen,
  type ResourceDescriptor,
} from './resource-descriptor';

/**
 * What the record page draws in each mode (admin plan 0052, section 2.3). One
 * case for each rule of `recordLayout`.
 */

interface Shop {
  [key: string]: unknown;
  id: string;
  supermarketId: string;
  name: string;
  city: string | null;
  note: string | null;
  productCount: number;
  source: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

function shops(record?: RecordBlock<Shop>): ResourceDescriptor<Shop> {
  return {
    name: 'shops',
    segment: 'shops',
    labels: { one: 'shops.one', many: 'shops.many' },
    title: (row) => row.name,
    parent: {
      resource: 'supermarkets',
      param: 'chainId',
      filter: 'supermarketId',
    },
    fields: [
      { kind: 'text', name: 'id', label: 'shops.id', editable: false },
      {
        kind: 'reference',
        name: 'supermarketId',
        label: 'shops.chain',
        resource: 'supermarkets',
        editable: false,
      },
      { kind: 'text', name: 'name', label: 'shops.name', required: true },
      { kind: 'text', name: 'city', label: 'shops.city' },
      { kind: 'text', name: 'note', label: 'shops.note', editable: 'edit' },
      {
        kind: 'number',
        name: 'productCount',
        label: 'shops.products',
        editable: false,
      },
      { kind: 'text', name: 'source', label: 'shops.source', editable: false },
      {
        kind: 'date',
        name: 'createdAt',
        label: 'shops.createdAt',
        editable: false,
      },
      {
        kind: 'text',
        name: 'createdBy',
        label: 'shops.createdBy',
        editable: false,
      },
      {
        kind: 'date',
        name: 'updatedAt',
        label: 'shops.updatedAt',
        editable: false,
      },
      {
        kind: 'text',
        name: 'updatedBy',
        label: 'shops.updatedBy',
        editable: false,
      },
    ],
    list: { columns: ['name'], compact: ['name'] },
    ...(record === undefined ? {} : { record }),
    gateway: () => {
      throw new Error('not read');
    },
  };
}

const block: RecordBlock<Shop> = {
  sections: [
    { title: 'shops.section.place', fields: ['supermarketId', 'name', 'city'] },
    { title: 'shops.section.notes', fields: ['note'] },
  ],
  children: [
    {
      as: 'tab',
      resource: 'products',
      by: 'shopId',
      count: 'productCount',
    },
  ],
  facts: {
    added: 'createdAt',
    addedBy: 'createdBy',
    changed: 'updatedAt',
    changedBy: 'updatedBy',
    also: ['source'],
  },
};

/** The sections, as their titles and the names of their fields. */
function drawn(layout: ReturnType<typeof recordLayout>) {
  return layout.sections.map((section) => [
    section.title,
    section.fields.map((field) => field.name),
  ]);
}

/** Every field some section holds. */
function sectioned(layout: ReturnType<typeof recordLayout>): string[] {
  return layout.sections.flatMap((section) =>
    section.fields.map((field) => field.name)
  );
}

describe('recordLayout', () => {
  it('holds every field a section names, while reading and while changing', () => {
    const sections = [
      ['shops.section.place', ['supermarketId', 'name', 'city']],
      ['shops.section.notes', ['note']],
    ];

    expect(drawn(recordLayout(shops(block), 'read'))).toEqual(sections);
    expect(drawn(recordLayout(shops(block), 'edit'))).toEqual(sections);
  });

  it('keeps the ID and every field of the facts out of the sections', () => {
    const names = sectioned(recordLayout(shops(block), 'read'));

    for (const name of [
      'id',
      'createdAt',
      'createdBy',
      'updatedAt',
      'updatedBy',
      'source',
    ]) {
      expect([name, names.includes(name)]).toEqual([name, false]);
    }
  });

  it('keeps out the ID field a descriptor names for itself', () => {
    const names = sectioned(
      recordLayout({ ...shops(), idField: 'name' }, 'read')
    );

    expect(names).toContain('id');
    expect(names).not.toContain('name');
  });

  it('keeps a field a child counts with out of the sections', () => {
    expect(sectioned(recordLayout(shops(block), 'read'))).not.toContain(
      'productCount'
    );
  });

  /**
   * `note` can only be set on a saved record, so a new one has no field for
   * it. The chain cannot be changed either, and it stays: it is the parent,
   * which the page draws as a locked value.
   */
  it('holds only what a new record can state, and the parent', () => {
    expect(drawn(recordLayout(shops(block), 'create'))).toEqual([
      ['shops.section.place', ['supermarketId', 'name', 'city']],
    ]);
  });

  it('leaves out a section with no field in this mode', () => {
    const titles = recordLayout(shops(block), 'create').sections.map(
      (section) => section.title
    );

    expect(titles).not.toContain('shops.section.notes');
  });

  it('puts a field no section names in a last section, in the order of the fields', () => {
    const layout = recordLayout(
      shops({
        sections: [{ title: 'shops.section.place', fields: ['city'] }],
      }),
      'read'
    );

    expect(drawn(layout)).toEqual([
      ['shops.section.place', ['city']],
      [
        'record.section.other',
        [
          'name',
          'note',
          'productCount',
          'source',
          'createdAt',
          'createdBy',
          'updatedAt',
          'updatedBy',
        ],
      ],
    ]);
  });

  /**
   * A record that exists sits under its parent, and the way back names it
   * (admin plan 0056, section 3.2). So a block that names the parent in no
   * section draws it only while adding, as the locked value.
   */
  it('draws a parent that no section names only while adding', () => {
    const block = {
      sections: [{ title: 'shops.section.place', fields: ['city' as const] }],
    };
    const fields = (mode: 'read' | 'edit' | 'create') =>
      recordLayout(shops(block), mode).sections.flatMap((section) =>
        section.fields.map((field) => field.name)
      );

    expect(fields('read')).not.toContain('supermarketId');
    expect(fields('edit')).not.toContain('supermarketId');
    expect(fields('create')).toContain('supermarketId');
  });

  it('draws one section of every field for a descriptor with no block', () => {
    const layout = recordLayout(shops(), 'read');

    expect(drawn(layout)).toEqual([
      [
        'record.section.details',
        [
          'supermarketId',
          'name',
          'city',
          'note',
          'productCount',
          'source',
          'createdAt',
          'createdBy',
          'updatedAt',
          'updatedBy',
        ],
      ],
    ]);
    // The Record block then holds the ID alone, which the page reads off the
    // row: no field is a fact.
    expect(layout.facts).toEqual({
      added: null,
      addedBy: null,
      changed: null,
      changedBy: null,
      addedLabel: 'record.facts.added',
      changedLabel: 'record.facts.changed',
      also: [],
    });
  });

  it('names the fields of the facts, with the ordinary headings', () => {
    const { facts } = recordLayout(shops(block), 'edit');

    expect({
      added: facts.added?.name,
      addedBy: facts.addedBy?.name,
      changed: facts.changed?.name,
      changedBy: facts.changedBy?.name,
      also: facts.also.map((field) => field.name),
    }).toEqual({
      added: 'createdAt',
      addedBy: 'createdBy',
      changed: 'updatedAt',
      changedBy: 'updatedBy',
      also: ['source'],
    });
    expect([facts.addedLabel, facts.changedLabel]).toEqual([
      'record.facts.added',
      'record.facts.changed',
    ]);
  });

  it('takes other words for the two headings from the descriptor', () => {
    const { facts } = recordLayout(
      shops({
        sections: [],
        facts: { added: 'createdAt', labels: { added: 'people.signedUp' } },
      }),
      'read'
    );

    expect([facts.addedLabel, facts.changedLabel]).toEqual([
      'people.signedUp',
      'record.facts.changed',
    ]);
  });

  it('has no facts for a record that does not exist yet', () => {
    const { facts } = recordLayout(shops(block), 'create');

    expect([
      facts.added,
      facts.addedBy,
      facts.changed,
      facts.changedBy,
      facts.also,
    ]).toEqual([null, null, null, null, []]);
  });

  it('draws a field two sections name in the first of them', () => {
    const layout = recordLayout(
      shops({
        sections: [
          { title: 'shops.section.place', fields: ['name'] },
          { title: 'shops.section.notes', fields: ['name', 'note'] },
        ],
      }),
      'read'
    );

    expect(drawn(layout).slice(0, 2)).toEqual([
      ['shops.section.place', ['name']],
      ['shops.section.notes', ['note']],
    ]);
  });
});

describe('the children of a record', () => {
  class Part {}

  const withChildren = (
    children: readonly RecordChild[],
    details?: 'first' | 'last'
  ): ResourceDescriptor =>
    ({
      name: 'things',
      fields: [],
      record: { sections: [], children, details },
    }) as unknown as ResourceDescriptor;

  const prices: RecordChild = {
    as: 'tab',
    name: 'prices',
    label: 'things.prices',
    component: Part,
  };
  const shopsTab: RecordChild = {
    as: 'tab',
    resource: 'shops',
    by: 'thingId',
    count: 'shopCount',
  };
  const panel: RecordChild = { as: 'panel', resource: 'notes', by: 'thingId' };

  it('has no tabs when no child is a tab', () => {
    expect(recordTabs(withChildren([panel]))).toEqual([]);
    expect(recordTabs(withChildren([]))).toEqual([]);
  });

  it('puts Details first, then each tab in the order of the children', () => {
    expect(
      recordTabs(withChildren([prices, panel, shopsTab])).map((tab) => tab.key)
    ).toEqual([RECORD_DETAILS_TAB, 'prices', 'shops']);
  });

  it('puts Details last when the block says so', () => {
    expect(
      recordTabs(withChildren([prices, shopsTab], 'last')).map((tab) => tab.key)
    ).toEqual(['prices', 'shops', RECORD_DETAILS_TAB]);
  });

  it('tells a list from a part', () => {
    expect(isRecordChildList(shopsTab)).toBe(true);
    expect(isRecordChildList(prices)).toBe(false);
  });

  it('counts from the field the child names, before anything else', () => {
    expect(recordChildCount(shopsTab, { shopCount: 7 }, { shops: 99 })).toBe(7);
    // The record is not read yet, or the field holds no number.
    expect(recordChildCount(shopsTab, null, { shops: 99 })).toBeNull();
    expect(recordChildCount(shopsTab, { shopCount: '7' }, null)).toBeNull();
  });

  it('counts from what another read holds, by the key of the child', () => {
    expect(recordChildCount(prices, {}, { prices: 4 })).toBe(4);
    expect(recordChildCount(panel, {}, { notes: 2 })).toBe(2);
  });

  it('has no count when nothing holds one', () => {
    expect(recordChildCount(prices, {}, null)).toBeNull();
    expect(recordChildCount(prices, {}, {})).toBeNull();
    expect(recordChildCount(prices, {}, { prices: null })).toBeNull();
  });
});

/**
 * A descriptor that states a block has a record page, so its rows open. A
 * shopping list has no action at all, and still has a page that reads (admin
 * plan 0058).
 */
describe('a record that only reads', () => {
  it('opens when the descriptor states a record block', () => {
    expect(shops().actions).toBeUndefined();
    expect(hasDetailScreen(shops())).toBe(false);
    expect(hasDetailScreen(shops(block))).toBe(true);
  });
});
