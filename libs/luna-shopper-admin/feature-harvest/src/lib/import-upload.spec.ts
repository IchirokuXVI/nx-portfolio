import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { ImportUploadPage } from './import-upload-page';

/**
 * The import (admin plan 0014, sections 2 and 5).
 *
 * Most of this file is about the hints, and that is the right proportion. The
 * three inputs are what the run is stamped with, so a file that quietly
 * overwrote one an operator had chosen would produce a run stamped as something
 * nobody asked for; and a file carried between environments names ids the
 * receiving one has never seen. Every case below is one of those two facts.
 */

const CHAIN = 'chain-1';
const OTHER_CHAIN = 'chain-2';
const SCOPE = 'scope-1';
const NATIONAL = 'scope-national';

const drain = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/** The directory this deployment has: two chains and two scopes, and no more. */
const DIRECTORY: Record<string, string> = {
  [CHAIN]: 'Deza',
  [OTHER_CHAIN]: 'Mercadona',
  [SCOPE]: 'Cordoba',
  [NATIONAL]: 'NATIONAL',
};

function document(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    sha256: '9f2cdead',
    producer: { name: 'leaflet-extractor', version: '0.4.0' },
    validity: { from: '2026-09-10', until: '2026-09-23' },
    products: [
      {
        id: 'p-1',
        name: 'Leche entera',
        price: { amount: 0.89, currency: 'EUR' },
      },
    ],
    ...over,
  };
}

/**
 * A file input event, without a `File`.
 *
 * The page asks a chosen file for its text and nothing else, so a stub with
 * `text()` exercises exactly the path a real drop takes. A real `File` would add
 * a jsdom dependency for no extra coverage.
 */
function dropped(doc: unknown): Event {
  return {
    target: { files: [{ text: async () => JSON.stringify(doc) }] },
  } as unknown as Event;
}

/** What the next import is answered with, when it is not answered with a run. */
let refusal: unknown = null;

async function render() {
  const imported: unknown[] = [];

  const service = {
    importDocument: async (input: unknown) => {
      imported.push(input);
      if (refusal !== null) {
        throw refusal;
      }
      return { id: 'run-9' };
    },
  } as unknown as HarvestServiceI;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ImportUploadPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async () => ({
              items: [
                { id: NATIONAL, kind: 'NATIONAL' },
                { id: SCOPE, kind: 'POSTAL_CODE' },
              ],
              nextCursor: null,
            }),
          }),
        },
      },
      {
        provide: ResourceReferences,
        useValue: {
          search: async () => [],
          resolve: async (_resource: string, id: string) =>
            DIRECTORY[id] === undefined ? null : { id, title: DIRECTORY[id] },
        },
      },
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

  const fixture = TestBed.createComponent(ImportUploadPage);
  fixture.detectChanges();
  await drain();

  return {
    fixture: fixture as ComponentFixture<ImportUploadPage>,
    page: fixture.componentInstance,
    imported,
  };
}

const text = (fixture: ComponentFixture<ImportUploadPage>): string =>
  fixture.nativeElement.textContent;

beforeEach(() => {
  refusal = null;
});

describe('the import, reading a file', () => {
  it('refuses a file that is not JSON, in the browser', async () => {
    const { page } = await render();

    await page.chooseFile({
      target: { files: [{ text: async () => '%PDF-1.7' }] },
    } as unknown as Event);

    expect(page.rejection()).toBe('not-json');
    expect(page.read()).toBeNull();
  });

  it('refuses JSON from something other than a producer', async () => {
    const { page } = await render();

    await page.chooseFile(dropped({ schema_version: 1 }));

    expect(page.rejection()).toBe('not-a-document');
  });

  it('shows what the file says about itself', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document()));
    fixture.detectChanges();

    expect(page.facts()).toContainEqual({
      key: 'producer',
      value: 'leaflet-extractor',
    });
    expect(text(fixture)).toContain('9f2cdead');
  });
});

describe('the import, the three inputs', () => {
  /**
   * All three, because all three are what the rows and the prices are stamped
   * with. The source kind especially: it decides which policy ranks the price,
   * so it is chosen rather than assumed.
   */
  it('will not start until the chain, the scope and the kind are all answered', async () => {
    const { page } = await render();

    await page.chooseFile(dropped(document({ hints: undefined })));
    expect(page.ready()).toBe(false);

    page.supermarketId.set(CHAIN);
    expect(page.ready()).toBe(false);

    page.priceScopeId.set(SCOPE);
    expect(page.ready()).toBe(false);

    page.sourceKind.set('OFFICIAL_LEAFLET');
    expect(page.ready()).toBe(true);
  });

  it('sends the three with the document, byte for byte', async () => {
    const { page, imported } = await render();
    const doc = document({ hints: undefined });

    await page.chooseFile(dropped(doc));
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_API');
    await page.submit();

    expect(imported[0]).toEqual({
      supermarketId: CHAIN,
      priceScopeId: SCOPE,
      sourceKind: 'OFFICIAL_API',
      validFrom: '2026-09-10',
      validUntil: '2026-09-23',
      document: doc,
    });
  });
});

