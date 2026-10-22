import { lineIdentities, normalizeContent } from './line-content';

/**
 * What an add has to share with a line to land on it (plan 0214, section 1).
 *
 * A line that is not named carries the name of a product in the locale of the
 * person who added it, so the name is no part of what it means: "Eggs" from a
 * phone in English and "Huevos" from one in Spanish are the same set. A named
 * line and a free text line are a person's own words, and keep the name in
 * their key.
 */
describe('lineIdentities (plan 0214, section 1)', () => {
  const SET = 'digest-of-the-eggs';
  const GROUP = '7c2b4d1a-8e35-4f90-b6a2-1d4c7e9b0f52';

  it('meets an unnamed line on its set whatever name the locale gave it', () => {
    const english = lineIdentities({
      content: 'Eggs',
      named: false,
      itemSetHash: SET,
      productGroupId: null,
    });
    const spanish = lineIdentities({
      content: 'Huevos',
      named: false,
      itemSetHash: SET,
      productGroupId: null,
    });

    expect(english).toEqual(spanish);
  });

  it('meets an unnamed line on its group with no name part', () => {
    const one = lineIdentities({
      content: 'Milk',
      named: false,
      itemSetHash: SET,
      productGroupId: GROUP,
    });
    const other = lineIdentities({
      content: 'Leche',
      named: false,
      itemSetHash: 'another-digest',
      productGroupId: GROUP,
    });

    expect(one.filter((key) => other.includes(key))).toHaveLength(1);
  });

  it('never meets a named line of the same set from an unnamed add', () => {
    const named = lineIdentities({
      content: 'Eggs',
      named: true,
      itemSetHash: SET,
      productGroupId: null,
    });
    const unnamed = lineIdentities({
      content: 'Eggs',
      named: false,
      itemSetHash: SET,
      productGroupId: null,
    });

    expect(named.filter((key) => unnamed.includes(key))).toEqual([]);
  });

  it('keeps the name in the key of a named line', () => {
    const eggs = lineIdentities({
      content: 'Eggs',
      named: true,
      itemSetHash: SET,
      productGroupId: null,
    });
    const huevos = lineIdentities({
      content: 'Huevos',
      named: true,
      itemSetHash: SET,
      productGroupId: null,
    });

    expect(eggs.filter((key) => huevos.includes(key))).toEqual([]);
  });

  it('still merges free text by the folded name, whatever the flag says', () => {
    const typed = lineIdentities({
      content: '  JAMÓN ',
      named: true,
      itemSetHash: null,
      productGroupId: null,
    });
    // A line with no product is always named (plan 0207), so a false here is
    // a request that rule 1 overrules, and the key must not depend on it.
    const folded = lineIdentities({
      content: 'jamon',
      named: false,
      itemSetHash: null,
      productGroupId: null,
    });

    expect(typed).toEqual(folded);
    expect(typed).toEqual([`${normalizeContent('jamon')}\u0000text`]);
  });
});
