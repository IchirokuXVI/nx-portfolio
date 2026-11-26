import type { ResourceDescriptor } from './resource-descriptor';
import {
  changedFields,
  draftFor,
  orderedFieldNames,
  settleDraft,
  toInput,
  validateDraft,
  type ResourceDraft,
} from './resource-draft';
import { isEditable } from './resource-field';

interface Product {
  id: string;
  name: Record<string, string>;
  websiteUrl: string | null;
  price: string | null;
  unitPrice: string | null;
  stores: number | null;
  productGroupId: string | null;
  active: boolean;
}

const descriptor: ResourceDescriptor<Product> = {
  name: 'products',
  segment: 'products',
  labels: { one: 'products.one', many: 'products.many' },
  title: (row) => row.id,
  fields: [
    { kind: 'text', name: 'id', label: 'products.id', editable: false },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'products.name',
      locales: ['en', 'es'],
      required: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'websiteUrl',
      label: 'products.website',
      format: 'url',
      nullable: true,
    },
    {
      kind: 'money',
      name: 'price',
      label: 'products.price',
      decimals: 2,
      nullable: true,
    },
    {
      kind: 'money',
      name: 'unitPrice',
      label: 'products.unitPrice',
      decimals: 4,
      nullable: true,
    },
    {
      kind: 'number',
      name: 'stores',
      label: 'products.stores',
      integer: true,
      min: 0,
      nullable: true,
    },
    {
      kind: 'reference',
      name: 'productGroupId',
      label: 'products.group',
      resource: 'product-groups',
      nullable: true,
    },
    { kind: 'boolean', name: 'active', label: 'products.active' },
  ],
  list: { columns: ['name'], compact: ['name'] },
  gateway: () => {
    throw new Error('not used');
  },
};

const row: Product = {
  id: 'p1',
  name: { en: 'Milk', es: 'Leche' },
  websiteUrl: null,
  price: '1.20',
  unitPrice: '1.2000',
  stores: 3,
  productGroupId: null,
  active: true,
};

describe('draftFor', () => {
  it('holds only the editable fields', () => {
    expect(Object.keys(draftFor(descriptor, row))).toEqual([
      'name',
      'websiteUrl',
      'price',
      'unitPrice',
      'stores',
      'productGroupId',
      'active',
    ]);
  });

  it('starts a create empty, with one blank string per content locale', () => {
    expect(draftFor(descriptor, null)).toEqual({
      name: { en: '', es: '' },
      websiteUrl: '',
      price: '',
      unitPrice: '',
      stores: '',
      productGroupId: '',
      active: false,
    });
  });

  it('carries money as the string the column holds, never as a number', () => {
    const draft = draftFor(descriptor, row);

    expect(draft['price']).toBe('1.20');
    expect(draft['unitPrice']).toBe('1.2000');
  });

  it('turns a null column into an empty control rather than the word null', () => {
    expect(draftFor(descriptor, row)['websiteUrl']).toBe('');
  });
});

