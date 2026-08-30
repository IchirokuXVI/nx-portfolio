import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import {
  AppResumed,
  ConnectionState,
  provideFakeBrowserFacade,
  ReloadBlocker,
} from '@portfolio/velista/platform';
import { ApiUrl } from './api-url';
import { ConnectionRecovery } from './connection-recovery';

const GATEWAY = 'https://gateway.test';
const HEALTH = `${GATEWAY}/health/ready`;

/** Drain the microtask queue. These specs are zoneless, so `whenStable` is not used. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('ConnectionRecovery', () => {
  let httpMock: HttpTestingController;
  let connection: ConnectionState;
  let resumes: WritableSignal<number>;
  let reloads: number;

  function build(): ConnectionRecovery {
    const recovery = TestBed.inject(ConnectionRecovery);
    TestBed.tick();
    return recovery;
  }

  beforeEach(() => {
    resumes = signal(0);
    reloads = 0;

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
        {
          provide: ReloadBlocker,
          useValue: { reloadWhenIdle: () => (reloads += 1) },
        },
        ApiUrl,
        ConnectionRecovery,
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    connection = TestBed.inject(ConnectionState);
  });

  afterEach(() => httpMock.verify());

  it('probes nothing while the app can reach the backend', async () => {
    build();

    resumes.set(1);
    TestBed.tick();
    await settle();

    // A resume that was never offline must not probe: the probe reports reachable and
    // queues a reload, and reloading a page nobody had a problem with would throw away
    // a half typed comment every time somebody checked the time.
    httpMock.expectNone(HEALTH);
    expect(reloads).toBe(0);
  });

  it('probes once, immediately, when a resume finds the app offline', async () => {
    // Plan 0035, section 4.2. Otherwise the blocking screen stays up for the rest of
    // the ten second interval, which is the whole of what somebody who walked out of a
    // lift is waiting on.
    build();
    connection.reportNetworkFailure();
    TestBed.tick();

    resumes.set(1);
    TestBed.tick();
    await settle();

    httpMock.expectOne(HEALTH).flush('ok');
    await settle();

    expect(reloads).toBe(1);
  });

  it('issues one probe per resume and no more', async () => {
    build();
    connection.reportNetworkFailure();
    TestBed.tick();

    resumes.set(1);
    TestBed.tick();
    await settle();
    httpMock.expectOne(HEALTH).error(new ProgressEvent('error'), { status: 0 });
    await settle();

    // Nothing resumed since, so nothing else asks: the interval is the only other
    // caller and it has not come round.
    TestBed.tick();
    await settle();

    httpMock.expectNone(HEALTH);
  });

  it('treats any answer as proof the network works, a 503 included', async () => {
    // A 503 comes from a backend that is there and deploying. Reading it as still
    // offline strands the user on the blocking screen through an ordinary deploy.
    const recovery = build();
    const probing = recovery.probe();

    httpMock
      .expectOne(HEALTH)
      .flush('unhealthy', { status: 503, statusText: 'Service Unavailable' });

    await expect(probing).resolves.toBe(true);
  });
});
