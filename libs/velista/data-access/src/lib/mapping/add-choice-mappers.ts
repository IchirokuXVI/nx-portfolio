import {
  ADD_CHOICE_MAX,
  LINE_APPROVAL_STATUS_FALLBACK,
  LINE_APPROVAL_STATUSES,
  LINE_UNIT_FALLBACK,
  LINE_UNITS,
  type AddChoice,
  type AddChoiceLine,
  type AddOutcome,
  type AddUnitRefusal,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import {
  isRecord,
  mapArray,
  nullableStr,
  oneOf,
  oneOfOrNull,
  str,
} from './primitives';

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
    // Backend `0246`: a line of another unit is named alone. Absent is a count.
    unit: oneOf(raw['unit'], LINE_UNITS, LINE_UNIT_FALLBACK),
    itemIds: mapArray(raw['itemIds'], str),
    productGroupId: nullableStr(raw['productGroupId']),
    approvalStatus: oneOf(
      raw['approvalStatus'],
      LINE_APPROVAL_STATUSES,
      LINE_APPROVAL_STATUS_FALLBACK
    ),
  };
}

/**
 * The refusal of a product add that met a line of another unit, or null for any
 * other failure (velista `0185`, section 4; backend `0260`, section 3).
 *
 * Mapped from `details.line` (rule D4). A refusal whose bag is missing or unreadable
 * is still that refusal: it names no line, `name` falls back to `addedName`, the
 * product the person added, and the unit is unknown, which draws the sentence that
 * names no unit. Only a product add reaches this; a merge's `line_unit_differs`
 * carries no bag and keeps the rename sentence, because its caller never asks here.
 */
export function toAddUnitRefusal(
  error: unknown,
  addedName: string
): AddUnitRefusal | null {
  if (!(error instanceof GatewayError) || error.code !== 'line_unit_differs') {
    return null;
  }

  const line = error.details?.['line'];
  if (!isRecord(line)) {
    return { lineId: null, name: addedName, unit: null };
  }

  const lineId = str(line['lineId']);
  const content = str(line['content'])?.trim() ?? '';
  return {
    lineId: lineId === null || lineId === '' ? null : lineId,
    name: content === '' ? addedName : content,
    unit: oneOfOrNull(line['unit'], LINE_UNITS),
  };
}

/**
 * The `outcome` of an add's answer, or the `addOutcome` of the basket's (backend
 * `0260`, R1), in velista's own words. Null for an answer that names none or one
 * this build does not know: a gateway of before backend `0260`, whose caller then
 * reads `merged` as it always did.
 */
export function toAddOutcome(raw: unknown): AddOutcome | null {
  switch (raw) {
    case 'CREATED':
      return 'created';
    case 'RAISED':
      return 'raised';
    case 'ALREADY_ON_LIST':
      return 'alreadyOnList';
    default:
      return null;
  }
}
