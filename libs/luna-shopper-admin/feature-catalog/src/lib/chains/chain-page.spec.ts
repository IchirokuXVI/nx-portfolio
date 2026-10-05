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
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  ResourceListPage,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChainSections } from '../chain-sections';
import { ShopSections } from '../shop-sections';
import { SupermarketFormPage } from '../supermarket-form-page';
import { CHAIN_INFO, ChainPage } from './chain-page';
import { CHAIN_RESOURCES, chainsRoutes } from './chains-routes';

/**
 * One chain, as a page (admin plan 0042, target 3), against the in memory
 * gateways and through the real route table of the Chains section.
 *
 * The seed is the catalog's own: Mercadona holds three shops, two sections and
 * six price scopes, and Consum holds one shop and one scope.
 *
 * Assertions are on keys wherever a string is translated, because the testing
 * translator answers the key.
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
}

const url = () => TestBed.inject(Router).url;

/** The chain's page. The column of chains is beside it and is not part of it. */
const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.querySelector('lib-chain-page') as HTMLElement;

const pageOf = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(ChainPage))
    .componentInstance as ChainPage;

/** The chain's own header, which is the first one inside its page. */
const head = (fixture: ComponentFixture<TestHost>) =>
  page(fixture).querySelector('.chain-head') as HTMLElement;

/** The tabs of the chain: what each says, its count, and where it goes. */
function tabs(fixture: ComponentFixture<TestHost>) {
  return (
    [...head(fixture).querySelectorAll('nav a')] as HTMLAnchorElement[]
  ).map((link) => {
    const count = link.querySelector('.count');
    return {
      label: [...link.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? '')
        .join(''),
      count: count === null ? null : (count.textContent?.trim() ?? ''),
      href: link.getAttribute('href'),
      current: link.getAttribute('aria-current'),
    };
  });
}

const rowsOf = (fixture: ComponentFixture<TestHost>) =>
  [...page(fixture).querySelectorAll('[data-row]')] as HTMLElement[];

const tableRows = (fixture: ComponentFixture<TestHost>) =>
  [...page(fixture).querySelectorAll('tbody tr')] as HTMLElement[];

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

afterEach(() => jest.restoreAllMocks());

describe('the page of a chain', () => {
  it('lands on the Shops tab', async () => {
    await boot('/chains/sm_mercadona');

    expect(url()).toBe('/chains/sm_mercadona/shops');
  });

  it('is titled with the chain’s name', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(head(fixture).querySelector('h1')?.textContent).toBe('Mercadona');
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

    expect(pageOf(fixture).info).toBe(CHAIN_INFO);
    expect(CHAIN_INFO).toEqual({
      title: 'catalog.chains.info.title',
      points: ['catalog.chains.info.holds', 'catalog.chains.info.openShop'],
    });
    expect(head(fixture).querySelector('lib-info-button')).not.toBeNull();
  });

  /**
   * Target 10 and section 4 of the plan, read off the one file that holds the
   * words: the two sentences of the chain's info and the two of "Priced by",
   * and the texts that went with the screens this plan deleted.
   */
  it('holds the plan’s sentences, and none of the notes it deleted', () => {
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
    expect(catalog.shops.pricedBy.info.mostSpecific).toBe(
      'A shop shows the price of its most specific scope.'
    );
    expect(catalog.shops.pricedBy.info.reach).toBe(
      'A chain region covers many shops. A single shop scope covers one.'
    );

    // "Choose a chain to begin", three times, and the tabs inside the form.
    expect(catalog.locations.note).toBeUndefined();
    expect(catalog.sections.note).toBeUndefined();
    expect(catalog.locationItems.note).toBeUndefined();
    expect(catalog.chainSections.says).toBeUndefined();
    expect(catalog.chainTabs).toBeUndefined();
  });

  it('offers to edit the chain, on its Details tab', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');
    const edit = (
      [...head(fixture).querySelectorAll('a')] as HTMLAnchorElement[]
    ).find((link) => link.textContent?.trim() === 'catalog.chains.edit');

    expect(edit?.getAttribute('href')).toBe('/chains/sm_mercadona/details');
  });

  /** One pane at a time below 72 rem: the chain is over the list of chains. */
  it('draws the way back to the chains on a narrow screen only', async () => {
    const narrow = await boot('/chains/sm_mercadona/shops');
    const back = head(narrow).querySelector('a.page-back');
    expect(back?.getAttribute('href')).toBe('/chains');
    expect(back?.getAttribute('aria-label')).toBe('catalog.chains.back');

    const wide = await boot('/chains/sm_mercadona/shops', [WIDE]);
    expect(head(wide).querySelector('.page-back')).toBeNull();
  });

  it('says so when the chain cannot be read, and draws no tab content', async () => {
    const fixture = await boot('/chains/sm_nowhere/shops');

    expect(
      page(fixture).querySelector('[role="alert"]')?.textContent
    ).toContain('resource.error.notFound');
    expect(page(fixture).querySelector('.chain-body')).toBeNull();
  });
});

