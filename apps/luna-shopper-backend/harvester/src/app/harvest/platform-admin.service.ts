import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminCredential } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  verifyAdminToken,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';

/**
 * The platform-admin gate (plan 0038, section 7; rewritten by plan 0072).
 *
 * **Every subject on this service is gated**, not just the writes, which is the
 * one way it differs from catalog's identical looking class. Nothing the
 * harvester exposes is open to ordinary users: not the runs, not the discovered
 * places, not the source configuration. The only user facing addition that was
 * designed, a public per item refresh, went to backlog 0006 with its cooldown.
 *
 * Since 0072 the evidence is a **signature** rather than a uuid drawn from
 * `PLATFORM_ADMIN_USER_IDS`, verified here against `ADMIN_JWT_PUBLIC_KEY`. The
 * harvester verifies for itself rather than trusting a flag from the gateway, for
 * the same reason catalog does: the downstream check is what makes a forgotten
 * guard upstream a broken route instead of an open one.
 *
 * The other half of catalog's gate is deliberately absent here. Catalog has a
 * service path because the harvester writes to it; **nothing writes to the
 * harvester**, so there is no service actor to configure and no second branch to
 * get wrong. A caller reaches these subjects with an operator token or not at
 * all.
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);
  private readonly adminPublicKey: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService
  ) {
    this.adminPublicKey =
      config.getOrThrow<HarvesterConfig>('harvester').adminJwtPublicKey;
  }

  /**
   * Throw unless the caller presented a valid operator token. Answers the
   * admin's id, which is the actor plan 0075 records against whatever the call
   * went on to do.
   */
  async requireAdmin(credential: AdminCredential): Promise<string> {
    if (!credential.adminToken) {
      throw new ForbiddenException(
        'Only the app owner can operate the harvester'
      );
    }

    try {
      const claims = await verifyAdminToken(
        this.jwt,
        credential.adminToken,
        this.adminPublicKey
      );
      return claims.sub;
    } catch (error) {
      // Logged, not returned: telling a caller whether a token was expired or
      // signed with the wrong key tells whoever is probing which half they have.
      this.logger.warn(
        `Refused an operator token: ${(error as Error).message}`
      );
      throw new ForbiddenException('That operator token was not accepted');
    }
  }
}
