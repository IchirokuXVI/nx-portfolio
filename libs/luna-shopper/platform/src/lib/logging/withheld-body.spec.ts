import type { ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { GlobalExceptionFilter } from '../errors/global-exception.filter';
import {
  isBodyWithheld,
  WITHHELD_BODY,
  withholdBodyFromLogs,
  WithholdBodyMiddleware,
} from './withheld-body';

/** A request that fails with a 500, and what the filter logged about it. */
function failWith(req: Record<string, unknown>): unknown[] {
  const logged: unknown[] = [];
  const logger = {
    setContext: () => undefined,
    error: (...args: unknown[]) => logged.push(...args),
    warn: (...args: unknown[]) => logged.push(...args),
  } as unknown as PinoLogger;
  const res = {
    status: () => ({ type: () => ({ send: () => undefined }) }),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter(logger).catch(new Error('boom'), host);
  return logged;
}

describe('a body withheld from the logs (plan 0164)', () => {
  const body = { latitude: 37.8847, longitude: -4.7792, accuracyMetres: 12 };

  it('is printed as a marker when a marked request fails', () => {
    const req = { method: 'POST', url: '/v1/catalog/shops/nearby', body };
    withholdBodyFromLogs(req);

    const text = JSON.stringify(failWith(req));
    expect(text).toContain(WITHHELD_BODY);
    expect(text).not.toContain('37.8847');
    expect(text).not.toContain('-4.7792');
  });

  it('is still printed for a request nobody marked', () => {
    const text = JSON.stringify(
      failWith({ method: 'POST', url: '/v1/elsewhere', body })
    );
    expect(text).toContain('37.8847');
  });

  it('is marked by the middleware before anything else runs', () => {
    const req = {};
    let called = false;
    new WithholdBodyMiddleware().use(req, {}, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(isBodyWithheld(req)).toBe(true);
  });

  it('cannot be marked by a field a client sends', () => {
    expect(
      isBodyWithheld(JSON.parse('{"luna.logging.bodyWithheld": true}'))
    ).toBe(false);
    expect(isBodyWithheld(null)).toBe(false);
    expect(isBodyWithheld(undefined)).toBe(false);
  });
});