describe('the tabs of a chain', () => {
  it('is Shops, Sections, Price scopes and Details, each under the chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(tabs(fixture).map((tab) => [tab.label, tab.href])).toEqual([
      ['catalog.chains.tabs.shops', '/chains/sm_mercadona/shops'],
      ['catalog.chains.tabs.sections', '/chains/sm_mercadona/sections'],
      ['catalog.chains.tabs.scopes', '/chains/sm_mercadona/scopes'],
      ['catalog.chains.tabs.details', '/chains/sm_mercadona/details'],
    ]);
  });

  it('marks the tab that is open as the current page', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');

    expect(tabs(fixture).map((tab) => tab.current)).toEqual([
      null,
      null,
      'page',
      null,
    ]);
  });

  /**
   * The shop count is the `locationCount` catalog gave on the chain. The
   * sections are read whole, and the scopes fit one page, so both are counted.
   * Details is a form and counts nothing.
   */
  it('counts the shops, the sections and the scopes of the seed', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    expect(tabs(fixture).map((tab) => tab.count)).toEqual([
      '3',
      '2',
      '6',
      null,
    ]);
  });

  it('counts another chain’s own, and not the first chain’s', async () => {
    const fixture = await boot('/chains/sm_consum/shops');

    // One shop and one scope. Consum has no section, and a tab says nothing
    // where there is nothing to count.
    expect(tabs(fixture).map((tab) => tab.count)).toEqual([
      '1',
      null,
      '1',
      null,
    ]);
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

    expect(tabs(fixture)[0].count).toBeNull();
    // The other two were given, and still show.
    expect(tabs(fixture)[1].count).toBe('2');
    expect(tabs(fixture)[2].count).toBe('6');
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

    expect(tabs(fixture)[2].count).toBeNull();
    expect(tabs(fixture)[0].count).toBe('3');
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

    expect(tabs(fixture).map((tab) => tab.count)).toEqual([
      '3',
      null,
      null,
      null,
    ]);
    expect(head(fixture).querySelector('h1')?.textContent).toBe('Mercadona');
    expect(
      fixture.debugElement.query(By.directive(SupermarketFormPage))
    ).not.toBeNull();
  });
});

/**
 * Whether the harvester has a source for the chain, and may fetch it (target
 * 3). The harvester is a second service, so it can fail by itself, and then
 * the header says nothing: a state nobody read is not a state.
 */
