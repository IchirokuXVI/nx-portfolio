import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  RecordPage,
  RecordView,
  ResourceChanges,
  ResourceListPage,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  FieldDescriptor,
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { PageHeader, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionSource } from '../catalog-sources';
import { ChainSections } from '../chain-sections';
import { ShopSections } from '../shop-sections';
import { CHAIN_RESOURCES, chainsRoutes } from './chains-routes';

/**
 * A chain on the record page (admin plan 0056), against the in memory
 * gateways and through the real route table of the Chains section.
 *
 * The seed is the catalog's own: Mercadona holds three shops, two sections and
 * six price scopes, and Consum holds one shop and one scope. Bonpreu holds
 * nothing and has no default scope.
 *
 * Assertions are on view models and on keys wherever a string is translated,
 * because the testing translator answers with the key.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/** The Chains section, as the app declares it. */
const CHAINS: AdminSection = {
  key: 'chains',
  label: '',
  held: CHAIN_RESOURCES,
  screens: chainsRoutes(),
};

/**
 * A screen 72 rem wide or wider, where the chains are a column that stays
 * beside the open chain. jsdom matches no media query, so without this every
 * spec below runs as a narrow screen.
 */
const WIDE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(false), split: signal(true) },
};

async function boot(url: string, providers: Provider[] = []) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([CHAINS])),
      provideLocationMocks(),
      provideSections(CHAINS),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

/** Lets the reads settle, then redraws. `whenStable` hangs in a zoneless spec. */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

async function go(fixture: ComponentFixture<TestHost>, url: string) {
  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);
  await settle(fixture);
}

const url = () => TestBed.inject(Router).url;

/**
 * The page of the chain. On the address of a shop there is a second record
 * page under it, and the chain's is the first.
 */
const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(RecordPage))
    .componentInstance as RecordPage;

/** The element of the chain's page. The column of chains is beside it. */
const pageElement = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(RecordPage))
    .nativeElement as HTMLElement;

const view = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(RecordView))
    .componentInstance as RecordView;

/** The tabs of the page. A chain that is read always has them. */
const tabs = (fixture: ComponentFixture<TestHost>) =>
  page(fixture).tabs() ?? [];

/** The number beside each tab, or `null` where the tab shows none. */
const counts = (fixture: ComponentFixture<TestHost>) =>
  tabs(fixture).map((tab) => tab.count?.() ?? null);

/** One field of the chain, by its name. */
const field = (fixture: ComponentFixture<TestHost>, name: string) =>
  (page(fixture).descriptor.fields as readonly FieldDescriptor[]).find(
    (candidate) => candidate.name === name
  ) as FieldDescriptor;

/** The column of chains, which is a list of the same resource. */
const column = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement
    .queryAll(By.directive(ResourceListPage))
    .find((list) => list.componentInstance.descriptor.name === 'supermarkets')
    ?.nativeElement as HTMLElement | undefined;

const rowsOf = (fixture: ComponentFixture<TestHost>) =>
  [...pageElement(fixture).querySelectorAll('[data-row]')] as HTMLElement[];

const tableRows = (fixture: ComponentFixture<TestHost>) =>
  [...pageElement(fixture).querySelectorAll('tbody tr')] as HTMLElement[];

const buttonSaying = (
  root: HTMLElement,
  label: string
): HTMLButtonElement | undefined =>
  ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find(
    (button) => button.textContent?.trim() === label
  );

function refusal(code: string, status: number): GatewayError {
  return new GatewayError({ code, status, correlationId: 'cid' });
}

/**
 * Change what one memory gateway does, by the end of its path.
 *
 * On the prototype, because a descriptor builds its gateway when a screen is
 * constructed, which is before a spec can reach the instance.
 */
function alter(
  pathEnd: string,
  change: (gateway: ResourceGateway<ResourceRow>) => void
) {
  const original = ResourceMemoryGateways.prototype.for;
  jest
    .spyOn(ResourceMemoryGateways.prototype, 'for')
    .mockImplementation(function <T extends ResourceRow>(
      this: ResourceMemoryGateways,
      source: Parameters<ResourceMemoryGateways['for']>[0]
    ): ResourceGateway<T> {
      const gateway = original.call(this, source) as ResourceGateway<T>;
      if (source.path.endsWith(pathEnd)) {
        change(gateway as unknown as ResourceGateway<ResourceRow>);
      }
      return gateway;
    });
}

/** What the chain gateway was asked to write. */
function recordChainUpdates(): { id: string; input: ResourceInput }[] {
  const sent: { id: string; input: ResourceInput }[] = [];
  alter('/supermarkets', (gateway) => {
    const update = gateway.update.bind(gateway);
    gateway.update = (id, input) => {
      sent.push({ id, input });
      return update(id, input);
    };
  });
  return sent;
}

