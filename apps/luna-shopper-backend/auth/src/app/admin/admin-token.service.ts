import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  type AdminAuthTokens,
} from '@portfolio/luna-shopper/contracts';
import type { AuthConfig } from '../config/app-config';
import type { AdminUser } from '../entities';
import { parseDurationMs } from '../tokens/duration';

/**
 * Signs operator tokens (plan 0071, sections 3 and 4).
 *
 * Deliberately not a method on `TokenService`. That class holds the user facing
 * keypair and the refresh token table, and the two things this one must never do
 * are reach for that key or write a long lived credential. Keeping them apart
 * means neither can acquire the other's behaviour by somebody adding a parameter.
 *
 * There is no refresh token here and no row anywhere: the session is one short
 * lived token that renews itself while it is still valid
 * (`apps/luna-shopper-admin/plans/0003`). A long lived credential for an account
 * that can read every user's data is exactly what this design refuses to hold.
 */
@Injectable()
export class AdminTokenService {
  private readonly config: AuthConfig;

  constructor(
    private readonly jwt: JwtService,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  /**
   * Signs a token for one admin and states when it lapses.
   *
   * `sub` is the admin's id, which is also the actor id on plan 0075's audit
   * rows, and `aud` is the constant `platform-admin`. There is no `kind` claim:
   * `UserKind` describes velista users, and an admin is not one, so any value
   * would be a lie a guard could act on.
   *
   * `expiresAt` is computed from the same duration string the token is signed
   * with, rather than read back out of the JWT, so the caller never has to decode
   * a token to know how long it has.
   */
  async issue(
    admin: Pick<AdminUser, 'id' | 'username' | 'displayName'>
  ): Promise<AdminAuthTokens> {
    const ttl = this.config.admin.accessTokenTtl;
    const accessToken = await this.jwt.signAsync(
      { sub: admin.id },
      {
        privateKey: this.config.admin.privateKey,
        algorithm: 'RS256',
        // A different `kid` from the auth key, so a verification failure says
        // which key was expected rather than only "invalid signature".
        keyid: this.config.admin.kid,
        audience: ADMIN_TOKEN_AUDIENCE,
        // The TTL is a validated duration string; cast to the ms-typed property
        // jsonwebtoken accepts at runtime.
        expiresIn: ttl as JwtSignOptions['expiresIn'],
      }
    );

    return {
      adminId: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      accessToken,
      expiresAt: new Date(Date.now() + parseDurationMs(ttl)).toISOString(),
    };
  }
}
