import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminCredential } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  verifyAdminToken,
} from '@portfolio/luna-shopper/platform';
import type { CatalogConfig } from '../config/app-config';

/**
 * Who catalog let through, and on what evidence. Returned so plan 0075 can
 * record the actor without asking a second time, and so a caller that needs to
 * know a machine wrote a row can tell.
 */
export interface CatalogActor {
  kind: 'admin' | 'service';
  /** The admin's id from the verified token, or the service's configured uuid. */
  actorId: string;
}

/**
 * The platform-admin gate (plan 0012, section 3; rewritten by plan 0072).
 *
 * Catalog is owner curated: only the app owner may write supermarkets,
 * locations, items and per location prices. Reads are open, so only the write
 * paths call {@link requireAdmin}.
 *
 * **What changed in 0072 is what "owner" means.** It used to be a uuid in
 * `PLATFORM_ADMIN_USER_IDS`, checked with `.has()`. That was never the boundary
 * it looked like: a uuid is not a secret, so anything able to publish on NATS
 * could claim to be an admin by sending an allowlisted one. It is now a
 * **signature**, verified here against `ADMIN_JWT_PUBLIC_KEY`, and the weaker
 * check is gone rather than kept beside it.
 *
 * Catalog verifies for itself rather than trusting an `isPlatformAdmin` flag the
 * gateway could set. That is the one property the rewrite was careful to keep: a
 * gateway route that forgets its guard still cannot write the catalog.
 *
 * There are two ways through, because there are two kinds of caller and only one
 * of them is a person:
 *
 * - **an admin**, presenting the token the gateway forwarded, and
 * - **a service**, presenting its own configured actor id and no token.
 *
 * The harvester is the only service, and giving it a credential shaped like a
 * person's is exactly the confusion 0072 set out to end: a machine is not an
 * admin. Its uuid is a single stable value that never changes when an admin is
 * created, which is what makes creating an admin a database write with no
 * restart anywhere.
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);
  private readonly adminPublicKey: string;
  private readonly serviceActorIds: ReadonlySet<string>;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService
  ) {
    const catalog = config.getOrThrow<CatalogConfig>('catalog');
    this.adminPublicKey = catalog.adminJwtPublicKey;
    this.serviceActorIds = new Set(catalog.serviceActorIds);
  }

  /**
   * Throw unless the caller is the app owner or a configured service. Called
   * first by every write.
   *
   * The two branches refuse separately, and with different words, so a log line
   * says which one turned the caller away: an operator whose token has lapsed and
   * a service whose uuid was never configured are different operational problems
   * with the same HTTP status.
   */
  async requireAdmin(credential: AdminCredential): Promise<CatalogActor> {
    if (credential.adminToken) {
      return { kind: 'admin', actorId: await this.verify(credential) };
    }

    if (credential.userId && this.serviceActorIds.has(credential.userId)) {
      return { kind: 'service', actorId: credential.userId };
    }

    throw new ForbiddenException('Only the app owner can manage the catalog');
  }

  private async verify(credential: AdminCredential): Promise<string> {
    try {
      const claims = await verifyAdminToken(
        this.jwt,
        credential.adminToken as string,
        this.adminPublicKey
      );
      return claims.sub;
    } catch (error) {
      // The reason is logged and not returned. A caller learns only that the
      // token was refused, because "expired" and "wrong key" tell somebody
      // probing the difference which of the two they got right.
      this.logger.warn(
        `Refused an operator token: ${(error as Error).message}`
      );
      throw new ForbiddenException('That operator token was not accepted');
    }
  }
}
