import type { FieldDescriptor } from './resource-field';
import { toCell, type RenderOptions } from './resource-view';

interface Scope {
  [key: string]: unknown;
  id: string;
  kind: string;
}

const options: RenderOptions = { locale: 'en', contentLocales: ['en', 'es'] };

const KINDS = [
  { value: 'NATIONAL', label: 'kind.NATIONAL' },
  { value: 'STORE', label: 'kind.STORE' },
];

const marked: FieldDescriptor<Scope> = {
  kind: 'enum',
  name: 'kind',
  label: 'scopes.kind',
  options: KINDS,
  scope: (row) =>
    row.kind === 'STORE'
      ? { level: 4, label: 'kind.STORE' }
      : row.kind === 'NATIONAL'
        ? { level: 1, label: 'kind.NATIONAL' }
        : undefined,
};

const plain: FieldDescriptor<Scope> = {
  kind: 'enum',
  name: 'kind',
  label: 'scopes.kind',
  options: KINDS,
};

/**
 * The scope mark of a cell (admin plan 0041, section 10): a field that names a
 * price scope, or a kind of one, says how many bars go before its value.
 */
describe('a cell that carries a scope mark', () => {
  it('puts the mark on the cell beside the value it already had', () => {
    expect(toCell(marked, { id: 's1', kind: 'STORE' }, options)).toEqual({
      text: '',
      key: 'kind.STORE',
      scope: { level: 4, label: 'kind.STORE' },
    });
  });

  it('follows the row and not the field', () => {
    expect(
      toCell(marked, { id: 's2', kind: 'NATIONAL' }, options).scope
    ).toEqual({ level: 1, label: 'kind.NATIONAL' });
  });

  /**
   * A kind this app does not know has no mark, which is better than a mark
   * that guesses how far a price reaches. The value is still drawn.
   */
  it('draws the value alone where the field answers no mark', () => {
    expect(toCell(marked, { id: 's3', kind: 'PROVINCE' }, options)).toEqual({
      text: 'PROVINCE',
    });
  });

  it('leaves a field with no mark exactly as it was', () => {
    expect(toCell(plain, { id: 's1', kind: 'STORE' }, options)).toEqual({
      text: '',
      key: 'kind.STORE',
    });
  });
});
