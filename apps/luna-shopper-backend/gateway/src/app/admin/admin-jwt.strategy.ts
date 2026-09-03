import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  ADMIN_TOKEN_AUDIENCE,
  type AdminTokenClaims,
} from '@portfolio/luna-shopper/contracts';
import { setRequestContext } from '@portfolio/luna-shopper/platform';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { GatewayConfig } from '../config/app-config';

/** The authenticated operator attached to the request. */
export interface CurrentAdmin {
  adminId: string;
  username?: string;
}

/**
 * Offline verification of an operator token (plan 0071, sections 3 and 5).
 *
 * Registered under its own passport name, `admin-jwt`, so a handler asks for one
 * principal or the other and can never accept whichever turns up. It is a
 * separate strategy for the same reason the key is separate: `JwtStrategy` and
 * this one have different trust roots, and a single strategy branching on a claim
 * would be one forgotten `if` away from letting a velista access token through.
 *
 * Two checks, and the audience is the one worth arguing for. The signature
 * already separates the principals, since a velista token is signed with the auth
 * key and will not verify here at all. Requiring `aud: platform-admin` anyway is
 * what keeps a future key consolidation from silently merging them: the check
 * that is redundant today is the check that is load bearing the day somebody
 * decides one keypair is enough.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<GatewayConfig>('gateway');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.adminJwtPublicKey,
      algorithms: ['RS256'],
      audience: ADMIN_TOKEN_AUDIENCE,
    });
  }

  validate(payload: AdminTokenClaims): CurrentAdmin {
    // The same pinning `JwtStrategy` does, so every log line for the request
    // names who made it. `userId` is the field the correlation context has; an
    // operator id is what fills it here, and plan 0075's audit rows are the
    // durable record.
    setRequestContext({ userId: payload.sub });
    return { adminId: payload.sub };
  }
}
