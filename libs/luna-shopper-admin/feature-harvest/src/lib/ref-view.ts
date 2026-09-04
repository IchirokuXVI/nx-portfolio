import type { Wire } from '@portfolio/luna-shopper-admin/models';

type Ref = Wire.HarvestItemSourceRefView;

/**
 * What kind of problem one unresolved ref is (plan 0006, section 5).
 *
 * The plan asks for a ref "whose source has gone `GONE`" to be recognisable,
 * because that is a different problem from one that was never resolved. There is
 * **no `GONE` status**: `ItemSourceRefStatus` is `ACTIVE`, `CANDIDATE`,
 * `REJECTED` and `MANUAL`, and nothing in the harvester writes a fifth. So the
 * distinction the plan asks for is real but has to be derived, and this is where
 * that derivation lives rather than inside a template.
 *
 * - `unmatched` is a ref that has never been resolved at all. It came from a
 *   fuzzy name match, it has never written a price, and it is waiting for
 *   somebody to agree with it. Confirming is a reasonable answer.
 * - `stale` is a ref that **was** resolved and has not been seen since. The
 *   product it points at has stopped appearing at the storefront, so confirming
 *   it settles a link to something that is not there, and the remedy is usually
 *   to correct the external id rather than to say yes.
 */
export type RefProblem = 'unmatched' | 'stale';

export function refProblem(ref: Ref): RefProblem {
  if (ref.lastResolvedAt === null) {
    return 'unmatched';
  }

  // Resolved once, and nothing has seen it since. A live ref is seen by every
  // run that touches its chain, so `lastSeenAt` behind `lastResolvedAt` means
  // the product stopped appearing after the link was settled.
  if (ref.lastSeenAt === null) {
    return 'stale';
  }

  return Date.parse(ref.lastSeenAt) <= Date.parse(ref.lastResolvedAt)
    ? 'stale'
    : 'unmatched';
}

/**
 * Confidence as a percentage, for a queue that has to be read at a glance.
 *
 * A `CANDIDATE` at 0.72 and one at 0.98 deserve different amounts of attention,
 * and a bare decimal makes an operator do the conversion four thousand times.
 */
export function confidencePercent(ref: Ref): number {
  return Math.round(Math.min(1, Math.max(0, ref.confidence)) * 100);
}

/** The lines the queue draws for one ref, in a fixed order. */
export function refLines(ref: Ref): readonly { key: string; value: string }[] {
  return [
    { key: 'itemId', value: ref.itemId },
    { key: 'supermarketId', value: ref.supermarketId },
    { key: 'externalId', value: ref.externalId },
    { key: 'matchedBy', value: ref.matchedBy },
    { key: 'status', value: ref.status },
    { key: 'externalUrl', value: ref.externalUrl ?? '' },
  ];
}
