import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceScopeKind,
  type PostalCodeCoverageView,
  type ResolvedScopesView,
  type ResolvedScopeView,
  type ResolvePriceScopesRequest,
} from '@portfolio/luna-shopper/contracts';
import { In, Repository } from 'typeorm';
import { PriceScope, Supermarket, SupermarketLocation } from '../entities';

/**
 * How long one resolution stands (plan 0049, section 1.1).
 *
 * Short on purpose, and short is the whole design: the mapping from a postal
 * code to a scope belongs to the chain and moves without telling us, which is
 * why it is not stored at all. A minute buys the repeat reads a search box makes
 * while somebody types, and costs at most a minute of a remapping nobody has
 * noticed yet.
 */
export const SCOPE_CACHE_TTL_MS = 60_000;

/** Beyond this many entries the oldest are dropped. A cache, not a table. */
const SCOPE_CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  value: ResolvedScopesView;
  expiresAt: number;
}

/**
 * Turns "these postal codes, these chains" into the scopes that answer it today
 * (plan 0049, sections 1.1 and 3.1).
 *
 * **It lives in catalog and not in core**, beside the scopes it resolves to.
 * Core stores what the user typed; this is the half that knows what a postal
 * code means this week, and putting it here is what lets an upstream remapping
 * change results with no data migration anywhere.
 *
 * ## The ladder, per chain
 *
 * 1. The chain's scopes that serve one of the caller's postal codes.
 * 2. Otherwise its `NATIONAL` scope, if it has one: a chain that prices
 *    nationally has no location to be asked about.
 * 3. Otherwise its owner set default scope, and the result is **flagged
 *    approximate**, so a client can say "prices shown for Madrid" rather than
 *    implying the number is the caller's.
 *
 * Rungs two and three are what "show me Mercadona" with no location resolves
 * through. Averaging across a chain's scopes is deliberately not a fourth rung:
 * an average price is a price that exists in no store.
 *
 * ## What the answer carries beyond the ids
 *
 * Every scope says which postal code reached it and by which rung, and every
 * postal code the caller asked about comes back in `coverage` saying whether
 * anybody we know serves it. A code no chain serves is not an error (section 5):
 * coverage is a property of our data, and the client explains it in words.
 */
@Injectable()
export class ScopeResolverService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    @InjectRepository(PriceScope)
    private readonly scopes: Repository<PriceScope>,
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>
  ) {}

  async resolve(req: ResolvePriceScopesRequest): Promise<ResolvedScopesView> {
    const postalCodes = dedupe(req.postalCodes ?? []);
    const included = dedupe(req.supermarketIds ?? []);
    const excluded = new Set(req.excludedSupermarketIds ?? []);

    const key = cacheKey(postalCodes, included, [...excluded].sort());
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }

    const value = await this.resolveUncached(postalCodes, included, excluded);
    this.remember(key, value);
    return value;
  }

  private async resolveUncached(
    postalCodes: string[],
    included: string[],
    excluded: Set<string>
  ): Promise<ResolvedScopesView> {
    // Rung one: the stores that actually sit in those postal codes, and the
    // scopes they price against.
    const serving =
      postalCodes.length === 0
        ? []
        : await this.locations.find({
            where: { postalCode: In(postalCodes) },
            select: {
              id: true,
              supermarketId: true,
              priceScopeId: true,
              postalCode: true,
            },
          });

    const coverage: PostalCodeCoverageView[] = postalCodes.map(
      (postalCode) => ({
        postalCode,
        served: serving.some((row) => row.postalCode === postalCode),
      })
    );

    // Which chains are in play: the ones the caller listed, or every chain that
    // serves them; then minus the exclusions. Intersection, in that order, which
    // is section 1.2's rule stated once.
    const candidates = (
      included.length > 0
        ? included
        : dedupe(serving.map((row) => row.supermarketId))
    ).filter((id) => !excluded.has(id));

    const scopes: ResolvedScopeView[] = [];
    const fallbackChains: string[] = [];

    for (const supermarketId of candidates) {
      const own = serving.filter((row) => row.supermarketId === supermarketId);
      if (own.length > 0) {
        for (const row of own) {
          scopes.push({
            priceScopeId: row.priceScopeId,
            supermarketId,
            postalCode: row.postalCode,
            origin: 'POSTAL_CODE',
            approximate: false,
          });
        }
        continue;
      }
      fallbackChains.push(supermarketId);
    }

    scopes.push(...(await this.ladderFor(fallbackChains)));

    // One entry per scope. A chain with three stores in one postal code prices
    // them all from one warehouse, and the caller wants the warehouse once.
    const unique = new Map<string, ResolvedScopeView>();
    for (const scope of scopes) {
      const existing = unique.get(scope.priceScopeId);
      // An exact reason beats an approximate one for the same scope: the id is
      // the same either way, and the explanation is what the client renders.
      if (!existing || (existing.approximate && !scope.approximate)) {
        unique.set(scope.priceScopeId, scope);
      }
    }
    const resolved = [...unique.values()];

    return {
      priceScopeIds: resolved.map((scope) => scope.priceScopeId),
      scopes: resolved,
      coverage,
      approximate: resolved.some((scope) => scope.approximate),
    };
  }

  /** Rungs two and three, for the chains rung one did not answer. */
  private async ladderFor(
    supermarketIds: string[]
  ): Promise<ResolvedScopeView[]> {
    if (supermarketIds.length === 0) {
      return [];
    }

    const [national, chains] = await Promise.all([
      this.scopes.find({
        where: {
          supermarketId: In(supermarketIds),
          kind: PriceScopeKind.NATIONAL,
        },
      }),
      this.supermarkets.find({ where: { id: In(supermarketIds) } }),
    ]);

    const nationalByChain = new Map(
      national.map((scope) => [scope.supermarketId, scope])
    );
    const defaultByChain = new Map(
      chains
        .filter((chain) => chain.defaultPriceScopeId !== null)
        .map((chain) => [chain.id, chain.defaultPriceScopeId as string])
    );

    const rungs: ResolvedScopeView[] = [];
    for (const supermarketId of supermarketIds) {
      const nationalScope = nationalByChain.get(supermarketId);
      if (nationalScope) {
        rungs.push({
          priceScopeId: nationalScope.id,
          supermarketId,
          postalCode: null,
          origin: 'NATIONAL',
          approximate: false,
        });
        continue;
      }
      const fallback = defaultByChain.get(supermarketId);
      if (fallback) {
        rungs.push({
          priceScopeId: fallback,
          supermarketId,
          postalCode: null,
          origin: 'CHAIN_DEFAULT',
          // The one place this is true, and the reason the field exists: the
          // price is real, and it is a price for somewhere else.
          approximate: true,
        });
      }
      // A chain off the end of the ladder contributes nothing, which is the
      // honest answer: we have no price for it anywhere the caller can reach.
    }
    return rungs;
  }

  private remember(key: string, value: ResolvedScopesView): void {
    if (this.cache.size >= SCOPE_CACHE_MAX_ENTRIES) {
      // Insertion ordered, so the first key is the oldest write. One eviction
      // per write past the cap is enough: this is a bound, not a policy.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { value, expiresAt: Date.now() + SCOPE_CACHE_TTL_MS });
  }
}

/** Order independent, so two callers asking the same thing share one entry. */
function cacheKey(
  postalCodes: string[],
  included: string[],
  excluded: string[]
): string {
  return JSON.stringify([
    [...postalCodes].sort(),
    [...included].sort(),
    excluded,
  ]);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
