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
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from './api-url';
import { contentLocaleInterceptor } from './content-locale-interceptor';
import { ContentLocaleStore } from './content-locale-store';

const GATEWAY = 'http://gateway.test';

/**
 * The back office says which language its operator reads (admin plan 0026,
 * section 4), so the server's own messages come back in it.
 *
 * The third property is the one a static header would fail: the request carries
 * whatever the setting says **now**, not what it said when the app booted.
 */
describe('contentLocaleInterceptor', () => {
  function boot() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([contentLocaleInterceptor])),
        provideHttpClientTesting(),
        ApiUrl,
        ContentLocaleStore,
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      backend: TestBed.inject(HttpTestingController),
      content: TestBed.inject(ContentLocaleStore),
    };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('sends the chosen language on every gateway request', async () => {
    const { http, backend } = boot();

    const pending = firstValueFrom(http.get(`${GATEWAY}/v1/admin/items`));
    const request = backend.expectOne(`${GATEWAY}/v1/admin/items`);

    expect(request.request.headers.get('Accept-Language')).toBe('en');
    request.flush({});
    await pending;
  });

  /**
   * The same rule `clientVersionInterceptor` states, and the reason this is a
   * third interceptor rather than a line inside one of the other two.
   */
  it('sends nothing to a URL that is not the gateway', async () => {
    const { http, backend } = boot();

    const pending = firstValueFrom(http.get('https://elsewhere.test/thing'));
    const request = backend.expectOne('https://elsewhere.test/thing');

    expect(request.request.headers.has('Accept-Language')).toBe(false);
    request.flush({});
    await pending;
  });

  it('follows a change of the setting', async () => {
    const { http, backend, content } = boot();

    content.choose('es');

    const pending = firstValueFrom(http.get(`${GATEWAY}/v1/admin/items`));
    const request = backend.expectOne(`${GATEWAY}/v1/admin/items`);

    // A bare code, with no q weighting and no region: the backend parses a full
    // `Accept-Language` list and keeps only the primary subtag, so this is the
    // simplest input it accepts.
    expect(request.request.headers.get('Accept-Language')).toBe('es');
    request.flush({});
    await pending;
  });
});
