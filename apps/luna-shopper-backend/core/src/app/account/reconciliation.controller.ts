import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  IDENTITY_EVENTS,
  RECONCILIATION_PATTERNS,
  type UserDeletedEvent,
  type UsersWithoutMembershipsRequest,
  type UsersWithoutMembershipsResponse,
  type UserUsernameChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import { AccountDeletionService } from './account-deletion.service';
import { UsernamePropagationService } from './username-propagation.service';

/**
 * Core's account surface: the identity event subscribers (`user.deleted` from
 * plan 0011, `user.usernameChanged` from plan 0018) and the reconciliation query
 * the auth orphan-user reaper calls. Both event handlers are idempotent, so an
 * at-least-once redelivery is harmless.
 */
@Controller()
export class AccountController {
  constructor(
    private readonly service: AccountDeletionService,
    private readonly usernames: UsernamePropagationService
  ) {}

  @EventPattern(IDENTITY_EVENTS.userDeleted)
  async onUserDeleted(@Payload() event: UserDeletedEvent): Promise<void> {
    await this.service.handleUserDeleted(event.userId);
  }

  @EventPattern(IDENTITY_EVENTS.userUsernameChanged)
  async onUsernameChanged(
    @Payload() event: UserUsernameChangedEvent
  ): Promise<void> {
    await this.usernames.handleUsernameChanged(event);
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
