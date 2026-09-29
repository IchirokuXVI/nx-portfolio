import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  isPermission,
  UserKind,
  type AccessTokenClaims,
  type Permission,
} from '@portfolio/luna-shopper/contracts';
import { setRequestContext } from '@portfolio/luna-shopper/platform';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { GatewayConfig } from '../config/app-config';

/** The authenticated caller attached to the request. */
export interface CurrentUser {
  userId: string;
  kind: UserKind;
  /**
   * What the account may do beyond the ordinary, read from the token's `perms`
   * claim (plan 0175). `@RequirePermission` checks this, and `me` answers it.
   * Empty for a token signed before the claim existed, and for a guest.
   */
  permissions: readonly Permission[];
}

/**
 * Offline access token verification (plan 0004, section 10; plan 0005,
 * section 3). The gateway verifies the RS256 signature with auth's public key
 * alone, never calling auth per request. On success the resolved user id is
 * pinned into the request context so every log line for the request is tagged
 * with it.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<GatewayConfig>('gateway');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.authJwtPublicKey,
      algorithms: ['RS256'],
    });
  }

  validate(payload: AccessTokenClaims): CurrentUser {
    setRequestContext({ userId: payload.sub });
    return {
      userId: payload.sub,
      kind: payload.kind,
      permissions: permissionsFromClaim(payload.perms),
    };
  }
}

/**
 * The `perms` claim as the gateway trusts it: absent reads as none, and a value
 * that names no known permission is dropped rather than carried, so a token
 * signed by a newer auth cannot grant this gateway something it has never heard
 * of. The signature already proves auth wrote it.
 */
export function permissionsFromClaim(claim: unknown): Permission[] {
  return Array.isArray(claim) ? claim.filter(isPermission) : [];
}
