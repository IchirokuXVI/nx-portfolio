import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { ResourceApiGateways } from './resource-api';

const GATEWAY = 'https://api.example.test';
const PATH = '/v1/admin/catalog/supermarkets';
const URL = `${GATEWAY}${PATH}`;

/**
 * The one HTTP implementation every resource shares (plan 0004, section 1).
 *
 * The query string is asserted rather than assumed. `cursor` and `limit` are
 * written out in `toParams` rather than generated, because `PageQueryDto`
 * carries them without an `@ApiPropertyOptional` and they are therefore absent
 * from the committed OpenAPI document even though every collection route
 * accepts them. Anything written by hand against a contract needs a spec saying
 * what it sends.
 */
describe('ResourceApiGateways', () => {
  let gateways: ResourceApiGateways;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        ApiUrl,
        ResourceApiGateways,
      ],
    });

    gateways = TestBed.inject(ResourceApiGateways);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const gateway = () => gateways.for({ path: PATH });

  it('lists with no parameters when nothing was asked for', async () => {
    const listing = gateway().list({});
    const request = http.expectOne((candidate) => candidate.url === URL);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);

    request.flush({ items: [], nextCursor: null });
    await listing;
  });

  it('sends the cursor, the limit, the order and the filters', async () => {
    const listing = gateway().list({
      cursor: 'c1',
      limit: 10,
      order: 'name',
      filters: { query: 'bon', empty: '' },
    });
    const request = http.expectOne((candidate) => candidate.url === URL);

    expect(request.request.params.get('cursor')).toBe('c1');
    expect(request.request.params.get('limit')).toBe('10');
    expect(request.request.params.get('order')).toBe('name');
    expect(request.request.params.get('query')).toBe('bon');
    // An empty filter is not a filter. Sending it would ask the backend to
    // match the empty string, which is not what an untouched search box means.
    expect(request.request.params.has('empty')).toBe(false);

    request.flush({ items: [], nextCursor: null });
    await listing;
  });

  it('sends the page size the source declared when the caller named none', async () => {
    const listing = gateways.for({ path: PATH, pageSize: 50 }).list({});
    const request = http.expectOne((candidate) => candidate.url === URL);

    expect(request.request.params.get('limit')).toBe('50');

    request.flush({ items: [], nextCursor: null });
    await listing;
  });

  it('reads a page, and reads a missing cursor as no more pages', async () => {
    const listing = gateway().list({});
    http
      .expectOne((candidate) => candidate.url === URL)
      .flush({ items: [{ id: 'a' }] });

    await expect(listing).resolves.toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });

  it('reads, creates, changes and deletes a member by id', async () => {
    const read = gateway().read('sm 1');
    // The id is escaped: a space or a slash in one would otherwise change which
    // route the gateway matched.
    http.expectOne(`${URL}/sm%201`).flush({ id: 'sm 1' });
    await read;

    const created = gateway().create({ name: { en: 'Aldi', es: 'Aldi' } });
    const post = http.expectOne(URL);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ name: { en: 'Aldi', es: 'Aldi' } });
    post.flush({ id: 'a' });
    await created;

    const updated = gateway().update('a', { logoUrl: null });
    const patch = http.expectOne(`${URL}/a`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ logoUrl: null });
    patch.flush({ id: 'a' });
    await updated;

    const removed = gateway().remove('a');
    const del = http.expectOne(`${URL}/a`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ id: 'a' });
    await removed;
  });

  /**
   * No screen above this ever sees an `HttpErrorResponse` or switches on a
   * status number, so the translation has to happen here.
   */
  it('turns a refusal into a GatewayError carrying its field errors', async () => {
    const created = gateway().create({});
    http.expectOne(URL).flush(
      {
        code: 'validation_failed',
        correlationId: 'abc',
        errors: { name: ['must not be empty'] },
      },
      { status: 400, statusText: 'Bad Request' }
    );

    await expect(created).rejects.toMatchObject({
      name: 'GatewayError',
      code: 'validation_failed',
      status: 400,
      correlationId: 'abc',
      fieldErrors: { name: ['must not be empty'] },
    });
  });
});
