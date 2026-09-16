import { brandKey } from './brand-key';
import cases from './brand-key.cases.json';

/**
 * Every pair of `brand-key.cases.json`, which is the file the curation tool's
 * own copy of this function is proven against as well (plan 0115, section 2).
 *
 * The cases live in JSON rather than in this file precisely so there can be two
 * implementations and one set of expectations: the tool is plain `.mjs` and
 * cannot import a TypeScript module, so a second copy of the function is
 * unavoidable and a second copy of the cases is not.
 */
describe('brandKey', () => {
  it.each(cases as [string | null, string | null][])(
    'keys %p as %p',
    (text, key) => {
      expect(brandKey(text)).toBe(key);
    }
  );

  it('has no key for undefined, as it has none for null', () => {
    expect(brandKey(undefined)).toBeNull();
  });

  it('covers the shapes section 2 names', () => {
    const inputs = (cases as [string | null, string | null][]).map(
      ([text]) => text
    );
    // A guard on the file rather than on the function: a case removed from the
    // JSON would otherwise silently shrink both suites that read it.
    expect(inputs).toContain(null);
    expect(inputs).toContain('');
    expect(inputs).toContain('   ');
    expect(inputs).toContain('DON SIMÓN');
  });
});
