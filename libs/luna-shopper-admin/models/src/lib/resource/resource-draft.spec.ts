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
    expect(validateDraft(descriptor, draftFor(descriptor, row))).toEqual({});
  });

  /**
   * Named rather than a bare "required": the control is several inputs, and
   * "required" under a box the operator has not scrolled to says less than the
   * language does.
   */
  it('names each missing locale of a required localized field', () => {
    expect(
      validateDraft(descriptor, draftWith({ name: { en: 'Milk', es: '' } }))
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
    expect(validateDraft(descriptor, draftWith({ price: '1.239' }))).toEqual({
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
      validateDraft(descriptor, draftWith({ unitPrice: '1.2345' }))
    ).toEqual({});
  });

  it('refuses a website that is not an http url', () => {
    expect(
      validateDraft(descriptor, draftWith({ websiteUrl: 'bonpreu.example' }))
    ).toEqual({
      websiteUrl: [{ kind: 'key', key: 'resource.error.notAUrl' }],
    });
  });

  it('refuses a fractional count and a negative one', () => {
    expect(validateDraft(descriptor, draftWith({ stores: '2.5' }))).toEqual({
      stores: [{ kind: 'key', key: 'resource.error.notAnInteger' }],
    });
    expect(validateDraft(descriptor, draftWith({ stores: '-1' }))).toEqual({
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
        draftWith({ price: '', websiteUrl: '', stores: '' })
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
