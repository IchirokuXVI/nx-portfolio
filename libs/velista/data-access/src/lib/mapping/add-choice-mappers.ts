import {
  ADD_CHOICE_MAX,
  LINE_APPROVAL_STATUS_FALLBACK,
  LINE_APPROVAL_STATUSES,
  type AddChoice,
  type AddChoiceLine,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { isRecord, mapArray, nullableStr, oneOf, str } from './primitives';

/**
 * The question a `line_add_needs_choice` refusal asks, or null for any other failure
 * (velista `0170`, target 7; backend `0228`, section 3).
 *
 * Mapped from `unknown` (rule D4). An entry this build cannot read is dropped, and a
 * refusal left with no line it can draw is not a question: it falls through to the
 * generic sentence like any other failure. Held to the server's cap of ten, so a
 * newer server that sent more cannot grow the popover past what it was drawn for.
 */
export function toAddChoice(error: unknown): AddChoice | null {
  if (
    !(error instanceof GatewayError) ||
    error.code !== 'line_add_needs_choice'
  ) {
    return null;
  }

  const lines = mapArray(error.details?.['lines'], toAddChoiceLine).slice(
    0,
    ADD_CHOICE_MAX
  );
  return lines.length === 0 ? null : { lines };
}

/** One entry of `details.lines`, or null when it cannot be drawn. */
export function toAddChoiceLine(raw: unknown): AddChoiceLine | null {
  if (!isRecord(raw)) {
    return null;
  }

  const lineId = str(raw['lineId']);
  const content = str(raw['content']);
  const quantity = raw['quantity'];
  if (
    lineId === null ||
    lineId === '' ||
    content === null ||
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity)
  ) {
    return null;
  }

  return {
    lineId,
    content,
    // A line the server did not say is unnamed draws its own words, which is the
    // reading that never shows a product's name over somebody's typing.
    named: raw['named'] !== false,
    quantity,
    itemIds: mapArray(raw['itemIds'], str),
    productGroupId: nullableStr(raw['productGroupId']),
    approvalStatus: oneOf(
      raw['approvalStatus'],
      LINE_APPROVAL_STATUSES,
      LINE_APPROVAL_STATUS_FALLBACK
    ),
  };
}
