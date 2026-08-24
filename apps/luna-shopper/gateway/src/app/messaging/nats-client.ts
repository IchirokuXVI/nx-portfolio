import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  buildNatsHeaders,
  getRequestContext,
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
 */
@Injectable()
export class NatsClient {
  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  send<TResponse, TRequest extends object = object>(
    subject: string,
    payload: TRequest
  ): Promise<TResponse> {
    const context = getRequestContext();
    const record = new NatsRecordBuilder(payload)
      .setHeaders(
        buildNatsHeaders({
          correlationId: context?.correlationId,
          locale: context?.locale,
        })
      )
      .build();
    return firstValueFrom(this.client.send<TResponse>(subject, record));
  }
}
