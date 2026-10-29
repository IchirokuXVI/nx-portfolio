import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import {
  BackendReadiness,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { SKIP_AUTH } from '../auth/http-context';
import { OperatorSettingsApi } from './operator-settings-api';
import {
  MEMORY_OPERATOR_SETTINGS,
  OperatorSettingsMemory,
} from './operator-settings-memory';
import { OPERATOR_SETTINGS_SERVICE } from './operator-settings-service';
import { OperatorSettingsStore } from './operator-settings-store';

/** Lets the store's awaited read settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
  }
  TestBed.tick();
}

describe('OperatorSettingsStore (velista 0172, target 1)', () => {
  let memory: OperatorSettingsMemory;

  function setUp(): {
    store: OperatorSettingsStore;
    readiness: BackendReadiness;
  } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(),
        OperatorSettingsMemory,
        {
          provide: OPERATOR_SETTINGS_SERVICE,
          useExisting: OperatorSettingsMemory,
        },
        OperatorSettingsStore,
      ],
    });
    memory = TestBed.inject(OperatorSettingsMemory);
    const readiness = TestBed.inject(BackendReadiness);
    const store = TestBed.inject(OperatorSettingsStore);
    TestBed.tick();
    return { store, readiness };
  }

  it('asks nothing until the backend has answered ready', async () => {
    const { store, readiness } = setUp();

    expect(store.state()).toBe('idle');
    expect(store.settings()).toBeNull();
    expect(memory.reads).toBe(0);

    readiness.reportReady();
    TestBed.tick();
    expect(store.state()).toBe('loading');
    await settle();

    expect(memory.reads).toBe(1);
    expect(store.state()).toBe('ready');
    expect(store.settings()).toEqual(MEMORY_OPERATOR_SETTINGS);
  });

  it('reads once per document, not once per recovery', async () => {
    const { readiness } = setUp();

    readiness.reportReady();
    TestBed.tick();
    await settle();
    readiness.reportUnreachable();
    TestBed.tick();
    readiness.reportReady();
    TestBed.tick();
    await settle();

    expect(memory.reads).toBe(1);
  });

  it('fails on an unreadable answer, and reload asks again', async () => {
    const { store, readiness } = setUp();
    memory.settings = null;

    readiness.reportReady();
    TestBed.tick();
    await settle();
    expect(store.state()).toBe('failed');
    expect(store.settings()).toBeNull();

    memory.settings = MEMORY_OPERATOR_SETTINGS;
    store.reload();
    await settle();

    expect(memory.reads).toBe(2);
    expect(store.state()).toBe('ready');
  });

  it('retries a failed read on the next readiness edge, and never in a loop', async () => {
    const { store, readiness } = setUp();
    memory.failNext = true;

    readiness.reportReady();
    TestBed.tick();
    await settle();
    expect(store.state()).toBe('failed');

    // Nothing moves on its own: no timer asks again.
    await settle();
    expect(memory.reads).toBe(1);

    readiness.reportUnreachable();
    TestBed.tick();
    readiness.reportReady();
    TestBed.tick();
    await settle();

    expect(memory.reads).toBe(2);
    expect(store.state()).toBe('ready');
  });

  it('sends one request for two presses of retry', async () => {
    const { store, readiness } = setUp();
    memory.failNext = true;
    readiness.reportReady();
    TestBed.tick();
    await settle();

    store.reload();
    store.reload();
    await settle();

    expect(memory.reads).toBe(2);
  });

  it('keeps an answer it already has when a later read fails', async () => {
    const { store, readiness } = setUp();
    readiness.reportReady();
    TestBed.tick();
    await settle();

    memory.failNext = true;
    store.reload();
    await settle();

    expect(store.state()).toBe('ready');
    expect(store.settings()).toEqual(MEMORY_OPERATOR_SETTINGS);
  });
});

describe('OperatorSettingsApi', () => {
  it('reads the public route without a token, and maps the answer', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: 'https://api.example.org',
            realtimeBaseUrl: 'https://rt.example.org',
          },
        },
        ApiUrl,
        OperatorSettingsApi,
      ],
    });
    const api = TestBed.inject(OperatorSettingsApi);
    const http = TestBed.inject(HttpTestingController);

    const read = api.read();
    const request = http.expectOne((req) =>
      req.url.endsWith('/v1/legal/settings')
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_AUTH)).toBe(true);
    request.flush({ appName: 'Example Shopper' });

    // No terms version: the answer is unreadable, which the store calls failed.
    await expect(read).resolves.toBeNull();
    http.verify();
  });
});
