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
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  PageHeader,
  ReferencesControl,
  ScopeMark,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ITEMS } from '../items';
import { LocationSections } from '../location-sections';
import { shopScopeName } from '../locations';
import { CHAIN_RESOURCES, chainsRoutes } from './chains-routes';

/**
 * A shop on the record page, as a pane inside its chain (admin plan 0056),
 * against the in memory gateways and through the real route table of the
 * Chains section.
 *
 * The seed is the catalog's own. `loc_cordoba_centro` is a Mercadona shop
 * priced by the Córdoba warehouse and by a scope of its own, with two product
 * rows and a postal code that is known. `loc_cordoba_oeste` is priced the
 * same way, holds one product row, and its postal code was guessed.
 * `loc_sierra` has no town and no postal code, and is priced by a warehouse
 * that has no label.
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

/**
 * The Chains section as the app declares it, and the products beside it: a
 * shop product points at a product, and its form picks one.
 */
const SECTIONS: readonly AdminSection[] = [
  {
    key: 'chains',
    label: '',
    held: CHAIN_RESOURCES,
    screens: chainsRoutes(),
  },
  { key: 'catalog', label: '', segment: 'catalog', resources: [ITEMS] },
];

/** 72 rem and above, where the shop sits beside the list of shops of its chain. */
const WIDE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(false), split: signal(true) },
};

const SHOPS = '/chains/sm_mercadona/shops';
const CENTRO = `${SHOPS}/loc_cordoba_centro`;
const OESTE = `${SHOPS}/loc_cordoba_oeste`;
const SIERRA = `${SHOPS}/loc_sierra`;

/** The own scope of the first shop, and the two warehouses of the chain. */
const OWN = 'ps_store_loc_cordoba_centro';
const WAREHOUSE = 'ps_mercadona_4661';
const OTHER_WAREHOUSE = 'ps_mercadona_3421';

async function boot(url: string, providers: Provider[] = []) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes(SECTIONS)),
      provideLocationMocks(),
      provideSections(...SECTIONS),
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
 * Every record page that is drawn. On the address of a shop there are two:
 * the first is the chain's, and the last is the shop's.
 */
const pages = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.queryAll(By.directive(RecordPage));

/** The page of the chain the shop is under. */
const chainPage = (fixture: ComponentFixture<TestHost>) =>
  pages(fixture)[0].componentInstance as RecordPage;

/** The page of the shop, or of whatever record is open under the chain. */
const page = (fixture: ComponentFixture<TestHost>) =>
  pages(fixture).at(-1)?.componentInstance as RecordPage;

const pageElement = (fixture: ComponentFixture<TestHost>) =>
  pages(fixture).at(-1)?.nativeElement as HTMLElement;

/** The header of the shop's page. The chain and the columns have their own. */
const header = (fixture: ComponentFixture<TestHost>) =>
  pages(fixture).at(-1)?.query(By.directive(PageHeader))
    .componentInstance as PageHeader;

/** The view of the record. The chain is on its Shops tab and draws none. */
const view = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(RecordView))
    .componentInstance as RecordView;

/** The tabs of the shop. A shop that is read always has them. */
const tabs = (fixture: ComponentFixture<TestHost>) =>
  page(fixture).tabs() ?? [];

/** One field of the record that is open, by its name. */
const field = (fixture: ComponentFixture<TestHost>, name: string) =>
  (page(fixture).descriptor.fields as readonly FieldDescriptor[]).find(
    (candidate) => candidate.name === name
  ) as FieldDescriptor;

/** The sections of the view: what each is titled, and the fields it holds. */
const sections = (fixture: ComponentFixture<TestHost>) =>
  view(fixture)
    .layout()
    .sections.map((section) => [
      section.title,
      section.fields.map((entry) => entry.name),
    ]);

/** A list that is drawn, by the resource it lists. */
const listOf = (fixture: ComponentFixture<TestHost>, resource: string) =>
  fixture.debugElement
    .queryAll(By.directive(ResourceListPage))
    .find((list) => list.componentInstance.descriptor.name === resource);

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

