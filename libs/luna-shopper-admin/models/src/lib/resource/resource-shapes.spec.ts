import { CONTENT_LOCALES } from './localized-text';
import {
  defineResource,
  fromNaturalKey,
  idOf,
  naturalKey,
  queryFilters,
  unansweredFilters,
  type FilterDescriptor,
  type ResourceDescriptor,
} from './resource-descriptor';
import { draftFor, toInput, validateDraft } from './resource-draft';
import { isEditable, type FieldDescriptor } from './resource-field';
import { toCell } from './resource-view';

/**
 * The shapes the catalog needed the descriptor to grow (plan 0005).
 *
 * Four of them, and each is a real property of the catalog rather than a
 * convenience: a field that can be set once and never moved, a row addressed by
 * a pair rather than an id, a filter that has to be answered before anything is
 * read, and a boolean with three answers.
 */

interface Row {
  readonly [key: string]: unknown;
}

const RENDER = { locale: 'en', contentLocales: CONTENT_LOCALES };

function resource(
  fields: readonly FieldDescriptor<Row>[],
  extra: Partial<ResourceDescriptor<Row>> = {}
) {
  return defineResource<Row>({
    name: 'things',
    segment: 'things',
    labels: { one: 'one', many: 'many' },
    title: () => 'a thing',
    fields,
    list: { columns: [], compact: [] },
    gateway: () => {
      throw new Error('not used');
    },
    ...extra,
  });
}

describe('a field that can be set once and never moved', () => {
  const FIELD: FieldDescriptor<Row> = {
    kind: 'reference',
    name: 'priceScopeId',
    label: 'scope',
    resource: 'price-scopes',
    required: true,
    createOnly: true,
  };

  it('is editable while creating and text once the row exists', () => {
    expect(isEditable(FIELD, 'create')).toBe(true);
    expect(isEditable(FIELD, 'edit')).toBe(false);
  });

  /**
   * A create form is the only place such a field can ever be set, so a caller
   * that has not said which form it is must not hide it.
   */
  it('is treated as editable when the mode is not stated', () => {
    expect(isEditable(FIELD)).toBe(true);
  });

  it('is left out of an edit entirely, draft and request alike', () => {
    const descriptor = resource([
      FIELD,
      { kind: 'text', name: 'note', label: 'note' },
    ]);
    const row: Row = { priceScopeId: 'ps_1', note: 'hello' };

    expect(Object.keys(draftFor(descriptor, row, 'edit'))).toEqual(['note']);
    expect(Object.keys(draftFor(descriptor, row, 'create'))).toEqual([
      'priceScopeId',
      'note',
    ]);

    const input = toInput(
      descriptor,
      { priceScopeId: 'ps_2', note: 'changed' },
      'edit',
      { priceScopeId: 'ps_1', note: 'hello' }
    );
    expect(input).toEqual({ note: 'changed' });
  });

  /**
   * A required field the form cannot show cannot be complained about either, or
   * an edit would be unsubmittable for a reason the operator cannot act on.
   */
  it('is not required of a form that cannot show it', () => {
    const descriptor = resource([FIELD]);

    expect(validateDraft(descriptor, {}, 'create')).toHaveProperty(
      'priceScopeId'
    );
    expect(validateDraft(descriptor, {}, 'edit')).toEqual({});
  });
});

describe('a row addressed by a pair rather than an id', () => {
  const KEY = ['itemId', 'priceScopeId'];

  it('joins and takes apart the same key', () => {
    const row = { itemId: 'it_1', priceScopeId: 'ps_1' };
    const key = naturalKey(row, KEY);

    expect(key).toBe('it_1~ps_1');
    expect(fromNaturalKey(key, KEY)).toEqual(row);
  });

  /** A tilde is unreserved, so the key survives a path segment untouched. */
  it('makes a key a URL can carry', () => {
    const key = naturalKey({ itemId: 'a', priceScopeId: 'b' }, KEY);

    expect(encodeURIComponent(key)).toBe(key);
  });

  it('is what the screens address the row by', () => {
    const descriptor = resource([], {
      identify: (row) => naturalKey(row, KEY),
    });

    expect(
      idOf(descriptor, { id: 'si_1', itemId: 'it_1', priceScopeId: 'ps_1' })
    ).toBe('it_1~ps_1');
  });

  it('leaves an ordinary resource addressed by its id', () => {
    expect(idOf(resource([]), { id: 'sm_1' })).toBe('sm_1');
  });
});

describe('a filter that has to be answered first', () => {
  const FILTERS: readonly FilterDescriptor[] = [
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'chain',
      resource: 'supermarkets',
      required: true,
      local: true,
    },
    {
      kind: 'reference',
      param: 'supermarketLocationId',
      label: 'shop',
      resource: 'locations',
      required: true,
      scopedBy: 'supermarketId',
    },
    { kind: 'enum', param: 'kind', label: 'kind', options: [] },
  ];

  it('names what is still missing, and nothing once it is answered', () => {
    expect(unansweredFilters(FILTERS, {}).map((f) => f.param)).toEqual([
      'supermarketId',
      'supermarketLocationId',
    ]);

    expect(
      unansweredFilters(FILTERS, {
        supermarketId: 'sm_1',
        supermarketLocationId: 'loc_1',
      })
    ).toEqual([]);
  });

  /**
   * A local filter narrows a picker and is never sent. The gateway validates
   * its query with `forbidNonWhitelisted`, so sending one would be a 400 rather
   * than a harmless extra.
   */
  it('sends everything except the local ones and the empty ones', () => {
    expect(
      queryFilters(FILTERS, {
        supermarketId: 'sm_1',
        supermarketLocationId: 'loc_1',
        kind: '',
      })
    ).toEqual({ supermarketLocationId: 'loc_1' });
  });
});

