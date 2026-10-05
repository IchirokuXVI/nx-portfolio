import { toRecordValue } from './record-value';
import type { FieldDescriptor, ResourceRow } from './resource-field';
import { toCell, type RenderOptions } from './resource-view';

/**
 * How one value reads on the record page (admin plan 0052, section 2.4): one
 * case for each kind and each format, and the empty value of each.
 */

type Field = FieldDescriptor<ResourceRow>;

const options: RenderOptions = { locale: 'en', contentLocales: ['en', 'es'] };

const text: Field = { kind: 'text', name: 'value', label: 'l' };
const name: Field = {
  kind: 'localized-text',
  name: 'value',
  label: 'l',
  locales: ['es', 'en'],
};
const reference: Field = {
  kind: 'reference',
  name: 'value',
  label: 'l',
  resource: 'brands',
};
const references: Field = {
  kind: 'references',
  name: 'value',
  label: 'l',
  resource: 'categories',
};
const json: Field = { kind: 'json', name: 'value', label: 'l' };
const yesNo: Field = { kind: 'boolean', name: 'value', label: 'l' };

function read(field: Field, value: unknown, row: ResourceRow = {}) {
  return toRecordValue(field, { ...row, value }, options);
}

describe('toRecordValue', () => {
  it('reads plain text as the text', () => {
    expect(read(text, 'Sevilla')).toEqual({ kind: 'text', text: 'Sevilla' });
  });

  it('reads an address as a link', () => {
    expect(read({ ...text, format: 'url' }, 'https://dia.es')).toEqual({
      kind: 'link',
      text: 'https://dia.es',
      href: 'https://dia.es',
    });
  });

  it('reads a code in the mono face', () => {
    expect(read({ ...text, format: 'code' }, '8480000')).toEqual({
      kind: 'text',
      text: '8480000',
      mono: true,
    });
  });

  it('reads the address of a picture as the picture', () => {
    expect(read({ ...text, format: 'image' }, 'https://cdn/x.png')).toEqual({
      kind: 'image',
      src: 'https://cdn/x.png',
    });
  });

  it('reads a text in several languages as one line for each, in the order of the field', () => {
    expect(read(name, { en: 'Whole milk', es: 'Leche entera' })).toEqual({
      kind: 'lines',
      lines: [
        { locale: 'es', text: 'Leche entera' },
        { locale: 'en', text: 'Whole milk' },
      ],
    });
  });

  it('says which language has no words', () => {
    expect(read(name, { es: 'Leche entera', en: ' ' })).toEqual({
      kind: 'lines',
      lines: [
        { locale: 'es', text: 'Leche entera' },
        { locale: 'en', text: null },
      ],
    });
  });

  it('reads a list for each language on one line', () => {
    expect(
      read({ ...name, list: true }, { es: ['leche', 'lácteo'], en: [] })
    ).toEqual({
      kind: 'lines',
      lines: [
        { locale: 'es', text: 'leche, lácteo' },
        { locale: 'en', text: null },
      ],
    });
  });

  it('carries the name a read joined onto the row', () => {
    const joined: Field = { ...reference, nameFrom: 'brandName' };

    expect(read(joined, 'b_1', { brandName: 'Hacendado' })).toEqual({
      kind: 'reference',
      resource: 'brands',
      id: 'b_1',
      name: 'Hacendado',
    });
    expect(read(joined, 'b_1', { brandName: { es: 'Leche' } })).toEqual({
      kind: 'reference',
      resource: 'brands',
      id: 'b_1',
      name: 'Leche',
    });
  });

  /** The page resolves it through the lookup. The ID never stands in for it. */
  it('carries no name when the row holds none', () => {
    expect(read(reference, 'b_1')).toEqual({
      kind: 'reference',
      resource: 'brands',
      id: 'b_1',
      name: null,
    });
    expect(
      read({ ...reference, nameFrom: 'brandName' }, 'b_1', { brandName: null })
    ).toMatchObject({ name: null });
  });

  it('reads several references as their IDs, and says whether the order counts', () => {
    expect(read(references, ['c_1', '', 'c_2'])).toEqual({
      kind: 'references',
      resource: 'categories',
      ids: ['c_1', 'c_2'],
      ordered: false,
    });
    expect(read({ ...references, ordered: true }, ['c_1'])).toMatchObject({
      ordered: true,
    });
  });

  it('prints an object across several lines', () => {
    expect(read(json, { a: 1 })).toEqual({
      kind: 'json',
      text: '{\n  "a": 1\n}',
    });
  });

  it('reads a yes or no and a choice as words', () => {
    expect(read(yesNo, true)).toEqual({
      kind: 'word',
      key: 'resource.value.yes',
    });
    expect(read(yesNo, false)).toEqual({
      kind: 'word',
      key: 'resource.value.no',
    });
    expect(
      read(
        {
          kind: 'enum',
          name: 'value',
          label: 'l',
          options: [{ value: 'L', label: 'units.litre' }],
        },
        'L'
      )
    ).toEqual({ kind: 'word', key: 'units.litre' });
  });

  it('reads a number, an amount and a date as the list reads them', () => {
    const fields: readonly (readonly [Field, unknown])[] = [
      [{ kind: 'number', name: 'value', label: 'l' }, 12345.5],
      [{ kind: 'money', name: 'value', label: 'l', decimals: 2 }, '1.35'],
      [{ kind: 'money', name: 'value', label: 'l', decimals: 4 }, '0.0135'],
      [{ kind: 'date', name: 'value', label: 'l' }, '2026-10-09T08:30:00Z'],
      [
        { kind: 'date', name: 'value', label: 'l', time: true },
        '2026-10-09T08:30:00Z',
      ],
    ];

    for (const [field, value] of fields) {
      const cell = toCell(field, { value }, options);

      expect(cell.text).not.toBe('');
      expect(read(field, value)).toEqual({ kind: 'text', text: cell.text });
    }
  });

  it('reads a sentence that `read` answered as that sentence', () => {
    const custom: Field = {
      ...text,
      read: () => ({
        kind: 'key',
        key: 'scopes.priority.custom',
        args: { n: 250 },
      }),
    };

    expect(read(custom, 'ignored')).toEqual({
      kind: 'word',
      key: 'scopes.priority.custom',
      args: { n: 250 },
    });
  });

  it('reads an empty value of every kind as none', () => {
    const empties: readonly (readonly [Field, unknown])[] = [
      [text, null],
      [text, ''],
      [{ ...text, format: 'url' }, null],
      [{ ...text, format: 'code' }, ''],
      [{ ...text, format: 'image' }, null],
      [{ kind: 'number', name: 'value', label: 'l' }, null],
      [{ kind: 'money', name: 'value', label: 'l', decimals: 2 }, null],
      [{ kind: 'date', name: 'value', label: 'l' }, null],
      [{ kind: 'date', name: 'value', label: 'l' }, 'not a date'],
      [yesNo, null],
      [{ kind: 'enum', name: 'value', label: 'l', options: [] }, null],
      [name, null],
      [name, { es: '', en: '  ' }],
      [
        { ...name, list: true },
        { es: [], en: [] },
      ],
      [reference, null],
      [reference, ''],
      [{ ...reference, unsetFlag: 'chains.noDefault' }, null],
      [references, []],
      [references, null],
      [json, null],
      [json, {}],
    ];

    for (const [field, value] of empties) {
      expect([field.kind, value, read(field, value)]).toEqual([
        field.kind,
        value,
        { kind: 'none' },
      ]);
    }
  });

  it('puts the mark of a scope and the state to check beside the value', () => {
    const marked: Field = {
      ...text,
      scope: () => ({ level: 2, label: 'scopes.kind.REGION' }),
      check: (row) =>
        row['guessed'] === true
          ? { label: 'shops.check.guessed', args: { from: 'city' } }
          : null,
    };

    expect(read(marked, 'Sevilla', { guessed: true })).toEqual({
      kind: 'text',
      text: 'Sevilla',
      scope: { level: 2, label: 'scopes.kind.REGION' },
      check: { label: 'shops.check.guessed', args: { from: 'city' } },
    });
    expect(read(marked, 'Sevilla', { guessed: false })).toEqual({
      kind: 'text',
      text: 'Sevilla',
      scope: { level: 2, label: 'scopes.kind.REGION' },
    });
  });
});