describe('the import, what the file wanted', () => {
  const hinted = {
    chain_id: CHAIN,
    price_scope_id: SCOPE,
    source_kind: 'OFFICIAL_LEAFLET',
  };

  it('fills the empty inputs and says which it set', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document({ hints: hinted })));
    await drain();
    fixture.detectChanges();

    expect(page.supermarketId()).toBe(CHAIN);
    expect(page.priceScopeId()).toBe(SCOPE);
    expect(page.sourceKind()).toBe('OFFICIAL_LEAFLET');
    expect(page.notice().kind).toBe('set');
    expect(page.notice().set.map((line) => line.field)).toEqual([
      'chain',
      'scope',
      'sourceKind',
    ]);
    // The name rather than the uuid, so the notice can be read.
    expect(page.notice().set[0].fileValue).toBe('Deza');
    expect(text(fixture)).toContain('harvest.imports.hints.set');
  });

  /**
   * The whole rule: an input the operator already set is never overwritten,
   * whatever the file says. The notice names both, so a disagreement is visible
   * before the run starts rather than in the queue afterwards.
   */
  it('keeps every choice the operator made first, and names what the file wanted', async () => {
    const { fixture, page } = await render();

    page.supermarketId.set(OTHER_CHAIN);
    page.priceScopeId.set(NATIONAL);
    page.sourceKind.set('OFFICIAL_API');

    await page.chooseFile(dropped(document({ hints: hinted })));
    await drain();
    fixture.detectChanges();

    expect(page.supermarketId()).toBe(OTHER_CHAIN);
    expect(page.priceScopeId()).toBe(NATIONAL);
    expect(page.sourceKind()).toBe('OFFICIAL_API');
    expect(page.notice().kind).toBe('kept');
    expect(page.notice().kept).toContainEqual({
      field: 'chain',
      outcome: 'kept',
      fileValue: 'Deza',
      keptValue: 'Mercadona',
    });
    expect(text(fixture)).toContain('harvest.imports.hints.kept');
  });

  it('lists both when some were set and some were kept', async () => {
    const { fixture, page } = await render();

    page.sourceKind.set('OFFICIAL_API');

    await page.chooseFile(dropped(document({ hints: hinted })));
    await drain();
    fixture.detectChanges();

    expect(page.notice().kind).toBe('mixed');
    expect(page.notice().set.map((line) => line.field)).toEqual([
      'chain',
      'scope',
    ]);
    expect(page.notice().kept.map((line) => line.field)).toEqual([
      'sourceKind',
    ]);
  });

  /**
   * An id does not survive an environment change, which is the ordinary state
   * of a file carried from the machine that walked to the cluster that imports.
   */
  it('leaves the input empty and names the id it could not find', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(
      dropped(document({ hints: { chain_id: 'chain-nowhere' } }))
    );
    await drain();
    fixture.detectChanges();

    expect(page.supermarketId()).toBe('');
    expect(page.notice().unknown).toEqual([
      {
        field: 'chain',
        outcome: 'unknown',
        fileValue: 'chain-nowhere',
        keptValue: '',
      },
    ]);
    expect(text(fixture)).toContain('harvest.imports.hints.unknownLine');
  });

  /** A hand written file carries none, and that is an ordinary file. */
  it('says nothing at all about a file with no hints', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document({ hints: undefined })));
    await drain();
    fixture.detectChanges();

    expect(page.notice().shown).toBe(false);
    expect(text(fixture)).not.toContain('harvest.imports.hints.');
  });

  /** A chain the file set still gets its national scope preselected. */
  it('preselects the national scope for a chain the file set', async () => {
    const { page } = await render();

    await page.chooseFile(dropped(document({ hints: { chain_id: CHAIN } })));
    await drain();

    expect(page.supermarketId()).toBe(CHAIN);
    expect(page.priceScopeId()).toBe(NATIONAL);
  });
});

