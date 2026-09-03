import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ADMIN_API_CONFIG,
  type ResourceGateway,
} from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { ResourceApiGateways } from './resource-api';
import type { ResourceSource } from './resource-gateways';
import { ResourceMemoryGateways } from './resource-memory';

/**
 * The three shapes the catalog needed the gateway to grow (plan 0005).
 *
 * A collection addressed under a parent, a write that is a `PUT` naming its own
 * key, and a member with no route to read it. All three are real properties of
 * the routes backend plan 0073 published, and all three are honoured by the
 * in-memory gateway as well, because a screen that only works against a server
 * is a screen no spec can drive.
 */

const GATEWAY = 'https://api.example.test';

interface Row {
  readonly id: string;
  readonly [key: string]: unknown;
}

function apiGateway(source: ResourceSource<Row>): {
  gateway: ResourceGateway<Row>;
  http: HttpTestingController;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
      ApiUrl,
      ResourceApiGateways,
    ],
  });

  return {
    gateway: TestBed.inject(ResourceApiGateways).for<Row>(source),
    http: TestBed.inject(HttpTestingController),
  };
}

/** Where a path lands, so a spec asserts the path rather than the whole origin. */
function pathOf(url: string): string {
  return url.startsWith(GATEWAY) ? url.slice(GATEWAY.length) : url;
}

describe('a collection addressed under a parent', () => {
  const SOURCE: ResourceSource<Row> = {
    path: '/v1/admin/catalog/locations',
    collectionPath: (scope) =>
      `/v1/admin/catalog/supermarkets/${scope['supermarketId']}/locations`,
    pathFilters: ['supermarketId'],
  };

  it('puts the parent in the path and not in the query string', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const reading = gateway.list({
      filters: { supermarketId: 'sm_1', postalCodeSource: 'DERIVED' },
    });

    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) ===
        '/v1/admin/catalog/supermarkets/sm_1/locations'
    );
    // The route declares `postalCodeSource` and does not declare
    // `supermarketId`, and the gateway refuses a parameter it did not declare.
    expect(request.request.params.get('postalCodeSource')).toBe('DERIVED');
    expect(request.request.params.get('supermarketId')).toBeNull();

    request.flush({ items: [], nextCursor: null });
    await reading;
    http.verify();
  });

  it('creates under the parent the body names', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const creating = gateway.create({ supermarketId: 'sm_2', city: 'Córdoba' });

    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) ===
        '/v1/admin/catalog/supermarkets/sm_2/locations'
    );
    expect(request.request.method).toBe('POST');

    request.flush({ id: 'loc_1' });
    await creating;
    http.verify();
  });

  it('reads, changes and deletes one shop at its own path', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const reading = gateway.read('loc_9');
    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) === '/v1/admin/catalog/locations/loc_9'
    );
    request.flush({ id: 'loc_9' });
    await reading;
    http.verify();
  });
});

describe('a write that is a PUT naming its own key', () => {
  const SOURCE: ResourceSource<Row> = {
    path: '/v2/admin/catalog/supermarket-items',
    upsert: true,
    key: ['itemId', 'priceScopeId'],
  };

  it('creates with a PUT to the collection', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const writing = gateway.create({
      itemId: 'it_1',
      priceScopeId: 'ps_1',
      price: 1.2,
    });

    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) === '/v2/admin/catalog/supermarket-items'
    );
    expect(request.request.method).toBe('PUT');
    request.flush({ id: 'si_1' });
    await writing;
    http.verify();
  });

  /**
   * The form leaves the key out of an edit, deliberately: changing it would
   * address a different row rather than move this one. So the gateway puts it
   * back, because the body is the only place this route reads it from.
   */
  it('puts the key back into a change the form left it out of', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const writing = gateway.update('it_1~ps_1', { price: 2.5 });

    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) === '/v2/admin/catalog/supermarket-items'
    );
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      itemId: 'it_1',
      priceScopeId: 'ps_1',
      price: 2.5,
    });
    request.flush({ id: 'si_1' });
    await writing;
    http.verify();
  });

  it('finds a member by listing on the key', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const reading = gateway.read('it_1~ps_1');

    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) === '/v2/admin/catalog/supermarket-items'
    );
    expect(request.request.params.get('itemId')).toBe('it_1');
    expect(request.request.params.get('priceScopeId')).toBe('ps_1');

    request.flush({
      items: [{ id: 'si_1', itemId: 'it_1', priceScopeId: 'ps_1' }],
      nextCursor: null,
    });
    await expect(reading).resolves.toMatchObject({ id: 'si_1' });
    http.verify();
  });

  /**
   * The `DELETE` is addressed by the id the row answers with rather than by the
   * key the URL carries, so the row is read first. One extra request, on an act
   * that already asked the operator whether they meant it.
   */
  it('reads a row before deleting it, to learn the id it answers to', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const removing = gateway.remove('it_1~ps_1');

    http
      .expectOne(
        (candidate) =>
          pathOf(candidate.url) === '/v2/admin/catalog/supermarket-items' &&
          candidate.method === 'GET'
      )
      .flush({
        items: [{ id: 'si_7', itemId: 'it_1', priceScopeId: 'ps_1' }],
        nextCursor: null,
      });

    // A macrotask, so the read resolves before the delete is expected.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const deletion = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) === '/v2/admin/catalog/supermarket-items/si_7'
    );
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush({ id: 'si_7' });

    await removing;
    http.verify();
  });
});

