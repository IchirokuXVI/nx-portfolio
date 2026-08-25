import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { NatsContext } from '@nestjs/microservices';
import { context as otelContext } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { DEFAULT_LOCALE } from '../localization/locale';
import {
  readCorrelationFromHeaders,
  readLocaleFromHeaders,
} from '../nats/correlation-headers';
import { beginConsumerSpan } from '../telemetry/nats-propagation';
import { runWithRequestContext } from './request-context';

/**
 * Seeds the per request context for the NATS message surface (plan 0004,
 * section 3), the broker counterpart of the HTTP correlation middleware, and
 * rejoins the caller's trace (plan 0016, section 4.3).
 *
 * It reads the correlation id and locale the gateway propagated on the message
 * headers and runs the handler inside an AsyncLocalStorage scope, so every log
 * line a message handler emits carries the same id that threads the originating
 * user action, and domain errors answer in the caller's locale. When a message
 * arrives without a correlation id (an internal event, a direct probe) one is
 * minted so a handler is never uncorrelated.
 *
 * It also extracts the W3C trace context from the same headers and opens a
 * consumer span parented to the caller's producer span, then runs the handler
 * inside that span's context. That is what makes a handler's own work (its
 * queries, its outbound messages) a child of the originating request rather than
 * the root of a disconnected new trace. With telemetry off the propagator writes
 * and reads nothing and every span is a no op, so this path costs a function call.
 */
@Injectable()
export class RpcCorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const natsContext = this.readNatsContext(context);
    const headers = natsContext?.getHeaders?.();
    const subject = natsContext?.getSubject?.() ?? 'unknown';
    const correlationId = readCorrelationFromHeaders(headers) ?? randomUUID();
    const locale = readLocaleFromHeaders(headers) ?? DEFAULT_LOCALE;

    return new Observable((subscriber) => {
      const scope = beginConsumerSpan(subject, headers);

      otelContext.with(scope.context, () => {
        runWithRequestContext({ correlationId, locale }, () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (error: unknown) => {
              scope.finish(error);
              subscriber.error(error);
            },
            complete: () => {
              scope.finish();
              subscriber.complete();
            },
          });
        });
      });
    });
  }

  private readNatsContext(context: ExecutionContext): NatsContext | undefined {
    try {
      return context.switchToRpc().getContext<NatsContext>() ?? undefined;
    } catch {
      // Non-NATS rpc transport (or a unit test double): no headers to read.
      return undefined;
    }
  }
}
