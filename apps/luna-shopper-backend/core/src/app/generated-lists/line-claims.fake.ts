import {
  NO_LINE_CLAIM,
  type LineClaim,
} from '@portfolio/luna-shopper/contracts';
import type { LineClaimService } from './line-claim.service';
import type { ZoneLineClaimRef } from './line-claim.sql';

/**
 * An in memory stand in for {@link LineClaimService} (plan 0052).
 *
 * It exists for the reason `fakeLineSettlements` does one table over: services
 * read the claim on paths that are not about baskets at all, because every line
 * they answer with carries the third indicator, and a spec about permissions or
 * about a quantity delta has to get past that read to test what it is about.
 *
 * The default answers "nobody is buying any of this" and "this basket claims
 * nothing", which is the truth in every spec that does not set one up. A spec
 * that cares passes `claims` and `refsOf`, and one that asserts on what was said
 * out loud reads {@link FakeLineClaims.announced}.
 */
export interface FakeLineClaims {
  /** Every `announce` call, in order, flattened to one entry per line. */
  announced: {
    zoneId: string;
    listId: string;
    lineId: string;
    claimed: boolean;
    claimedByUserId: string | null;
  }[];
  /** One entry per call rather than per line, for asserting on the batching. */
  calls: {
    claimed: boolean;
    claimedByUserId: string | null;
    lineIds: string[];
  }[];
  service: LineClaimService;
}

export function fakeLineClaims(
  claims: Readonly<Record<string, LineClaim>> = {},
  refsOf: (id: string) => ZoneLineClaimRef[] = () => []
): FakeLineClaims {
  const announced: FakeLineClaims['announced'] = [];
  const calls: FakeLineClaims['calls'] = [];

  const claimsOf = async (
    lineIds: readonly string[]
  ): Promise<Map<string, LineClaim>> =>
    new Map(lineIds.map((id) => [id, claims[id] ?? NO_LINE_CLAIM]));

  const announce = (
    claimed: boolean,
    claimedByUserId: string | null,
    entries: readonly ZoneLineClaimRef[]
  ): void => {
    calls.push({
      claimed,
      claimedByUserId: claimed ? claimedByUserId : null,
      lineIds: entries.map((entry) => entry.lineId),
    });
    for (const entry of entries) {
      announced.push({
        zoneId: entry.zoneId,
        listId: entry.listId,
        lineId: entry.lineId,
        claimed,
        claimedByUserId: claimed ? claimedByUserId : null,
      });
    }
  };

  const service = {
    claimsOf,
    async claimOf(lineId: string) {
      return claims[lineId] ?? NO_LINE_CLAIM;
    },
    async refsOf(generatedListId: string) {
      return refsOf(generatedListId);
    },
    async refsOfBasketLine(generatedListLineId: string) {
      return refsOf(generatedListLineId);
    },
    async announceReleased(entries: readonly ZoneLineClaimRef[]) {
      if (entries.length === 0) {
        return;
      }
      // The real one asks the derivation which of these nothing carries any more
      // (section 3.4). Here the map is the derivation, so the same filter runs
      // over it and a spec can leave a line claimed by a second basket.
      const resolved = await claimsOf(entries.map((entry) => entry.lineId));
      announce(
        false,
        null,
        entries.filter(
          (entry) => !(resolved.get(entry.lineId)?.claimed ?? false)
        )
      );
    },
    announce,
    /**
     * The claim window, which the overlap query asks for too (plan 0092).
     *
     * A day back rather than the real service's configured window, because
     * every basket a spec seeds is generated now and the only thing this has to
     * do is not exclude it.
     */
    since: () => new Date(Date.now() - 24 * 60 * 60 * 1000),
  } as unknown as LineClaimService;

  return { announced, calls, service };
}