/** What the harvester answers for a chain's source. */
function harvester(readSource: (id: string) => Promise<unknown>): Provider {
  return {
    provide: HARVEST_SERVICE,
    useValue: { readSource },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('a chain, on the record page', () => {
  it('opens on its shops', async () => {
    const fixture = await boot('/chains/sm_mercadona');

    expect(url()).toBe('/chains/sm_mercadona/shops');
    expect(page(fixture).descriptor.name).toBe('supermarkets');
    expect(page(fixture).store().mode()).toBe('read');
  });

  it('is titled with the name of the chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(page(fixture).heading()).toBe('Mercadona');
    expect(pageElement(fixture).querySelector('h1')?.textContent).toBe(
      'Mercadona'
    );
  });

  /** On a wide screen the column says "Chains" in a pane, and the page is the chain. */
  it('is the one h1 on a wide screen, beside the column of chains', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [WIDE]);

    const headings = [...fixture.nativeElement.querySelectorAll('h1')].map(
      (heading) => (heading as HTMLElement).textContent
    );
    expect(headings).toEqual(['Mercadona']);
  });

  it('says how to use the page behind the info button, not in a paragraph', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(page(fixture).descriptor.info).toEqual({
      title: 'catalog.chains.info.title',
      points: ['catalog.chains.info.holds', 'catalog.chains.info.openShop'],
    });
    expect(
      pageElement(fixture).querySelector('lib-page-header lib-info-button')
    ).not.toBeNull();
  });

  /** Read off the one file that holds the words: the two sentences of the info. */
  it('holds the sentences of the info', () => {
    const { catalog } = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../ui/assets/i18n/en.json'),
        'utf8'
      )
    );

    expect(catalog.chains.info.holds).toBe(
      'A chain holds its shops, its sections and its price scopes.'
    );
    expect(catalog.chains.info.openShop).toBe(
      'Open a shop to set its section order, its products and the scopes that price it.'
    );
  });

  /**
   * One pane at a time below 72 rem: the chain is over the list of chains,
   * so the header names the way back. Beside the column there is none,
   * because the column is the way back.
   */
  it('draws the way back to the chains on a narrow screen only', async () => {
    const narrow = await boot('/chains/sm_mercadona/shops');
    // The header of the page. The column of chains has one of its own.
    const header = narrow.debugElement
      .query(By.directive(RecordPage))
      .query(By.directive(PageHeader)).componentInstance as PageHeader;
    expect(page(narrow).listUrl).toBe('/chains');
    expect(header.backLink()).toBe('/chains');
    // A chain is under no row, so the way back says the name of its list.
    expect(page(narrow).backLabel()).toBe('catalog.supermarkets.many');
    expect(
      pageElement(narrow).querySelector('a.page-back')?.getAttribute('href')
    ).toBe('/chains');

    const wide = await boot('/chains/sm_mercadona/shops', [WIDE]);
    expect(page(wide).backLabel()).toBeNull();
    expect(pageElement(wide).querySelector('.page-back')).toBeNull();
  });

  it('says so when the chain is not there, and draws no tab', async () => {
    const fixture = await boot('/chains/sm_nowhere/shops');

    expect(
      pageElement(fixture).querySelector('[data-missing], [data-no-answer]')
    ).not.toBeNull();
    expect(page(fixture).tabs()).toBeNull();
    expect(pageElement(fixture).querySelector('.under')).toBeNull();
  });
});

