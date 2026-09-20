import { mergeKey, normalizeContent } from './line-dedup';

/**
 * The dedup rule (plan 0050, section 3), which is the one piece of the run that
 * decides something about a person's intention rather than about their access.
 *
 * The cases below are split the way the plan argues them: what must merge,
 * because the point of the feature is one line to buy once, and what must
 * **not**, because merging two things somebody meant separately loses a purchase
 * silently while showing two lines they can merge by hand costs one gesture.
 */
describe('normalizeContent', () => {
  it('folds case, accents and surrounding space', () => {
    expect(normalizeContent('  Café  ')).toBe('cafe');
    expect(normalizeContent('LECHE')).toBe('leche');
  });

  it('collapses runs of whitespace so two spaces are not a different line', () => {
    expect(normalizeContent('tinned  tomatoes')).toBe('tinned tomatoes');
  });

  it('does not stem or strip words', () => {
    // The conservative half of the rule. "milk" and "whole milk" are two things
    // until a person says otherwise.
    expect(normalizeContent('whole milk')).not.toBe(normalizeContent('milk'));
  });
});

describe('mergeKey', () => {
  it('merges two lines carrying the same product set, whatever they are called', () => {
    // The identity beats the spelling, which is the case the text rule could
    // never catch: two households typing "leche" and "Milk" for one carton.
    const spanish = mergeKey({ itemSetHash: 'abc123', content: 'Leche' });
    const english = mergeKey({ itemSetHash: 'abc123', content: 'Milk' });
    expect(spanish).toBe(english);
  });

  it('merges a single product with itself, without a second rule for it', () => {
    // A set of one hashes like any other set, which is why the plan's "same
    // single product" case needs no code of its own.
    expect(mergeKey({ itemSetHash: 'one-product', content: 'Pascual' })).toBe(
      mergeKey({ itemSetHash: 'one-product', content: 'pascual milk' })
    );
  });

  it('keeps two different product sets apart', () => {
    expect(mergeKey({ itemSetHash: 'abc', content: 'Milk' })).not.toBe(
      mergeKey({ itemSetHash: 'def', content: 'Milk' })
    );
  });

  it('falls back to normalized text for free text lines', () => {
    expect(mergeKey({ itemSetHash: null, content: 'Café' })).toBe(
      mergeKey({ itemSetHash: null, content: 'cafe' })
    );
  });

  it('never lets a hash collide with text somebody typed', () => {
    // The namespacing. Without it a line whose content happened to equal another
    // line's digest would merge with it.
    expect(mergeKey({ itemSetHash: 'abc123', content: 'x' })).not.toBe(
      mergeKey({ itemSetHash: null, content: 'abc123' })
    );
  });

  it('does not merge a free text line into a line that names a product', () => {
    expect(mergeKey({ itemSetHash: 'abc', content: 'Milk' })).not.toBe(
      mergeKey({ itemSetHash: null, content: 'Milk' })
    );
  });
});
