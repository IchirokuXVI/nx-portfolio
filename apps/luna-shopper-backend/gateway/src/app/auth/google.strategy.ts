import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { GoogleProfile } from '@portfolio/luna-shopper/contracts';
import { Strategy, type Profile } from 'passport-google-oauth20';
import type { GatewayConfig } from '../config/app-config';

/**
 * Google OAuth at the gateway (plan 0005, section 4.4). The passport dance runs
 * here; on success `validate` distills the Google profile to the fields auth
 * needs, and the controller asks auth to create or link the account. Provided
 * only when Google is configured (see the gateway auth module), so an unset
 * client id never breaks boot.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const { google } = configService.getOrThrow<GatewayConfig>('gateway');
    super({
      clientID: google.clientId,
      clientSecret: google.clientSecret,
      callbackURL: google.callbackUrl,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile
  ): GoogleProfile {
    return {
      providerUserId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
    };
  }
}
