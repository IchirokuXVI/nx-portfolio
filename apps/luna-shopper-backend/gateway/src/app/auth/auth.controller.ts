import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  type AuthTokens,
} from '@portfolio/luna-shopper/contracts';
import {
  getRequestContext,
  THROTTLE_LIMITS,
} from '@portfolio/luna-shopper/platform';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  LoginDto,
  RefreshDto,
  RegisterDto,
  UpgradeDto,
  VerifyEmailDto,
} from './auth.dto';
import { AuthUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { CurrentUser } from './jwt.strategy';

/**
 * The public auth surface (plan 0005). Each route proxies to the auth service
 * over NATS; the open ones carry stricter rate limit buckets (plan 0004,
 * section 8). Controllers are versioned independently (`v1`).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly nats: NatsClient) {}

  @Post('register')
  @Throttle(THROTTLE_LIMITS.registration)
  @ApiContractResponse(AUTH_PATTERNS.register, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.register, {
      ...dto,
      locale: getRequestContext()?.locale,
    });
  }

  @Post('login')
  @Throttle(THROTTLE_LIMITS.login)
  @ApiContractResponse(AUTH_PATTERNS.login, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, auth: true })
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.login, dto);
  }

  @Post('verify-email')
  @Throttle(THROTTLE_LIMITS.verifyResend)
  @ApiContractResponse(AUTH_PATTERNS.verifyEmail, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, membership: true })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ userId: string }> {
    return this.nats.send(AUTH_PATTERNS.verifyEmail, dto);
  }

  @Post('refresh')
  @SkipThrottle()
  @ApiContractResponse(AUTH_PATTERNS.refresh, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, auth: true, throttled: false })
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.refresh, dto);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(AUTH_PATTERNS.upgrade, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, auth: true, conflict: true })
  upgrade(
    @AuthUser() user: CurrentUser,
    @Body() dto: UpgradeDto
  ): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.upgrade, {
      userId: user.userId,
      ...dto,
      locale: getRequestContext()?.locale,
    });
  }
}
