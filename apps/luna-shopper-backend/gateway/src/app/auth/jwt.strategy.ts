import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  UserKind,
  type AccessTokenClaims,
} from '@portfolio/luna-shopper/contracts';
import { setRequestContext } from '@portfolio/luna-shopper/platform';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { GatewayConfig } from '../config/app-config';

/** The authenticated caller attached to the request. */
export interface CurrentUser {
  userId: string;
  kind: UserKind;
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
    return { userId: payload.sub, kind: payload.kind };
  }
}
