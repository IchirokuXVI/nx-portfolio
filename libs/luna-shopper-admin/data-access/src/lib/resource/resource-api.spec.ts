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

/**
 * The four resources whose routes are not ordinary CRUD (plan 0005, and backend
 * plan 0073).
 *
 * Every mistake available here is silent in a way the screens cannot show. A
 * collection built at the wrong URL answers 404, a value sent both in the path
 * and in the body answers 400 because the validation pipe refuses a property no
 * DTO declares, and a `PUT` that forgot its key writes a row nobody asked for.
 * So this asserts the URL, the method and the body, which is the whole contract
 * these options exist to express.
 */
describe('ResourceApiGateways, on the routes that are not plain CRUD', () => {
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

  /** Shops: listed and created under a chain, changed at their own path. */
  const shops = () =>
    gateways.for({
      path: '/v1/admin/catalog/locations',
      collectionPath: (values) => {
        const chain = values['supermarketId'];
        return typeof chain === 'string' && chain !== ''
          ? `/v1/admin/catalog/supermarkets/${chain}/locations`
          : null;
      },
      pathParams: ['supermarketId'],
    });

  /** Prices: one `PUT` for both create and change, keyed on a pair. */
  const prices = () =>
    gateways.for({
      path: '/v2/admin/catalog/supermarket-items',
      upsert: true,
      key: ['itemId', 'priceScopeId'],
      keyFilters: ['itemId', 'priceScopeId'],
      readVia: 'collection' as const,
    });

  it('lists a chain’s shops under the chain', async () => {
    const listing = shops().list({ filters: { supermarketId: 'sm1' } });
    const request = http.expectOne(
      (candidate) =>
        candidate.url ===
        `${GATEWAY}/v1/admin/catalog/supermarkets/sm1/locations`
    );

    // In the path, so not also in the query string. `AdminListLocationsQueryDto`
    // does not declare it, and the pipe refuses what no DTO declares.
    expect(request.request.params.get('supermarketId')).toBeNull();

    request.flush({ items: [], nextCursor: null });
    await listing;
  });

  /**
   * No request at all, rather than one to a URL with a hole in it. The screen
   * says which filter it is waiting for.
   */
  it('asks for nothing while the chain is unnamed', async () => {
    await expect(shops().list({})).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('creates a shop under its chain and leaves the chain out of the body', async () => {
    const created = shops().create({ supermarketId: 'sm1', city: 'Córdoba' });
    const request = http.expectOne(
      `${GATEWAY}/v1/admin/catalog/supermarkets/sm1/locations`
    );

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ city: 'Córdoba' });

    request.flush({ id: 'loc1' });
    await created;
  });

  it('changes one shop at its own path', async () => {
    const updated = shops().update('loc1', { city: 'Sevilla' });
    const request = http.expectOne(
      `${GATEWAY}/v1/admin/catalog/locations/loc1`
    );

    expect(request.request.method).toBe('PATCH');
    request.flush({ id: 'loc1' });
    await updated;
  });

  /**
   * A price has no route that reads it by its own uuid, so a read is a filtered
   * listing: one request, and an exact answer, because the key doubles as the
   * collection's filters.
   */
  it('reads a price by the pair it is keyed on', async () => {
    const read = prices().read('it1~ps1');
    const request = http.expectOne(
      (candidate) =>
        candidate.url === `${GATEWAY}/v2/admin/catalog/supermarket-items`
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('itemId')).toBe('it1');
    expect(request.request.params.get('priceScopeId')).toBe('ps1');

    request.flush({
      items: [{ id: 'si1', itemId: 'it1', priceScopeId: 'ps1', price: 1 }],
      nextCursor: null,
    });

    await expect(read).resolves.toMatchObject({ id: 'si1' });
  });

  /**
   * The key goes back into the body, because an upsert is addressed by what is
   * in it. The form leaves those columns out on purpose: they are what the row
   * is, and a `PUT` carrying a different pair would write a second price rather
   * than change this one.
   */
  it('puts a change to a price back with its key', async () => {
    const updated = prices().update('it1~ps1', { price: 2 });
    const request = http.expectOne(
      `${GATEWAY}/v2/admin/catalog/supermarket-items`
    );

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      itemId: 'it1',
      priceScopeId: 'ps1',
      price: 2,
    });

    request.flush({ id: 'si1' });
    await updated;
  });

  it('creates a price with the same PUT', async () => {
    const created = prices().create({
      itemId: 'it1',
      priceScopeId: 'ps1',
      price: 2,
    });
    const request = http.expectOne(
      `${GATEWAY}/v2/admin/catalog/supermarket-items`
    );

    expect(request.request.method).toBe('PUT');
    request.flush({ id: 'si1' });
    await created;
  });

  /**
   * A delete quotes the row's own uuid, which is the one thing that uuid is good
   * for. So a keyed resource is read first and deleted by what came back.
   */
  it('deletes a price by the uuid the listing gave it', async () => {
    const removed = prices().remove('it1~ps1');

    http
      .expectOne(
        (candidate) =>
          candidate.url === `${GATEWAY}/v2/admin/catalog/supermarket-items` &&
          candidate.method === 'GET'
      )
      .flush({
        items: [{ id: 'si1', itemId: 'it1', priceScopeId: 'ps1' }],
        nextCursor: null,
      });

    // A macrotask, so the read resolves before the delete is expected.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const del = http.expectOne(
      `${GATEWAY}/v2/admin/catalog/supermarket-items/si1`
    );
    expect(del.request.method).toBe('DELETE');
    del.flush({ id: 'si1' });

    await removed;
  });

  /**
   * The location item list takes the shop and not the product, so the read asks
   * for the shop's rows and finds the product among them. Sending `itemId` too
   * would be refused rather than ignored.
   */
  it('narrows a read to the key parts the route accepts', async () => {
    const shopRows = gateways.for({
      path: '/v1/admin/catalog/location-items',
      upsert: true,
      key: ['itemId', 'supermarketLocationId'],
      keyFilters: ['supermarketLocationId'],
      readVia: 'collection' as const,
    });

    const read = shopRows.read('it1~loc1');
    const request = http.expectOne(
      (candidate) =>
        candidate.url === `${GATEWAY}/v1/admin/catalog/location-items`
    );

    expect(request.request.params.get('supermarketLocationId')).toBe('loc1');
    expect(request.request.params.get('itemId')).toBeNull();

    request.flush({
      items: [{ id: 'sli1', itemId: 'it1', supermarketLocationId: 'loc1' }],
      nextCursor: null,
    });

    await expect(read).resolves.toMatchObject({ id: 'sli1' });
  });
});
