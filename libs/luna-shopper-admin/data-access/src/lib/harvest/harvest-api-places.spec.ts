import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { GatewayError } from '../gateway-error';
import { HarvestApi } from './harvest-api';

/**
 * The two place routes of backend plan 0193, as this app calls them (admin
 * plan 0061).
 *
 * What a link means is the harvester's. What this class owes the screens is
 * the method, the address and the body, and a refusal that arrives with its
 * code and its details.
 */

const API = { gatewayBaseUrl: 'http://gateway.test/api' };
const PLACES = `${API.gatewayBaseUrl}/v1/admin/harvest/places`;

function setUp() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ADMIN_API_CONFIG, useValue: API },
      ApiUrl,
      HarvestApi,
    ],
  });

  return {
    harvest: TestBed.inject(HarvestApi),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HarvestApi, linking a place', () => {
  it('posts the shop to the link of the place, and answers what was filled', async () => {
    const { harvest, http } = setUp();

    const done = harvest.linkPlace('place-1', {
      supermarketLocationId: 'shop-1',
    });
    const request = http.expectOne(`${PLACES}/place-1/link`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ supermarketLocationId: 'shop-1' });
    request.flush({ place: { id: 'place-1' }, filled: ['ADDRESS', 'CITY'] });

    await expect(done).resolves.toEqual({
      place: { id: 'place-1' },
      filled: ['ADDRESS', 'CITY'],
    });
    http.verify();
  });

  it('sends acrossChains when the link is asked for across chains', () => {
    const { harvest, http } = setUp();

    void harvest.linkPlace('place-1', {
      supermarketLocationId: 'shop-1',
      acrossChains: true,
    });

    expect(http.expectOne(`${PLACES}/place-1/link`).request.body).toEqual({
      supermarketLocationId: 'shop-1',
      acrossChains: true,
    });
  });

  it('hands on the other chain refusal with the chain it names', async () => {
    const { harvest, http } = setUp();

    const done = harvest
      .linkPlace('place-1', { supermarketLocationId: 'shop-1' })
      .catch((error: unknown) => error);
    http.expectOne(`${PLACES}/place-1/link`).flush(
      {
        code: 'place_names_another_chain',
        correlationId: 'c-1',
        details: { chain: { id: 'chain-2', name: { es: 'Dia' } } },
      },
      { status: 409, statusText: 'Conflict' }
    );

    const error = (await done) as GatewayError;
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.code).toBe('place_names_another_chain');
    expect(error.details['chain']).toEqual({
      id: 'chain-2',
      name: { es: 'Dia' },
    });
  });
});

describe('HarvestApi, linking places by reference', () => {
  it('posts an empty body for the dry answer', async () => {
    const { harvest, http } = setUp();

    const done = harvest.linkPlacesByRef({});
    const request = http.expectOne(`${PLACES}/link-by-ref`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ applied: false, linked: [], skipped: [] });

    await expect(done).resolves.toEqual({
      applied: false,
      linked: [],
      skipped: [],
    });
    http.verify();
  });

  it('posts apply when the links are to be written', () => {
    const { harvest, http } = setUp();

    void harvest.linkPlacesByRef({ apply: true });

    expect(http.expectOne(`${PLACES}/link-by-ref`).request.body).toEqual({
      apply: true,
    });
  });
});