describe('validateDraft', () => {
  const draftWith = (
    changes: Partial<Record<string, unknown>>
  ): ResourceDraft => ({
    ...draftFor(descriptor, row),
    ...changes,
  });

  it('is empty when there is nothing wrong', () => {
    expect(
      validateDraft(descriptor, draftFor(descriptor, row), 'create', {})
    ).toEqual({});
  });

  /**
   * Required means "in at least one language" (plan 0079). A supermarket
   * leaflet is printed in Spanish only, and the product it names is a complete
   * product; the list shows the fallback and marks the gap.
   */
  it('accepts a required localized field with one language blank', () => {
    expect(
      validateDraft(
        descriptor,
        draftWith({ name: { en: 'Milk', es: '' } }),
        'create',
        {}
      )
    ).toEqual({});
    expect(
      validateDraft(
        descriptor,
        draftWith({ name: { en: '', es: 'Leche' } }),
        'create',
        {}
      )
    ).toEqual({});
  });

  it('refuses a required localized field with every language blank, once', () => {
    expect(
      validateDraft(
        descriptor,
        draftWith({ name: { en: '', es: '  ' } }),
        'create',
        {}
      )
    ).toEqual({
      name: [{ kind: 'key', key: 'resource.error.missingAnyLocale' }],
    });
  });

  /**
   * The wire refuses `''` and refuses `null` alike: a language the name does
   * not have is spelled by leaving it out (plan 0079).
   */
  it('submits only the languages that have text', () => {
    expect(
      toInput(
        descriptor,
        draftWith({ name: { en: '', es: 'Leche' } }),
        'create',
        {}
      )
    ).toEqual(expect.objectContaining({ name: { es: 'Leche' } }));
  });

  it('refuses money with more decimals than the column has', () => {
    expect(
      validateDraft(descriptor, draftWith({ price: '1.239' }), 'create', {})
    ).toEqual({
      price: [
        {
          kind: 'key',
          key: 'resource.error.tooPrecise',
          args: { decimals: 2 },
        },
      ],
    });
  });

  it('accepts on the unit price the precision the price refuses', () => {
    expect(
      validateDraft(
        descriptor,
        draftWith({ unitPrice: '1.2345' }),
        'create',
        {}
      )
    ).toEqual({});
  });

  it('refuses a website that is not an http url', () => {
    expect(
      validateDraft(
        descriptor,
        draftWith({ websiteUrl: 'bonpreu.example' }),
        'create',
        {}
      )
    ).toEqual({
      websiteUrl: [{ kind: 'key', key: 'resource.error.notAUrl' }],
    });
  });

  /** Admin plan 0052, section 2.1: the address of a picture is an address. */
  it('checks the address of a picture as it checks a website', () => {
    const pictured: ResourceDescriptor<Product> = {
      ...descriptor,
      fields: [
        {
          kind: 'text',
          name: 'websiteUrl',
          label: 'products.picture',
          format: 'image',
        },
      ],
    };

    expect(
      validateDraft(pictured, { websiteUrl: 'logo.png' }, 'create', {})
    ).toEqual({
      websiteUrl: [{ kind: 'key', key: 'resource.error.notAUrl' }],
    });
    expect(
      validateDraft(
        pictured,
        { websiteUrl: 'https://cdn.example/logo.png' },
        'create',
        {}
      )
    ).toEqual({});
  });

  it('refuses a fractional count and a negative one', () => {
    expect(
      validateDraft(descriptor, draftWith({ stores: '2.5' }), 'create', {})
    ).toEqual({
      stores: [{ kind: 'key', key: 'resource.error.notAnInteger' }],
    });
    expect(
      validateDraft(descriptor, draftWith({ stores: '-1' }), 'create', {})
    ).toEqual({
      stores: [
        { kind: 'key', key: 'resource.error.tooSmall', args: { min: 0 } },
      ],
    });
  });

  /**
   * An empty optional field is not an unreadable one, so it collects no
   * complaint at all.
   */
  it('says nothing about an empty optional field', () => {
    expect(
      validateDraft(
        descriptor,
        draftWith({ price: '', websiteUrl: '', stores: '' }),
        'create',
        {}
      )
    ).toEqual({});
  });
});

describe('changedFields', () => {
  it('sees nothing changed in an untouched draft', () => {
    const original = draftFor(descriptor, row);

    expect(changedFields(original, original)).toEqual([]);
  });

  it('sees a changed locale inside localized text', () => {
    const original = draftFor(descriptor, row);
    const draft = { ...original, name: { en: 'Milk', es: 'Lechita' } };

    expect(changedFields(draft, original)).toEqual(['name']);
  });
});

