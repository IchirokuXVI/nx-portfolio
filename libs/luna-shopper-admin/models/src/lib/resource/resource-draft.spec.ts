import type { ResourceDescriptor } from './resource-descriptor';
import {
  changedFields,
  draftFor,
  isDirty,
  toInput,
  validateDraft,
  type ResourceDraft,
} from './resource-draft';

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
   * Named rather than a bare "required": the control is several inputs, and
   * "required" under a box the operator has not scrolled to says less than the
   * language does.
   */
  it('names each missing locale of a required localized field', () => {
    expect(
      validateDraft(
        descriptor,
        draftWith({ name: { en: 'Milk', es: '' } }),
        'create',
        {}
      )
    ).toEqual({
      name: [
        {
          kind: 'key',
          key: 'resource.error.missingLocale',
          args: { locale: 'es' },
        },
      ],
    });
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

describe('changedFields and isDirty', () => {
  it('sees nothing changed in an untouched draft', () => {
    const original = draftFor(descriptor, row);

    expect(changedFields(original, original)).toEqual([]);
    expect(isDirty(original, original)).toBe(false);
  });

  it('sees a changed locale inside localized text', () => {
    const original = draftFor(descriptor, row);
    const draft = { ...original, name: { en: 'Milk', es: 'Lechita' } };

    expect(changedFields(draft, original)).toEqual(['name']);
    expect(isDirty(draft, original)).toBe(true);
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
