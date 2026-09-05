import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  PRICE_SCOPES,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import { LeafletUploadPage } from './leaflet-upload-page';

/**
 * A leaflet arrives as a file (admin plan 0010, section 7).
 *
 * The document is written out here rather than read from `tmp/leaflet`, which
 * is git ignored: a spec that read it would pass on the one machine that has
 * the file and fail in CI. It is shaped after the real vision output, with the
 * three offers that answer the import's rules differently.
 *
 * Driven through the in-memory harvester, which dedupes on the document digest,
 * so the 409 branch is a real refusal rather than an assertion about a mock.
 */

/** The catalog seed's chains: one with a national scope, one without. */
const MERCADONA = 'sm_mercadona';
const CONSUM = 'sm_consum';

const drain = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

const DOCUMENT = {
  schema_version: '1.0',
  source: {
    file: 'eljamon.pdf',
    sha256: 'f62fa7ac367008e1dd00871292e9b6be1b5d1c8cca840c40a6541cec3a58f2ea',
    page_count: 40,
  },
  retailer: {
    name: 'El Jamon',
    chain_id: 'el-jamon',
    country: 'ES',
    currency: 'EUR',
    language: 'es',
  },
  validity: { starts_on: '2026-08-27', ends_on: '2026-09-23' },
  offers: [
    {
      id: 'p05-o07',
      page: 5,
      product: { name: 'Cerveza Radler Cruzcampo', format: { raw: '33 cl.' } },
      pricing: { price: { amount: 0.39, currency: 'EUR' }, basis: 'unit' },
      promotion: { type: 'second_unit_discount', raw_text: '-50%' },
      source: 'vision',
    },
    {
      id: 'p36-o01',
      page: 36,
      product: { name: 'Champu Elvive', format: {} },
      pricing: { price: { amount: 2.34, currency: 'EUR' }, basis: 'unit' },
      loyalty: { required: true, program: 'descuentos ifamilia' },
      source: 'vision',
    },
    {
      id: 'p01-o01',
      page: 1,
      product: { name: 'Aceite Coosur', format: { raw: '5 l' } },
      pricing: { price: { amount: 19.95, currency: 'EUR' }, basis: 'unit' },
      promotion: { type: 'price_drop', raw_text: 'ANTES 21,95' },
      source: 'vision',
    },
  ],
  warnings: [{ page: 0, message: 'Only six pages were read.' }],
};

/** A file input's change event, with a file that answers `text()`. */
function dropped(text: string): Event {
  return {
    target: { files: [{ text: async () => text }] },
  } as unknown as Event;
}