describe('the tabs of a chain', () => {
  it('is Shops, Sections, Price scopes and Details, each under the chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(tabs(fixture).map((tab) => tab.label)).toEqual([
      'catalog.locations.many',
      'catalog.chains.tabs.sections',
      'catalog.priceScopes.many',
      'record.tab.details',
    ]);
    expect(tabs(fixture).map((tab) => tab.path)).toEqual([
      '/chains/sm_mercadona/shops',
      '/chains/sm_mercadona/sections',
      '/chains/sm_mercadona/scopes',
      '/chains/sm_mercadona/details',
    ]);
  });

  it('marks the tab that is open as the current page', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');
    const links = [
      ...pageElement(fixture).querySelectorAll('lib-page-header nav a'),
    ] as HTMLAnchorElement[];

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/chains/sm_mercadona/shops',
      '/chains/sm_mercadona/sections',
      '/chains/sm_mercadona/scopes',
      '/chains/sm_mercadona/details',
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'page',
      null,
    ]);
  });

  /**
   * The shop count is the `locationCount` catalog gave on the chain. The
   * sections are read whole, and the scopes fit one page, so both are counted.
   * Details is the record and counts nothing.
   */
  it('counts the shops, the sections and the scopes of the seed', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(counts(fixture)).toEqual([3, 2, 6, null]);
    expect(tabs(fixture)[3].count).toBeUndefined();
  });

  it('counts the own rows of another chain, and not those of the first', async () => {
    const fixture = await boot('/chains/sm_consum/shops');

    // One shop, no section and one scope.
    expect(counts(fixture)).toEqual([1, 0, 1, null]);
  });

  /** "Do not show a number that the gateway does not give." */
  it('shows no shop count when the chain carries none', async () => {
    alter('/supermarkets', (gateway) => {
      const read = gateway.read.bind(gateway);
      gateway.read = async (id) => {
        const { locationCount, ...row } = await read(id);
        void locationCount;
        return row;
      };
    });
    const fixture = await boot('/chains/sm_mercadona/sections');

    // The other two were given, and still show.
    expect(counts(fixture)).toEqual([null, 2, 6, null]);
  });

  /**
   * The scope list has no total. Past one page the length of the first page is
   * a number that is too small, so the tab shows none.
   */
  it('shows no scope count when the list has more pages', async () => {
    alter('/price-scopes', (gateway) => {
      const list = gateway.list.bind(gateway);
      gateway.list = async (query): Promise<ResourcePage<ResourceRow>> => ({
        ...(await list(query)),
        nextCursor: 'more',
      });
    });
    const fixture = await boot('/chains/sm_mercadona/sections');

    expect(counts(fixture)).toEqual([3, 2, null, null]);
  });

  it('shows no count for what could not be read, and still opens', async () => {
    jest
      .spyOn(ShopSections.prototype, 'chainSections')
      .mockRejectedValue(refusal('unavailable', 503));
    alter('/price-scopes', (gateway) => {
      gateway.list = async () => {
        throw refusal('unavailable', 503);
      };
    });
    const fixture = await boot('/chains/sm_mercadona/details');

    expect(counts(fixture)).toEqual([3, null, null, null]);
    expect(page(fixture).heading()).toBe('Mercadona');
    expect(fixture.debugElement.query(By.directive(RecordView))).not.toBeNull();
  });

  /**
   * The page asks for the counts once for each chain it opens. A section
   * written by anything else says so, and the number is read again.
   */
  it('counts the sections again when one is written', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');
    expect(counts(fixture)[1]).toBe(2);

    await TestBed.inject(RESOURCE_GATEWAYS)
      .for(sectionSource())
      .create({
        supermarketId: 'sm_mercadona',
        slug: 'bakery',
        name: { en: 'Bakery', es: 'Panadería' },
        position: 2,
        categoryIds: [],
      });
    // Nothing said so yet, and the tab still shows what it read.
    await settle(fixture);
    expect(counts(fixture)[1]).toBe(2);

    TestBed.inject(ResourceChanges).wrote('sections');
    await settle(fixture);
    await settle(fixture);

    expect(counts(fixture)).toEqual([3, 3, 6, null]);
  });
});

/**
 * Whether the harvester fetches the chain, as a state beside its name (admin
 * plan 0056, target 2). The harvester is a second service, so it can fail by
 * itself, and then the header says nothing: a state nobody read is not a
 * state.
 */
describe('the harvester state of a chain', () => {
  const FETCHED = 'catalog.chains.source.fetched';
  const OFF = 'catalog.chains.source.off';

  const labels = (fixture: ComponentFixture<TestHost>) =>
    page(fixture)
      .chips()
      .map((chip) => chip.label);

  it('says the chain is fetched when its source is switched on', async () => {
    const asked: string[] = [];
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async (id) => {
        asked.push(id);
        return { enabled: true };
      }),
    ]);

    expect(asked).toContain('sm_mercadona');
    expect(page(fixture).chips()).toEqual([{ label: FETCHED, tone: 'good' }]);
    const chip = pageElement(fixture).querySelector('lib-page-header .chip');
    expect(chip?.textContent?.trim()).toBe(FETCHED);
    expect(chip?.classList.contains('good')).toBe(true);
    // A state and no longer a link: the source is reached from Setup.
    expect(chip?.tagName).toBe('SPAN');
    expect(chip?.closest('a')).toBeNull();
  });

  it('says the chain is not fetched when its source is switched off', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async () => ({ enabled: false })),
    ]);

    expect(page(fixture).chips()).toEqual([{ label: OFF, tone: 'neutral' }]);
  });

  /** Not found is an answer: every price of this chain is typed by a person. */
  it('says the chain is not fetched when the harvester knows no source', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async () => {
        throw refusal('not_found', 404);
      }),
    ]);

    expect(page(fixture).chips()).toEqual([{ label: OFF, tone: 'neutral' }]);
  });

  it('says nothing when the harvester did not answer, and still opens', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async () => {
        throw refusal('unavailable', 503);
      }),
    ]);

    expect(page(fixture).chips()).toEqual([]);
    expect(page(fixture).heading()).toBe('Mercadona');
    expect(rowsOf(fixture)).toHaveLength(3);
  });

  /**
   * The column of chains builds its states from the same `rowStates`. The
   * source is another read, made for the one chain that is open, so a row of
   * the column never says it.
   */
  it('is not said on the rows of the column of chains', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      WIDE,
      harvester(async () => ({ enabled: true })),
    ]);

    expect(labels(fixture)).toContain(FETCHED);
    const chains = column(fixture);
    expect(chains).toBeDefined();
    expect(chains?.textContent).toContain('Mercadona');
    expect(chains?.textContent).not.toContain(FETCHED);
    expect(chains?.textContent).not.toContain(OFF);
    // The gap a row does say is still said there.
    expect(chains?.textContent).toContain(
      'catalog.supermarkets.noDefaultScope'
    );
  });

  it('follows the chain that is open', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      WIDE,
      harvester(async (id) => ({ enabled: id === 'sm_mercadona' })),
    ]);
    expect(labels(fixture)).toEqual([FETCHED]);

    await go(fixture, '/chains/sm_consum/shops');

    expect(labels(fixture)).toEqual([
      OFF,
      'catalog.supermarkets.noDefaultScope',
    ]);
  });
});

