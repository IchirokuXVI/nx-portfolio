import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  MEMBERSHIP_PATTERNS,
  type ListMembersRequest,
  type MembershipActionRequest,
  type MembershipPage,
  type MembershipView,
  type SetMembershipUsernameRequest,
} from '@portfolio/luna-shopper/contracts';
import { MemberListingService } from './member-listing.service';
import { MembershipService } from './membership.service';

/** Core's membership governance NATS surface (plan 0006, section 4). */
@Controller()
export class MembershipController {
  constructor(
    private readonly membership: MembershipService,
    private readonly members: MemberListingService
  ) {}

  @MessagePattern(MEMBERSHIP_PATTERNS.list)
  list(@Payload() req: ListMembersRequest): Promise<MembershipPage> {
    return this.members.list(req);
  }

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

  @MessagePattern(MEMBERSHIP_PATTERNS.setUsername)
  setUsername(
    @Payload() req: SetMembershipUsernameRequest
  ): Promise<MembershipView> {
    return this.membership.setUsername(req);
  }
}
