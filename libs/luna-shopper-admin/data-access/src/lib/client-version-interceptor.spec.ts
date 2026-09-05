import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ADMIN_API_CONFIG,
  ADMIN_APP_VERSION,
  CLIENT_VERSION_HEADER,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from './api-url';
import {
  clientVersionInterceptor,
  PAGE_RELOAD,
} from './client-version-interceptor';

const GATEWAY = 'http://gateway.test';

/**
 * The back office says which build it is (backend plan 0080, section 11), so
 * a deployment's `MIN_CLIENT_VERSION` retires an old back office the way it
 * retires an old velista.
 */
describe('clientVersionInterceptor', () => {
  function boot(version = '0.6.0') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([clientVersionInterceptor])),
        provideHttpClientTesting(),
        ApiUrl,
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        { provide: ADMIN_APP_VERSION, useValue: version },
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      backend: TestBed.inject(HttpTestingController),
    };
  }

  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      // A test environment without storage is the same as a browser without it.
    }
  });

  it('stamps every gateway request with the build version', async () => {
    const { http, backend } = boot('0.6.0');

    const pending = firstValueFrom(http.get(`${GATEWAY}/v1/admin/environment`));
    const request = backend.expectOne(`${GATEWAY}/v1/admin/environment`);

    expect(request.request.headers.get(CLIENT_VERSION_HEADER)).toBe('0.6.0');
    request.flush({});
    await pending;
  });

  it('sends nothing to a URL that is not the gateway', async () => {
    const { http, backend } = boot();

    const pending = firstValueFrom(http.get('https://elsewhere.test/thing'));
    const request = backend.expectOne('https://elsewhere.test/thing');

    expect(request.request.headers.has(CLIENT_VERSION_HEADER)).toBe(false);
    request.flush({});
    await pending;
  });

  it('reloads once when the gateway answers client_too_old, and rethrows', async () => {
    const reload = jest.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([clientVersionInterceptor])),
        provideHttpClientTesting(),
        ApiUrl,
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        { provide: ADMIN_APP_VERSION, useValue: '0.5.1' },
        { provide: PAGE_RELOAD, useValue: reload },
      ],
    });
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = firstValueFrom(
        http.get(`${GATEWAY}/v1/admin/environment`)
      );
      backend
        .expectOne(`${GATEWAY}/v1/admin/environment`)
        .flush(
          { code: 'client_too_old' },
          { status: 426, statusText: 'Upgrade Required' }
        );
      await expect(pending).rejects.toMatchObject({ status: 426 });
    }
    // Two refusals, one reload: a page that reloaded on every refusal would
    // loop while the new bundle is not yet reachable.
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
