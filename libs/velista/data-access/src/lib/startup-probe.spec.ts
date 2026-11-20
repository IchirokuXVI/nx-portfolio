import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { APP_API_CONFIG, APP_VERSION } from '@portfolio/velista/models';
import {
  AppResumed,
  AppUpdates,
  BackendReadiness,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { ApiUrl } from './api-url';
import { SKIP_AUTH } from './auth/http-context';
import { VELISTA_DATA_ACCESS_PROVIDERS } from './data-access-providers';
import { gatewayInterceptor } from './gateway-interceptor';
import {
  STARTUP_PROBE_BACKOFF_MS,
  STARTUP_PROBE_INTERVAL_MS,
  STARTUP_PROBE_TIMEOUT_MS,
  StartupProbe,
} from './startup-probe';

const GATEWAY = 'https://gateway.test';
const HEALTH = `${GATEWAY}/health/ready`;

/** Drain the microtask queue. These specs are zoneless, so `whenStable` is not used. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('StartupProbe', () => {
  let httpMock: HttpTestingController;
  let readiness: BackendReadiness;
  let resumes: WritableSignal<number>;

  function start(): void {
    TestBed.inject(StartupProbe);
    TestBed.tick();
  }

  /** The one open probe, or a failure naming how many there actually are. */
  function pending(): TestRequest {
    return httpMock.expectOne(HEALTH);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    resumes = signal(0);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.test',
          },
        },
        { provide: AppResumed, useValue: { resumes } },
        ApiUrl,
        StartupProbe,
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    readiness = TestBed.inject(BackendReadiness);
  });

  afterEach(() => {
    httpMock.verify();
    jest.useRealTimers();
  });

  it('asks once at startup and stops as soon as it is answered', async () => {
    start();

    pending().flush('ok');
    await settle();

    expect(readiness.state()).toBe('ready');

    // Nothing behind a ready app: the running session is owned by `ConnectionState`
    // and `ConnectionRecovery`, and a second poller would be exactly the duplication
    // this plan set out to avoid (D11).
    jest.advanceTimersByTime(STARTUP_PROBE_INTERVAL_MS * 5);
    await settle();
    httpMock.verify();
  });

  // D10. Without it the interceptor refreshes the token first, so the startup answer
  // costs two serial round trips, the first sent when the backend is least likely to
  // answer.
  it('sends the probe anonymously', () => {
    start();

    expect(pending().request.context.get(SKIP_AUTH)).toBe(true);
  });

  describe('when nothing answers', () => {
    it('backs off 1s, 2s, 5s and then every 10s', async () => {
      start();

      for (const delay of STARTUP_PROBE_BACKOFF_MS) {
        pending().error(new ProgressEvent('error'), { status: 0 });
        await settle();

        expect(readiness.state()).toBe('unreachable');

        // Nothing goes out until the backoff for this attempt has elapsed.
        jest.advanceTimersByTime(delay - 1);
        httpMock.verify();

        jest.advanceTimersByTime(1);
        await settle();
      }

      // The fourth failure and everything after it waits the flat interval.
      pending().error(new ProgressEvent('error'), { status: 0 });
      await settle();

      jest.advanceTimersByTime(STARTUP_PROBE_INTERVAL_MS - 1);
      httpMock.verify();

      jest.advanceTimersByTime(1);
      await settle();
      pending().flush('ok');
      await settle();

      expect(readiness.state()).toBe('ready');
    });

    // D7. `HttpClient` has no deadline, so a socket that is opened and never answered
    // produces no error at all and the app would sit on the startup screen forever
    // with nothing retrying behind it.
    it('abandons an attempt that hangs, and counts it as no response', async () => {
      start();

      const hanging = pending();

      jest.advanceTimersByTime(STARTUP_PROBE_TIMEOUT_MS - 1);
      await settle();
      expect(readiness.state()).toBe('connecting');

      jest.advanceTimersByTime(1);
      await settle();

      expect(readiness.state()).toBe('unreachable');
      expect(hanging.cancelled).toBe(true);

      jest.advanceTimersByTime(STARTUP_PROBE_BACKOFF_MS[0]);
      await settle();
      pending().flush('ok');
      await settle();

      expect(readiness.state()).toBe('ready');
    });

    // D6. A 503 proves the network works, which is why `ConnectionState` reads it as
    // reachable, and it also says the gateway cannot serve the app. Only a 2xx is ready.
    it('treats a 503 as not ready', async () => {
      start();

      pending().flush('unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      });
      await settle();

      expect(readiness.state()).toBe('unreachable');

      jest.advanceTimersByTime(STARTUP_PROBE_BACKOFF_MS[0]);
      await settle();
      pending().flush('ok');
      await settle();
    });
  });

  describe('what makes it ask again out of turn', () => {
    async function failFirstAttempt(): Promise<void> {
      start();
      pending().error(new ProgressEvent('error'), { status: 0 });
      await settle();
    }

    // A resume is the moment a phone comes back onto a working network, and it is
    // already counted for us.
    it('asks on a resume rather than waiting out the backoff', async () => {
      await failFirstAttempt();

      resumes.set(1);
      TestBed.tick();
      await settle();

      pending().flush('ok');
      await settle();

      expect(readiness.state()).toBe('ready');
    });

    // D9. The button lives in `ui`, which cannot import this library, so it reaches
    // here through a counter in `platform`.
    it('asks when a retry is requested', async () => {
      await failFirstAttempt();

      readiness.requestRetry();
      TestBed.tick();
      await settle();

      pending().flush('ok');
      await settle();

      expect(readiness.state()).toBe('ready');
    });

    it('ignores a resume once the app is ready', async () => {
      start();
      pending().flush('ok');
      await settle();

      resumes.set(1);
      TestBed.tick();
      await settle();

      httpMock.verify();
    });
  });

  // The interceptor is what recognises a refusal, so this spec drives the state
  // directly: what matters here is that the probe stops rather than retrying its way
  // around a deployment that will not serve this build.
  it('stops once the build is refused', async () => {
    start();

    readiness.reportTooOld();
    pending().flush('too old', { status: 426, statusText: 'Upgrade Required' });
    await settle();

    expect(readiness.state()).toBe('too-old');

    jest.advanceTimersByTime(STARTUP_PROBE_INTERVAL_MS * 3);
    await settle();
    httpMock.verify();
  });
});

