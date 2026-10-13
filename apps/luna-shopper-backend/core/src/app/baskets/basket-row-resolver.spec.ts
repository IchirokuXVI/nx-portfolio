import { BASKET_LIMITS } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { namedLinesOf } from './basket-row-resolver';

/**
 * The lines a write names (plan 0201, section 4).
 *
 * The gateway validates a body before it sends one. Core is also called by its
 * own services and specs, so the check is asked again here: a write that named
 * no line would lock nothing and answer success.
 */
describe('namedLinesOf', () => {
  /** The field a refusal names, so a client can mark it. */
  function refusalOf(act: () => unknown): unknown {
    try {
      act();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      return (error as ValidationException).messageArgs;
    }
    throw new Error('expected a refusal');
  }

  it('answers the named lines in the order they were named', () => {
    expect(namedLinesOf('l-2', ['l-1', 'l-2', 'l-3'])).toEqual([
      'l-1',
      'l-2',
      'l-3',
    ]);
  });

  it('answers a line one time when it was named two times', () => {
    expect(namedLinesOf('l-1', ['l-1', 'l-2', 'l-1'])).toEqual(['l-1', 'l-2']);
  });

  it('takes one line, which is the row key itself', () => {
    expect(namedLinesOf('l-1', ['l-1'])).toEqual(['l-1']);
  });

  it('refuses a write that names no line', () => {
    expect(refusalOf(() => namedLinesOf('l-1', []))).toEqual({
      field: 'lineIds',
    });
    expect(refusalOf(() => namedLinesOf('l-1', undefined))).toEqual({
      field: 'lineIds',
    });
  });

  it('refuses a row key that is not one of the named lines', () => {
    // A request whose path and body disagree is malformed. It is refused
    // before anything is read.
    expect(refusalOf(() => namedLinesOf('l-9', ['l-1', 'l-2']))).toEqual({
      field: 'lineIds',
    });
  });

  it('takes the most lines a write may name, and refuses one more', () => {
    const most = Array.from(
      { length: BASKET_LIMITS.maxWriteLines },
      (_, index) => `l-${index}`
    );

    expect(namedLinesOf('l-0', most)).toHaveLength(BASKET_LIMITS.maxWriteLines);
    expect(refusalOf(() => namedLinesOf('l-0', [...most, 'l-more']))).toEqual({
      field: 'lineIds',
    });
  });

  it('counts the limit after the same line named again is dropped', () => {
    const most = Array.from(
      { length: BASKET_LIMITS.maxWriteLines },
      (_, index) => `l-${index}`
    );

    expect(namedLinesOf('l-0', [...most, 'l-0'])).toHaveLength(
      BASKET_LIMITS.maxWriteLines
    );
  });
});
