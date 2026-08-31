import { itemSetHash } from './item-set-hash';

const MILK = '11111111-1111-4111-8111-111111111111';
const BREAD = '22222222-2222-4222-8222-222222222222';

/**
 * Plan 0048, section 1.1, and its exit criterion: *two lines holding the same
 * products carry the same hash, however the products were added*.
 *
 * The literal digests are here on purpose. The core migration computes the same
 * value in SQL, and a spec that only compared this function to itself would let
 * the two drift apart without a single test going red.
 */
describe('itemSetHash', () => {
  it('is null for an empty set, and not the digest of nothing', () => {
    // A free text line has no product identity. Hashing the empty string would
    // give every one of them the same value and make the commonest kind of line
    // in the product look like one enormous duplicate group.
    expect(itemSetHash([])).toBeNull();
  });

  it('does not depend on the order the products were added in', () => {
    expect(itemSetHash([MILK, BREAD])).toBe(itemSetHash([BREAD, MILK]));
  });

  it('does not depend on a product being named twice', () => {
    expect(itemSetHash([MILK, BREAD, MILK])).toBe(itemSetHash([MILK, BREAD]));
  });

  it('is SHA-256 hex over the sorted distinct ids joined with commas', () => {
    // The exact value the migration's `encode(sha256(convert_to(
    // string_agg(DISTINCT ... ORDER BY ...), 'UTF8')), 'hex')` produces.
    expect(itemSetHash([BREAD, MILK])).toBe(
      'f1263a03cdb2be40b54df53df70602a0e9fcc7f8df4e1715891bbf0e92d83f4f'
    );
    expect(itemSetHash([MILK])).toBe(
      'bd7662a5eeb41614e720d477abfcb2272e19a8a70a93b7e3bc8560d44ad326e9'
    );
  });

  it('tells two different sets apart', () => {
    expect(itemSetHash([MILK])).not.toBe(itemSetHash([MILK, BREAD]));
  });
});
