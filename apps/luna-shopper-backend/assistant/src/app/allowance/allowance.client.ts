import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  ASSISTANT_ALLOWANCE_PATTERNS,
  type AssistantAllowanceView,
  type ReadAllowanceRequest,
  type ReserveAllowanceRequest,
  type ReserveAllowanceResponse,
  type SettleAllowanceRequest,
  type SettleAllowanceResponse,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  getRequestContext,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { firstValueFrom, timeout } from 'rxjs';

/** The injection token of the assistant's NATS client to core (plan 0234). */
export const CORE_NATS_CLIENT = 'CORE_NATS_CLIENT';

/**
 * How long core has to answer (plan 0234, section 5.5). Past it the turn is
 * refused and no provider is called: the allowance fails closed, because an
 * assistant that answers while its counter is down is the hole the plan closes.
 */
export const ALLOWANCE_TIMEOUT_MS = 2000;

/**
 * Core did not answer, or answered with an error. The assistant refuses the
 * turn on a reserve and logs it on a settle.
 */
export class AllowanceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AllowanceUnavailableError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * The assistant's door into core's allowance (plan 0234, section 5).
 *
 * The assistant had no NATS client before this: it answered and never asked.
 * It asks core here and nowhere else, and every question carries a user id,
 * numbers and a day, never what a turn said. Each request carries the
 * correlation id and locale on its headers, as the gateway's do, so one turn
 * reads as one trace across the three services.
 */
@Injectable()
export class AllowanceClient {
  constructor(@Inject(CORE_NATS_CLIENT) private readonly client: ClientProxy) {}

  reserve(req: ReserveAllowanceRequest): Promise<ReserveAllowanceResponse> {
    return this.send(ASSISTANT_ALLOWANCE_PATTERNS.reserve, req);
  }

  settle(req: SettleAllowanceRequest): Promise<SettleAllowanceResponse> {
    return this.send(ASSISTANT_ALLOWANCE_PATTERNS.settle, req);
  }

  read(req: ReadAllowanceRequest): Promise<AssistantAllowanceView> {
    return this.send(ASSISTANT_ALLOWANCE_PATTERNS.read, req);
  }

  private async send<T>(subject: string, payload: object): Promise<T> {
    const context = getRequestContext();
    try {
      return await traceNatsSend(subject, () => {
        const record = new NatsRecordBuilder(payload)
          .setHeaders(
            buildNatsHeaders({
              correlationId: context?.correlationId,
              locale: context?.locale,
            })
          )
          .build();
        return firstValueFrom(
          this.client
            .send<T>(subject, record)
            .pipe(timeout(ALLOWANCE_TIMEOUT_MS))
        );
      });
    } catch (error) {
      throw new AllowanceUnavailableError(
        `core did not answer ${subject}: ${describe(error)}`,
        { cause: error }
      );
    }
  }
}

/** One short line, with nothing from the request in it. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const code =
    (error as { code?: unknown })?.code ??
    (error as { error?: { code?: unknown } })?.error?.code;
  return typeof code === 'string' ? code : 'unknown error';
}
