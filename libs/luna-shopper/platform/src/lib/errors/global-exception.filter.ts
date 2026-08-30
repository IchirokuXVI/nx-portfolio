import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { throwError, type Observable } from 'rxjs';
import { getRequestContext } from '../context/request-context';
import { DEFAULT_LOCALE, type SupportedLocale } from '../localization/locale';
import { isDomainException, retryAfterSecondsOf } from './domain-exception';
import { ERROR_CODES, type ErrorCode } from './error-codes';
import {
  PROBLEM_JSON_CONTENT_TYPE,
  type ProblemDetails,
} from './problem-details';
import { buildProblemDetails } from './problem-factory';

/** Maps an HTTP status onto the closest stable error code. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    // A 413 is a statement about the request, not about the server, so it lands
    // on the code that already means "what you sent is not acceptable" rather
    // than on `internal` (luna plan 0041, section 4.1). It arrives from exactly
    // one place: multer refusing an upload over the interceptor's `limits`,
    // which `@nestjs/platform-express` turns into a `PayloadTooLargeException`.
    // Reported as `internal` it would read to the client as the assistant having
    // broken, which is the one thing that failure is not.
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ERROR_CODES.VALIDATION_FAILED;
    default:
      return ERROR_CODES.INTERNAL;
  }
}

/**
 * Pulls per field detail out of a Nest `ValidationPipe` 400, whose response body
 * is `{ message: string[] }`, into the envelope's `errors` map keyed by a best
 * effort field name.
 */
function extractValidationErrors(
  response: unknown
): Record<string, string[]> | undefined {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('message' in response)
  ) {
    return undefined;
  }
  const messages = (response as { message: unknown }).message;
  if (!Array.isArray(messages)) {
    return undefined;
  }
  const errors: Record<string, string[]> = {};
  for (const raw of messages) {
    const text = String(raw);
    const field = text.split(' ')[0] || '_';
    (errors[field] ??= []).push(text);
  }
  return errors;
}

/**
 * The global exception filter (plan 0004, sections 1 and 2): the single backstop
 * for both the gateway's HTTP surface and the NATS message surface of auth, core
 * and realtime. Branching on the context type keeps one `@Catch()` filter from
 * clashing on the hybrid services (which serve both an HTTP health port and NATS).
 *
 * Whatever the transport, it guarantees the same thing: nothing unexpected is
 * swallowed silently, every error carries the house problem+json envelope with a
 * correlation id, a {@link DomainException} is a handled outcome logged at `warn`,
 * and anything else is logged at `error` with reproduction context before a
 * generic 500. Because the code, not the class, crosses the broker, the gateway
 * reproduces a service's domain error for the client without a raw stack.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void | Observable<never> {
    if (host.getType() === 'rpc') {
      return this.handleRpc(exception);
    }
    return this.handleHttp(exception, host);
  }

  /** Resolves the correlation id and locale that ride in from the request context. */
  private resolveMeta(): { correlationId: string; locale: SupportedLocale } {
    const context = getRequestContext();
    return {
      correlationId: context?.correlationId ?? randomUUID(),
      locale: context?.locale ?? DEFAULT_LOCALE,
    };
  }

  /**
   * Recognises a house error envelope that a downstream service already produced
   * and returned over the broker (plan 0004, section 2). NATS nests it under
   * `error`; either shape is accepted. The gateway passes it straight through
   * rather than reclassifying a handled downstream outcome as an internal error,
   * so a 404/409/401 from auth or core keeps its status and localized message.
   */
  private extractRemoteProblem(exception: unknown): ProblemDetails | undefined {
    const candidates = [exception, (exception as { error?: unknown })?.error];
    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        typeof (candidate as ProblemDetails).status === 'number' &&
        typeof (candidate as ProblemDetails).code === 'string' &&
        typeof (candidate as ProblemDetails).message === 'string' &&
        'correlationId' in candidate
      ) {
        return candidate as ProblemDetails;
      }
    }
    return undefined;
  }

  private classify(exception: unknown): {
    code: ErrorCode;
    detail?: string;
    messageArgs?: Record<string, string | number>;
    errors?: Record<string, string[]>;
    retryAfterSeconds?: number;
  } {
    if (isDomainException(exception)) {
      return {
        code: exception.code,
        detail: exception.message,
        messageArgs: exception.messageArgs,
        // Lifted out of the details bag onto the envelope, so a throttled client
        // reads the wait from the body (plan 0021, section 2).
        retryAfterSeconds: retryAfterSecondsOf(exception),
      };
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return {
        code: codeForStatus(exception.getStatus()),
        detail:
          typeof response === 'string'
            ? response
            : ((response as { error?: string }).error ?? exception.message),
        errors: extractValidationErrors(response),
      };
    }
    if (exception instanceof RpcException) {
      return { code: ERROR_CODES.INTERNAL, detail: exception.message };
    }
    return { code: ERROR_CODES.INTERNAL };
  }

  private handleHttp(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const { correlationId, locale } = this.resolveMeta();

    const remote = this.extractRemoteProblem(exception);
    const problem: ProblemDetails = remote
      ? { ...remote, correlationId }
      : buildProblemDetails({
          ...this.classify(exception),
          correlationId,
          locale,
        });

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception,
          req: {
            method: req?.method,
            url: req?.originalUrl ?? req?.url,
            params: req?.params,
            query: req?.query,
            body: req?.body,
          },
        },
        'Unhandled error while processing request'
      );
    } else {
      this.logger.warn(
        { code: problem.code, status: problem.status },
        'Request rejected with a handled outcome'
      );
    }

    this.send(res, problem);
  }

  private handleRpc(exception: unknown): Observable<never> {
    const { correlationId, locale } = this.resolveMeta();
    const remote = this.extractRemoteProblem(exception);
    const problem: ProblemDetails = remote
      ? { ...remote, correlationId }
      : buildProblemDetails({
          ...this.classify(exception),
          correlationId,
          locale,
        });

    if (problem.code === ERROR_CODES.INTERNAL) {
      this.logger.error(
        { err: exception },
        'Unhandled error while processing message'
      );
    } else {
      this.logger.warn(
        { code: problem.code },
        'Message rejected with a handled outcome'
      );
    }

    return throwError(() => new RpcException(problem));
  }

  private send(res: unknown, problem: ProblemDetails): void {
    const response = res as {
      status?: (code: number) => {
        type: (t: string) => { send: (body: unknown) => void };
      };
    };
    if (typeof response?.status === 'function') {
      response
        .status(problem.status)
        .type(PROBLEM_JSON_CONTENT_TYPE)
        .send(problem);
    }
  }
}
