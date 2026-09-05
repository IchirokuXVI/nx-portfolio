import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { GatewayError } from '../gateway-error';
import { DirectoryApi } from './directory-api';

/**
 * The seven named actions, each against the route backend plan 0074 built for
 * it (plan 0007, section 6).
 *
 * The assertion every one of these makes is the same, and it is the only one
 * worth making here: the method and the URL. What an action *means* lives in
 * core or in auth, and this class is the mapping from one to the other.
 */

const API = { gatewayBaseUrl: 'http://gateway.test/api' };

const ZONE = 'zone-1';
const MEMBERSHIP = 'membership-1';
const USER = 'user-1';

function setUp() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ADMIN_API_CONFIG, useValue: API },
      ApiUrl,
      DirectoryApi,
    ],
  });

  return {
    directory: TestBed.inject(DirectoryApi),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('DirectoryApi', () => {
  it('deletes an account through the route that runs the cascade', async () => {
    const { directory, http } = setUp();

    const done = directory.deleteUser(USER);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/users/${USER}`
    );
    expect(request.request.method).toBe('DELETE');
    request.flush({ deleted: true });

    await expect(done).resolves.toBeUndefined();
    http.verify();
  });

  it('resends a confirmation, and says nothing about the language by default', async () => {
    const { directory, http } = setUp();

    const done = directory.resendVerification(USER);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/users/${USER}/resend-verification`
    );
    expect(request.request.method).toBe('POST');
    // An absent locale is left out rather than sent as null: the gateway reads
    // a missing one as the request's own language, and null is a different
    // claim.
    expect(request.request.body).toEqual({});
    request.flush({ sent: true });

    await done;
    http.verify();
  });

  it('sends the locale when one was chosen', async () => {
    const { directory, http } = setUp();

    const done = directory.resendVerification(USER, 'es');
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/users/${USER}/resend-verification`
    );
    expect(request.request.body).toEqual({ locale: 'es' });
    request.flush({ sent: true });

    await done;
    http.verify();
  });

  it('deletes a zone through the reaper route', async () => {
    const { directory, http } = setUp();

    const done = directory.deleteZone(ZONE);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}`
    );
    expect(request.request.method).toBe('DELETE');
    request.flush({ id: ZONE });

    await done;
    http.verify();
  });

  /** The one action with an answer worth reading: the code it just minted. */
  it('answers a regenerated join code with the new code', async () => {
    const { directory, http } = setUp();

    const done = directory.regenerateJoinCode(ZONE);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}/join-code`
    );
    expect(request.request.method).toBe('POST');
    request.flush({ id: ZONE, joinCode: 'NEWC0DE1' });

    await expect(done).resolves.toBe('NEWC0DE1');
    http.verify();
  });

  it.each([
    ['transferOwnership', 'ownership'],
    ['kickMember', 'kick'],
    ['banMember', 'ban'],
  ] as const)('posts %s to the membership route', async (method, segment) => {
    const { directory, http } = setUp();

    const done = directory[method](ZONE, MEMBERSHIP);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}/members/${MEMBERSHIP}/${segment}`
    );
    expect(request.request.method).toBe('POST');
    request.flush({});

    await done;
    http.verify();
  });

  /**
   * Every failure arrives as a `GatewayError`, so the screens above never see an
   * `HttpErrorResponse` and never switch on a status number.
   */
  it('turns a refusal into a gateway error', async () => {
    const { directory, http } = setUp();

    const done = directory.deleteZone(ZONE);
    http
      .expectOne(`${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}`)
      .flush({ code: 'forbidden' }, { status: 403, statusText: 'Forbidden' });

    await expect(done).rejects.toBeInstanceOf(GatewayError);
    http.verify();
  });

  /** Ids arrive as data, so they are escaped rather than pasted into a path. */
  it('escapes an id that could change the path', async () => {
    const { directory, http } = setUp();

    const done = directory.deleteUser('a/b');
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/users/a%2Fb`
    );
    request.flush({ deleted: false });

    await done;
    http.verify();
  });
});

/**
 * The acts plan 0009 adds, each against the route backend plan 0077 built for
 * it.
 *
 * They are acts rather than fields because each does more than write a column.
 * The assertion here is the same one the seven above make, and the only one
 * worth making in this class: the method and the URL.
 */
describe('DirectoryApi, for the writes that are not fields', () => {
  const LIST = 'list-1';
  const LINE = 'line-1';

  /**
   * One service method, two routes, because the two directions are `POST` and
   * `DELETE` on the same address. Both write `status` and `markedForDeletionAt`
   * in one transaction, which is the whole reason this is not two fields.
   */
  it('marks a zone for deletion with a POST', async () => {
    const { directory, http } = setUp();

    const done = directory.setZoneDeletionMark(ZONE, true);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}/deletion-mark`
    );
    expect(request.request.method).toBe('POST');
    request.flush({});

    await expect(done).resolves.toBeUndefined();
    http.verify();
  });

  it('takes the mark off again with a DELETE', async () => {
    const { directory, http } = setUp();

    const done = directory.setZoneDeletionMark(ZONE, false);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}/deletion-mark`
    );
    expect(request.request.method).toBe('DELETE');
    request.flush({});

    await expect(done).resolves.toBeUndefined();
    http.verify();
  });

  it('lets a waiting member in through the approve route', async () => {
    const { directory, http } = setUp();

    const done = directory.approveMember(ZONE, MEMBERSHIP);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}/members/${MEMBERSHIP}/approve`
    );
    expect(request.request.method).toBe('POST');
    request.flush({});

    await expect(done).resolves.toBeUndefined();
    http.verify();
  });

  it('refuses one through the reject route', async () => {
    const { directory, http } = setUp();

    const done = directory.rejectMember(ZONE, MEMBERSHIP);
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/zones/${ZONE}/members/${MEMBERSHIP}/reject`
    );
    expect(request.request.method).toBe('POST');
    request.flush({});

    await expect(done).resolves.toBeUndefined();
    http.verify();
  });

  /**
   * One route for both answers, with the answer in the body. It is a service
   * call rather than a select on the form, because an act can be confirmed.
   */
  it('sets a line approval, with the state in the body', async () => {
    const { directory, http } = setUp();

    const done = directory.setLineApproval(LIST, LINE, 'APPROVED');
    const request = http.expectOne(
      `${API.gatewayBaseUrl}/v1/admin/lists/${LIST}/lines/${LINE}/approval`
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ status: 'APPROVED' });
    request.flush({});

    await expect(done).resolves.toBeUndefined();
    http.verify();
  });
});
