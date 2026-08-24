import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  MEMBERSHIP_PATTERNS,
  type MembershipActionRequest,
  type MembershipView,
} from '@portfolio/luna-shopper/contracts';
import { MembershipService } from './membership.service';

/** Core's membership governance NATS surface (plan 0006, section 4). */
@Controller()
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @MessagePattern(MEMBERSHIP_PATTERNS.approve)
  approve(@Payload() req: MembershipActionRequest): Promise<MembershipView> {
    return this.membership.approve(req);
  }

  @MessagePattern(MEMBERSHIP_PATTERNS.reject)
  reject(@Payload() req: MembershipActionRequest): Promise<{ id: string }> {
    return this.membership.reject(req);
  }

  @MessagePattern(MEMBERSHIP_PATTERNS.kick)
  kick(@Payload() req: MembershipActionRequest): Promise<MembershipView> {
    return this.membership.kick(req);
  }

  @MessagePattern(MEMBERSHIP_PATTERNS.ban)
  ban(@Payload() req: MembershipActionRequest): Promise<MembershipView> {
    return this.membership.ban(req);
  }
}
