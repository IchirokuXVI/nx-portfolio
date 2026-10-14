import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AUTH_PATTERNS,
  type RecoverySignInResult,
} from '@portfolio/luna-shopper/contracts';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { RecoverySignInDto } from './auth.dto';
import { AuthUser } from './current-user.decorator';
import { OptionalJwtAuthGuard } from './jwt-auth.guard';
import type { CurrentUser } from './jwt.strategy';
import { RefuseImpersonation } from './refuse-impersonation.decorator';

/**
 * Sign in with a reset link and keep the password (plan 0210, target state 5).
 *
 * A controller of its own so that `WithholdBodyMiddleware` applies to this
 * route and to no other in the auth surface: the body is a raw reset token, a
 * key to an account until it is spent, and the constraint of the plan is that
 * a raw token is never logged. The error log prints the body of a request that
 * failed with a 500, so the route is marked before any guard can fail it.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class RecoverySignInController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Spend a reset link as a sign in. The same grant `reset-password` spends,
   * so the first of the two links to be used ends the other.
   *
   * **Optionally authenticated, with the guard of plan 0020.** No bearer is
   * the ordinary case: somebody opened the link on a device that is signed
   * out. A bearer that holds up says who is asking, and that decides the
   * answer: its owner is told they are already signed in and keeps the
   * session, and anybody else is refused with `recovery_other_account` until
   * they agree to leave. A stale bearer is a 401 and not a quiet anonymous
   * request, so the client refreshes and asks again rather than replacing a
   * session by accident.
   *
   * The caller comes from the verified token and never from the body. Spending
   * happens only here, on a POST: the page that opens the link never calls this
   * on load, because mail scanners open links.
   *
   * No `@Throttle` of its own, which is the bucket `reset-password` uses: the
   * default one. Both spend a 256 bit single use token.
   */
  @Post('recovery-sign-in')
  // A support session cannot press this (plan 0194, joined by plan 0210): it
  // would trade the session of the operator for a real one. Auth refuses it
  // too, so the rule holds if this list drifts.
  @RefuseImpersonation()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiContractResponse(AUTH_PATTERNS.recoverySignIn, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    body: true,
    auth: true,
    impersonation: 'refused',
    recovery: 'signIn',
  })
  recoverySignIn(
    @Body() dto: RecoverySignInDto,
    @AuthUser() user?: CurrentUser
  ): Promise<RecoverySignInResult> {
    return this.nats.send(AUTH_PATTERNS.recoverySignIn, {
      token: dto.token,
      ...(dto.switchAccount === undefined
        ? {}
        : { switchAccount: dto.switchAccount }),
      ...(user ? { callerUserId: user.userId } : {}),
      ...(user?.impersonation ? { supportSession: true } : {}),
    });
  }
}
