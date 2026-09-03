import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_USER_PATTERNS,
  type AdminZonePage,
  type AdminZoneRowPage,
  type ResolveAdminUsersResult,
} from '@portfolio/luna-shopper/contracts';
import { NatsClient } from '../messaging/nats-client';
import { adminCredential } from './admin-credential';
import type { CurrentAdmin } from './admin-jwt.strategy';

/**
 * The join that does not exist (plan 0074, section 3).
 *
 * Zones live in core's Postgres and users live in auth's. There is no foreign key
 * between them and there deliberately never has been, which is the same seam
 * `catalog-client.service` keeps on the other side: ids cross the boundary as
 * opaque values and no query mentions another service's table. So a screen that
 * wants a zone **and** its owner's name is two calls and a join here, in the one
 * place that talks to both services.
 *
 * Three properties this class exists to guarantee, all of them from section 3:
 *
 * - **One batched call, never N.** The ids come from a page that has already been
 *   fetched, so the fan out is bounded by the page size, and it is sent as a
 *   single request rather than one per row.
 * - **A failed decoration never fails the listing.** If auth is down, slow, or
 *   simply does not know an id, the zone still renders. The fallback is the id
 *   itself, which is what section 3 says to show and is more useful than an empty
 *   cell: an operator can paste it into the user screen.
 * - **The names are the only thing crossing.** The batched call answers with a
 *   username and a display name per id, and nothing else. A decoration that
 *   carried email addresses would leak one into every screen that only wanted to
 *   render a name.
 */
@Injectable()
export class AdminUserNamesService {
  private readonly logger = new Logger(AdminUserNamesService.name);

  constructor(private readonly nats: NatsClient) {}

  /**
   * A page of zones with each owner's name attached.
   *
   * Zones with no owner are skipped rather than sent as an id auth will not find:
   * an ownerless zone is plan 0011's deliberate state, not a missing name, and
   * asking about `null` would be a request that can only fail.
   */
  async decorateZones(
    admin: CurrentAdmin,
    page: AdminZonePage
  ): Promise<AdminZoneRowPage> {
    const ids = [
      ...new Set(
        page.items
          .map((zone) => zone.ownerUserId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const names = await this.resolve(admin, ids);

    return {
      nextCursor: page.nextCursor,
      items: page.items.map((zone) => ({
        ...zone,
        ownerName: zone.ownerUserId
          ? // The id itself when the name is missing, per section 3. Not null,
            // and not an empty string: the row must still identify its owner.
            (names.get(zone.ownerUserId) ?? zone.ownerUserId)
          : null,
      })),
    };
  }

  /**
   * Usernames by id, best effort.
   *
   * The catch is the whole point and not defensive habit. This call decorates a
   * listing that has already succeeded, so every failure mode of it, a NATS
   * timeout, an auth service that is restarting, a token that expired between the
   * two calls, has the same correct answer: return no names, let the caller fall
   * back to the ids, and log it. Rethrowing would turn "we could not label the
   * rows" into "the page is unavailable", which is the trade section 3 refuses.
   */
  private async resolve(
    admin: CurrentAdmin,
    userIds: string[]
  ): Promise<Map<string, string>> {
    if (!userIds.length) {
      return new Map();
    }

    try {
      const result = await this.nats.send<ResolveAdminUsersResult>(
        ADMIN_USER_PATTERNS.resolveMany,
        { ...adminCredential(admin), userIds }
      );
      return new Map(
        (result?.users ?? []).map((user) => [user.userId, user.username])
      );
    } catch (error) {
      this.logger.warn(
        `Could not resolve ${userIds.length} owner names; rendering ids instead: ${
          (error as Error).message
        }`
      );
      return new Map();
    }
  }
}
