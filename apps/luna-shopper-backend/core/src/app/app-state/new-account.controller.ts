import { Controller, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  IDENTITY_EVENTS,
  type UserRegisteredEvent,
  type UserUpgradedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { CoreConfig } from '../config/app-config';
import { UserAppStateService } from './user-app-state.service';

/**
 * Marks the tour as seen on a new account when `NEW_ACCOUNTS_SKIP_TOUR` is on.
 *
 * A development convenience. The developer registers accounts all day and has
 * seen the tour, so a new account must not open it. Off by default and off in
 * every cluster, where this handler does nothing.
 *
 * An account starts to exist in two ways, and both are heard: `user.registered`
 * (email or Google), and `user.upgraded` (a guest who registers keeps its
 * `userId`). The stamp is idempotent, so a redelivered event changes nothing.
 *
 * **The event is not a guarantee.** It is published after auth commits, and the
 * app reads `GET /v1/account/me` right after it has its tokens. The event is one
 * broker hop against a browser round trip, so it lands first in practice, but
 * nothing orders the two. If core is down when the event is published, the
 * event is lost and that one account shows the tour.
 */
@Controller()
export class NewAccountController {
  private readonly logger = new Logger(NewAccountController.name);
  private readonly skipTour: boolean;

  constructor(
    private readonly state: UserAppStateService,
    config: ConfigService
  ) {
    this.skipTour =
      config.getOrThrow<CoreConfig>('core').appState.newAccountsSkipTour;
  }

  @EventPattern(IDENTITY_EVENTS.userRegistered)
  onRegistered(@Payload() event: UserRegisteredEvent): Promise<void> {
    return this.markTourSeen(event.userId);
  }

  @EventPattern(IDENTITY_EVENTS.userUpgraded)
  onUpgraded(@Payload() event: UserUpgradedEvent): Promise<void> {
    return this.markTourSeen(event.userId);
  }

  private async markTourSeen(userId: string): Promise<void> {
    if (!this.skipTour) return;
    try {
      await this.state.set({ userId, tourSeen: true });
    } catch (error) {
      // The account exists either way. A failed stamp costs one tour, and the
      // log is where a developer finds out why it opened.
      this.logger.warn(
        `Could not mark the tour seen for new account ${userId}: ${String(error)}`
      );
    }
  }
}
