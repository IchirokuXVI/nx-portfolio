import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ADMIN_API_CONFIG,
  DEFAULT_REACHABILITY_POLICY,
} from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { HealthApi } from './health-api';
import { SKIP_REACHABILITY_PROBE } from './probe-http-context';

/**
 * The one request this app makes about the server rather than about the data
 * (plan 0008, section 1).
 *
 * The assertions are about which endpoint is asked and what counts as an answer.
 * A 2xx is the only success: a 502 from a proxy in front of a restarting gateway
 * and a 500 from a gateway that cannot answer its own liveness check are both
 * "not a server this operator can work against".
 */

const GATEWAY = 'https://api.example.test';
const URL = `${GATEWAY}/health/live`;

describe('HealthApi', () => {
  let api: HealthApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        ApiUrl,
        HealthApi,
      ],
    });

    api = TestBed.inject(HealthApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /**
   * Liveness, not readiness. The question is whether the network path and the
   * process exist, and `/health/ready` answers a different one that Kubernetes
   * asks.
   */
  it('asks the liveness endpoint', async () => {
    const probe = api.probe();

    const request = http.expectOne(URL);
    expect(request.request.method).toBe('GET');
    request.flush('{}');

    expect(await probe).toBe(true);
  });

  /**
   * Without this the interceptor answers a failing probe by probing, which is a
   * service reporting its own failure to itself.
   */
  it('marks itself so the interceptor does not probe about it', async () => {
    const probe = api.probe();

    const request = http.expectOne(URL);
    expect(request.request.context.get(SKIP_REACHABILITY_PROBE)).toBe(true);
    request.flush('{}');

    await probe;
  });

  it.each([
    ['a gateway that cannot answer its own check', 500],
    ['a proxy in front of a restarting gateway', 502],
    ['a request that never arrived', 0],
  ])('answers false for %s', async (_case, status) => {
    const probe = api.probe();

    http.expectOne(URL).flush(null, { status, statusText: 'Failed' });

    expect(await probe).toBe(false);
  });

  /**
   * A server that needs longer than the probe timeout to say it is alive is not
   * a server the operator can work against, and a probe with no clock on it
   * would leave the cover saying "checking" for as long as the socket stayed
   * open.
   */
  it('answers false when the probe takes too long', async () => {
    jest.useFakeTimers();
    try {
      const probe = api.probe();
      http.expectOne(URL);

      jest.advanceTimersByTime(DEFAULT_REACHABILITY_POLICY.probeTimeoutMs);

      expect(await probe).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
