import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
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

async function render() {
  const imported: unknown[] = [];

  const service = {
    importDocument: async (input: unknown) => {
      imported.push(input);
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
