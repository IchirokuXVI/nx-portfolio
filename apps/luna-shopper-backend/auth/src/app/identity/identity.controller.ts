import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  STATS_PATTERNS,
  type AuthTokens,
  type ConsumeOAuthStateRequest,
  type DeleteAccountRequest,
  type DeleteAccountResult,
  type ForgotPasswordRequest,
  type GetProfileRequest,
  type GoogleLoginRequest,
  type IdentityStats,
  type LoginRequest,
  type MintOAuthStateRequest,
  type MintOAuthStateResult,
  type MintParticipantTokenRequest,
  type MintParticipantTokenResult,
  type OAuthStatePayload,
  type RefreshRequest,
  type RegisterRequest,
  type ResendVerificationRequest,
  type ResendVerificationResult,
  type ResetPasswordRequest,
  type RetryAfterResult,
  type SetUsernameRequest,
  type UpgradeRequest,
  type UserProfileView,
  type VerifyEmailRequest,
} from '@portfolio/luna-shopper/contracts';
import { TokenService } from '../tokens/token.service';
import { IdentityService } from './identity.service';
import { StatsService } from './stats.service';

/**
 * The auth service's NATS surface (plan 0005). Each handler answers one subject
 * from the shared contract; the gateway is the only caller. Domain errors thrown
 * by {@link IdentityService} are turned into the house error envelope by the
 * global exception filter (plan 0004) and travel back over the broker as a code
 * the gateway maps to an HTTP status.
 */
@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly stats: StatsService,
    private readonly tokens: TokenService
  ) {}

  /** Platform identity totals (plan 0017, section 8). Takes no argument. */
  @MessagePattern(STATS_PATTERNS.identity)
  identityStats(): Promise<IdentityStats> {
    return this.stats.identity();
  }

  @MessagePattern(AUTH_PATTERNS.createTemporaryUser)
  createTemporaryUser(): Promise<AuthTokens> {
    return this.identity.createTemporaryUser();
  }

  @MessagePattern(AUTH_PATTERNS.register)
  register(@Payload() req: RegisterRequest): Promise<AuthTokens> {
    return this.identity.register(req);
  }

  @MessagePattern(AUTH_PATTERNS.login)
  login(@Payload() req: LoginRequest): Promise<AuthTokens> {
    return this.identity.login(req);
  }

  @MessagePattern(AUTH_PATTERNS.verifyEmail)
  verifyEmail(@Payload() req: VerifyEmailRequest): Promise<{ userId: string }> {
    return this.identity.verifyEmail(req.token);
  }

  @MessagePattern(AUTH_PATTERNS.resendVerification)
  resendVerification(
    @Payload() req: ResendVerificationRequest
  ): Promise<ResendVerificationResult> {
    return this.identity.resendVerification(req);
  }

  @MessagePattern(AUTH_PATTERNS.forgotPassword)
  forgotPassword(
    @Payload() req: ForgotPasswordRequest
  ): Promise<RetryAfterResult> {
    return this.identity.forgotPassword(req);
  }

  @MessagePattern(AUTH_PATTERNS.resetPassword)
  resetPassword(@Payload() req: ResetPasswordRequest): Promise<AuthTokens> {
    return this.identity.resetPassword(req);
  }

  @MessagePattern(AUTH_PATTERNS.refresh)
  refresh(@Payload() req: RefreshRequest): Promise<AuthTokens> {
    return this.identity.refresh(req.refreshToken);
  }

  @MessagePattern(AUTH_PATTERNS.upgrade)
  upgrade(@Payload() req: UpgradeRequest): Promise<AuthTokens> {
    return this.identity.upgrade(req);
  }

  @MessagePattern(AUTH_PATTERNS.googleLogin)
  googleLogin(@Payload() req: GoogleLoginRequest): Promise<AuthTokens> {
    return this.identity.googleLogin(req);
  }

  @MessagePattern(AUTH_PATTERNS.mintOAuthState)
  mintOAuthState(
    @Payload() req: MintOAuthStateRequest
  ): Promise<MintOAuthStateResult> {
    return this.identity.mintOAuthState(req);
  }

  @MessagePattern(AUTH_PATTERNS.consumeOAuthState)
  consumeOAuthState(
    @Payload() req: ConsumeOAuthStateRequest
  ): Promise<OAuthStatePayload> {
    return this.identity.consumeOAuthState(req);
  }

  @MessagePattern(AUTH_PATTERNS.deleteAccount)
  deleteAccount(
    @Payload() req: DeleteAccountRequest
  ): Promise<DeleteAccountResult> {
    return this.identity.deleteAccount(req);
  }

  @MessagePattern(AUTH_PATTERNS.setUsername)
  setUsername(@Payload() req: SetUsernameRequest): Promise<UserProfileView> {
    return this.identity.setUsername(req);
  }

  @MessagePattern(AUTH_PATTERNS.getProfile)
  getProfile(@Payload() req: GetProfileRequest): Promise<UserProfileView> {
    return this.identity.getProfile(req);
  }

  /**
   * Sign a participant's basket scoped socket token (plan 0051, section 9).
   *
   * The one handler here that authorizes nothing. Core has already established
   * that this participant is live on this basket, by the single indexed read
   * section 3.3 specifies, and auth is called for the private key alone. Written
   * as a pass through on purpose: giving it a rule of its own would mean two
   * services deciding who may hold a basket, which is how they come to disagree.
   */
  @MessagePattern(AUTH_PATTERNS.mintParticipantToken)
  mintParticipantToken(
    @Payload() req: MintParticipantTokenRequest
  ): Promise<MintParticipantTokenResult> {
    return this.tokens.signParticipantToken(req);
  }
}
