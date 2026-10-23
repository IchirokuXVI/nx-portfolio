import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ApiUrl,
  GatewayError,
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { ITEMS_PATH } from './catalog-sources';
import { ItemLinkedImages } from './item-linked-images';
import { ItemSourceEntries } from './item-source-entries';

/**
 * The linked images read over HTTP (admin plan 0065). Every Sources tab spec
 * runs on the memory seed, so this is the one that pins the route, the parse
 * of its body and what a refusal leaves on the tab.
 */

const API = { gatewayBaseUrl: 'http://gateway.test/api' };
const ITEM = 'item-1';
const URL = `${API.gatewayBaseUrl}${ITEMS_PATH}/${ITEM}/linked-images`;

function setUp() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ADMIN_API_CONFIG, useValue: API },
      ApiUrl,
      // Not the memory back end, so the read goes over HTTP.
      { provide: RESOURCE_GATEWAYS, useValue: {} },
      {
        provide: HARVEST_SERVICE,
        useValue: {
          listItemEntries: async () => ({ items: [], nextCursor: null }),
        },
      },
      { provide: ResourceReferences, useValue: { resolve: async () => null } },
    ],
  });

  return {
    images: TestBed.inject(ItemLinkedImages),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('ItemLinkedImages over HTTP', () => {
  it('reads the linked images of the product and keys them by source row', async () => {
    const { images, http } = setUp();

    const read = images.read(ITEM);
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('GET');
    request.flush({
      images: [
        {
          sourceEntryId: 'entry-1',
          url: 'https://chain.test/a.jpg',
          enabled: true,
        },
        {
          sourceEntryId: 'entry-2',
          url: 'https://chain.test/b.jpg',
          enabled: false,
        },
        { sourceEntryId: '', url: 'https://chain.test/c.jpg', enabled: true },
      ],
    });

    const photos = await read;
    expect([...photos.entries()]).toEqual([
      ['entry-1', { url: 'https://chain.test/a.jpg', enabled: true }],
      ['entry-2', { url: 'https://chain.test/b.jpg', enabled: false }],
    ]);
    http.verify();
  });

  it('turns a 503 into a gateway error, and the Sources tab says the photos failed', async () => {
    const { images, http } = setUp();

    const read = images.read(ITEM);
    http
      .expectOne(URL)
      .flush(
        { code: 'SERVICE_UNAVAILABLE' },
        { status: 503, statusText: 'Service Unavailable' }
      );
    const refusal = await read.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(GatewayError);
    expect(refusal).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });

    const fixture = TestBed.createComponent(ItemSourceEntries);
    fixture.componentRef.setInput('itemId', ITEM);
    fixture.detectChanges();
    http
      .expectOne(URL)
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    // The refusal settles over a few promise turns that whenStable does not wait on.
    await new Promise((resolve) => setTimeout(resolve));

    expect(fixture.componentInstance.photosFailed()).toBe(true);
    expect(fixture.componentInstance.photos().size).toBe(0);
    http.verify();
  });
});