/** The memory harvester, with every call recorded. */
function recorded(over: Partial<HarvestServiceI> = {}): {
  service: HarvestServiceI;
  calls: { name: string; args: unknown[] }[];
} {
  const inner = new HarvestMemory();
  const calls: { name: string; args: unknown[] }[] = [];

  const service = new Proxy(inner, {
    get(target, property, receiver) {
      const override = (over as Record<string, unknown>)[property as string];
      const value = override ?? Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value;
      }

      return (...args: unknown[]) => {
        calls.push({ name: property, args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as HarvestServiceI;

  return { service, calls };
}

async function render(over: Partial<HarvestServiceI> = {}) {
  const { service, calls } = recorded(over);

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LeafletUploadPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      // The chain picker and the scope picker both read a descriptor, so both
      // have to be mounted or every lookup answers nothing.
      provideResources(SUPERMARKETS, PRICE_SCOPES),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LeafletUploadPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture, calls, page: fixture.componentInstance };
}

/** The page with the document read and a chain chosen. */
async function loaded(over: Partial<HarvestServiceI> = {}) {
  const rendered = await render(over);
  await rendered.page.chooseFile(dropped(JSON.stringify(DOCUMENT)));
  await rendered.page.chooseChain(MERCADONA);
  await drain();
  rendered.fixture.detectChanges();
  return rendered;
}

const named = (
  calls: { name: string; args: unknown[] }[],
  name: string
): unknown[][] => calls.filter((call) => call.name === name).map((c) => c.args);

const text = (fixture: ComponentFixture<LeafletUploadPage>): string =>
  fixture.nativeElement.textContent;

describe('the leaflet upload', () => {
  it('refuses a file that is not JSON, in the browser', async () => {
    const { page, calls, fixture } = await render();

    await page.chooseFile(dropped('%PDF-1.7'));
    fixture.detectChanges();

    expect(page.rejection()).toBe('not-json');
    expect(page.leaflet()).toBeNull();
    // Nothing was sent. A 300 KB round trip to be told it is not JSON is a
    // round trip for nothing.
    expect(named(calls, 'importLeaflet')).toEqual([]);
  });

  it('shows what the file contains before anything is chosen', async () => {
    const { page, fixture } = await render();

    await page.chooseFile(dropped(JSON.stringify(DOCUMENT)));
    fixture.detectChanges();

    expect(page.facts()).toEqual([
      { key: 'retailer', value: 'El Jamon' },
      { key: 'chainId', value: 'el-jamon' },
      { key: 'file', value: 'eljamon.pdf' },
      {
        key: 'sha256',
        value:
          'f62fa7ac367008e1dd00871292e9b6be1b5d1c8cca840c40a6541cec3a58f2ea',
      },
      { key: 'pages', value: '40' },
      { key: 'offers', value: '3' },
      { key: 'warnings', value: '1' },
    ]);
  });

  /**
   * Which rows the rules will drop or queue is visible **before** submitting,
   * which is the whole point of previewing rather than reading the run's
   * warnings afterwards.
   */
  it('draws the rows a rule will drop or queue muted', async () => {
    const { page, fixture } = await render();

    await page.chooseFile(dropped(JSON.stringify(DOCUMENT)));
    fixture.detectChanges();

    const muted = page.offers().filter((row) => row.muted);
    expect(muted.map((row) => row.id).sort()).toEqual(['p05-o07', 'p36-o01']);
    expect(
      fixture.nativeElement.querySelectorAll('.offers li.muted')
    ).toHaveLength(2);
  });

  it('sorts the preview by page, both ways', async () => {
    const { page, fixture } = await render();

    await page.chooseFile(dropped(JSON.stringify(DOCUMENT)));
    fixture.detectChanges();
    expect(page.offers().map((row) => row.page)).toEqual([1, 5, 36]);

    page.togglePageOrder();
    fixture.detectChanges();
    expect(page.offers().map((row) => row.page)).toEqual([36, 5, 1]);
  });

  /**
   * Most leaflets are nationwide, so the chain's `NATIONAL` scope is the answer
   * the operator confirms rather than searches for.
   */
  it('preselects the chain national scope', async () => {
    const { page } = await loaded();

    expect(page.priceScopeId()).toBe('ps_mercadona_national');
    expect(page.noNationalScope()).toBe(false);
  });

  /**
   * A chain with none is offered the create form instead. It opens in a new
   * tab, because this screen holds the document in memory and nowhere else.
   */
  it('offers to create a scope for a chain with no national one', async () => {
    const { page, fixture } = await render();

    await page.chooseFile(dropped(JSON.stringify(DOCUMENT)));
    await page.chooseChain(CONSUM);
    await drain();
    fixture.detectChanges();

    expect(page.noNationalScope()).toBe(true);
    const link = fixture.nativeElement.querySelector('.field a');
    expect(link.getAttribute('href')).toContain('/price-scopes/new');
    expect(link.getAttribute('href')).toContain('supermarketId=');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('prefills the dates from the file and sends them as days', async () => {
    const { page, calls } = await loaded();

    expect(page.validFrom()).toBe('2026-08-27');
    expect(page.validUntil()).toBe('2026-09-23');

    await page.submit();

    expect(named(calls, 'importLeaflet')[0][0]).toMatchObject({
      supermarketId: MERCADONA,
      priceScopeId: 'ps_mercadona_national',
      validFrom: '2026-08-27',
      validUntil: '2026-09-23',
    });
  });

  /** A null date leaves the input empty, required, and the import blocked. */
  it('will not import until a missing date is typed', async () => {
    const { page, calls, fixture } = await render();

    await page.chooseFile(
      dropped(
        JSON.stringify({
          ...DOCUMENT,
          validity: { starts_on: null, ends_on: null },
        })
      )
    );
    await page.chooseChain(MERCADONA);
    await drain();
    fixture.detectChanges();

    expect(page.missingDates()).toBe(true);
    expect(page.ready()).toBe(false);

    await page.submit();
    expect(named(calls, 'importLeaflet')).toEqual([]);

    page.validFrom.set('2026-09-01');
    page.validUntil.set('2026-09-30');
    expect(page.ready()).toBe(true);
  });

  /** The document goes over byte for byte. Nothing on this screen edits it. */
  it('sends the document exactly as it was read', async () => {
    const { page, calls } = await loaded();

    await page.submit();

    expect(named(calls, 'importLeaflet')[0][0]).toMatchObject({
      document: DOCUMENT,
    });
  });

  it('leaves for the run on a successful import', async () => {
    const { page, fixture } = await loaded();
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    await page.submit();
    await drain();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith([
      '/',
      'harvest',
      'runs',
      expect.any(String),
    ]);
  });

  /**
   * Section 2.1: a refusal is drawn as rows naming the offer, and the preview
   * row with the same id is highlighted so the operator can see the tile the
   * gateway objected to.
   */
  it('draws a refusal as rows naming the offer', async () => {
    const refuse = async () => {
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: '',
        fieldErrors: {
          '/offers/0/pricing/price': [
            '/offers/0/pricing/price must be an object (offer p05-o07)',
          ],
          '/offers/0/basis': ['/offers/0/basis is required (offer p05-o07)'],
        },
      });
    };
    const { page, fixture } = await loaded({
      importLeaflet: refuse,
    } as unknown as Partial<HarvestServiceI>);

    await page.submit();
    await drain();
    fixture.detectChanges();

    expect(page.failures()).toHaveLength(1);
    expect(page.failures()[0].offerId).toBe('p05-o07');
    expect(page.failures()[0].messages).toHaveLength(2);
    expect(page.blamed().has('p05-o07')).toBe(true);
    expect(
      fixture.nativeElement.querySelectorAll('.offers li.blamed')
    ).toHaveLength(1);
    // The document is still here, so the operator fixes the file in the
    // extractor and drops it again without losing anything.
    expect(page.leaflet()).not.toBeNull();
  });

  /**
   * The document dedupe is per chain and per digest, and the refusal names the
   * run that took it. Reverting that run is the way to import a corrected file.
   */
  it('links to the earlier run when the document was already imported', async () => {
    const { page, fixture } = await loaded();

    await page.submit();
    await drain();

    // The same file again, for the same chain.
    await page.chooseFile(dropped(JSON.stringify(DOCUMENT)));
    await page.chooseChain(MERCADONA);
    await drain();
    await page.submit();
    await drain();
    fixture.detectChanges();

    expect(page.conflict()?.kind).toBe('already-imported');
    expect(page.conflict()?.runId).not.toBe('');
    expect(text(fixture)).toContain('harvest.leaflets.conflict.open');
  });
});
