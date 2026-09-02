import { Injectable } from '@nestjs/common';
import {
  PRICE_SCOPE_PATTERNS,
  PROFILE_PATTERNS,
  type CatalogScopeView,
  type ProfileScopeSelector,
  type ResolvedScopesView,
} from '@portfolio/luna-shopper/contracts';
import {
  CatalogScopeRequiredException,
  RedisService,
} from '@portfolio/luna-shopper/platform';
import { NatsClient } from '../messaging/nats-client';

/**
 * How long a resolved scope set stands with no invalidation (plan 0049, section
 * 2.1).
 *
 * The backstop, not the mechanism: every profile edit passes through this
 * gateway and drops the entry as it goes, so in the ordinary case the cache is
 * exactly as fresh as the user's last save. The minute covers what that cannot,
 * which is a chain remapping a postal code underneath us.
 */
export const SCOPE_CACHE_TTL_SECONDS = 60;

/**
 * One hash per user, fields keyed by profile, so an invalidation is a single
 * `DEL` on a key whose name is known from the `userId` alone. The shape matters:
 * a key per user and profile pair would need a scan to drop them all, and a
 * profile edit has to drop every entry that user has.
 */
export const userScopeKey = (userId: string) => `catalog:scope:${userId}`;

/** The field a resolution is stored under when the caller named no profile. */
const DEFAULT_FIELD = 'default';

/**
 * What a caller said about where they shop, in falling precedence: the scopes
 * themselves, then a place to resolve, then a profile of theirs, then nothing,
 * which means their default profile.
 */
export interface ScopeQuery {
  priceScopeIds?: string[];
  postalCodes?: string[];
  supermarketIds?: string[];
  profileId?: string;
}

/**
 * Resolving where the caller shops, before a catalog read runs (plan 0049,
 * sections 2.1, 3 and 3.1).
 *
 * **The gateway resolves and passes.** Two calls, in this order, and neither
 * service learns anything about the other's domain:
 *
 * 1. core, `profiles.resolveScopes`: what the user said. Postal codes as typed,
 *    the chains they listed, the chains they refused.
 * 2. catalog, `priceScope.resolve`: what that means today. The ladder in section
 *    3.1, the coverage flags in section 5, the scope ids to read with.
 *
 * Letting catalog call core itself was rejected because it inverts the
 * dependency direction every other plan has kept, and putting the scope set in
 * the JWT was rejected because it goes stale exactly when a user edits a
 * profile, which is the moment they expect the catalog to change.
 *
 * ## The cache, and how it is invalidated
 *
 * The pair of round trips is cached in Redis for a minute, shared across pods,
 * and dropped by {@link invalidate} the moment a profile is created, edited,
 * renamed, defaulted or deleted. Every one of those passes through this gateway,
 * which is what makes the write path the invalidation signal: `profiles.changed`
 * is emitted by core at the same instant for the user's other devices, and this
 * is the same event observed at its source. The gateway holds no broker
 * subscription and this plan is not the one that should give it its first,
 * because a minute of staleness in the worst case is what a subscription would
 * be buying.
 *
 * Redis being down degrades to a miss, per plan 0028 section 5: two extra NATS
 * calls, never a wrong answer.
 */
@Injectable()
export class ScopeResolutionService {
  constructor(
    private readonly nats: NatsClient,
    private readonly redis: RedisService
  ) {}

  /**
   * The scopes a catalog read runs against.
   *
   * With `explicitScopeIds`, the caller has already said where they shop and
   * nothing is resolved. Otherwise the named or default profile is, and a
   * profile holding neither a postal code nor a chain **fails** with
   * `CATALOG_SCOPE_REQUIRED` (section 3): it does not fall back to everything,
   * and it does not answer an empty page, because an empty page reads as "there
   * is nothing", which is a different and false statement.
   */
  async forRead(userId: string, query: ScopeQuery): Promise<string[]> {
    const { priceScopeIds } = await this.describe(userId, query);
    return priceScopeIds;
  }

