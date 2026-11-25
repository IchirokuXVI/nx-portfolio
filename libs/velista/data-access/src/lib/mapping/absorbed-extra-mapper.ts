import type { AbsorbedExtra, ExtraBuyer } from '@portfolio/velista/models';
import { isRecord } from './primitives';

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * The `extra` of a raise that reported what it took into the ask (backend `0276`),
 * read from `unknown` (rule D4). Anything this build cannot read whole is null, and
 * a null asks nothing: an amount that is not a non negative integer, a buyer that is
 * not `{ userId: string | null }`, more countable than was above, or no `extra` at
 * all. A question built on a guess would name the wrong person or the wrong amount.
 */
export function toAbsorbedExtra(value: unknown): AbsorbedExtra | null {
  if (!isRecord(value)) {
    return null;
  }
  const above = count(value['above']);
  const countable = count(value['countable']);
  const buyers = value['buyers'];
  if (
    above === null ||
    countable === null ||
    countable > above ||
    !Array.isArray(buyers)
  ) {
    return null;
  }
  const read: ExtraBuyer[] = [];
  for (const buyer of buyers) {
    if (!isRecord(buyer)) {
      return null;
    }
    const userId = buyer['userId'];
    if (userId !== null && typeof userId !== 'string') {
      return null;
    }
    read.push({ userId });
  }
  return { above, countable, buyers: read };
}

/**
 * The `counted` of a count's answer (backend `0276`, target state 7): the units it
 * took off the line, a positive integer, or null when this build cannot read it.
 */
export function toCounted(value: unknown): number | null {
  const read = count(value);
  return read === null || read === 0 ? null : read;
}
