import {
  toCell,
  type RenderOptions,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SCOPE_KIND_OPTIONS, priceScopeMark } from './catalog-enums';
import { PRICE_SCOPE_SEED } from './catalog-seed';
import { PRICE_SCOPES } from './price-scopes';

const options: RenderOptions = { locale: 'en', contentLocales: ['en', 'es'] };

/**
 * How specific a price scope is, as the four bars beside its kind (admin plan
 * 0041, section 10).
 */
describe('the scope mark of a price scope kind', () => {
  it('rises from nationwide to a single shop', () => {
    expect(
      PRICE_SCOPE_KIND_OPTIONS.map((option) => [
        option.value,
        priceScopeMark(option.value)?.level,
      ])
    ).toEqual([
      ['NATIONAL', 1],
      ['REGION', 2],
      ['LOCAL_AREA', 3],
      ['STORE', 4],
    ]);
  });

  it('is named by the kind, as the key the list already translates', () => {
    expect(priceScopeMark('LOCAL_AREA')).toEqual({
      level: 3,
      label: 'catalog.priceScopeKind.LOCAL_AREA',
    });
  });

  /** A mark that guessed would say how far a price reaches, and be wrong. */
  it('has no mark for a kind this app does not know', () => {
    expect(priceScopeMark('PROVINCE')).toBeUndefined();
    expect(priceScopeMark(null)).toBeUndefined();
  });

  it('is on the kind cell of the price scopes list', () => {
    const kind = PRICE_SCOPES.fields.find((field) => field.name === 'kind');
    const [scope] = PRICE_SCOPE_SEED;

    if (kind === undefined) {
      throw new Error('the price scopes descriptor has no kind field');
    }

    expect(toCell(kind, scope, options).scope).toEqual(
      priceScopeMark(scope.kind)
    );
    expect(PRICE_SCOPES.list.columns).toContain('kind');
  });
});
