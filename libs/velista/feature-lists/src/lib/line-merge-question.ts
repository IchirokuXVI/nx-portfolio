import { GatewayError } from '@portfolio/velista/data-access';
import { LINE_QUANTITY_MAX } from '@portfolio/velista/models';

/**
 * What a refused rename asks and says (velista plan 0083, section 5).
 *
 * One piece for the two places a line is renamed: the detail sheet over the list
 * and the name sheet over the line page (velista `0135`, section 6). Both send the
 * same write and have to read the same refusal the same way.
 */

/**
 * The merge question, as the refusal stated it.
 *
 * `total` is worked out here rather than sent, from the amount the save carried and
 * the other line's, capped as the server caps the sum (backend plan 0112, section 3).
 */
export interface MergeQuestion {
  readonly other: string;
  readonly otherQuantity: number;
  readonly total: number;
}

/**
 * The question a `line_merge_required` refusal asks, or null for any other failure.
 *
 * Mapped from `unknown` (rule D4): a refusal whose details this build cannot read is
 * not a question the sheet can ask, and falls through to the generic sentence.
 */
export function mergeQuestionOf(
  error: unknown,
  amount: number
): MergeQuestion | null {
  if (
    !(error instanceof GatewayError) ||
    error.code !== 'line_merge_required'
  ) {
    return null;
  }

  const other = error.details?.['otherContent'];
  const otherQuantity = error.details?.['otherQuantity'];
  if (
    typeof other !== 'string' ||
    typeof otherQuantity !== 'number' ||
    !Number.isFinite(otherQuantity)
  ) {
    return null;
  }

  return {
    other,
    otherQuantity,
    total: Math.min(LINE_QUANTITY_MAX, amount + otherQuantity),
  };
}

/** The bound a `line_merge_too_many_products` refusal names, or null. */
export function mergeProductsMaxOf(error: unknown): number | null {
  if (
    !(error instanceof GatewayError) ||
    error.code !== 'line_merge_too_many_products'
  ) {
    return null;
  }
  const max = error.details?.['max'];
  return typeof max === 'number' && Number.isFinite(max) ? max : null;
}
