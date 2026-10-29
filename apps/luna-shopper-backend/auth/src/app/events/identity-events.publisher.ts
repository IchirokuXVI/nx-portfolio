import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  IDENTITY_EVENTS,
  IMPERSONATION_EVENTS,
  type ImpersonationEndedEvent,
  type UserEmailVerifiedEvent,
  type UserRegisteredEvent,
  type UserUpgradedEvent,
  type UserUsernameChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';

/** Injection token for the NATS client used to publish identity events. */
export const NATS_EVENTS = 'NATS_EVENTS';

/**
 * Publishes the identity events other services react to (plan 0005, section 5).
 * Each event carries the active correlation id on its NATS headers so one id
 * threads the originating action through to any downstream consumer (plan 0004,
 * section 3). Consumers are free to ignore these.
 *
 * `user.deleted` is not here. Since plan 0232 it travels through an outbox to a
 * JetStream stream (`AccountDeletionPublisher`), and a plain publish on
 * the same subject would be captured by that stream as a second copy.
 */
@Injectable()
export class IdentityEventsPublisher {
  constructor(@Inject(NATS_EVENTS) private readonly client: ClientProxy) {}

  private emit(subject: string, payload: object): void {
    // A producer span per event, so the publish is a hop in the originating
    // request's trace instead of an unexplained gap (plan 0016, section 4.3).
    traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(payload)
        .setHeaders(buildNatsHeaders())
        .build();
      this.client.emit(subject, record);
    });
  }

  userRegistered(event: UserRegisteredEvent): void {
    this.emit(IDENTITY_EVENTS.userRegistered, event);
  }

  userUpgraded(event: UserUpgradedEvent): void {
    this.emit(IDENTITY_EVENTS.userUpgraded, event);
  }

  userEmailVerified(event: UserEmailVerifiedEvent): void {
    this.emit(IDENTITY_EVENTS.userEmailVerified, event);
  }

  userUsernameChanged(event: UserUsernameChangedEvent): void {
    this.emit(IDENTITY_EVENTS.userUsernameChanged, event);
  }

  /** A support session is over (plan 0194). Realtime drops its sockets. */
  impersonationEnded(event: ImpersonationEndedEvent): void {
    this.emit(IMPERSONATION_EVENTS.ended, event);
  }
}
