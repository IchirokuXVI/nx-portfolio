import {
  provideHttpClient,
  type HttpErrorResponse,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ADMIN_API_CONFIG,
  UNKNOWN_ENVIRONMENT,
} from '@portfolio/luna-shopper-admin/models';
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
    request.flush({ environment: 'staging', devAutologin: false });

    await expect(read).resolves.toEqual({
      deployment: 'staging',
      devAutologin: false,
    });
  });

  /**
   * The other half of the same read (plan 0002, section 5). The app skips its
   * login screen only because the server said it may, so this is the value that
   * carries that permission across the boundary.
   */
  it('reads the autologin the gateway offers', async () => {
    const read = api.read();
    http
      .expectOne(URL)
      .flush({ environment: 'development', devAutologin: true });

    await expect(read).resolves.toEqual({
      deployment: 'development',
      devAutologin: true,
    });
  });

  /**
   * Rule D4 at the boundary: the payload is mapped into this app's own union, so a
   * name the app has no colour for arrives as "unknown" rather than as a string
   * that quietly misses every lookup.
   */
  it('refuses an environment name it does not know', async () => {
    const read = api.read();
    http.expectOne(URL).flush({ environment: 'preview' });

    await expect(read).resolves.toEqual(UNKNOWN_ENVIRONMENT);
  });

  it('answers unknown for a body with no environment at all', async () => {
    const read = api.read();
    http.expectOne(URL).flush({});

    await expect(read).resolves.toEqual(UNKNOWN_ENVIRONMENT);
  });

  /**
   * A gateway that answered something this app could not use is still a gateway
   * that answered, so the read settles rather than rejecting and the page draws
   * itself saying the environment is unknown. It is also the safe answer to the
   * second question: no autologin, so the login screen appears rather than being
   * skipped on the strength of a failed request.
   */
  it('answers unknown for a refusal the gateway answered with', async () => {
    const read = api.read();
    http
      .expectOne(URL)
      .flush(null, { status: 500, statusText: 'Server Error' });

    await expect(read).resolves.toEqual(UNKNOWN_ENVIRONMENT);
  });

  /**
   * The one case that rejects (plan 0008, section 3). A request that produced no
   * response at all is a fact about the server rather than about the deployment,
   * and the app answers the two differently: it probes, and covers the login
   * screen rather than offering a password field that cannot work.
   */
  it('throws when the request produced no response at all', async () => {
    const read = api.read();
    http
      .expectOne(URL)
      .error(new ProgressEvent('error'), { status: 0 } as HttpErrorResponse);

    await expect(read).rejects.toBeDefined();
  });
});