describe('the harvester state of a chain', () => {
  const chip = (fixture: ComponentFixture<TestHost>) =>
    head(fixture).querySelector('[data-source]') as HTMLElement | null;

  it('says the chain is fetched when its source is switched on', async () => {
    const asked: string[] = [];
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async (id) => {
        asked.push(id);
        return { enabled: true };
      }),
    ]);

    expect(asked).toContain('sm_mercadona');
    expect(chip(fixture)?.dataset['source']).toBe('fetched');
    expect(chip(fixture)?.textContent).toBe('catalog.chains.source.fetched');
    expect(chip(fixture)?.classList.contains('good')).toBe(true);
  });

  it('says the source is off when it exists and may not be fetched', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async () => ({ enabled: false })),
    ]);

    expect(chip(fixture)?.dataset['source']).toBe('off');
    expect(chip(fixture)?.textContent).toBe('catalog.chains.source.off');
  });

  /** Not found is an answer: every price of this chain is typed by a person. */
  it('says there is no source when the harvester knows none', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async () => {
        throw refusal('not_found', 404);
      }),
    ]);

    expect(chip(fixture)?.dataset['source']).toBe('none');
    expect(chip(fixture)?.textContent).toBe('catalog.chains.source.none');
  });

  it('says nothing when the harvester did not answer, and still opens', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [
      harvester(async () => {
        throw refusal('unavailable', 503);
      }),
    ]);

    expect(chip(fixture)).toBeNull();
    expect(head(fixture).querySelector('h1')?.textContent).toBe('Mercadona');
    expect(rowsOf(fixture)).toHaveLength(3);
  });

  /**
   * The state is a link to where it is set: the chain sources of the
   * harvester's Setup tab (admin plan 0044; target 3 deferred the link to
   * that plan). In each of the three states, because "no source" is fixed
   * there as well: that is where a source is added.
   */
  it.each([
    ['fetched', async () => ({ enabled: true })],
    ['off', async () => ({ enabled: false })],
    [
      'none',
      async () => {
        throw refusal('not_found', 404);
      },
    ],
  ] as const)('links the %s state to Setup', async (state, read) => {
    const fixture = await boot('/chains/sm_mercadona/shops', [harvester(read)]);
    const link = chip(fixture);

    expect(link?.dataset['source']).toBe(state);
    expect(link?.tagName).toBe('A');
    expect(link?.classList.contains('chip')).toBe(true);
    expect(link?.getAttribute('href')).toBe('/harvest/setup/sources');
  });
});

describe('the Shops tab of a chain', () => {
  it('lists that chain’s shops only', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    const shops = rowsOf(fixture).map((row) => row.textContent ?? '');
    expect(shops).toHaveLength(3);
    expect(shops.join(' ')).toContain('Avenida del Gran Capitán 12');
    expect(shops.join(' ')).not.toContain('Consum Centro');
  });

  it('adds a shop under the chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    buttonSaying(page(fixture), 'catalog.locations.add')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/shops/new');
  });

  /**
   * While a shop is open on a narrow screen the shop is the page, and its own
   * header stands where the chain's did.
   */
  it('steps its header aside while a shop is open', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');
    expect(head(fixture).classList.contains('under-shop')).toBe(false);

    await go(fixture, '/chains/sm_mercadona/shops/loc_cordoba_centro/details');
    expect(head(fixture).classList.contains('under-shop')).toBe(true);

    await go(fixture, '/chains/sm_mercadona/shops');
    expect(head(fixture).classList.contains('under-shop')).toBe(false);
  });
});

describe('the Sections tab of a chain', () => {
  it('draws the chain’s sections panel, given the chain of the page', async () => {
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
    expect(tabs(fixture)[1].count).toBe('2');

    await panel.confirmDelete(panel.sections()[0]);
    await settle(fixture);
    await settle(fixture);

    expect(tabs(fixture)[1].count).toBe('1');
  });
});

/**
 * The Price scopes tab (target 7): the chain's default scope carries a
 * "Default" state, and "Make default" sits on the others. The default is the
 * chain's `defaultPriceScopeId`, so the action writes the chain.
 */
