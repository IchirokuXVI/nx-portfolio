import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  IDENTITY_EVENTS,
  RECONCILIATION_PATTERNS,
  type UserDeletedEvent,
  type UsersWithoutMembershipsRequest,
  type UsersWithoutMembershipsResponse,
} from '@portfolio/luna-shopper/contracts';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Core's account surface (plan 0011): the `user.deleted` saga subscriber and the
 * reconciliation query the auth orphan-user reaper calls. The event handler is
 * idempotent, so an at-least-once redelivery is harmless.
 */
@Controller()
export class AccountController {
  constructor(private readonly service: AccountDeletionService) {}

  @EventPattern(IDENTITY_EVENTS.userDeleted)
  async onUserDeleted(@Payload() event: UserDeletedEvent): Promise<void> {
    await this.service.handleUserDeleted(event.userId);
  }

  @MessagePattern(RECONCILIATION_PATTERNS.usersWithoutMemberships)
  async usersWithoutMemberships(
    @Payload() req: UsersWithoutMembershipsRequest
  ): Promise<UsersWithoutMembershipsResponse> {
    return {
      userIds: await this.service.usersWithoutMemberships(req.userIds),
    };
  }
}