describe('toInput', () => {
  const original = draftFor(descriptor, row);

  /**
   * `PATCH` means what changed. Sending the whole row back would overwrite a
   * column somebody else changed while the form was open.
   */
  it('sends only the changed fields on an edit', () => {
    const draft = { ...original, price: '1.50' };

    expect(toInput(descriptor, draft, 'edit', original)).toEqual({
      price: '1.50',
    });
  });

  it('sends nothing at all when nothing changed', () => {
    expect(toInput(descriptor, original, 'edit', original)).toEqual({});
  });

  it('sends localized text as an object, not as a string', () => {
    const draft = { ...original, name: { en: 'Whole milk', es: 'Leche' } };

    expect(toInput(descriptor, draft, 'edit', original)).toEqual({
      name: { en: 'Whole milk', es: 'Leche' },
    });
  });

  it('canonicalizes money to the column scale', () => {
    const draft = { ...original, unitPrice: '2,5' };

    expect(toInput(descriptor, draft, 'edit', original)).toEqual({
      unitPrice: '2.5000',
    });
  });

  it('sends null for a cleared nullable field', () => {
    const draft = { ...original, price: '' };

    expect(toInput(descriptor, draft, 'edit', original)).toEqual({
      price: null,
    });
  });

  it('sends a create with every field that has an answer', () => {
    const empty = draftFor(descriptor, null);
    const draft = {
      ...empty,
      name: { en: 'Milk', es: 'Leche' },
      price: '1.20',
    };

    expect(toInput(descriptor, draft, 'create', empty)).toEqual({
      name: { en: 'Milk', es: 'Leche' },
      price: '1.20',
      websiteUrl: null,
      unitPrice: null,
      stores: null,
      productGroupId: null,
      active: false,
    });
  });

  /**
   * The rule of section 5, asserted rather than assumed. `unitPrice` is stored
   * verbatim: the obvious derivation from `price` disagrees with the source on
   * 110 of 4,232 products, in the field whose only purpose is comparison.
   */
  it('derives nothing: changing the price leaves the unit price alone', () => {
    const draft = { ...original, price: '9.99' };
    const input = toInput(descriptor, draft, 'edit', original);

    expect(input).not.toHaveProperty('unitPrice');
    expect(Object.keys(input)).toEqual(['price']);
  });
});

/**
 * A `jsonb` column with no shape this app knows (plan 0009, section 3.1).
 *
 * The control holds text, because that is what a textarea holds and because
 * half typed JSON has to survive under the operator's cursor. The parse happens
 * once, on the way out, and only after validation has agreed it reads.
 */
describe('a json field', () => {
  interface Household {
    id: string;
    config: Record<string, unknown>;
  }

  const zone: ResourceDescriptor<Household> = {
    name: 'zones',
    segment: 'zones',
    labels: { one: 'zones.one', many: 'zones.many' },
    title: (row) => row.id,
    fields: [
      { kind: 'text', name: 'id', label: 'zones.id', editable: false },
      { kind: 'json', name: 'config', label: 'zones.config' },
    ],
    list: { columns: ['id'], compact: ['id'] },
    gateway: () => {
      throw new Error('not used');
    },
  };

  const row: Household = { id: 'z1', config: { currency: 'EUR' } };

  it('opens with the object printed, so it can be read before it is changed', () => {
    expect(draftFor(zone, row, 'edit')['config']).toBe(
      '{\n  "currency": "EUR"\n}'
    );
  });

  it('submits the object rather than the text the control held', () => {
    const original = draftFor(zone, row, 'edit');
    const draft = { ...original, config: '{ "currency": "GBP" }' };

    expect(toInput(zone, draft, 'edit', original)).toEqual({
      config: { currency: 'GBP' },
    });
  });

  it('refuses text that does not read, and text that reads as something else', () => {
    const original = draftFor(zone, row, 'edit');

    for (const bad of ['{ nope', '[1, 2]', '"a string"', '7']) {
      expect(
        validateDraft(zone, { ...original, config: bad }, 'edit', original)
      ).toEqual({
        config: [{ kind: 'key', key: 'resource.error.notAnObject' }],
      });
    }
  });
});

/**
 * Validation checks exactly what a submit would send, which for an edit is only
 * what changed (plan 0009, section 3.2).
 *
 * The row this exists for is a zone owner's membership. It holds `role: OWNER`,
 * which the picker must not offer, because `setRole` refuses it and ownership is
 * a transfer. Checking that untouched value would leave the form permanently
 * invalid over a field nobody edited, and an owner's per zone name could never
 * be corrected.
 */