describe('the Price scopes tab of a chain', () => {
  const DEFAULT = 'catalog.priceScopes.state.default';
  const MAKE_DEFAULT = 'catalog.priceScopes.makeDefault';

  const rowSaying = (fixture: ComponentFixture<TestHost>, words: string) =>
    tableRows(fixture).find((row) => row.textContent?.includes(words));

  const defaults = (fixture: ComponentFixture<TestHost>) =>
    tableRows(fixture).filter((row) => row.textContent?.includes(DEFAULT));

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

  const offered = (fixture: ComponentFixture<TestHost>) =>
    tableRows(fixture).filter(
      (row) => buttonSaying(row, MAKE_DEFAULT) !== undefined
    );

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

  it('writes the chain on "Make default", and moves the state', async () => {
    const sent = recordChainUpdates();
    const fixture = await boot('/chains/sm_mercadona/scopes');

    const warehouse = rowSaying(fixture, 'Córdoba warehouse') as HTMLElement;
    buttonSaying(warehouse, MAKE_DEFAULT)?.click();
    await settle(fixture);
    await settle(fixture);

    expect(sent).toEqual([
      {
        id: 'sm_mercadona',
        input: { defaultPriceScopeId: 'ps_mercadona_4661' },
      },
    ]);
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
   * A chain with no default scope is a gap to fix, and chains made before
   * backend plan 0153 have none. The flat list of chains flagged each one.
   * Here is where the gap shows now, and where it is closed.
   */
  it('marks none on a chain that has no default, and offers every general scope', async () => {
    const sent: { id: string; input: ResourceInput }[] = [];
    // Mercadona as a chain made before backend plan 0153: no default yet.
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

    expect(sent).toEqual([
      {
        id: 'sm_mercadona',
        input: { defaultPriceScopeId: 'ps_mercadona_national' },
      },
    ]);
    expect(defaults(fixture)).toHaveLength(1);
    expect(defaults(fixture)[0].textContent).toContain('Nationwide');
  });

  /** Consum holds one scope, and it is its one shop's own. */
  it('offers nothing on a chain whose only scope is a single shop’s', async () => {
    const fixture = await boot('/chains/sm_consum/scopes');

    expect(tableRows(fixture)).toHaveLength(1);
    expect(defaults(fixture)).toHaveLength(0);
    expect(offered(fixture)).toHaveLength(0);
  });

  it('adds a scope under the chain, and opens one beside the page', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');

    buttonSaying(page(fixture), 'catalog.priceScopes.add')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(url()).toBe('/chains/sm_mercadona/scopes/new');
    // A form is a page of its own, beside the chain's and not a tab of it.
    expect(page(fixture)).toBeNull();
    // The chain is the address, so the form draws no control for it.
    expect(
      fixture.nativeElement.querySelector('#field-supermarketId')
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('#field-kind')).not.toBeNull();
  });
});

describe('the Details tab of a chain', () => {
  const formOf = (fixture: ComponentFixture<TestHost>) =>
    fixture.debugElement.query(By.directive(SupermarketFormPage))
      .componentInstance as SupermarketFormPage;

  it('is the chain’s form, with no header and no tabs of its own', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    const form = fixture.debugElement.query(By.directive(SupermarketFormPage))
      .nativeElement as HTMLElement;

    expect(formOf(fixture).mode).toBe('edit');
    expect(form.querySelector('lib-page-header')).toBeNull();
    expect(form.querySelector('nav')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'catalog.chainTabs'
    );
  });

  it('saves, stays on the tab, and retitles the page', async () => {
    const sent = recordChainUpdates();
    const fixture = await boot('/chains/sm_mercadona/details');

    formOf(fixture).change({
      name: 'name',
      value: { en: 'Mercadona Sur', es: 'Mercadona Sur' },
    });
    await formOf(fixture).submit();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/details');
    expect(sent).toEqual([
      {
        id: 'sm_mercadona',
        input: { name: { en: 'Mercadona Sur', es: 'Mercadona Sur' } },
      },
    ]);
    expect(fixture.nativeElement.textContent).toContain('resource.form.saved');
    // The header reads the chain again, so it says what was saved.
    expect(head(fixture).querySelector('h1')?.textContent).toBe(
      'Mercadona Sur'
    );
  });

  /** There is no list to go back to, so Cancel puts back what the chain holds. */
  it('puts the chain’s values back on cancel, and stays', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');

    formOf(fixture).change({ name: 'externalBrandKey', value: 'Q0' });
    expect(formOf(fixture).store.dirty()).toBe(true);

    formOf(fixture).goBack();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_mercadona/details');
    expect(formOf(fixture).store.dirty()).toBe(false);
    expect(formOf(fixture).store.draft()['externalBrandKey']).toBe('Q1888874');
  });
});

/**
 * **The keyed outlet.** On a wide screen the chains are a column beside the
 * page, and pressing another one changes only a route parameter: the router
 * keeps every component it can, the chain's page among them. A list that read
 * the old chain's shops would go on showing them. So what is under the tabs
 * is keyed on the chain, and a new chain builds it again.
 *
 * Each case first shows that the page really was kept, because that is what
 * makes the redraw the template's doing and not the router's.
 */
