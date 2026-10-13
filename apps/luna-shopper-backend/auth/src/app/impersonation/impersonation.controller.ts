import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  IMPERSONATION_PATTERNS,
  type AuthTokens,
  type CheckImpersonationRequest,
  type CheckImpersonationResult,
  type EndImpersonationRequest,
  type EndImpersonationResult,
  type ExchangeImpersonationRequest,
  type ImpersonationStatusRequest,
  type ImpersonationStatusView,
  type StartImpersonationRequest,
  type StartImpersonationResult,
} from '@portfolio/luna-shopper/contracts';
import { ImpersonationService } from './impersonation.service';

/**
 * Support sessions on the broker (plan 0194).
 *
 * Its own controller, beside `AdminController` and `IdentityController` and in
 * neither. Two of these subjects take an operator token and three do not, so
 * the set belongs to no one principal, and a reader who opens this file sees
 * every way a support session starts, renews its claim to be live, and ends.
 *
 * `status` and `start` are gated inside the service on the forwarded operator
 * token, as every admin subject is. The others carry no operator token by
 * design: `exchange` is reached with the single use code, and `end` and `check`
 * with the session id that the gateway read from a verified token.
 */
@Controller()
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @MessagePattern(IMPERSONATION_PATTERNS.status)
  status(
    @Payload() req: ImpersonationStatusRequest
  ): Promise<ImpersonationStatusView> {
    return this.impersonation.status(req);
  }

  @MessagePattern(IMPERSONATION_PATTERNS.start)
  start(
    @Payload() req: StartImpersonationRequest
  ): Promise<StartImpersonationResult> {
    return this.impersonation.start(req);
  }

  @MessagePattern(IMPERSONATION_PATTERNS.exchange)
  exchange(@Payload() req: ExchangeImpersonationRequest): Promise<AuthTokens> {
    return this.impersonation.exchange(req);
  }

  @MessagePattern(IMPERSONATION_PATTERNS.end)
  end(
    @Payload() req: EndImpersonationRequest
  ): Promise<EndImpersonationResult> {
    return this.impersonation.end(req);
  }

  @MessagePattern(IMPERSONATION_PATTERNS.check)
  check(
    @Payload() req: CheckImpersonationRequest
  ): Promise<CheckImpersonationResult> {
    return this.impersonation.check(req);
  }
}