describe('validateDraft over an edit', () => {
  interface Membership {
    membershipId: string;
    username: string;
    role: string;
  }

  const membership: ResourceDescriptor<Membership> = {
    name: 'memberships',
    segment: 'memberships',
    labels: { one: 'memberships.one', many: 'memberships.many' },
    idField: 'membershipId',
    title: (row) => row.username,
    fields: [
      {
        kind: 'text',
        name: 'username',
        label: 'memberships.username',
        required: true,
      },
      {
        kind: 'enum',
        name: 'role',
        label: 'memberships.role',
        options: [
          { value: 'ADMIN', label: 'memberships.role.ADMIN' },
          { value: 'MEMBER', label: 'memberships.role.MEMBER' },
        ],
      },
    ],
    list: { columns: ['username'], compact: ['username'] },
    gateway: () => {
      throw new Error('not used');
    },
  };

  const owner: Membership = {
    membershipId: 'm1',
    username: 'rosa',
    role: 'OWNER',
  };

  it('says nothing about a value the picker does not offer and nobody touched', () => {
    const original = draftFor(membership, owner, 'edit');

    expect(validateDraft(membership, original, 'edit', original)).toEqual({});
  });

  it('still refuses that field once it has been changed to something wrong', () => {
    const original = draftFor(membership, owner, 'edit');
    const draft = { ...original, role: 'GUEST' };

    expect(validateDraft(membership, draft, 'edit', original)).toEqual({
      role: [{ kind: 'key', key: 'resource.error.notAnOption' }],
    });
  });

  it('checks every field of a create, changed or not', () => {
    const empty = draftFor(membership, null, 'create');

    expect(validateDraft(membership, empty, 'create', empty)).toEqual({
      username: [{ kind: 'key', key: 'resource.error.required' }],
    });
  });
});

/**
 * A field holding several references (admin plan 0028, section 3): a shop's
 * price scopes, whose order the form does not own.
 */
describe('a references field', () => {
  interface Shop {
    id: string;
    priceScopeIds: string[];
  }

  const shops: ResourceDescriptor<Shop> = {
    name: 'shops',
    segment: 'shops',
    labels: { one: 'shops.one', many: 'shops.many' },
    title: (shop) => shop.id,
    fields: [
      { kind: 'text', name: 'id', label: 'shops.id', editable: false },
      {
        kind: 'references',
        name: 'priceScopeIds',
        label: 'shops.scopes',
        resource: 'price-scopes',
      },
    ],
    list: { columns: ['id'], compact: ['id'] },
    gateway: () => {
      throw new Error('not used');
    },
  };

  const shop: Shop = { id: 's1', priceScopeIds: ['store', 'region'] };

  it('opens with the ids as a list, and a create with an empty one', () => {
    expect(draftFor(shops, shop, 'edit')).toEqual({
      priceScopeIds: ['store', 'region'],
    });
    expect(draftFor(shops, null, 'create')).toEqual({ priceScopeIds: [] });
  });

  it('is not a change when the same ids come back in another order', () => {
    const original = draftFor(shops, shop, 'edit');
    const draft = { priceScopeIds: ['region', 'store'] };

    expect(changedFields(draft, original)).toEqual([]);
    expect(toInput(shops, draft, 'edit', original)).toEqual({});
  });

  /**
   * A product's categories are the other kind (admin plan 0036): the first is
   * first, so a new order is a change the form sends.
   */
  it('counts a new order as a change when the field says order matters', () => {
    const ranked: ResourceDescriptor<Shop> = {
      ...shops,
      fields: [
        shops.fields[0],
        { ...shops.fields[1], kind: 'references', ordered: true } as never,
      ],
    };
    const original = draftFor(ranked, shop, 'edit');
    const draft = { priceScopeIds: ['region', 'store'] };

    expect(changedFields(draft, original)).toEqual([]);
    expect(changedFields(draft, original, orderedFieldNames(ranked))).toEqual([
      'priceScopeIds',
    ]);
    expect(toInput(ranked, draft, 'edit', original)).toEqual({
      priceScopeIds: ['region', 'store'],
    });
  });

  it('sends a changed list whole', () => {
    const original = draftFor(shops, shop, 'edit');
    const draft = { priceScopeIds: ['store', 'local'] };

    expect(changedFields(draft, original)).toEqual(['priceScopeIds']);
    expect(toInput(shops, draft, 'edit', original)).toEqual({
      priceScopeIds: ['store', 'local'],
    });
  });

  it('counts a removed id as a change, not an addition of the same size', () => {
    const original = draftFor(shops, shop, 'edit');

    expect(
      changedFields({ priceScopeIds: ['store', 'store'] }, original)
    ).toEqual(['priceScopeIds']);
  });

  it('sends an emptied list on an edit, and leaves an empty create out', () => {
    const original = draftFor(shops, shop, 'edit');

    expect(toInput(shops, { priceScopeIds: [] }, 'edit', original)).toEqual({
      priceScopeIds: [],
    });

    const empty = draftFor(shops, null, 'create');
    expect(toInput(shops, empty, 'create', empty)).toEqual({});
  });
});

