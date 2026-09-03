import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminCredential } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  verifyAdminToken,
} from '@portfolio/luna-shopper/platform';
import type { CoreConfig } from '../config/app-config';

/**
 * Core's platform admin gate (plan 0074).
 *
 * Every admin subject in core calls this first, and it is the only thing
 * standing between an operator and somebody else's household: `ZoneAuthzService`
 * cannot help here, because an operator has no membership in the zone they are
 * looking at and the entire point of these subjects is that they work anyway.
 *
 * So the check is the signature, verified here rather than trusted from the
 * payload, which is plan 0072 section 3's property arriving in a third service:
 * a gateway route added without `AdminJwtGuard` still cannot read a stranger's
 * list, because core refuses it.
 *
 * **No service branch**, unlike catalog's. Catalog has one because the harvester
 * writes prices as a machine; nothing writes to a household's data on a machine's
 * behalf, and a configured uuid that could read every list in the system is the
 * shape of boundary plan 0072 existed to remove.
 */
@Injectable()
export class CorePlatformAdminService {
  private readonly logger = new Logger(CorePlatformAdminService.name);
  private readonly adminPublicKey: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService
  ) {
    this.adminPublicKey =
      config.getOrThrow<CoreConfig>('core').adminJwtPublicKey;
  }

  /**
   * Throw unless the caller presented a live operator token. Returns the admin's
   * id from the verified claims, which plan 0075 records as the actor.
   */
  async requireAdmin(credential: AdminCredential): Promise<string> {
    if (!credential?.adminToken) {
      throw new ForbiddenException('Only an operator can read this');
    }

    try {
      const claims = await verifyAdminToken(
        this.jwt,
        credential.adminToken,
        this.adminPublicKey
      );
      return claims.sub;
    } catch (error) {
      // Logged, not returned: "expired" and "wrong key" tell somebody probing the
      // difference which of the two they got right.
      this.logger.warn(
        `Refused an operator token: ${(error as Error).message}`
      );
      throw new ForbiddenException('That operator token was not accepted');
    }
  }
}