/**
 * The same probe behind the real `gatewayInterceptor`, answered the way the gateway
 * answers it. The probe asks for text, so a refusal's problem document arrives as a
 * string, which is what the emulator walk of plan 0180 (row 12 of section 5) found
 * reading as "cannot reach the server".
 */
describe('StartupProbe through gatewayInterceptor', () => {
  let httpMock: HttpTestingController;
  let readiness: BackendReadiness;
  let checkNow: jest.Mock;

  function start(): void {
    TestBed.inject(StartupProbe);
    TestBed.tick();
  }

  function pending(): TestRequest {
    return httpMock.expectOne(HEALTH);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    checkNow = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([gatewayInterceptor])),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.test',
          },
        },
        {
          provide: RokuTranslatorService,
          useValue: { getLocale: () => 'en' },
        },
        { provide: APP_VERSION, useValue: '0.91.0' },
        { provide: AppUpdates, useValue: { checkNow } },
        { provide: AppResumed, useValue: { resumes: signal(0) } },
        ...VELISTA_DATA_ACCESS_PROVIDERS,
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    readiness = TestBed.inject(BackendReadiness);
  });

  afterEach(() => {
    httpMock.verify();
    jest.useRealTimers();
  });

  it('reads the refusal of MinClientVersionGuard as too-old and stops', async () => {
    start();

    // The exact body and headers the guard's refusal is rendered with.
    pending().flush(
      JSON.stringify({
        type: 'https://errors.luna-shopper-backend/client_too_old',
        title: 'client_too_old',
        status: 426,
        code: 'client_too_old',
        detail: 'client version 0.91.0 is below the supported minimum 0.91.5',
        message: 'This version of the app is out of date.',
        correlationId: 'c1',
      }),
      {
        status: 426,
        statusText: 'Upgrade Required',
        headers: {
          'content-type': 'application/problem+json; charset=utf-8',
          'x-min-client-version': '0.91.5',
        },
      }
    );
    await settle();

    expect(readiness.state()).toBe('too-old');
    expect(checkNow).toHaveBeenCalled();

    jest.advanceTimersByTime(STARTUP_PROBE_INTERVAL_MS * 3);
    await settle();
    httpMock.verify();
  });

  it('still reads a 503 with a plain text body as unreachable', async () => {
    start();

    pending().flush('{"code":"client_too_old"}', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'content-type': 'text/plain' },
    });
    await settle();

    expect(readiness.state()).toBe('unreachable');
    expect(checkNow).not.toHaveBeenCalled();

    jest.advanceTimersByTime(STARTUP_PROBE_BACKOFF_MS[0]);
    await settle();
    pending().flush('{"status":"ok"}', {
      headers: { 'content-type': 'application/json' },
    });
    await settle();

    expect(readiness.state()).toBe('ready');
  });

  it('reads the health answer as ready', async () => {
    start();

    pending().flush('{"status":"ok","info":{},"error":{},"details":{}}', {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-min-client-version': '0.91.5',
      },
    });
    await settle();

    expect(readiness.state()).toBe('ready');
  });
});
