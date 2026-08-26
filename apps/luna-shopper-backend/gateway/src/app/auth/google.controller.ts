import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiFoundResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  type AuthTokens,
  type GoogleProfile,
} from '@portfolio/luna-shopper/contracts';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
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
  // The only route in the gateway with no response body to document: the guard
  // answers with a redirect before the handler runs, so what a client sees is a
  // `Location` header, not a payload.
  @ApiFoundResponse({
    description: "Redirects to Google's consent screen.",
  })
  @ApiProblemResponses()
  // The guard triggers the redirect to Google; this body never runs.
  start(): void {
    return;
  }

  @Get('callback')
  @UseGuards(AuthGuard('google'))
  @ApiContractResponse(AUTH_PATTERNS.googleLogin)
  @ApiProblemResponses({ auth: true })
  callback(@Req() req: { user?: GoogleProfile }): Promise<AuthTokens> {
    const profile = req.user as GoogleProfile;
    return this.nats.send(AUTH_PATTERNS.googleLogin, { ...profile });
  }
}
