import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  IDENTITY_EVENTS,
  RECONCILIATION_PATTERNS,
  type UsersWithoutMembershipsRequest,
  type UsersWithoutMembershipsResponse,
  type UserUsernameChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import { AccountDeletionService } from './account-deletion.service';
import { UsernamePropagationService } from './username-propagation.service';

/**
 * Core's account surface: the `user.usernameChanged` subscriber (plan 0018) and
 * the reconciliation query the auth orphan-user reaper calls. The handler is
 * idempotent, so a duplicate is harmless.
 *
 * `user.deleted` is not here since plan 0232 (section 5). It arrives on a
 * JetStream stream through `AccountDeletionConsumer`, so a deletion is
 * processed once and survives a stopped core.
 */
@Controller()
export class AccountController {
  constructor(
    private readonly service: AccountDeletionService,
    private readonly usernames: UsernamePropagationService
  ) {}

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
