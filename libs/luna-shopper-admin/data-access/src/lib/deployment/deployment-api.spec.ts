import {
  provideHttpClient,
  type HttpErrorResponse,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { DeploymentApi } from './deployment-api';

const GATEWAY = 'https://api.example.test';
const URL = `${GATEWAY}/v1/admin/environment`;

describe('DeploymentApi', () => {
  let api: DeploymentApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        ApiUrl,
        DeploymentApi,
      ],
    });

    api = TestBed.inject(DeploymentApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the deployment from the gateway, unauthenticated', async () => {
    const read = api.read();

    const request = http.expectOne(URL);
    // Nothing attaches a token in this plan, and the endpoint is public. A header
    // here would be a claim of identity the login screen cannot yet make.
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ environment: 'staging' });

    await expect(read).resolves.toBe('staging');
  });

  /**
   * Rule D4 at the boundary: the payload is mapped into this app's own union, so a
   * name the app has no colour for arrives as "unknown" rather than as a string
   * that quietly misses every lookup.
   */
  it('refuses an environment name it does not know', async () => {
    const read = api.read();
    http.expectOne(URL).flush({ environment: 'preview' });

    await expect(read).resolves.toBeNull();
  });

  it('answers unknown for a body with no environment at all', async () => {
    const read = api.read();
    http.expectOne(URL).flush({});

    await expect(read).resolves.toBeNull();
  });

  /**
   * An unreachable gateway must not throw. Nothing is waiting on this call, and the
   * page has to be able to draw itself and say the environment is unknown; an
   * unhandled rejection during bootstrap would give an operator a blank screen and
   * less information than that.
   */
  it('answers unknown rather than throwing when the gateway does not answer', async () => {
    const read = api.read();
    http
      .expectOne(URL)
      .error(new ProgressEvent('error'), { status: 0 } as HttpErrorResponse);

    await expect(read).resolves.toBeNull();
  });
});
