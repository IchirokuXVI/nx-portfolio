import type { CountedExtra } from '@portfolio/velista/models';
import { isRecord } from './primitives';

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * The `extra` of a raise that counted the units bought above the ask (backend
 * `0275`), read from `unknown` (rule D4). Anything this build cannot read whole is
 * null, and a null asks nothing: a count that is not a non negative integer, a
 * buyer that is not `{ userId: string | null }`, more counted than was above, or no
 * `extra` at all. A question built on a guess would name the wrong person or the
 * wrong amount.
 */
export function toCountedExtra(value: unknown): CountedExtra | null {
  if (!isRecord(value)) {
    return null;
  }
  const above = count(value['above']);
  const counted = count(value['counted']);
  const buyers = value['buyers'];
  if (
    above === null ||
    counted === null ||
    counted > above ||
    !Array.isArray(buyers)
  ) {
    return null;
  }
  const read: { readonly userId: string | null }[] = [];
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
  return { above, counted, buyers: read };
}
