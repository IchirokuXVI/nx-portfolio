import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  type AuthTokens,
} from '@portfolio/luna-shopper/contracts';
import {
  getRequestContext,
  THROTTLE_BUCKETS,
} from '@portfolio/luna-shopper/platform';
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
  @Throttle({ [THROTTLE_BUCKETS.registration]: {} })
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.register, {
      ...dto,
      locale: getRequestContext()?.locale,
    });
  }

  @Post('login')
  @Throttle({ [THROTTLE_BUCKETS.login]: {} })
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.login, dto);
  }

  @Post('verify-email')
  @Throttle({ [THROTTLE_BUCKETS.verifyResend]: {} })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ userId: string }> {
    return this.nats.send(AUTH_PATTERNS.verifyEmail, dto);
  }

  @Post('refresh')
  @SkipThrottle()
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.refresh, dto);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
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
