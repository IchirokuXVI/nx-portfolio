import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  buildNatsHeaders,
  getRequestContext,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { firstValueFrom } from 'rxjs';

/** Injection token for the gateway's NATS request/reply client. */
export const NATS_CLIENT = 'NATS_CLIENT';

/**
 * The gateway's request/reply bridge to the backend services (plan 0004,
 * section 3; plan 0005+). Every request carries the active correlation id and
 * locale on its NATS headers, so one id threads the user action across services
 * and auth/core answer in the caller's language. Errors returned by a service (the
 * house error envelope) surface as a rejected promise the global filter renders.
 *
 * The round trip runs inside a producer span (plan 0016, section 4.3), so the
 * time spent waiting on the broker is visible in the trace as its own hop rather
 * than as an unexplained gap in the gateway's request span. The span is active
 * while the headers are built, which is how the `traceparent` on the wire points
 * at it.
 */
@Injectable()
export class NatsClient {
  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  send<TResponse, TRequest extends object = object>(
    subject: string,
    payload: TRequest
  ): Promise<TResponse> {
    const context = getRequestContext();
    return traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(payload)
        .setHeaders(
          buildNatsHeaders({
            correlationId: context?.correlationId,
            locale: context?.locale,
          })
        )
        .build();
      return firstValueFrom(this.client.send<TResponse>(subject, record));
    });
  }
}
