import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { NatsContext } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { DEFAULT_LOCALE } from '../localization/locale';
import {
  readCorrelationFromHeaders,
  readLocaleFromHeaders,
} from '../nats/correlation-headers';
import { runWithRequestContext } from './request-context';

/**
 * Seeds the per request context for the NATS message surface (plan 0004,
 * section 3), the broker counterpart of the HTTP correlation middleware.
 *
 * It reads the correlation id and locale the gateway propagated on the message
 * headers and runs the handler inside an AsyncLocalStorage scope, so every log
 * line a message handler emits carries the same id that threads the originating
 * user action, and domain errors answer in the caller's locale. When a message
 * arrives without a correlation id (an internal event, a direct probe) one is
 * minted so a handler is never uncorrelated.
 */
@Injectable()
export class RpcCorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const headers = this.readHeaders(context);
    const correlationId = readCorrelationFromHeaders(headers) ?? randomUUID();
    const locale = readLocaleFromHeaders(headers) ?? DEFAULT_LOCALE;

    return new Observable((subscriber) => {
      runWithRequestContext({ correlationId, locale }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }

  private readHeaders(context: ExecutionContext) {
    try {
      const natsContext = context.switchToRpc().getContext<NatsContext>();
      return natsContext?.getHeaders?.() ?? undefined;
    } catch {
      // Non-NATS rpc transport (or a unit test double): no headers to read.
      return undefined;
    }
  }
}
