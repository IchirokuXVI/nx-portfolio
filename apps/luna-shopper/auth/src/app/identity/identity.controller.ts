import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  type AuthTokens,
  type GoogleLoginRequest,
  type LoginRequest,
  type RefreshRequest,
  type RegisterRequest,
  type UpgradeRequest,
  type VerifyEmailRequest,
} from '@portfolio/luna-shopper/contracts';
import { IdentityService } from './identity.service';

/**
 * The auth service's NATS surface (plan 0005). Each handler answers one subject
 * from the shared contract; the gateway is the only caller. Domain errors thrown
 * by {@link IdentityService} are turned into the house error envelope by the
 * global exception filter (plan 0004) and travel back over the broker as a code
 * the gateway maps to an HTTP status.
 */
@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

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
}
