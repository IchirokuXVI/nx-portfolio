import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { ApiUrl } from '../api-url';
import { HarvestApi } from './harvest-api';

/**
 * The probe list of backend plan 0219, section 8, as the start of a run reads
 * it (admin plan 0069): one page of ten for one chain.
 */
const API = { gatewayBaseUrl: 'http://gateway.test/api' };
const SOURCES = `${API.gatewayBaseUrl}/v1/admin/harvest/sources`;

describe('HarvestApi, probes of a chain', () => {
  it('reads the probes of the chain with the limit it is given', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_API_CONFIG, useValue: API },
        ApiUrl,
        HarvestApi,
      ],
    });
    const harvest = TestBed.inject(HarvestApi);
    const http = TestBed.inject(HttpTestingController);

    const done = harvest.listProbes('chain/1', { limit: 10 });
    const request = http.expectOne(
      (candidate) => candidate.url === `${SOURCES}/chain%2F1/probes`
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('limit')).toBe('10');
    request.flush({ items: [], nextCursor: null });

    await expect(done).resolves.toEqual({ items: [], nextCursor: null });
    http.verify();
  });
});