/** From reading to the form, and the first draw of its controls. */
async function edit(fixture: ComponentFixture<TestHost>) {
  page(fixture).edit();
  await settle(fixture);
  await settle(fixture);
  await settle(fixture);
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

/** Every write one memory gateway was asked for, in order. */
function recordWrites(pathEnd: string) {
  const sent: { act: 'create' | 'update'; input: ResourceInput }[] = [];
  alter(pathEnd, (gateway) => {
    const create = gateway.create.bind(gateway);
    const update = gateway.update.bind(gateway);
    gateway.create = (input) => {
      sent.push({ act: 'create', input });
      return create(input);
    };
    gateway.update = (id, input) => {
      sent.push({ act: 'update', input });
      return update(id, input);
    };
  });
  return sent;
}

/** What one shop reads as, with some of its columns changed. */
function readAs(change: Readonly<Record<string, unknown>>) {
  alter('/locations', (gateway) => {
    const read = gateway.read.bind(gateway);
    gateway.read = async (id) => ({ ...(await read(id)), ...change });
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('a shop, on the record page', () => {
  it('opens on its details, reading', async () => {
    const fixture = await boot(CENTRO);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(pages(fixture)).toHaveLength(2);
    expect(chainPage(fixture).descriptor.name).toBe('supermarkets');
    expect(page(fixture).descriptor.name).toBe('locations');
    expect(page(fixture).store().mode()).toBe('read');
  });

  /** The address is what tells two shops of a chain apart. */
  it('is titled with the address, over the town and the postal code', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(page(fixture).heading()).toBe('Avenida del Gran Capitán 12');
    expect(page(fixture).subtitle()).toBe('Córdoba 14001');
    expect(
      pageElement(fixture).querySelector('.page-subtitle')?.textContent
    ).toBe('Córdoba 14001');
  });

  it('draws no line under the name of a shop that has neither', async () => {
    // No town and no postal code: the nearest centroid was too far away.
    const fixture = await boot(`${SIERRA}/details`);

    expect(page(fixture).heading()).toBe('Carretera de Trassierra km 8');
    expect(page(fixture).subtitle()).toBeNull();
    expect(pageElement(fixture).querySelector('.page-subtitle')).toBeNull();
  });

  /**
   * Below 72 rem the header of the chain is not drawn while a shop is open,
   * so the shop is the page and its way back names the chain. Beside the
   * column of shops there is no way back: the column is one.
   */
  it('names the chain on the way back on a narrow screen, and draws none on a wide one', async () => {
    const narrow = await boot(`${CENTRO}/details`);
    expect(page(narrow).backLabel()).toBe('record.back');
    expect(page(narrow).listUrl).toBe(SHOPS);
    expect(header(narrow).backLink()).toBe(SHOPS);
    expect(
      pageElement(narrow).querySelector('a.page-back')?.getAttribute('href')
    ).toBe(SHOPS);
    expect(chainPage(narrow).yielded()).toBe(true);

    const wide = await boot(`${CENTRO}/details`, [WIDE]);
    expect(page(wide).backLabel()).toBeNull();
    expect(pageElement(wide).querySelector('.page-back')).toBeNull();
  });

  /**
   * On a wide screen the shop sits under the header of its chain, beside the
   * list, and titles a pane. The chain is then the one h1 that is drawn.
   */
  it('titles a pane, a level under the chain', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);

    expect(pageElement(fixture).querySelector('.page-title')?.tagName).toBe(
      'H2'
    );
    expect(
      [...fixture.nativeElement.querySelectorAll('h1')].map(
        (heading) => (heading as HTMLElement).textContent
      )
    ).toEqual(['Mercadona']);
  });

  it('is Details, Sections and Products, each under the shop', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(tabs(fixture).map((tab) => tab.label)).toEqual([
      'record.tab.details',
      'catalog.shops.tabs.sections',
      'catalog.shops.tabs.products',
    ]);
    expect(tabs(fixture).map((tab) => tab.path)).toEqual([
      `${CENTRO}/details`,
      `${CENTRO}/sections`,
      `${CENTRO}/products`,
    ]);
    const links = [
      ...pageElement(fixture).querySelectorAll('lib-page-header nav a'),
    ] as HTMLAnchorElement[];
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      'page',
      null,
      null,
    ]);
  });

  /**
   * The Sections tab counts what the read of the shop carries, and the
   * Products tab shows no number: its list is paged and has no total.
   */
  it('counts the sections the read of the shop names, and never the products', async () => {
    readAs({ sections: [{ id: 's1' }, { id: 's2' }] });
    const fixture = await boot(`${CENTRO}/details`);
    const [details, walked, products] = tabs(fixture);

    expect(details.count).toBeUndefined();
    expect(walked.count?.()).toBe(2);
    expect(products.count?.()).toBeNull();
  });

  it('counts none for a shop whose read names no section', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(tabs(fixture)[1].count?.()).toBe(0);
  });

  /**
   * A shop is read by its own id. So an address that names another chain goes
   * to the address of the shop, and never draws the shop under that chain.
   */
  it('goes to its own chain when the address names another one', async () => {
    const fixture = await boot('/chains/sm_consum/shops/loc_cordoba_centro');
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(chainPage(fixture).heading()).toBe('Mercadona');
    expect(page(fixture).heading()).toBe('Avenida del Gran Capitán 12');
  });

  /** `?edit=1` is what another screen asked for, and it is still asked for. */
  it('opens the form at its own address when the wrong one asked for it', async () => {
    const fixture = await boot(
      '/chains/sm_consum/shops/loc_cordoba_centro?edit=1'
    );
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(page(fixture).store().mode()).toBe('edit');
  });

  it('goes there from a tab of the wrong address as well', async () => {
    const fixture = await boot(
      '/chains/sm_consum/shops/loc_cordoba_centro/details'
    );
    await settle(fixture);
    await settle(fixture);

    expect(url()).toMatch(new RegExp(`^${CENTRO}(/details)?$`));
  });

  it('says so when the shop is not there, and draws no tab', async () => {
    const fixture = await boot(`${SHOPS}/loc_nowhere/details`);

    expect(
      pageElement(fixture).querySelector('[data-missing], [data-no-answer]')
    ).not.toBeNull();
    expect(page(fixture).tabs()).toBeNull();
    expect(pageElement(fixture).querySelector('.under')).toBeNull();
  });
});

