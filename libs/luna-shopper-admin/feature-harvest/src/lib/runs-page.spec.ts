import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { RunsPage } from './runs-page';

/**
 * The start form (admin plan 0014, section 3).
 *
 * Two things changed and both are refusals made visible. `REFRESH` cannot be
 * named, because backend plan `0086` deleted the mode: a walk writes its prices
 * now, so nothing was left for a refresh to do. And a Mercadona walk cannot be
 * started without a price scope, because the spawn refuses one, so the field
 * appears exactly where it is required rather than everywhere or nowhere.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';
const NATIONAL = 'scope-national';

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

function spawnRecorder(): {
  service: HarvestServiceI;
  spawned: unknown[];
} {
  const memory = new HarvestMemory();
  const spawned: unknown[] = [];

  const service = {
    ...({} as HarvestServiceI),
    listRuns: (query: never) => memory.listRuns(query),
    readSource: (id: string) => memory.readSource(id),
    spawnRun: async (input: unknown) => {
      spawned.push(input);
      return memory.listRuns({}).then((page) => page.items[0]);
    },
  } as unknown as HarvestServiceI;

  return { service, spawned };
}

async function render() {
  const { service, spawned } = spawnRecorder();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        // The chain's scopes, for the preselection. One national scope, which
        // is what a chain that prices nationwide looks like.
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async () => ({
              items: [{ id: NATIONAL, kind: 'NATIONAL' }],
              nextCursor: null,
            }),
          }),
        },
      },
      {
        provide: ResourceReferences,
        useValue: { search: async () => [], resolve: async () => null },
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

  const fixture = TestBed.createComponent(RunsPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture: fixture as ComponentFixture<RunsPage>, spawned };
}

/** The form, pointed at one chain and given time to read its source row. */
async function chain(fixture: ComponentFixture<RunsPage>, id: string) {
  fixture.componentInstance.supermarketId.set(id);
  fixture.componentInstance.onChainChange();
  await drain();
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<RunsPage>): string =>
  fixture.nativeElement.textContent;

describe('the run form, the modes it offers', () => {
  it('offers three, and cannot name a refresh or a leaflet import', async () => {
    const { fixture } = await render();

    expect(fixture.componentInstance.modes).toEqual([
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
      'FILE_IMPORT',
    ]);
    expect(text(fixture)).not.toContain('harvest.mode.REFRESH');
    expect(text(fixture)).not.toContain('harvest.mode.LEAFLET_IMPORT');
  });

  /**
   * An import needs a document, and a document is a file, a preview and a
   * validation failure that names the product it is about. None of that fits
   * three text inputs, so the form offers the way to the screen that does.
   */
  it('sends a file import to the upload screen rather than starting it', async () => {
    const { fixture } = await render();

    fixture.componentInstance.mode.set('FILE_IMPORT');
    fixture.detectChanges();

    expect(fixture.componentInstance.uploading()).toBe(true);
    expect(fixture.componentInstance.uploadLink()).toEqual([
      '/',
      'harvest',
      'imports',
      'upload',
    ]);
  });
});

describe('the run form, the price scope a walk writes to', () => {
  /**
   * The spawn refuses a Mercadona walk without a scope (backend plan 0086,
   * section 9), so the field is on screen and the button is not offered until it
   * is answered.
   */
  it('asks for a scope for a chain fetched through an API that prices', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    expect(page.adapterKey()).toBe('mercadona-api');
    expect(page.needsScope()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.priceScope');
  });

  /** Most walks price nationally, so the operator confirms rather than searches. */
  it('preselects the chain national scope', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    expect(fixture.componentInstance.priceScopeId()).toBe(NATIONAL);
    expect(fixture.componentInstance.ready()).toBe(true);
  });

  it('will not start the walk with the scope emptied', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.priceScopeId.set('');
    fixture.detectChanges();

    expect(page.ready()).toBe(false);
    await page.start();
    await drain();

    expect(spawned).toEqual([]);
  });

  it('sends the scope with the walk', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);

    await fixture.componentInstance.start();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeId: NATIONAL,
    });
  });

  /**
   * DEZA's site prints no price, so its walk writes none and the spawn accepts
   * a scope and ignores it. A field that does nothing is a lie in a form.
   */
  it('asks for no scope for a chain whose site prints none', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.adapterKey()).toBe('deza-web');
    expect(page.needsScope()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.priceScope');
    expect(page.ready()).toBe(true);

    await page.start();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: DEZA,
    });
  });

  /**
   * A store discovery finds shops and writes no price at all, so the field has
   * nothing to be about whatever the chain's adapter is.
   */
  it('asks for no scope on a store discovery', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.mode.set('STORE_DISCOVERY');
    fixture.detectChanges();

    expect(page.needsScope()).toBe(false);
  });

  /** A scope of the previous chain is not a scope of this one. */
  it('drops the scope when the chain changes', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    fixture.componentInstance.supermarketId.set(DEZA);
    fixture.componentInstance.onChainChange();

    expect(fixture.componentInstance.priceScopeId()).toBe('');
  });
});