describe('a boolean with three answers', () => {
  const OVERRIDE: FieldDescriptor<Row> = {
    kind: 'boolean',
    name: 'available',
    label: 'stocked here',
    nullable: true,
  };
  const PLAIN: FieldDescriptor<Row> = {
    kind: 'boolean',
    name: 'available',
    label: 'stocked',
  };

  /**
   * "Nobody has checked this shop" and "this shop does not stock it" are
   * different claims, and a checkbox can only carry one of them. A new row that
   * says nothing must not read as the second.
   */
  it('starts at nothing rather than at no', () => {
    const descriptor = resource([OVERRIDE]);

    expect(draftFor(descriptor, null, 'create')).toEqual({ available: '' });
    expect(toInput(descriptor, { available: '' }, 'create', {})).toEqual({
      available: null,
    });
  });

  it('carries yes and no as themselves', () => {
    const descriptor = resource([OVERRIDE]);

    expect(draftFor(descriptor, { available: false }, 'edit')).toEqual({
      available: 'false',
    });
    expect(toInput(descriptor, { available: 'false' }, 'create', {})).toEqual({
      available: false,
    });
    expect(toInput(descriptor, { available: 'true' }, 'create', {})).toEqual({
      available: true,
    });
  });

  it('leaves an ordinary boolean a checkbox', () => {
    const descriptor = resource([PLAIN]);

    expect(draftFor(descriptor, null, 'create')).toEqual({ available: false });
    expect(toInput(descriptor, { available: false }, 'create', {})).toEqual({
      available: false,
    });
  });

  it('draws nothing as nothing rather than as no', () => {
    expect(toCell(OVERRIDE, { available: null }, RENDER)).toEqual({
      text: '',
      key: 'resource.value.none',
    });
    expect(toCell(OVERRIDE, { available: false }, RENDER)).toEqual({
      text: '',
      key: 'resource.value.no',
    });
  });
});

describe('localized text whose entries are lists', () => {
  const SYNONYMS: FieldDescriptor<Row> = {
    kind: 'localized-text',
    name: 'synonyms',
    label: 'other words',
    locales: CONTENT_LOCALES,
    entries: 'list',
  };

  /**
   * The column holds `{ en: string[], es: string[] }` and the form holds one
   * line per language. Splitting and joining happen at the two edges, so
   * nothing above the draft has to know.
   */
  it('reads a list as a line and writes a line back as a list', () => {
    const descriptor = resource([SYNONYMS]);
    const row: Row = {
      synonyms: { en: ['whole milk', 'semi skimmed'], es: ['leche entera'] },
    };

    expect(draftFor(descriptor, row, 'edit')).toEqual({
      synonyms: { en: 'whole milk, semi skimmed', es: 'leche entera' },
    });

    expect(
      toInput(
        descriptor,
        { synonyms: { en: 'whole milk, semi skimmed', es: 'leche entera' } },
        'create',
        {}
      )
    ).toEqual({
      synonyms: { en: ['whole milk', 'semi skimmed'], es: ['leche entera'] },
    });
  });

  /**
   * An empty line is an empty list rather than a list holding one empty string,
   * which is the difference between "no synonyms" and "a synonym that is
   * nothing".
   */
  it('writes an empty line as no words at all', () => {
    expect(
      toInput(
        resource([SYNONYMS]),
        { synonyms: { en: '', es: '  ,  ' } },
        'create',
        {}
      )
    ).toEqual({ synonyms: { en: [], es: [] } });
  });

  it('shows the words in a cell rather than an empty one', () => {
    expect(
      toCell(SYNONYMS, { synonyms: { en: ['a', 'b'], es: [] } }, RENDER)
    ).toEqual({ text: 'a, b' });
  });
});

describe('money the gateway carries as a number', () => {
  const PRICE: FieldDescriptor<Row> = {
    kind: 'money',
    name: 'price',
    label: 'price',
    decimals: 4,
    wire: 'number',
    nullable: true,
  };

  /**
   * The digits are held and validated as text and converted once, at the edge.
   * Four decimals are well inside what a double round trips to the same
   * shortest decimal it came from.
   */
  it('sends the digits that were typed', () => {
    expect(
      toInput(resource([PRICE]), { price: '0.2998' }, 'create', {})
    ).toEqual({ price: 0.2998 });
  });

  it('still refuses more decimals than the column keeps', () => {
    expect(
      validateDraft(resource([PRICE]), { price: '0.29985' }, 'create')
    ).toHaveProperty('price');
  });

  it('leaves a decimal string alone where the gateway wants one', () => {
    const asText: FieldDescriptor<Row> = { ...PRICE, wire: undefined };

    expect(
      toInput(resource([asText]), { price: '0.2998' }, 'create', {})
    ).toEqual({ price: '0.2998' });
  });
});