describe('the Details tab of a shop', () => {
  it('draws the shop in four sections, with the source of the code in the Record block', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(sections(fixture)).toEqual([
      ['catalog.locations.section.name', ['label']],
      [
        'catalog.locations.section.address',
        [
          'address',
          'city',
          'postalCode',
          'country',
          'latitude',
          'longitude',
          'mapUrl',
        ],
      ],
      ['catalog.locations.section.prices', ['priceScopeIds']],
      ['catalog.locations.section.source', ['externalProvider', 'externalRef']],
    ]);
    expect(
      view(fixture)
        .layout()
        .facts.also.map((entry) => entry.name)
    ).toEqual(['postalCodeSource']);
    // The chain is the pane the shop sits under, so no section names it.
    expect(sections(fixture).flat(2)).not.toContain('supermarketId');
    expect(sections(fixture).flat(2)).not.toContain('postalCodeSource');
    // One header for the shop, and the sections are a tab and no panel here.
    expect(
      pageElement(fixture).querySelectorAll('lib-page-header')
    ).toHaveLength(1);
    expect(
      fixture.debugElement.query(By.directive(LocationSections))
    ).toBeNull();
  });

  it('keeps the four sections while the shop is changed', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    await edit(fixture);

    expect(page(fixture).store().mode()).toBe('edit');
    expect(sections(fixture).map(([title]) => title)).toEqual([
      'catalog.locations.section.name',
      'catalog.locations.section.address',
      'catalog.locations.section.prices',
      'catalog.locations.section.source',
    ]);
    expect(sections(fixture).flat(2)).not.toContain('supermarketId');
    // The link to the map follows the two numbers, and is no control.
    expect(view(fixture).isControl(field(fixture, 'mapUrl'))).toBe(false);
    expect(view(fixture).lockReason(field(fixture, 'mapUrl'))).toBe(
      'catalog.locations.mapFollows'
    );
    expect(view(fixture).isControl(field(fixture, 'latitude'))).toBe(true);
  });

  /** A guess is the one value of a shop a person has to look at. */
  it('says a guessed postal code has to be checked', async () => {
    const fixture = await boot(`${OESTE}/details`);
    const value = view(fixture).valueOf(field(fixture, 'postalCode'));

    expect(value).toMatchObject({ kind: 'text', text: '14005' });
    expect(value.check?.label).toBe('catalog.locations.postalCodeGuessed');
    expect(
      pageElement(fixture).querySelector('[data-check]')?.textContent?.trim()
    ).toBe('catalog.locations.postalCodeGuessed');
  });

  it('says nothing beside a postal code that is known', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const value = view(fixture).valueOf(field(fixture, 'postalCode'));

    expect(value).toMatchObject({ kind: 'text', text: '14001' });
    expect(value.check).toBeUndefined();
    expect(pageElement(fixture).querySelector('[data-check]')).toBeNull();
  });

  /** Neither known nor guessed is a deliberate state, and no gap to check. */
  it('says nothing beside a postal code that is missing on purpose', async () => {
    const fixture = await boot(`${SIERRA}/details`);
    const value = view(fixture).valueOf(field(fixture, 'postalCode'));

    expect(value.kind).toBe('none');
    expect(value.check).toBeUndefined();
  });

  /** Two numbers and one link (target 8). There is no map. */
  it('links the two coordinates to the place on a map', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const value = view(fixture).valueOf(field(fixture, 'mapUrl'));

    expect(value.kind).toBe('link');
    if (value.kind !== 'link') {
      return;
    }
    expect(value.label).toBe('catalog.locations.openOnMap');
    expect(value.href).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
    expect(value.href).toContain('37.8882');
    expect(value.href).toContain('-4.7794');
    const link = [
      ...pageElement(fixture).querySelectorAll('lib-record-view a'),
    ].find((anchor) => anchor.getAttribute('href') === value.href);
    expect(link?.textContent?.trim()).toBe('catalog.locations.openOnMap');
  });

  /**
   * The link is worked out from the two numbers. In the form it follows the
   * numbers that are typed: the saved place beside the numbers of another
   * one would be a link that lies.
   */
  it('follows the coordinates that are typed, and links to none while one is empty', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const store = page(fixture).store();
    const href = () => {
      const value = view(fixture).valueOf(field(fixture, 'mapUrl'));
      return value.kind === 'link' ? value.href : null;
    };
    await edit(fixture);
    expect(href()).toContain('37.8882');

    store.set('latitude', '40.4168');
    store.set('longitude', '-3.7038');
    expect(href()).toContain('mlat=40.4168&mlon=-3.7038');
    expect(href()).not.toContain('37.8882');

    store.set('longitude', '');
    expect(href()).toBeNull();
    store.set('longitude', 'west');
    expect(href()).toBeNull();
  });

  it.each(['latitude', 'longitude'])(
    'links to no map when the %s is missing',
    async (coordinate) => {
      readAs({ [coordinate]: null });
      const fixture = await boot(`${CENTRO}/details`);

      expect(view(fixture).valueOf(field(fixture, 'mapUrl'))).toEqual({
        kind: 'none',
      });
    }
  );

  it('reads the provider as a code', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(view(fixture).valueOf(field(fixture, 'externalProvider'))).toEqual({
      kind: 'text',
      text: 'osm',
      mono: true,
    });
  });

  it('saves, stays on the tab, and retitles the page', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${CENTRO}/details`);
    const store = page(fixture).store();
    await edit(fixture);

    store.set('address', 'Calle Nueva 1');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(sent).toEqual([
      { act: 'update', input: { address: 'Calle Nueva 1' } },
    ]);
    expect(store.mode()).toBe('read');
    expect(pageElement(fixture).querySelector('[data-saved]')).not.toBeNull();
    // The page holds what was saved, so its title says it.
    expect(page(fixture).heading()).toBe('Calle Nueva 1');
  });

  /** Cancel asks first when something changed, and a yes puts the shop back. */
  it('puts the values of the shop back on cancel, and stays', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${CENTRO}/details`);
    const store = page(fixture).store();
    await edit(fixture);

    store.set('city', 'Sevilla');
    expect(page(fixture).dirty()).toBe(true);

    const cancelled = page(fixture).cancel();
    await settle(fixture);
    expect(page(fixture).leaving()).toBe(true);
    page(fixture).answerLeave(true);
    await cancelled;
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(store.mode()).toBe('read');
    expect(page(fixture).dirty()).toBe(false);
    expect(store.row()?.['city']).toBe('Córdoba');
    expect(sent).toEqual([]);
  });
});

