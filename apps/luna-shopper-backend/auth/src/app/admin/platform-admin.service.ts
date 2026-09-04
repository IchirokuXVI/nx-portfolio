import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminCredential } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  verifyAdminToken,
} from '@portfolio/luna-shopper/platform';
import type { AuthConfig } from '../config/app-config';

/**
 * Auth's platform admin gate (plan 0074).
 *
 * The third of these, after catalog's and the harvester's, and it exists for the
 * reason plan 0072 section 3 gives rather than out of symmetry: **every service
 * that acts on an operator token proves the signature itself.** A gateway route
 * added without `AdminJwtGuard` still cannot read the user table, because the
 * service behind it refuses.
 *
 * Two things it deliberately does **not** copy from catalog's version:
 *
 * - **There is no service branch.** Catalog has one because the harvester writes
 *   prices without holding a person's credential. Nothing writes to the user
 *   directory on a machine's behalf, so a request with no `adminToken` is refused
 *   here rather than falling through to an actor id check. Adding a service actor
 *   would mean a uuid in configuration could read every email address in the
 *   system, which is the shape of boundary plan 0072 removed.
 * - **It reads the key auth already holds.** `admin.publicKey` is the public half
 *   of the pair this same service signs with, so there is no new environment
 *   variable and no chance of the signer and the verifier disagreeing.
 */
@Injectable()
export class AuthPlatformAdminService {
  private readonly logger = new Logger(AuthPlatformAdminService.name);
  private readonly adminPublicKey: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService
  ) {
    this.adminPublicKey = config.getOrThrow<AuthConfig>('auth').admin.publicKey;
  }

  /**
   * Throw unless the caller presented a live operator token. Returns the admin's
   * id from the verified claims, which plan 0075 records as the actor.
   */
  async requireAdmin(credential: AdminCredential): Promise<string> {
    if (!credential?.adminToken) {
      throw new ForbiddenException('Only an operator can read the directory');
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
