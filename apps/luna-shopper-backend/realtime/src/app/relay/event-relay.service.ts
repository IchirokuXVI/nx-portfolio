import { Injectable } from '@nestjs/common';
import type { RealtimeEvent } from '@portfolio/luna-shopper/contracts';
import { Observable, Subject } from 'rxjs';

/**
 * One fan-out message: what to send, to which rooms, and the correlation id of
 * the request that caused it (plan 0009, section 4) so a realtime push can be
 * traced back to its originating action.
 */
export interface RelayMessage {
  rooms: string[];
  event: RealtimeEvent;
  payload: unknown;
  correlationId?: string;
}

/**
 * The single internal relay both transports read from (plan 0009, section 3).
 *
 * The JetStream consumer and the presence service publish here; the socket
 * gateway and the SSE controller subscribe. Because everything flows through one
 * stream, a WebSocket client and an SSE client receive byte-identical payloads,
 * so there is one source of truth for what an event looks like.
 */
@Injectable()
export class EventRelayService {
  private readonly subject = new Subject<RelayMessage>();

  /** Publish a message to every subscriber (the socket gateway and SSE streams). */
  publish(message: RelayMessage): void {
    this.subject.next(message);
  }

  /** The shared stream of relay messages. */
  get stream$(): Observable<RelayMessage> {
    return this.subject.asObservable();
  }
}