/**
 * A chain with no default scope is a gap somebody has to close, and chains
 * made before backend plan 0153 have none. The header says so, and so does
 * the row of the field on Details, where the value reads "None".
 */
describe('a chain with no default scope', () => {
  const NO_DEFAULT = 'catalog.supermarkets.noDefaultScope';

  it('says so beside its name', async () => {
    const fixture = await boot('/chains/sm_bonpreu/shops', [
      harvester(async () => {
        throw refusal('unavailable', 503);
      }),
    ]);

    expect(page(fixture).chips()).toEqual([
      { label: NO_DEFAULT, tone: 'waiting' },
    ]);
    expect(
      pageElement(fixture)
        .querySelector('lib-page-header .chip')
        ?.classList.contains('waiting')
    ).toBe(true);
  });

  it('says so on the field, on Details', async () => {
    const fixture = await boot('/chains/sm_bonpreu/details');
    const value = view(fixture).valueOf(field(fixture, 'defaultPriceScopeId'));

    expect(value.kind).toBe('none');
    expect(value.check).toEqual({ label: NO_DEFAULT });
  });

  it('says neither on a chain that has one', async () => {
    const fixture = await boot('/chains/sm_mercadona/details', [
      harvester(async () => {
        throw refusal('unavailable', 503);
      }),
    ]);
    const value = view(fixture).valueOf(field(fixture, 'defaultPriceScopeId'));

    expect(page(fixture).chips()).toEqual([]);
    expect(value).toMatchObject({
      kind: 'reference',
      resource: 'price-scopes',
      id: 'ps_mercadona_national',
    });
    expect(value.check).toBeUndefined();
  });
});

describe('the Shops tab of a chain', () => {
  it('lists the shops of that chain only', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    const shops = rowsOf(fixture).map((row) => row.textContent ?? '');
    expect(shops).toHaveLength(3);
    expect(shops.join(' ')).toContain('Avenida del Gran Capitán 12');
    expect(shops.join(' ')).not.toContain('Consum Centro');
  });

  it('adds a shop under the chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    buttonSaying(pageElement(fixture), 'catalog.locations.add')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/shops/new');
  });

  /**
   * Below 72 rem an open shop is the page, and its own header stands where
   * the chain's did. The class is what the media query of the page reads.
   */
  it('gives its header up while a shop is open', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');
    const head = () =>
      pageElement(fixture).querySelector(':scope > .head') as HTMLElement;
    expect(page(fixture).yielded()).toBe(false);
    expect(head().classList.contains('yields')).toBe(false);

    await go(fixture, '/chains/sm_mercadona/shops/loc_cordoba_centro/details');
    expect(page(fixture).yielded()).toBe(true);
    expect(head().classList.contains('yields')).toBe(true);

    await go(fixture, '/chains/sm_mercadona/shops');
    expect(page(fixture).yielded()).toBe(false);
    expect(head().classList.contains('yields')).toBe(false);
  });

  /**
   * A chain that is gone draws no outlet, so no shop is drawn under it. Its
   * own header is then the one way back, also where the address names a shop.
   */
  it('keeps its header over a shop when the chain is not there', async () => {
    const fixture = await boot(
      '/chains/sm_nowhere/shops/loc_cordoba_centro/details'
    );
    const head = pageElement(fixture).querySelector(':scope > .head');

    expect(page(fixture).descriptor.name).toBe('supermarkets');
    expect(page(fixture).yielded()).toBe(true);
    expect(page(fixture).givesWay()).toBe(false);
    expect(head?.classList.contains('yields')).toBe(false);
    expect(head?.querySelector('a.page-back')?.getAttribute('href')).toBe(
      '/chains'
    );
    expect(pageElement(fixture).querySelector('[data-missing]')).not.toBeNull();
  });

  it('gives its header up to a new shop as well', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops/new');

    expect(page(fixture).descriptor.name).toBe('supermarkets');
    expect(page(fixture).yielded()).toBe(true);
  });

  it('keeps its header on every other tab', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');
    expect(page(fixture).yielded()).toBe(false);

    await go(fixture, '/chains/sm_mercadona/details');
    expect(page(fixture).yielded()).toBe(false);
  });
});