/**
 * "Priced by" is a field of the shop (target 7): the scopes that price it,
 * each with the mark that says how far it reaches. It changes under "Edit"
 * with the rest of the shop, and nothing on a reading page writes.
 */
describe('the price scopes of a shop', () => {
  const scopesField = (fixture: ComponentFixture<TestHost>) =>
    field(fixture, 'priceScopeIds');

  const control = (fixture: ComponentFixture<TestHost>) =>
    fixture.debugElement.query(By.directive(ReferencesControl));

  const rowOf = (fixture: ComponentFixture<TestHost>, id: string) =>
    control(fixture).nativeElement.querySelector(
      `li[data-row="${id}"]`
    ) as HTMLElement | null;

  /**
   * The shop holds its own scope first. The page reads the widest first, as
   * the line above the tabs did before the record page.
   */
  it('reads them most general first, each by its name', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(page(fixture).store().row()?.['priceScopeIds']).toEqual([
      OWN,
      WAREHOUSE,
    ]);
    expect(view(fixture).valueOf(scopesField(fixture))).toMatchObject({
      kind: 'references',
      resource: 'price-scopes',
      ids: [WAREHOUSE, OWN],
    });
    expect(view(fixture).namesOf(scopesField(fixture))[WAREHOUSE]).toBe(
      'Córdoba warehouse'
    );
    expect(pageElement(fixture).textContent).toContain('Córdoba warehouse');
    // Read, and so no control.
    expect(control(fixture)).toBeNull();
  });

  /**
   * A harvested scope has no label, and is known by the key its source
   * prints. The kind beside it is in the words of this app, and never as the
   * gateway spells it.
   */
  it('calls a scope with no label by the word for its kind and its source key', async () => {
    const fixture = await boot(`${SIERRA}/details`);

    expect(
      shopScopeName(
        { id: 'loc_sierra' },
        { kind: 'REGION', externalKey: '3421', label: null }
      )
    ).toEqual({
      kind: 'key',
      key: 'catalog.priceScopes.unlabelled.REGION',
      args: { key: '3421' },
    });
    expect(view(fixture).namesOf(scopesField(fixture))[OTHER_WAREHOUSE]).toBe(
      'catalog.priceScopes.unlabelled.REGION'
    );
    expect(pageElement(fixture).textContent).not.toContain('REGION 3421');
  });

  it('calls a scope with no label and no key by the word for its kind alone', () => {
    expect(
      shopScopeName({ id: 'x' }, { kind: 'NATIONAL', externalKey: null })
    ).toEqual({ kind: 'key', key: 'catalog.priceScopeKind.NATIONAL' });
  });

  it('leaves a scope with a label, and one of a kind it has no word for, to its title', () => {
    expect(
      shopScopeName(
        { id: 'x' },
        { kind: 'REGION', externalKey: '4661', label: { es: 'Almacén' } }
      )
    ).toBeUndefined();
    expect(
      shopScopeName({ id: 'x' }, { kind: 'PROVINCE', externalKey: '14' })
    ).toBeUndefined();
  });

  /** The scope of the shop itself: its title is its kind and the id of the shop. */
  it('calls the own scope of the shop "This shop only", reading and in the form', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(view(fixture).namesOf(scopesField(fixture))[OWN]).toBe(
      'catalog.shops.pricedBy.own'
    );
    expect(pageElement(fixture).textContent).toContain(
      'catalog.shops.pricedBy.own'
    );

    await edit(fixture);
    expect(rowOf(fixture, OWN)?.querySelector('.name')?.textContent).toBe(
      'catalog.shops.pricedBy.own'
    );
    // The scope of another shop is no scope of this one.
    expect(
      shopScopeName(
        { id: 'loc_other' },
        { kind: 'STORE', externalKey: 'loc_cordoba_centro', label: null }
      )
    ).not.toEqual({ kind: 'key', key: 'catalog.shops.pricedBy.own' });
  });

  it('gives each scope the mark of how far it reaches', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const marks = view(fixture).marksOf(scopesField(fixture));

    expect(Object.keys(marks).sort()).toEqual([WAREHOUSE, OWN].sort());
    expect(marks[OWN].label).toBe('catalog.priceScopeKind.STORE');
    expect(marks[WAREHOUSE].label).toBe('catalog.priceScopeKind.REGION');
    // The two reach differently far, and the marks say so.
    expect(marks[OWN].level).not.toBe(marks[WAREHOUSE].level);
    // And they are drawn: one mark before each name.
    expect(
      pages(fixture)
        .at(-1)
        ?.queryAll(By.directive(ScopeMark))
        .map((mark) => (mark.componentInstance as ScopeMark).label())
    ).toEqual([
      'catalog.priceScopeKind.REGION',
      'catalog.priceScopeKind.STORE',
    ]);
  });

  it('offers the scopes of the chain of the shop, and no scope of a single shop', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${CENTRO}/details`);
    await edit(fixture);

    const picker = control(fixture).componentInstance as ReferencesControl;
    expect(view(fixture).isControl(scopesField(fixture))).toBe(true);
    expect(picker.value()).toEqual([OWN, WAREHOUSE]);
    expect(picker.resource()).toBe('price-scopes');
    expect(picker.scope()).toEqual({
      supermarketId: 'sm_mercadona',
      kind: ['LOCAL_AREA', 'REGION', 'NATIONAL'],
    });
    // Opening the form writes nothing.
    expect(sent).toEqual([]);
  });

  /**
   * Every shop holds a `STORE` scope of its own, which catalog keeps. The
   * form offers no button that takes it away, and says why.
   */
  it('locks the own scope of the shop, which has no remove button', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    await edit(fixture);
    await settle(fixture);

    const picker = control(fixture).componentInstance as ReferencesControl;
    expect(picker.isLocked(OWN)).toBe(true);
    expect(picker.removable(OWN)).toBe(false);
    expect(picker.isLocked(WAREHOUSE)).toBe(false);
    expect(picker.removable(WAREHOUSE)).toBe(true);

    const own = rowOf(fixture, OWN);
    const warehouse = rowOf(fixture, WAREHOUSE);
    expect(own?.classList.contains('locked')).toBe(true);
    expect(own?.getAttribute('title')).toBe('resource.references.locked');
    expect(own?.querySelector('[data-remove]')).toBeNull();
    expect(warehouse?.querySelector('[data-remove]')).not.toBeNull();

    // And a caller that is no button is refused the same way.
    const emitted: (readonly string[])[] = [];
    picker.valueChange.subscribe((value) => emitted.push(value));
    picker.remove(OWN);
    expect(emitted).toEqual([]);
  });

  it('takes a scope away with its button, and sends nothing until Save', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${CENTRO}/details`);
    const store = page(fixture).store();
    await edit(fixture);
    await settle(fixture);

    (
      rowOf(fixture, WAREHOUSE)?.querySelector(
        '[data-remove]'
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(store.draft()['priceScopeIds']).toEqual([OWN]);
    expect(store.changed()).toEqual(['priceScopeIds']);
    expect(sent).toEqual([]);
  });

  it('changes the scopes with the Save of the record', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${CENTRO}/details`);
    const store = page(fixture).store();
    const changes = TestBed.inject(ResourceChanges);
    const before = changes.version('locations');
    await edit(fixture);

    // The warehouse out, and the other warehouse in.
    store.set('priceScopeIds', [OWN, OTHER_WAREHOUSE]);
    await settle(fixture);
    expect(sent).toEqual([]);

    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(sent).toEqual([
      {
        act: 'update',
        input: { priceScopeIds: [OWN, OTHER_WAREHOUSE] },
      },
    ]);
    expect(store.mode()).toBe('read');
    expect(store.row()?.['priceScopeIds']).toEqual([OWN, OTHER_WAREHOUSE]);
    expect(view(fixture).valueOf(scopesField(fixture))).toMatchObject({
      // Read again, so most general first.
      ids: [OTHER_WAREHOUSE, OWN],
    });
    expect(control(fixture)).toBeNull();
    // The list of shops shows the scopes too, so it is told of the write.
    expect(changes.version('locations')).toBeGreaterThan(before);
  });

  it('says why a save was refused, and keeps the picks', async () => {
    alter('/locations', (gateway) => {
      gateway.update = async () => {
        throw refusal('not_found', 404);
      };
    });
    const fixture = await boot(`${CENTRO}/details`);
    const store = page(fixture).store();
    await edit(fixture);
    const picks = [OWN, OTHER_WAREHOUSE];

    store.set('priceScopeIds', picks);
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(view(fixture).shownRefusal()).toEqual({
      key: 'resource.error.notFound',
      link: null,
    });
    expect(pageElement(fixture).querySelector('[data-refusal]')).not.toBeNull();
    // The draft stays, so a refusal costs a retry and not the picks.
    expect(store.mode()).toBe('edit');
    expect(store.draft()['priceScopeIds']).toEqual(picks);
    expect(store.busy()).toBe(false);
  });
});

describe('a new shop', () => {
  /**
   * The chain is in the address, so the form draws no picker for it. It is a
   * value with a lock, which says where it came from.
   */
  it('is made under the chain the address names, which is a locked value', async () => {
    const fixture = await boot(`${SHOPS}/new`);
    const store = page(fixture).store();
    const chain = field(fixture, 'supermarketId');

    expect(page(fixture).descriptor.name).toBe('locations');
    expect(store.mode()).toBe('create');
    expect(page(fixture).tabs()).toBeNull();
    expect(store.draft()['supermarketId']).toBe('sm_mercadona');
    expect(view(fixture).isControl(chain)).toBe(false);
    expect(view(fixture).lockReason(chain)).toBe('record.locked.fromAddress');
    expect(
      pageElement(fixture).querySelector('#record-field-supermarketId')
    ).toBeNull();
    expect(
      pageElement(fixture)
        .querySelector('lib-locked-value [data-reason]')
        ?.textContent?.trim()
    ).toBe('record.locked.fromAddress');
    expect(
      pageElement(fixture).querySelector('#record-field-address')
    ).not.toBeNull();
    // Below 72 rem the new shop is the page, as an open shop is.
    expect(chainPage(fixture).yielded()).toBe(true);
  });

  /**
   * No section names the chain, so while a shop is added it is the one field
   * of a last section. What cannot be typed on a new shop is not drawn.
   */
  it('draws the chain last, and nothing that follows from the rest', async () => {
    const fixture = await boot(`${SHOPS}/new`);

    expect(sections(fixture)).toEqual([
      ['catalog.locations.section.name', ['label']],
      [
        'catalog.locations.section.address',
        ['address', 'city', 'postalCode', 'country', 'latitude', 'longitude'],
      ],
      ['catalog.locations.section.prices', ['priceScopeIds']],
      ['catalog.locations.section.source', ['externalProvider', 'externalRef']],
      ['record.section.other', ['supermarketId']],
    ]);
    expect(view(fixture).layout().facts.also).toEqual([]);
  });

  it('sends the chain of the address with what was typed', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${SHOPS}/new`);

    page(fixture).store().set('address', 'Calle Nueva 1');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(sent).toHaveLength(1);
    expect(sent[0].act).toBe('create');
    expect(sent[0].input).toMatchObject({
      supermarketId: 'sm_mercadona',
      address: 'Calle Nueva 1',
    });
  });

  it('opens the shop that was made, on Details, in its pane', async () => {
    const fixture = await boot(`${SHOPS}/new`);
    const changes = TestBed.inject(ResourceChanges);
    const chains = changes.version('supermarkets');

    page(fixture).store().set('address', 'Calle Nueva 1');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toMatch(
      /^\/chains\/sm_mercadona\/shops\/(?!new\/)[^/]+\/details$/
    );
    expect(page(fixture).descriptor.name).toBe('locations');
    expect(page(fixture).heading()).toBe('Calle Nueva 1');
    expect(page(fixture).added()).toBe(true);
    expect(pageElement(fixture).querySelector('[data-added]')).not.toBeNull();
    // The chain counts its shops, and it holds one more.
    expect(changes.version('supermarkets')).toBeGreaterThan(chains);
  });
});