/**
 * Admin plan 0034, section 2: `'edit'` is the mirror of `'create'`, fixed at
 * creation and settable afterwards, which is a chain's default price scope.
 */
describe('isEditable', () => {
  const field = (editable?: boolean | 'create' | 'edit') => ({
    kind: 'text' as const,
    name: 'x',
    label: 'x',
    editable,
  });

  it('answers each setting in each mode', () => {
    expect(
      [undefined, true, false, 'create', 'edit'].map((editable) => [
        isEditable(field(editable as never), 'create'),
        isEditable(field(editable as never), 'edit'),
      ])
    ).toEqual([
      [true, true],
      [true, true],
      [false, false],
      [true, false],
      [false, true],
    ]);
  });
});

/**
 * A size or a weight, never both, and no size on a piece sold by the kilo
 * (admin plan 0068): what one change rules out.
 */
describe('settleDraft', () => {
  interface Piece {
    id: string;
    unit: string;
    size: number | null;
    weight: number | null;
    flagged: boolean;
  }

  const pieces: ResourceDescriptor<Piece> = {
    name: 'pieces',
    segment: 'pieces',
    labels: { one: 'pieces.one', many: 'pieces.many' },
    title: (row) => row.id,
    fields: [
      { kind: 'text', name: 'id', label: 'pieces.id', editable: false },
      {
        kind: 'enum',
        name: 'unit',
        label: 'pieces.unit',
        options: [
          { value: 'GRAM', label: 'pieces.gram' },
          { value: 'KILO', label: 'pieces.kilo' },
        ],
      },
      {
        kind: 'number',
        name: 'size',
        label: 'pieces.size',
        nullable: true,
        shown: (row) => row.unit !== 'KILO',
        excludes: 'weight',
      },
      {
        kind: 'number',
        name: 'weight',
        label: 'pieces.weight',
        nullable: true,
        excludes: 'size',
      },
      { kind: 'boolean', name: 'flagged', label: 'pieces.flagged' },
    ],
    list: { columns: ['id'], compact: ['id'] },
    gateway: () => {
      throw new Error('not used');
    },
  };

  const piece: Piece = {
    id: 'p1',
    unit: 'GRAM',
    size: null,
    weight: null,
    flagged: false,
  };

  it('empties the field a field with a value excludes', () => {
    const draft = { unit: 'GRAM', size: '250', weight: '500', flagged: false };

    expect(settleDraft(pieces, draft, piece, 'size')).toEqual({
      ...draft,
      weight: '',
    });
    expect(settleDraft(pieces, draft, piece, 'weight')).toEqual({
      ...draft,
      size: '',
    });
  });

  it('empties nothing for a field that was emptied', () => {
    const draft = { unit: 'GRAM', size: '', weight: '500', flagged: false };

    expect(settleDraft(pieces, draft, piece, 'size')).toBe(draft);
  });

  it('empties a field the row with the draft over it does not show', () => {
    const draft = { unit: 'KILO', size: '250', weight: '', flagged: false };

    expect(settleDraft(pieces, draft, piece, 'unit')).toEqual({
      ...draft,
      size: '',
    });
  });

  it('reads the row under a draft that does not hold the field shown reads', () => {
    const draft = { size: '250' };

    expect(
      settleDraft(pieces, draft, { ...piece, unit: 'KILO' }, 'flagged')
    ).toEqual({
      size: '',
    });
  });

  it('answers the same draft when nothing is ruled out', () => {
    const draft = { unit: 'GRAM', size: '250', weight: '', flagged: true };

    expect(settleDraft(pieces, draft, piece, 'size')).toBe(draft);
    expect(settleDraft(pieces, draft, piece, 'flagged')).toBe(draft);
  });

  it('touches only the fields the draft holds', () => {
    const draft = { unit: 'KILO' };

    expect(settleDraft(pieces, draft, piece, 'unit')).toBe(draft);
  });
});