describe('the Sections tab of a chain', () => {
  it('draws the sections panel, given the chain of the page', async () => {
    const fixture = await boot('/chains/sm_mercadona/sections');
    const panel = fixture.debugElement.query(By.directive(ChainSections))
      .componentInstance as ChainSections;

    expect(panel.supermarketId()).toBe('sm_mercadona');
    expect(panel.sections().map((section) => section.slug)).toEqual([
      'offers',
      'chilled',
    ]);
  });

  /** The tab counts what the panel lists, so a delete moves the number. */
  it('counts again after a section is deleted', async () => {
    const fixture = await boot('/chains/sm_mercadona/sections');
    const panel = fixture.debugElement.query(By.directive(ChainSections))
      .componentInstance as ChainSections;
    expect(counts(fixture)[1]).toBe(2);

    await panel.confirmDelete(panel.sections()[0]);
    await settle(fixture);
    await settle(fixture);

    expect(counts(fixture)[1]).toBe(1);
  });
});

/**
 * The Price scopes tab: the chain's default scope carries a "Default" state,
 * and "Make default" sits on the others. The default is the chain's
 * `defaultPriceScopeId`, so the action writes the chain, and the list finds
 * the chain through the page it is a tab of.
 */
describe('the Price scopes tab of a chain', () => {
  const DEFAULT = 'catalog.priceScopes.state.default';
  const MAKE_DEFAULT = 'catalog.priceScopes.makeDefault';

  const rowSaying = (fixture: ComponentFixture<TestHost>, words: string) =>
    tableRows(fixture).find((row) => row.textContent?.includes(words));

  const defaults = (fixture: ComponentFixture<TestHost>) =>
    tableRows(fixture).filter((row) => row.textContent?.includes(DEFAULT));

  const offered = (fixture: ComponentFixture<TestHost>) =>
    tableRows(fixture).filter(
      (row) => buttonSaying(row, MAKE_DEFAULT) !== undefined
    );

  it('marks the default scope, and no other', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');

    expect(tableRows(fixture)).toHaveLength(6);
    expect(defaults(fixture)).toHaveLength(1);
    expect(defaults(fixture)[0].textContent).toContain('Nationwide');
    expect(
      defaults(fixture)[0]
        .querySelector('.state-chip')
        ?.getAttribute('data-tone')
    ).toBe('good');
  });

  /**
   * Not on the default, which already is. Not on a single shop scope either:
   * the default is what a shop falls back to when nothing more specific holds
   * a price, and one shop's own scope is the most specific there is.
   */
  it('offers "Make default" on the general scopes that are not the default', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');

    // Two warehouses. The nationwide scope is the default, and the other
    // three are the shops' own.
    expect(offered(fixture)).toHaveLength(2);
    for (const row of offered(fixture)) {
      expect(row.textContent).toContain('catalog.priceScopeKind.REGION');
    }
    expect(offered(fixture)).not.toContain(defaults(fixture)[0]);
  });

  it('writes the chain on "Make default", and the record reads again', async () => {
    const sent = recordChainUpdates();
    const fixture = await boot('/chains/sm_mercadona/scopes');
    expect(page(fixture).store().row()?.['defaultPriceScopeId']).toBe(
      'ps_mercadona_national'
    );

    const warehouse = rowSaying(fixture, 'Córdoba warehouse') as HTMLElement;
    buttonSaying(warehouse, MAKE_DEFAULT)?.click();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(sent).toEqual([
      {
        id: 'sm_mercadona',
        input: { defaultPriceScopeId: 'ps_mercadona_4661' },
      },
    ]);
    // The page of the chain read the chain again, so the list under it
    // moves the state.
    expect(page(fixture).store().row()?.['defaultPriceScopeId']).toBe(
      'ps_mercadona_4661'
    );
    expect(defaults(fixture)).toHaveLength(1);
    expect(defaults(fixture)[0].textContent).toContain('Córdoba warehouse');
    // The scope that was the default can be made the default again.
    expect(
      buttonSaying(
        rowSaying(fixture, 'Nationwide') as HTMLElement,
        MAKE_DEFAULT
      )
    ).toBeDefined();
  });

  /**
   * Mercadona as a chain made before backend plan 0153: no default yet. Here
   * is where the gap is closed.
   */
  it('marks none on a chain that has no default, and offers every general scope', async () => {
    const sent: { id: string; input: ResourceInput }[] = [];
    let unset = true;
    alter('/supermarkets', (gateway) => {
      const read = gateway.read.bind(gateway);
      const update = gateway.update.bind(gateway);
      gateway.read = async (id) => {
        const row = await read(id);
        return unset ? { ...row, defaultPriceScopeId: null } : row;
      };
      gateway.update = (id, input) => {
        sent.push({ id, input });
        unset = false;
        return update(id, input);
      };
    });
    const fixture = await boot('/chains/sm_mercadona/scopes');

    expect(defaults(fixture)).toHaveLength(0);
    // The nationwide scope and the two warehouses.
    expect(offered(fixture)).toHaveLength(3);

    buttonSaying(
      rowSaying(fixture, 'Nationwide') as HTMLElement,
      MAKE_DEFAULT
    )?.click();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(sent).toEqual([
      {
        id: 'sm_mercadona',
        input: { defaultPriceScopeId: 'ps_mercadona_national' },
      },
    ]);
    expect(defaults(fixture)).toHaveLength(1);
    expect(defaults(fixture)[0].textContent).toContain('Nationwide');
  });

  /** Consum holds one scope, and it is the own scope of its one shop. */
  it('offers nothing on a chain whose only scope is that of a single shop', async () => {
    const fixture = await boot('/chains/sm_consum/scopes');

    expect(tableRows(fixture)).toHaveLength(1);
    expect(defaults(fixture)).toHaveLength(0);
    expect(offered(fixture)).toHaveLength(0);
  });

  it('adds a scope under the chain, on a page beside that of the chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');

    buttonSaying(pageElement(fixture), 'catalog.priceScopes.add')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(url()).toBe('/chains/sm_mercadona/scopes/new');
    // A record is a page of its own, beside the chain's and not a tab of it.
    const pages = fixture.debugElement.queryAll(By.directive(RecordPage));
    expect(pages).toHaveLength(1);
    expect(page(fixture).descriptor.name).toBe('price-scopes');
    // The chain is the address, so the page draws no control for it. It is
    // a value with a lock, which says where it came from.
    expect(
      fixture.nativeElement.querySelector('#record-field-supermarketId')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-locked-value [data-reason]')
        ?.textContent
    ).toContain('record.locked.fromAddress');
    expect(
      fixture.nativeElement.querySelector('#record-field-kind')
    ).not.toBeNull();
  });

  /**
   * The page of a scope is in the pane of the split of chains, and the
   * column beside it lists chains. So the column is no way back for it: its
   * own link is, on a wide screen as on a narrow one.
   */
  it('leads back from a scope to the tab, beside the column of chains too', async () => {
    for (const providers of [[WIDE], []]) {
      const fixture = await boot(
        '/chains/sm_mercadona/scopes/ps_mercadona_4661',
        providers
      );

      expect(page(fixture).descriptor.name).toBe('price-scopes');
      expect(page(fixture).backLabel()).not.toBeNull();
      expect(
        pageElement(fixture).querySelector('a.page-back')?.getAttribute('href')
      ).toBe('/chains/sm_mercadona/scopes');
    }
  });
});

