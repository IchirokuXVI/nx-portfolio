import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ASSISTANT_ALLOWANCE_PATTERNS,
  type AssistantAllowanceView,
  type ReadAllowanceRequest,
  type ReserveAllowanceRequest,
  type ReserveAllowanceResponse,
  type SettleAllowanceRequest,
  type SettleAllowanceResponse,
} from '@portfolio/luna-shopper/contracts';
import { AssistantAllowanceService } from './assistant-allowance.service';

/**
 * Core's allowance surface (plan 0234, section 5). The assistant is the only
 * caller: it reserves before a provider call, settles after it, and reads a
 * person's usage for the gateway's `GET /v1/assistant/allowance`.
 */
@Controller()
export class AssistantAllowanceController {
  constructor(private readonly allowance: AssistantAllowanceService) {}

  @MessagePattern(ASSISTANT_ALLOWANCE_PATTERNS.reserve)
  reserve(
    @Payload() req: ReserveAllowanceRequest
  ): Promise<ReserveAllowanceResponse> {
    return this.allowance.reserve(req);
  }

  @MessagePattern(ASSISTANT_ALLOWANCE_PATTERNS.settle)
  settle(
    @Payload() req: SettleAllowanceRequest
  ): Promise<SettleAllowanceResponse> {
    return this.allowance.settle(req);
  }

  @MessagePattern(ASSISTANT_ALLOWANCE_PATTERNS.read)
  read(@Payload() req: ReadAllowanceRequest): Promise<AssistantAllowanceView> {
    return this.allowance.read(req);
  }
}
