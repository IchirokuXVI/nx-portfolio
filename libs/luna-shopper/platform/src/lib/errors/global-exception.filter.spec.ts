import type { ArgumentsHost } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { PinoLogger } from 'nestjs-pino';
import { firstValueFrom, type Observable } from 'rxjs';
import { GlobalExceptionFilter } from './global-exception.filter';
import type { ProblemDetails } from './problem-details';

/** What TypeORM raises when Postgres refuses `'undefined'::uuid`. */
function invalidUuid(): Error {
  const error = new Error(
    'invalid input syntax for type uuid: "undefined"'
  ) as Error & { driverError: { code: string } };
  error.name = 'QueryFailedError';
  error.driverError = { code: '22P02' };
  return error;
}

function logger(): PinoLogger {
  return {
    setContext: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;
}

function httpHost(): { host: ArgumentsHost; sent: () => ProblemDetails } {
  let body: ProblemDetails | undefined;
  const res = {
    status: () => ({
      type: () => ({
        send: (sent: ProblemDetails) => {
          body = sent;
        },
      }),
    }),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/v1/baskets/undefined' }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, sent: () => body as ProblemDetails };
}

describe('GlobalExceptionFilter', () => {
  describe('Postgres refusing a malformed value (22P02)', () => {
    it('answers an HTTP request 400, not 500', () => {
      const filter = new GlobalExceptionFilter(logger());
      const { host, sent } = httpHost();

      filter.catch(invalidUuid(), host);

      expect(sent()).toEqual(
        expect.objectContaining({ status: 400, code: 'validation_failed' })
      );
    });

    it('answers a NATS request with a 400 problem the gateway passes on', async () => {
      const filter = new GlobalExceptionFilter(logger());
      const host = { getType: () => 'rpc' } as unknown as ArgumentsHost;

      const result = filter.catch(invalidUuid(), host) as Observable<never>;
      const thrown = await firstValueFrom(result).catch((error) => error);

      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toEqual(
        expect.objectContaining({ status: 400, code: 'validation_failed' })
      );
    });

    it('still answers any other database error 500', () => {
      const filter = new GlobalExceptionFilter(logger());
      const { host, sent } = httpHost();
      const error = invalidUuid() as Error & { driverError: { code: string } };
      error.driverError.code = '40001';

      filter.catch(error, host);

      expect(sent()).toEqual(
        expect.objectContaining({ status: 500, code: 'internal' })
      );
    });
  });
});