describe('the Details tab of a chain', () => {
  it('draws the chain in two sections, reading, under the one header', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    const layout = view(fixture).layout();

    expect(page(fixture).store().mode()).toBe('read');
    expect(
      layout.sections.map((section) => [
        section.title,
        section.fields.map((entry) => entry.name),
      ])
    ).toEqual([
      [
        'catalog.supermarkets.section.name',
        ['name', 'websiteUrl', 'logoUrl', 'externalBrandKey'],
      ],
      ['catalog.supermarkets.section.prices', ['defaultPriceScopeId']],
    ]);
    // The count of the first tab is drawn there and nowhere else, and the
    // Record block of a chain holds the ID alone.
    expect(
      layout.sections.flatMap((section) =>
        section.fields.map((entry) => entry.name)
      )
    ).not.toContain('locationCount');
    expect(layout.facts.also).toEqual([]);
    // One header: the page's. The view has none of its own.
    expect(
      pageElement(fixture).querySelectorAll('lib-page-header')
    ).toHaveLength(1);
    expect(
      pageElement(fixture).querySelector('lib-record-view lib-page-header')
    ).toBeNull();
  });

  it('reads the website as a link and the key as a code', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');

    expect(view(fixture).valueOf(field(fixture, 'websiteUrl'))).toEqual({
      kind: 'link',
      text: 'https://www.mercadona.es',
      href: 'https://www.mercadona.es',
    });
    expect(view(fixture).valueOf(field(fixture, 'externalBrandKey'))).toEqual({
      kind: 'text',
      text: 'Q1888874',
      mono: true,
    });
    // No chain of the seed has a logo.
    expect(view(fixture).valueOf(field(fixture, 'logoUrl'))).toEqual({
      kind: 'none',
    });
  });

  it('reads the logo as a picture', async () => {
    alter('/supermarkets', (gateway) => {
      const read = gateway.read.bind(gateway);
      gateway.read = async (id) => ({
        ...(await read(id)),
        logoUrl: 'https://cdn.example/mercadona.png',
      });
    });
    const fixture = await boot('/chains/sm_mercadona/details');

    expect(view(fixture).valueOf(field(fixture, 'logoUrl'))).toEqual({
      kind: 'image',
      src: 'https://cdn.example/mercadona.png',
    });
  });

  /** "Edit" is in the header, so it works from any tab and lands on Details. */
  it('opens the form on Details from another tab', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(page(fixture).canEdit()).toBe(true);
    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/details');
    expect(page(fixture).store().mode()).toBe('edit');
    expect(page(fixture).chips()).toEqual([
      { label: 'record.state.editing', tone: 'neutral' },
    ]);
  });

  it('saves the website, stays on the tab, and reads again', async () => {
    const sent = recordChainUpdates();
    const fixture = await boot('/chains/sm_mercadona/details');
    const store = page(fixture).store();

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    expect(store.mode()).toBe('edit');
    // The count is no field of the form, and the default scope is one only
    // on a chain that exists.
    expect(view(fixture).isControl(field(fixture, 'websiteUrl'))).toBe(true);
    expect(view(fixture).isControl(field(fixture, 'defaultPriceScopeId'))).toBe(
      true
    );

    store.set('websiteUrl', 'https://tienda.mercadona.es');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/details');
    expect(sent).toEqual([
      {
        id: 'sm_mercadona',
        input: { websiteUrl: 'https://tienda.mercadona.es' },
      },
    ]);
    expect(store.mode()).toBe('read');
    expect(store.row()?.['websiteUrl']).toBe('https://tienda.mercadona.es');
    expect(pageElement(fixture).querySelector('[data-saved]')).not.toBeNull();
  });

  it('retitles the page with the name that was saved', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    const store = page(fixture).store();

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    store.set('name', { en: 'Mercadona Sur', es: 'Mercadona Sur' });
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).heading()).toBe('Mercadona Sur');
    expect(pageElement(fixture).querySelector('h1')?.textContent).toBe(
      'Mercadona Sur'
    );
  });

  /** Cancel asks first when something changed, and a yes puts the chain back. */
  it('puts the values of the chain back on cancel, and stays', async () => {
    const sent = recordChainUpdates();
    const fixture = await boot('/chains/sm_mercadona/details');
    const store = page(fixture).store();

    page(fixture).edit();
    await settle(fixture);
    await settle(fixture);
    store.set('externalBrandKey', 'Q0');
    expect(page(fixture).dirty()).toBe(true);

    const cancelled = page(fixture).cancel();
    await settle(fixture);
    expect(page(fixture).leaving()).toBe(true);
    page(fixture).answerLeave(true);
    await cancelled;
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/details');
    expect(store.mode()).toBe('read');
    expect(page(fixture).dirty()).toBe(false);
    expect(store.row()?.['externalBrandKey']).toBe('Q1888874');
    expect(sent).toEqual([]);
  });
});

