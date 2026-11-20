import {
  isLineUnit,
  LINE_UNITS,
  type LineUnit,
} from '@portfolio/luna-shopper/contracts';
import {
  LineUnitMismatchException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';

/**
 * The two checks core asks of a unit a request names (plan 0246, section 3.2).
 *
 * Free functions, because three services ask them: the line's own writes, the
 * list page's settle and the basket's settle and demand. Core checks them
 * again rather than trusting the gateway, for the reason `validateQuantity`
 * gives: the gateway is one caller of core, not a wall.
 */

/** A {@link LineUnit}, or undefined when none was named. */
export function validateLineUnit(unit: unknown): LineUnit | undefined {
  if (unit === undefined || unit === null) {
    return undefined;
  }
  if (!isLineUnit(unit)) {
    throw new ValidationException(
      `unit must be one of ${LINE_UNITS.join(', ')}`,
      { messageArgs: { field: 'unit' } }
    );
  }
  return unit;
}

/** A unit that must be named, refused as a validation error when it is not. */
export function requireLineUnit(unit: unknown): LineUnit {
  const named = validateLineUnit(unit);
  if (named === undefined) {
    throw new ValidationException('unit is required', {
      messageArgs: { field: 'unit' },
    });
  }
  return named;
}

/**
 * The unit a delta, a settle or a demand was made in, which must be the
 * line's. Another unit is `line_unit_mismatch`, and nothing is written: the
 * client reads the line again, as it does for `stale_quantity`.
 */
export function assertLineUnit(
  line: { unit?: LineUnit | null },
  unit: unknown
): void {
  const named = requireLineUnit(unit);
  const own = line.unit ?? 'UNIT';
  if (named !== own) {
    throw new LineUnitMismatchException(
      `The line counts in ${own}, not ${named}`
    );
  }
}