describe('the import, the window', () => {
  it('shows the two dates for a document that carries one', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document()));
    fixture.detectChanges();

    expect(page.validFrom()).toBe('2026-09-10');
    expect(page.validUntil()).toBe('2026-09-23');
    expect(text(fixture)).toContain('harvest.imports.validFrom');
  });

  /**
   * A storefront export has no window, so asking for one would be asking for a
   * fact the file never had.
   */
  it('hides them for a document that carries none', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document({ validity: undefined })));
    fixture.detectChanges();

    expect(page.read()?.validity).toBeNull();
    expect(page.missingDates()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.imports.validFrom');
  });

  it('refuses to start with a window it was given and the operator emptied', async () => {
    const { page } = await render();

    await page.chooseFile(dropped(document({ hints: undefined })));
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_LEAFLET');
    page.validUntil.set('');

    expect(page.missingDates()).toBe(true);
    expect(page.ready()).toBe(false);
  });
});

describe('the import, once it has started', () => {
  /**
   * The rows are the work, and an import fetches nothing so its run is over in
   * seconds. The queue is where the operator goes next, with the chain it was
   * imported for already chosen.
   */
  it('links to the queue with the chain preselected', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document({ hints: undefined })));
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_LEAFLET');
    await page.submit();
    fixture.detectChanges();

    expect(page.started()).toBe('run-9');
    expect(page.queueLink()).toEqual(['/', 'harvest', 'entries']);
    expect(page.queueParams()).toEqual({ supermarketId: CHAIN });
    expect(text(fixture)).toContain('harvest.imports.openQueue');
  });
});

/**
 * The refusal an operator in a cluster actually meets (backend plan 0086,
 * section 6.2).
 *
 * Both clusters run the harvester with `HARVEST_ENABLED` false, and an import is
 * the one run an operator there has any reason to start. So the 501 that answers
 * it is an ordinary state of this screen and gets the switch's own explanation,
 * not the app's general "something went wrong".
 */
describe('the import, refused by the deployment', () => {
  const ready = async () => {
    const rendered = await render();
    await rendered.page.chooseFile(dropped(document({ hints: undefined })));
    rendered.page.supermarketId.set(CHAIN);
    rendered.page.priceScopeId.set(SCOPE);
    rendered.page.sourceKind.set('OFFICIAL_LEAFLET');
    return rendered;
  };

  it('names the switch that stopped it', async () => {
    refusal = new GatewayError({
      code: 'not_configured',
      status: 501,
      correlationId: '',
      detail: 'Harvesting is disabled on this deployment.',
    });

    const { fixture, page } = await ready();
    await page.submit();
    fixture.detectChanges();

    expect(page.errorKey()).toBe('harvest.blocked.service-off');
    expect(page.started()).toBe('');
    expect(text(fixture)).toContain('harvest.blocked.service-off');
  });

  it('falls through to the general vocabulary for anything else', async () => {
    refusal = new GatewayError({
      code: 'internal',
      status: 500,
      correlationId: '',
    });

    const { page } = await ready();
    await page.submit();

    expect(page.errorKey()).toBe('resource.error.unknown');
  });
});

/**
 * The preview, capped and searchable (admin plan 0019).
 *
 * The screen's own half. What matched and what is drawn is decided by two pure
 * functions with their own table of cases in `harvest-document.spec.ts`, so
 * everything here is about the three signals around them: that the cap is
 * really applied to the DOM, that a term resets the window, that a refusal
 * narrows the preview, and that a second file leaves none of it behind.
 */