describe('going from one chain to another', () => {
  it('lists the new chain’s shops, on the page the router kept', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [WIDE]);
    const kept = pageOf(fixture);
    expect(rowsOf(fixture)).toHaveLength(3);

    await go(fixture, '/chains/sm_consum/shops');

    expect(pageOf(fixture)).toBe(kept);
    expect(head(fixture).querySelector('h1')?.textContent).toBe('Consum');
    const shops = rowsOf(fixture).map((row) => row.textContent ?? '');
    expect(shops).toHaveLength(1);
    expect(shops[0]).toContain('Consum Centro');
  });

  it('opens it from the column, which is how an operator does it', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops', [WIDE]);
    const kept = pageOf(fixture);
    const column = fixture.debugElement
      .queryAll(By.directive(ResourceListPage))
      .find((list) => list.componentInstance.descriptor.name === 'supermarkets')
      ?.nativeElement as HTMLElement;

    ([...column.querySelectorAll('[data-row]')] as HTMLElement[])
      .find((row) => row.textContent?.includes('Consum'))
      ?.click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains/sm_consum/shops');
    expect(pageOf(fixture)).toBe(kept);
    expect(rowsOf(fixture).map((row) => row.textContent ?? '')).toEqual([
      expect.stringContaining('Consum Centro'),
    ]);
    // The column marks the chain that is open now.
    expect(
      column.querySelector('[aria-current="true"]')?.textContent
    ).toContain('Consum');
  });

  it('builds the list again, and does not reuse the old chain’s', async () => {
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
    expect(tabs(fixture).map((tab) => tab.count)).toEqual([
      '3',
      '2',
      '6',
      null,
    ]);

    await go(fixture, '/chains/sm_consum/scopes');

    expect(tabs(fixture).map((tab) => tab.count)).toEqual([
      '1',
      null,
      '1',
      null,
    ]);
    expect(tabs(fixture)[2].href).toBe('/chains/sm_consum/scopes');
    expect(tableRows(fixture)).toHaveLength(1);
    expect(tableRows(fixture)[0].textContent).toContain('loc_consum_centro');
  });

  it('draws the new chain’s sections', async () => {
    const fixture = await boot('/chains/sm_mercadona/sections', [WIDE]);
    const panel = () =>
      fixture.debugElement.query(By.directive(ChainSections))
        .componentInstance as ChainSections;
    expect(panel().sections()).toHaveLength(2);

    await go(fixture, '/chains/sm_consum/sections');

    expect(panel().supermarketId()).toBe('sm_consum');
    expect(panel().sections()).toEqual([]);
  });

  it('draws the new chain’s form on the Details tab', async () => {
    const fixture = await boot('/chains/sm_mercadona/details', [WIDE]);
    const kept = pageOf(fixture);
    const form = () =>
      fixture.debugElement.query(By.directive(SupermarketFormPage))
        .componentInstance as SupermarketFormPage;
    const old = form();
    expect(old.store.draft()['externalBrandKey']).toBe('Q1888874');

    await go(fixture, '/chains/sm_consum/details');

    expect(pageOf(fixture)).toBe(kept);
    expect(form()).not.toBe(old);
    expect(form().store.draft()['externalBrandKey']).toBe('Q8350308');
  });

  it('does the same on a narrow screen, where the address is all that changes', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    await go(fixture, '/chains/sm_consum/shops');

    expect(head(fixture).querySelector('h1')?.textContent).toBe('Consum');
    expect(rowsOf(fixture)).toHaveLength(1);
  });
});

describe('deleting a chain', () => {
  it('asks first, then goes back to the chains', async () => {
    const fixture = await boot('/chains/sm_bonpreu/shops');
    const dialog = () =>
      fixture.nativeElement.querySelector('lib-confirm-dialog');

    buttonSaying(head(fixture), 'catalog.chains.delete')?.click();
    await settle(fixture);
    expect(dialog()?.textContent).toContain('catalog.chains.deleteHeading');

    await pageOf(fixture).confirmDelete();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe('/chains');
    expect(fixture.nativeElement.textContent).not.toContain('Bonpreu');
  });

  it('says why the gateway refused, and stays on the chain', async () => {
    alter('/supermarkets', (gateway) => {
      gateway.remove = async () => {
        throw refusal('not_found', 404);
      };
    });
    const fixture = await boot('/chains/sm_bonpreu/shops');

    pageOf(fixture).deleting.set(true);
    await pageOf(fixture).confirmDelete();
    await settle(fixture);

    expect(url()).toBe('/chains/sm_bonpreu/shops');
    expect(
      fixture.nativeElement.querySelector('lib-confirm-dialog')
    ).toBeNull();
    expect(page(fixture).querySelector('.refusal')?.textContent).toContain(
      'resource.error.notFound'
    );
  });
});