describe('a new chain', () => {
  it('is the record page, with no tab and no default scope to pick', async () => {
    const fixture = await boot('/chains/new');
    const store = page(fixture).store();

    expect(store.mode()).toBe('create');
    expect(page(fixture).tabs()).toBeNull();
    expect(store.missing()).toEqual(['name']);
    // A new chain is made with a national scope that catalog makes its
    // default in the same write, so there is nothing to pick.
    expect(
      view(fixture)
        .layout()
        .sections.map((section) => [
          section.title,
          section.fields.map((entry) => entry.name),
        ])
    ).toEqual([
      [
        'catalog.supermarkets.section.name',
        ['name', 'websiteUrl', 'logoUrl', 'externalBrandKey'],
      ],
    ]);
  });

  it('opens the chain it made, on Details', async () => {
    const fixture = await boot('/chains/new');
    const store = page(fixture).store();

    store.set('name', { en: 'Dia', es: 'Dia' });
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toMatch(/^\/chains\/(?!new\/)[^/]+\/details$/);
    expect(page(fixture).heading()).toBe('Dia');
    expect(page(fixture).added()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-added]')).not.toBeNull();
  });
});

/**
 * **What is under the header is keyed on the chain.** On a wide screen the
 * chains are a column beside the page, and pressing another one changes only
 * a route parameter: the router keeps every component it can, the page of the
 * chain among them. So a new chain builds every tab again.
 *
 * Each case first shows that the page really was kept, because that is what
 * makes the redraw the page's doing and not the router's.
 */