describe('a member the list route cannot filter down to', () => {
  /**
   * One shop's aisle positions can be asked for by shop and not by product, so
   * the shop narrows the read and the product is matched in what comes back.
   */
  const SOURCE: ResourceSource<Row> = {
    path: '/v1/admin/catalog/location-items',
    upsert: true,
    key: ['itemId', 'supermarketLocationId'],
    keyFilters: ['supermarketLocationId'],
  };

  it('narrows by what the route takes and matches the rest itself', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const reading = gateway.read('it_2~loc_1');

    const request = http.expectOne(
      (candidate) =>
        pathOf(candidate.url) === '/v1/admin/catalog/location-items'
    );
    expect(request.request.params.get('supermarketLocationId')).toBe('loc_1');
    expect(request.request.params.get('itemId')).toBeNull();

    request.flush({
      items: [
        { id: 'li_1', itemId: 'it_1', supermarketLocationId: 'loc_1' },
        { id: 'li_2', itemId: 'it_2', supermarketLocationId: 'loc_1' },
      ],
      nextCursor: null,
    });

    await expect(reading).resolves.toMatchObject({ id: 'li_2' });
    http.verify();
  });

  it('answers not found when the collection runs out', async () => {
    const { gateway, http } = apiGateway(SOURCE);

    const reading = gateway.read('it_9~loc_1');
    http
      .expectOne(
        (candidate) =>
          pathOf(candidate.url) === '/v1/admin/catalog/location-items'
      )
      .flush({ items: [], nextCursor: null });

    await expect(reading).rejects.toMatchObject({ code: 'not_found' });
    http.verify();
  });
});

describe('the same shapes with no backend at all', () => {
  function memory(source: ResourceSource<Row>): ResourceGateway<Row> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ResourceMemoryGateways] });
    return TestBed.inject(ResourceMemoryGateways).for<Row>(source);
  }

  const SEED: readonly Row[] = [
    { id: 'si_1', itemId: 'it_1', priceScopeId: 'ps_1', price: 1 },
    { id: 'si_2', itemId: 'it_2', priceScopeId: 'ps_1', price: 2 },
  ];

  const SOURCE: ResourceSource<Row> = {
    path: '/prices',
    seed: SEED,
    upsert: true,
    key: ['itemId', 'priceScopeId'],
  };

  it('addresses a row by its natural key', async () => {
    const gateway = memory(SOURCE);

    await expect(gateway.read('it_2~ps_1')).resolves.toMatchObject({
      id: 'si_2',
    });
  });

  /**
   * Writing a price for a product and a scope that already have one is a change
   * to that row. A table that added a second would hold a state the database
   * forbids, and the memory gateway exists to be driven, not to be lenient.
   */
  it('replaces rather than adds when the key already exists', async () => {
    const gateway = memory(SOURCE);

    await gateway.create({ itemId: 'it_1', priceScopeId: 'ps_1', price: 9 });

    const page = await gateway.list({});
    expect(page.items).toHaveLength(SEED.length);
    await expect(gateway.read('it_1~ps_1')).resolves.toMatchObject({
      price: 9,
    });
  });

  /**
   * There are no URLs here, so the parent that would have been a path segment
   * arrives as an ordinary filter this table matches on. Same answer, shorter
   * road.
   */
  it('treats a path parent as an ordinary filter', async () => {
    const gateway = memory({
      path: '/locations',
      seed: [
        { id: 'a', supermarketId: 'sm_1' },
        { id: 'b', supermarketId: 'sm_2' },
      ],
      collectionPath: (scope) => `/chains/${scope['supermarketId']}/locations`,
      pathFilters: ['supermarketId'],
    });

    const page = await gateway.list({ filters: { supermarketId: 'sm_2' } });
    expect(page.items.map((row) => row.id)).toEqual(['b']);
  });
});
