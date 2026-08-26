import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MembershipStatus,
  RealtimeEvent,
  UsernamePropagation,
  type UserUsernameChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import { runOnce } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toMembershipView } from '../zones/zone.mappers';
import { ProcessedEventStore } from './idempotency.store';

/**
 * Core's reaction to a global username change (plan 0018, section 4.4).
 *
 * Auth owns `users.username` and commits it synchronously; the per zone names are
 * copies, so they follow here when the event is consumed. The window between the
 * two is accepted, not worked around: it is milliseconds in practice, the
 * realtime events below close it on the client without a refetch, and the
 * alternative is a distributed transaction across two databases.
 *
 * Idempotent through the `processed_events` inbox keyed on the event id,
 * mirroring {@link AccountDeletionService}, so an at-least-once redelivery
 * neither writes twice nor emits twice. The key is the event id and not the pair
 * of names, so renaming back to a name the user held before still applies.
 */
@Injectable()
export class UsernamePropagationService {
  constructor(
    @InjectRepository(ZoneMembership)
    private readonly memberships: Repository<ZoneMembership>,
    private readonly events: CoreEventsPublisher,
    private readonly store: ProcessedEventStore
  ) {}

  /** Handle `user.usernameChanged`, at most once per change. */
  async handleUsernameChanged(event: UserUsernameChangedEvent): Promise<void> {
    await runOnce(this.store, `user.usernameChanged:${event.eventId}`, () =>
      this.apply(event)
    );
  }

  private async apply(event: UserUsernameChangedEvent): Promise<void> {
    // The event fires for every mode so that a consumer sees every rename;
    // GLOBAL_ONLY is recorded as processed and touches no membership.
    if (event.propagation === UsernamePropagation.GLOBAL_ONLY) {
      return;
    }
    const allZones = event.propagation === UsernamePropagation.ALL_ZONES;

    // One statement per user rather than a row at a time, and `RETURNING` hands
    // back exactly the rows that changed: without it, ALL_ZONES for a user in
    // twenty zones would mean twenty selects to find the rooms to emit into.
    //
    // KICKED and BANNED rows are excluded (section 4.2): they are the historical
    // record a zone's admins recognise by name.
    const updated = await this.memberships
      .createQueryBuilder()
      .update(ZoneMembership)
      .set({ username: event.newUsername })
      .where('"userId" = :userId', { userId: event.userId })
      .andWhere('status IN (:...statuses)', {
        statuses: [MembershipStatus.APPROVED, MembershipStatus.PENDING],
      })
      // MATCHING_ZONES compares byte for byte and case sensitively: a member who
      // typed `vela` where their global name was `Vela` chose a different string
      // (section 4.1, where the case insensitive alternative is recorded as
      // deliberately rejected).
      .andWhere(':allZones = true OR username = :oldUsername', {
        allZones,
        oldUsername: event.oldUsername,
      })
      .returning('*')
      .execute();

    // Once per affected membership, into that membership's own zone room: each
    // room learns only about its own member (section 7).
    for (const row of (updated.raw ?? []) as ZoneMembership[]) {
      this.events.emit(
        RealtimeEvent.MemberUsernameChanged,
        row.zoneId,
        toMembershipView(row)
      );
    }
  }
}