describe('the import, previewing a large file', () => {
  /** A file of `count` products, each findable by its own number. */
  function big(count: number): Record<string, unknown> {
    return document({
      hints: undefined,
      products: Array.from({ length: count }, (_, index) => ({
        id: `p-${index}`,
        name: `Product ${index}`,
        brand: index === count - 1 ? 'Jamón' : 'Hacendado',
        price: { amount: 1, currency: 'EUR' },
      })),
    });
  }

  const rows = (fixture: ComponentFixture<ImportUploadPage>): number =>
    fixture.nativeElement.querySelectorAll('.products li').length;

  /** Type into the box and let the 250 ms settle, without waiting for it. */
  function search(page: ImportUploadPage, term: string): void {
    page.onSearch({ target: { value: term } } as unknown as Event);
    jest.advanceTimersByTime(300);
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('draws the first 250 of a 400 row file and offers the rest', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(400)));
    fixture.detectChanges();

    expect(rows(fixture)).toBe(250);
    expect(page.tally().kind).toBe('capped');
    expect(page.window().remaining).toBe(150);
    expect(text(fixture)).toContain('harvest.imports.preview.more');
  });

  it('draws 500 once "show more" has been pressed', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(600)));
    page.showMore();
    fixture.detectChanges();

    expect(rows(fixture)).toBe(500);
  });

  /** The document is untouched by any of this: only the `@for` is capped. */
  it('holds every product and sends the file whole', async () => {
    const { fixture, page, imported } = await render();
    const doc = big(400);

    await page.chooseFile(dropped(doc));
    fixture.detectChanges();
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_API');
    await page.submit();

    expect(page.read()?.products).toHaveLength(400);
    expect((imported[0] as { document: unknown }).document).toEqual(doc);
  });

  /**
   * The whole file is filtered and the window applied to what matched, so the
   * one product on row 399 is drawn without "show more" being pressed once.
   */
  it('finds a product past the cap and drops the "show more"', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(400)));
    search(page, 'jamon');
    fixture.detectChanges();

    expect(rows(fixture)).toBe(1);
    expect(page.window().hasMore).toBe(false);
    expect(page.tally().kind).toBe('matching');
    expect(page.tally().matched).toBe('1');
    expect(text(fixture)).not.toContain('harvest.imports.preview.more');
  });

  it('resets the window when the term changes', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(600)));
    page.showMore();
    expect(page.shown()).toBe(500);

    search(page, 'product');
    fixture.detectChanges();

    expect(page.shown()).toBe(250);
    expect(rows(fixture)).toBe(250);
  });

  it('says nothing matched rather than drawing an empty list', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(400)));
    search(page, 'chorizo');
    fixture.detectChanges();

    expect(page.tally().kind).toBe('none');
    expect(rows(fixture)).toBe(0);
  });

  /** A leaflet. No cap in sight, and no control either. */
  it('draws a small file whole and shows only its count', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(40)));
    fixture.detectChanges();

    expect(rows(fixture)).toBe(40);
    expect(page.tally().kind).toBe('all');
    expect(page.tally().total).toBe('40');
    expect(text(fixture)).not.toContain('harvest.imports.preview.more');
  });

  /**
   * Under a cap, marking the blamed rows where they sit is a promise that
   * cannot be kept: the row a message names is past the window and every drawn
   * row is unmarked. So the preview follows the operator to the complaint.
   */
  it('narrows to the refused rows, and a control gives the file back', async () => {
    refusal = new GatewayError({
      code: 'validation_failed',
      status: 400,
      correlationId: '',
      fieldErrors: {
        '/products/300/price': ['A price is required.'],
        '/products/301/price': ['A price is required.'],
      },
    });

    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(400)));
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_API');
    await page.submit();
    fixture.detectChanges();

    expect(page.refusedOnly()).toBe(true);
    expect(rows(fixture)).toBe(2);
    expect(page.tally().kind).toBe('refused');
    expect(page.tally().total).toBe('400');
    expect(text(fixture)).toContain('harvest.imports.preview.wholeFile');

    // Narrower still, because two filters at once read as the narrower question.
    search(page, 'Product 300');
    fixture.detectChanges();
    expect(rows(fixture)).toBe(1);
    expect(page.tally().kind).toBe('refusedMatching');

    page.showWholeFile();
    search(page, '');
    fixture.detectChanges();
    expect(page.refusedOnly()).toBe(false);
    expect(rows(fixture)).toBe(250);
  });

  /**
   * A complaint about the producer block names no product, so narrowing would
   * hide the whole document to say something that is not about it.
   */
  it('leaves the preview alone for a refusal that names no product', async () => {
    refusal = new GatewayError({
      code: 'validation_failed',
      status: 400,
      correlationId: '',
      fieldErrors: { '/producer/name': ['A producer is required.'] },
    });

    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(400)));
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_API');
    await page.submit();
    fixture.detectChanges();

    expect(page.refusedOnly()).toBe(false);
    expect(rows(fixture)).toBe(250);
  });

  it('clears the term, the window and the refusal when a second file arrives', async () => {
    refusal = new GatewayError({
      code: 'validation_failed',
      status: 400,
      correlationId: '',
      fieldErrors: { '/products/300/price': ['A price is required.'] },
    });

    const { fixture, page } = await render();

    await page.chooseFile(dropped(big(400)));
    page.supermarketId.set(CHAIN);
    page.priceScopeId.set(SCOPE);
    page.sourceKind.set('OFFICIAL_API');
    await page.submit();
    page.showMore();
    search(page, 'jamon');
    fixture.detectChanges();

    refusal = null;
    await page.chooseFile(dropped(big(400)));
    fixture.detectChanges();

    expect(page.term()).toBe('');
    expect(page.shown()).toBe(250);
    expect(page.refusedOnly()).toBe(false);
    expect(page.failures()).toEqual([]);
    expect(rows(fixture)).toBe(250);
  });
});