/**
 * What one emptying leads to (admin plan 0075): A excludes B, and C is shown
 * only while B holds a value, so typing A empties B and then C.
 */
describe('settleDraft, emptying in a chain', () => {
  interface Chain {
    id: string;
    a: number | null;
    b: number | null;
    c: number | null;
    d: number | null;
  }

  const held = (value: unknown): boolean =>
    value !== null && value !== undefined && String(value).trim() !== '';

  const chain: ResourceDescriptor<Chain> = {
    name: 'chains',
    segment: 'chains',
    labels: { one: 'chains.one', many: 'chains.many' },
    title: (row) => row.id,
    fields: [
      { kind: 'text', name: 'id', label: 'chains.id', editable: false },
      {
        kind: 'number',
        name: 'a',
        label: 'chains.a',
        nullable: true,
        excludes: 'b',
      },
      { kind: 'number', name: 'b', label: 'chains.b', nullable: true },
      {
        kind: 'number',
        name: 'c',
        label: 'chains.c',
        nullable: true,
        shown: (row) => held(row.b),
      },
      {
        kind: 'number',
        name: 'd',
        label: 'chains.d',
        nullable: true,
        shown: (row) => held(row.c),
      },
    ],
    list: { columns: ['id'], compact: ['id'] },
    gateway: () => {
      throw new Error('not used');
    },
  };

  const row: Chain = { id: 'c1', a: null, b: 70, c: 100, d: 3 };

  it('empties B and every field shown only beside it in one settle', () => {
    const draft = { a: '50', b: '70', c: '100', d: '3' };

    expect(settleDraft(chain, draft, row, 'a')).toEqual({
      a: '50',
      b: '',
      c: '',
      d: '',
    });
  });

  it('reports no field that held nothing as changed', () => {
    const draft = { a: '50', b: '70', c: '', d: '' };
    const settled = settleDraft(
      chain,
      draft,
      { ...row, c: null, d: null },
      'a'
    );

    expect(settled).toEqual({ a: '50', b: '', c: '', d: '' });
    expect(changedFields(settled, draft)).toEqual(['b']);
  });

  it('answers the same draft when the chain starts nowhere', () => {
    const draft = { a: '', b: '70', c: '100', d: '3' };

    expect(settleDraft(chain, draft, row, 'a')).toBe(draft);
  });

  it('ends when two rules would empty each other', () => {
    interface Pair {
      id: string;
      left: number | null;
      right: number | null;
      flagged: boolean;
    }
    const pair: ResourceDescriptor<Pair> = {
      name: 'pairs',
      segment: 'pairs',
      labels: { one: 'pairs.one', many: 'pairs.many' },
      title: (value) => value.id,
      fields: [
        { kind: 'text', name: 'id', label: 'pairs.id', editable: false },
        {
          kind: 'number',
          name: 'left',
          label: 'pairs.left',
          nullable: true,
          shown: (value) => !held(value.right),
        },
        {
          kind: 'number',
          name: 'right',
          label: 'pairs.right',
          nullable: true,
          shown: (value) => !held(value.left),
        },
        { kind: 'boolean', name: 'flagged', label: 'pairs.flagged' },
      ],
      list: { columns: ['id'], compact: ['id'] },
      gateway: () => {
        throw new Error('not used');
      },
    };
    const draft = { left: '1', right: '2', flagged: true };

    expect(
      settleDraft(
        pair,
        draft,
        { id: 'p', left: 1, right: 2, flagged: true },
        'flagged'
      )
    ).toEqual({ left: '', right: '', flagged: true });
  });
});
