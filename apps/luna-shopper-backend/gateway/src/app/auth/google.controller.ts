import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  type AuthTokens,
  type GoogleProfile,
} from '@portfolio/luna-shopper/contracts';
import { NatsClient } from '../messaging/nats-client';

/**
 * Google login endpoints (plan 0005, section 4.4). `GET /v1/auth/google` starts
 * the OAuth redirect; Google returns to the callback, where the resolved profile
 * is handed to auth to create a new registered user or link onto an existing one.
 * Registered only when Google is configured.
 */
@ApiTags('auth')
@Controller({ path: 'auth/google', version: '1' })
export class GoogleController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @UseGuards(AuthGuard('google'))
  // The guard triggers the redirect to Google; this body never runs.
  start(): void {
    return;
  }

  @Get('callback')
  @UseGuards(AuthGuard('google'))
  callback(@Req() req: { user?: GoogleProfile }): Promise<AuthTokens> {
    const profile = req.user as GoogleProfile;
    return this.nats.send(AUTH_PATTERNS.googleLogin, { ...profile });
  }
}