describe('going from one chain to another', () => {
  it('lists the shops of the new chain, on the page the router kept', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [WIDE]);
    const kept = page(fixture);
    expect(rowsOf(fixture)).toHaveLength(3);

    await go(fixture, '/chains/sm_consum/shops');

    expect(page(fixture)).toBe(kept);
    expect(page(fixture).heading()).toBe('Consum');
    const shops = rowsOf(fixture).map((row) => row.textContent ?? '');
    expect(shops).toHaveLength(1);
    expect(shops[0]).toContain('Consum Centro');
  });

  it('opens it from the column, which is how an operator does it', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [WIDE]);
    const kept = page(fixture);
    const chains = column(fixture) as HTMLElement;

    ([...chains.querySelectorAll('[data-row]')] as HTMLElement[])
      .find((row) => row.textContent?.includes('Consum'))
      ?.click();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_consum/shops');
    expect(page(fixture)).toBe(kept);
    expect(rowsOf(fixture).map((row) => row.textContent ?? '')).toEqual([
      expect.stringContaining('Consum Centro'),
    ]);
    // The column marks the chain that is open now.
    expect(
      chains.querySelector('[aria-current="true"]')?.textContent
    ).toContain('Consum');
  });

  it('builds the list again, and does not reuse that of the old chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [WIDE]);
    const shopsList = () =>
      fixture.debugElement
        .queryAll(By.directive(ResourceListPage))
        .find((list) => list.componentInstance.descriptor.name === 'locations')
        ?.componentInstance as ResourceListPage;
    const old = shopsList();

    await go(fixture, '/chains/sm_consum/shops');

    expect(shopsList()).not.toBe(old);
  });

  it('counts the new chain on the tabs', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes', [WIDE]);
    expect(counts(fixture)).toEqual([3, 2, 6, null]);

    await go(fixture, '/chains/sm_consum/scopes');

    expect(counts(fixture)).toEqual([1, 0, 1, null]);
    expect(tabs(fixture)[2].path).toBe('/chains/sm_consum/scopes');
    expect(tableRows(fixture)).toHaveLength(1);
    expect(tableRows(fixture)[0].textContent).toContain('loc_consum_centro');
  });

  it('draws the sections of the new chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/sections', [WIDE]);
    const panel = () =>
      fixture.debugElement.query(By.directive(ChainSections))
        .componentInstance as ChainSections;
    expect(panel().sections()).toHaveLength(2);

    await go(fixture, '/chains/sm_consum/sections');

    expect(panel().supermarketId()).toBe('sm_consum');
    expect(panel().sections()).toEqual([]);
  });

  it('draws the new chain on the Details tab', async () => {
    const fixture = await boot('/chains/sm_mercadona/details', [WIDE]);
    const kept = page(fixture);
    const old = view(fixture);
    expect(old.valueOf(field(fixture, 'externalBrandKey'))).toMatchObject({
      text: 'Q1888874',
    });

    await go(fixture, '/chains/sm_consum/details');

    expect(page(fixture)).toBe(kept);
    expect(view(fixture)).not.toBe(old);
    expect(
      view(fixture).valueOf(field(fixture, 'externalBrandKey'))
    ).toMatchObject({ text: 'Q8350308' });
  });

  it('does the same on a narrow screen, where the address is all that changes', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    await go(fixture, '/chains/sm_consum/shops');

    expect(page(fixture).heading()).toBe('Consum');
    expect(rowsOf(fixture)).toHaveLength(1);
  });
});

describe('deleting a chain', () => {
  it('asks first, then goes back to the chains', async () => {
    const fixture = await boot('/chains/sm_bonpreu/shops');

    expect(page(fixture).canDelete()).toBe(true);
    page(fixture).deleting.set(true);
    await settle(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-delete-question]')
    ).not.toBeNull();

    await page(fixture).confirmDelete();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains');
    expect(fixture.nativeElement.textContent).not.toContain('Bonpreu');
  });

  /** A chain that still holds shops is refused, and the page says why. */
  it('says why the gateway refused, and stays on the chain', async () => {
    alter('/supermarkets', (gateway) => {
      gateway.remove = async () => {
        throw refusal('conflict', 409);
      };
    });
    const fixture = await boot('/chains/sm_mercadona/shops');

    page(fixture).deleting.set(true);
    await page(fixture).confirmDelete();
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/shops');
    expect(page(fixture).deleting()).toBe(false);
    expect(page(fixture).refusedDelete()).toEqual({
      key: 'resource.error.conflict',
      link: null,
    });
    expect(
      fixture.nativeElement.querySelector('[data-delete-question]')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-delete-refused]')?.textContent
    ).toContain('resource.error.conflict');
    // The chain is still there, and still read.
    expect(page(fixture).heading()).toBe('Mercadona');
  });
});