/**
 * Whether the file needs to be told which group of shops its prices are for
 * (admin plan 0025, section 3).
 *
 * Three rules, one case each. **All three are read from the products and never
 * from `hints.adapter_key`**: the hint is what a producer claims and the
 * products are what the file holds, so a mislabelled file is asked for what it
 * actually needs rather than refused for lying.
 */
describe('the import, the scope the file needs', () => {
  /** A version 2 document that prices two regions itself. */
  const scoped = (over: Record<string, unknown> = {}) =>
    document({
      schema_version: 2,
      validity: undefined,
      scopes: [
        { key: '58', kind: 'REGION', name: 'Sevilla' },
        { key: '12', kind: 'REGION', name: 'Madrid' },
      ],
      products: [
        {
          id: 'p-1',
          name: 'Uva blanca',
          prices: [
            { scope: '58', amount: 1.29, currency: 'EUR' },
            { scope: '12', amount: 1.39, currency: 'EUR' },
          ],
        },
      ],
      ...over,
    });

  it('asks for a scope for a leaflet, which prices no group of its own', async () => {
    // Rule 1, and every version 1 document: a price naming no group has
    // nowhere to go without a default.
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document({ hints: undefined })));
    fixture.detectChanges();

    expect(page.needsScope()).toBe(true);
    expect(text(fixture)).toContain('harvest.imports.scope');
  });

  it('asks for no scope from a file that prices every group itself', async () => {
    // Rule 2. A LIDL export names 59 regions and prices each, so a default
    // would catch nothing.
    const { fixture, page } = await render();

    await page.chooseFile(dropped(scoped({ hints: undefined })));
    fixture.detectChanges();

    expect(page.needsScope()).toBe(false);
    page.supermarketId.set(CHAIN);
    page.sourceKind.set('OFFICIAL_API');

    // Ready with no scope chosen at all, which is the whole point of the rule.
    expect(page.priceScopeId()).toBe('');
    expect(page.ready()).toBe(true);
  });

  it('asks for no scope from a file that states no price at all', async () => {
    // Rule 3. A DEZA export prices nothing, so there is no scope to write a
    // price for.
    const { page } = await render();

    await page.chooseFile(
      dropped(
        document({
          hints: undefined,
          products: [{ id: 'p-1', name: 'Uva blanca' }],
        })
      )
    );

    expect(page.needsScope()).toBe(false);
  });

  it('asks for a scope when one price of a scoped file names none', async () => {
    // One unscoped price is enough: that price has nowhere to go, and the rest
    // of the file being scoped does not help it.
    const { page } = await render();

    await page.chooseFile(
      dropped(
        scoped({
          hints: undefined,
          products: [
            {
              id: 'p-1',
              name: 'Uva blanca',
              prices: [
                { scope: '58', amount: 1.29, currency: 'EUR' },
                { amount: 1.19, currency: 'EUR' },
              ],
            },
          ],
        })
      )
    );

    expect(page.needsScope()).toBe(true);
  });

  it('reads the products, not the adapter the file claims', async () => {
    // A file labelled `lidl-api` that carries an unscoped price is asked for a
    // default. The hint is a claim; the products are the proof.
    const { page } = await render();

    await page.chooseFile(
      dropped(document({ hints: { adapter_key: 'lidl-api' } }))
    );

    expect(page.needsScope()).toBe(true);
  });

  it('shows what the file prices for, and sends no scope with it', async () => {
    const { fixture, page, imported } = await render();
    const doc = scoped({ hints: undefined });

    await page.chooseFile(dropped(doc));
    page.supermarketId.set(CHAIN);
    page.sourceKind.set('OFFICIAL_API');
    fixture.detectChanges();

    expect(page.scopeSummary()).toEqual({
      count: 2,
      names: 'Sevilla, Madrid',
      mostPerProduct: 2,
    });
    expect(text(fixture)).toContain('harvest.imports.scopes.count');

    await page.submit();

    // No `priceScopeId` at all: sending one would be this screen asserting a
    // fact about an import that has no default to fall back to.
    expect(imported[0]).toEqual({
      supermarketId: CHAIN,
      sourceKind: 'OFFICIAL_API',
      document: doc,
    });
  });

  it('shows no scope block for a leaflet, which declares none', async () => {
    const { fixture, page } = await render();

    await page.chooseFile(dropped(document({ hints: undefined })));
    fixture.detectChanges();

    expect(page.scopeSummary()).toBeNull();
    expect(text(fixture)).not.toContain('harvest.imports.scopes.count');
  });
});