describe('the Sections tab of a shop', () => {
  it('draws the order panel, given the shop and the chain it reads', async () => {
    const fixture = await boot(`${CENTRO}/sections`);
    const panel = fixture.debugElement.query(By.directive(LocationSections))
      .componentInstance as LocationSections;

    expect(
      pageElement(fixture).querySelector('lib-location-sections')
    ).not.toBeNull();
    expect(panel.locationId()).toBe('loc_cordoba_centro');
    expect(panel.supermarketId()).toBe('sm_mercadona');
    // The one seeded shop with a walk shown to shoppers.
    expect(panel.hasMap()).toBe(true);
    // The record is not drawn under it.
    expect(fixture.debugElement.query(By.directive(RecordView))).toBeNull();
  });

  /** The page counts the sections of the shop on the tab, so a save reads it again. */
  it('reads the shop again after an order is saved', async () => {
    const fixture = await boot(`${OESTE}/sections`);
    const panel = fixture.debugElement.query(By.directive(LocationSections))
      .componentInstance as LocationSections;
    const load = jest.spyOn(page(fixture).store(), 'load');

    panel.move(panel.order()[1], -1);
    await panel.save();
    await settle(fixture);
    await settle(fixture);

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('the Products tab of a shop', () => {
  it('draws the list of the products of the shop', async () => {
    const fixture = await boot(`${CENTRO}/products`);

    expect(listOf(fixture, 'location-items')).toBeDefined();
    expect(
      pageElement(fixture).contains(
        listOf(fixture, 'location-items')?.nativeElement
      )
    ).toBe(true);
  });

  it('shows the product name and its brand, and not the id', async () => {
    const fixture = await boot(`${CENTRO}/products`);

    const rows = tableRows(fixture).map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Whole milk 1 L');
    expect(rows[0]).toContain('Hacendado');
    expect(rows[1]).toContain('Extra virgin olive oil 1 L');
    expect(rows.join(' ')).not.toContain('it_milk_1l');
    expect(rows.join(' ')).not.toContain('it_olive_oil_1l');
  });

  it('lists the rows of this shop only, with nothing to choose first', async () => {
    const fixture = await boot(`${OESTE}/products`);

    expect(tableRows(fixture)).toHaveLength(1);
    // No control of any list filters by the shop: the address already did.
    expect(
      fixture.nativeElement.querySelector(
        '[id^="filter-"][id$="supermarketLocationId"]'
      )
    ).toBeNull();
  });

  /** A tab draws no page header: the page of the shop already did. */
  it('draws no header of its own, and still offers to add a product', async () => {
    const fixture = await boot(`${CENTRO}/products`);
    const list = listOf(fixture, 'location-items')
      ?.nativeElement as HTMLElement;

    expect(list.querySelector('lib-page-header')).toBeNull();

    buttonSaying(list, 'catalog.locationItems.add')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/products/new`);
  });

  it('adds a product at the shop the address names, with no control for the shop', async () => {
    const sent = recordWrites('/location-items');
    const fixture = await boot(`${CENTRO}/products/new`);
    const store = page(fixture).store();

    // A record is a page of its own, beside that of the shop and not a tab
    // of it. The chain is still above both.
    expect(
      pages(fixture).map((found) => found.componentInstance.descriptor.name)
    ).toEqual(['supermarkets', 'location-items']);
    expect(
      pageElement(fixture).querySelector('#record-field-supermarketLocationId')
    ).toBeNull();
    expect(
      pageElement(fixture).querySelector('#record-field-itemId')
    ).not.toBeNull();

    store.set('itemId', 'it_dish_soap');
    store.set('positionInStore', 'Aisle 9');
    await view(fixture).save();
    await settle(fixture);
    await settle(fixture);

    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({
      itemId: 'it_dish_soap',
      supermarketLocationId: 'loc_cordoba_centro',
      positionInStore: 'Aisle 9',
    });
    // The app opens the row that was added, and says so (admin plan 0053).
    expect(url()).toBe(`${CENTRO}/products/it_dish_soap~loc_cordoba_centro`);
    expect(fixture.nativeElement.querySelector('[data-added]')).not.toBeNull();

    // And the tab the row is listed on now holds it.
    await go(fixture, `${CENTRO}/products`);
    expect(tableRows(fixture)).toHaveLength(3);
  });

  it('opens a row on a page of its own, beside that of the shop', async () => {
    const fixture = await boot(`${CENTRO}/products`);

    (
      tableRows(fixture)[0].querySelector('button.title') as HTMLButtonElement
    ).click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/products/it_milk_1l~loc_cordoba_centro`);
    expect(
      pages(fixture).map((found) => found.componentInstance.descriptor.name)
    ).toEqual(['supermarkets', 'location-items']);
  });
});

/**
 * **What is under the header is keyed on the shop**, for the reason the page
 * of a chain gives: pressing another shop in the column changes one route
 * parameter, the router keeps the page, and a tab that read the old shop
 * would keep it.
 */
describe('going from one shop to another', () => {
  it('draws the new shop on the Details tab, on the page the router kept', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);
    const kept = page(fixture);
    const old = view(fixture);
    expect(old.valueOf(field(fixture, 'postalCode'))).toMatchObject({
      text: '14001',
    });

    await go(fixture, `${OESTE}/details`);

    expect(page(fixture)).toBe(kept);
    expect(view(fixture)).not.toBe(old);
    expect(view(fixture).valueOf(field(fixture, 'postalCode'))).toMatchObject({
      text: '14005',
    });
    expect(page(fixture).heading()).toBe('Calle Historiador Domínguez Ortiz 4');
    expect(page(fixture).subtitle()).toBe('Córdoba 14005');
  });

  it('opens it from the column, which marks the shop that is open', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);
    const column = listOf(fixture, 'locations')?.nativeElement as HTMLElement;
    const current = () =>
      column.querySelector('[aria-current="true"]')?.textContent ?? '';
    expect(current()).toContain('Gran Capitán');

    ([...column.querySelectorAll('[data-row]')] as HTMLElement[])
      .find((row) => row.textContent?.includes('Domínguez Ortiz'))
      ?.click();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${OESTE}/details`);
    expect(current()).toContain('Domínguez Ortiz');
    expect(column.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it('lists the products of the new shop', async () => {
    const fixture = await boot(`${CENTRO}/products`, [WIDE]);
    expect(tableRows(fixture)).toHaveLength(2);

    await go(fixture, `${OESTE}/products`);

    expect(tableRows(fixture)).toHaveLength(1);
    expect(tableRows(fixture)[0].textContent).toContain('Whole milk 1 L');
  });

  it('draws the section order of the new shop', async () => {
    const fixture = await boot(`${CENTRO}/sections`, [WIDE]);
    const panel = () =>
      fixture.debugElement.query(By.directive(LocationSections))
        .componentInstance as LocationSections;
    expect(panel().saved()?.source).toBe('LOCATION');

    await go(fixture, `${OESTE}/sections`);

    expect(panel().locationId()).toBe('loc_cordoba_oeste');
    expect(panel().saved()?.source).toBe('CHAIN');
    expect(panel().hasMap()).toBe(false);
  });

  it('reads the scopes of the new shop', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);

    await go(fixture, `${SIERRA}/details`);

    expect(
      view(fixture).valueOf(field(fixture, 'priceScopeIds'))
    ).toMatchObject({ ids: [OTHER_WAREHOUSE, 'ps_store_loc_sierra'] });
  });
});

describe('deleting a shop', () => {
  /**
   * One name for the shop on the whole page: the heading. The title of a
   * shop carries its town, for a picker.
   */
  it('calls the shop what the heading calls it, in the question and in the menu', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const name = 'Avenida del Gran Capitán 12';

    expect(page(fixture).heading()).toBe(name);
    expect(page(fixture).title()).toBe(name);
    expect(
      page(fixture).descriptor.title(page(fixture).store().row() ?? {}, [])
    ).not.toBe(name);

    page(fixture).deleting.set(true);
    await settle(fixture);
    const question = fixture.debugElement
      .queryAll(By.directive(ConfirmDialog))
      .at(-1)?.componentInstance as ConfirmDialog;
    expect(question.headingArgs()).toMatchObject({ name });
    expect(question.confirmArgs()).toEqual({ name });
  });

  it('asks first, then goes back to the shops of the chain', async () => {
    const fixture = await boot(`${OESTE}/details`);
    const changes = TestBed.inject(ResourceChanges);
    const chains = changes.version('supermarkets');

    expect(page(fixture).canDelete()).toBe(true);
    page(fixture).deleting.set(true);
    await settle(fixture);
    expect(
      pageElement(fixture).querySelector('[data-delete-question]')
    ).not.toBeNull();

    await page(fixture).confirmDelete();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(SHOPS);
    expect(fixture.nativeElement.textContent).not.toContain('Domínguez Ortiz');
    // The chain counts its shops, and one of them is gone.
    expect(changes.version('supermarkets')).toBeGreaterThan(chains);
  });

  it('says why the gateway refused, and stays on the shop', async () => {
    alter('/locations', (gateway) => {
      gateway.remove = async () => {
        throw refusal('conflict', 409);
      };
    });
    const fixture = await boot(`${OESTE}/details`);

    page(fixture).deleting.set(true);
    await page(fixture).confirmDelete();
    await settle(fixture);

    expect(url()).toBe(`${OESTE}/details`);
    expect(page(fixture).deleting()).toBe(false);
    expect(page(fixture).refusedDelete()).toEqual({
      key: 'resource.error.conflict',
      link: null,
    });
    expect(
      pageElement(fixture).querySelector('[data-delete-question]')
    ).toBeNull();
    expect(
      pageElement(fixture).querySelector('[data-delete-refused]')?.textContent
    ).toContain('resource.error.conflict');
  });
});
