import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  AUTH_PATTERNS,
  type AuthTokens,
  type ResendVerificationResult,
  type RetryAfterResult,
} from '@portfolio/luna-shopper/contracts';
import {
  getRequestContext,
  THROTTLE_LIMITS,
} from '@portfolio/luna-shopper/platform';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
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
  // Consuming a link is not resending one, and the resend bucket used to sit here
  // (plan 0021, section 4.3): a mail client that prefetches links, a double tap
  // and one genuine retry could exhaust it, refusing a link that would have
  // worked.
  @Throttle(THROTTLE_LIMITS.verifyConsume)
  @ApiContractResponse(AUTH_PATTERNS.verifyEmail, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, membership: true })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ userId: string }> {
    return this.nats.send(AUTH_PATTERNS.verifyEmail, dto);
  }

  /**
   * Resend the confirmation link (plan 0021, section 4). Bearer authenticated and
   * bodyless: the address is the caller's own, and only a token says whose that
   * is. The response carries the wait, so the client counts down the number the
   * server gave it rather than a hardcoded sixty.
   */
  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Throttle(THROTTLE_LIMITS.verifyResend)
  @ApiContractResponse(AUTH_PATTERNS.resendVerification, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ auth: true, conflict: true })
  resendVerification(
    @AuthUser() user: CurrentUser
  ): Promise<ResendVerificationResult> {
    return this.nats.send(AUTH_PATTERNS.resendVerification, {
      userId: user.userId,
      locale: getRequestContext()?.locale,
    });
  }

  /**
   * Ask for a password reset link (plan 0022, section 2). Unauthenticated, and
   * deliberately incurious: the answer is the same for an address with an
   * account, an address with none and an address that signs in with Google, so a
   * caller cannot use it to learn which addresses are registered.
   */
  @Post('forgot-password')
  @Throttle(THROTTLE_LIMITS.passwordReset)
  @ApiContractResponse(AUTH_PATTERNS.forgotPassword, {
    status: HttpStatus.CREATED,
    description:
      'Accepted. This says nothing about whether the address has an account: tell the user that if it does, a link is on its way, and never claim delivery.',
  })
  @ApiProblemResponses({ body: true })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<RetryAfterResult> {
    return this.nats.send(AUTH_PATTERNS.forgotPassword, {
      ...dto,
      locale: getRequestContext()?.locale,
    });
  }

  /**
   * Spend a reset link (plan 0022, section 3). Answers with a token pair, so the
   * user lands signed in rather than at a sign in form asking for the password
   * they chose eight seconds ago.
   */
  @Post('reset-password')
  @ApiContractResponse(AUTH_PATTERNS.resetPassword, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<AuthTokens> {
    return this.nats.send(AUTH_PATTERNS.resetPassword, dto);
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