  /**
   * The whole resolution, for `GET /v1/catalog/scope`: the ids, the reason for
   * each, and which postal codes nobody serves.
   */
  async describe(userId: string, query: ScopeQuery): Promise<CatalogScopeView> {
    if (query.priceScopeIds && query.priceScopeIds.length > 0) {
      // Already scopes. There is nothing to resolve and nothing to explain: the
      // caller named the warehouses, so no rung of the ladder was climbed.
      return {
        priceScopeIds: query.priceScopeIds,
        scopes: [],
        coverage: [],
        approximate: false,
        profileId: null,
        explicit: true,
      };
    }

    if (
      (query.postalCodes && query.postalCodes.length > 0) ||
      (query.supermarketIds && query.supermarketIds.length > 0)
    ) {
      const resolved = await this.askCatalog({
        userId,
        postalCodes: query.postalCodes ?? [],
        supermarketIds: query.supermarketIds ?? [],
        excludedSupermarketIds: [],
        // A caller who named a place has not named a profile, so there are no
        // refusals to apply. Stated rather than left off, so the empty case is
        // a decision on the page that makes it.
        excludedSupermarketLocationIds: [],
      });
      return { ...resolved, profileId: null, explicit: true };
    }

    const resolved = await this.resolve(userId, query.profileId);
    return resolved;
  }

  /**
   * The shops this caller has switched off (plan 0064, section 3).
   *
   * For the reads that offer a shop rather than price one, which need the
   * refusals without needing the scopes. **Deliberately not the cached path
   * above**: that one throws `CATALOG_SCOPE_REQUIRED` for a profile that has
   * said nothing, which is the right answer when the question is "what do prices
   * cost here" and the wrong one when it is "which shops are there". A profile
   * with no postal code still has opinions, and a person filling one in should
   * see their shops rather than an onboarding error.
   *
   * One round trip to core and no caching. The alternative is a second cache
   * keyed the same way as the scope one and invalidated by the same writes,
   * which is a copy of a mechanism to save a call that happens once per screen.
   */
  async refusedLocations(
    userId: string,
    profileId?: string
  ): Promise<string[]> {
    const selector = await this.nats.send<ProfileScopeSelector>(
      PROFILE_PATTERNS.resolveScopes,
      { userId, profileId }
    );
    return selector.excludedSupermarketLocationIds;
  }

  /**
   * Forget this user's resolutions (plan 0049, section 2.1).
   *
   * Called after every profile mutation the account controller performs, before
   * it answers, so the response a client receives and its next catalog read
   * cannot disagree.
   */
  async invalidate(userId: string): Promise<void> {
    await this.redis.tryCommand(
      (client) => client.del(userScopeKey(userId)),
      'catalog scope invalidate'
    );
  }

  /** The cached pair of round trips, keyed by user and profile. */
  private async resolve(
    userId: string,
    profileId?: string
  ): Promise<CatalogScopeView> {
    const field = profileId ?? DEFAULT_FIELD;
    const cached = await this.redis.tryCommand(
      (client) => client.hget(userScopeKey(userId), field),
      'catalog scope read'
    );
    if (cached) {
      try {
        return JSON.parse(cached) as CatalogScopeView;
      } catch {
        // An unreadable entry is a miss. Falling through rather than throwing
        // keeps one bad write from making every catalog read 500.
      }
    }

    const selector = await this.nats.send<ProfileScopeSelector>(
      PROFILE_PATTERNS.resolveScopes,
      { userId, profileId }
    );

    if (selector.empty) {
      // Deliberately not cached: the next thing this user does is fill the
      // profile in, and the read after that must not be answered from a minute
      // old "you have said nothing".
      throw new CatalogScopeRequiredException(
        'Add a postal code or choose a supermarket first',
        { details: { profileId: selector.profileId } }
      );
    }

    const resolved = await this.askCatalog({
      userId,
      postalCodes: selector.postalCodes,
      supermarketIds: selector.supermarketIds,
      excludedSupermarketIds: selector.excludedSupermarketIds,
      excludedSupermarketLocationIds: selector.excludedSupermarketLocationIds,
    });
    const view: CatalogScopeView = {
      ...resolved,
      profileId: selector.profileId,
      explicit: false,
    };

    await this.redis.tryCommand(async (client) => {
      await client.hset(userScopeKey(userId), field, JSON.stringify(view));
      // On the key rather than the field, because ioredis has no per field TTL
      // and the whole hash is one user's answers, which expire together.
      return client.expire(userScopeKey(userId), SCOPE_CACHE_TTL_SECONDS);
    }, 'catalog scope write');

    return view;
  }

  private askCatalog(request: {
    userId: string;
    postalCodes: string[];
    supermarketIds: string[];
    excludedSupermarketIds: string[];
    excludedSupermarketLocationIds: string[];
  }): Promise<ResolvedScopesView> {
    return this.nats.send<ResolvedScopesView>(
      PRICE_SCOPE_PATTERNS.resolve,
      request
    );
  }
}
