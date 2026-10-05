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
  ResourceGateway,
  ResourceInput,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  ReferencesControl,
  ScopeMark,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ITEMS } from '../items';
import { LocationFormPage } from '../location-form-page';
import { LocationSections } from '../location-sections';
import { CHAIN_RESOURCES, chainsRoutes } from './chains-routes';
import { PRICED_BY_INFO, ShopPage } from './shop-page';

/**
 * One shop, as a page inside its chain (admin plan 0042, target 5), against
 * the in memory gateways and through the real route table of the Chains
 * section.
 *
 * The seed is the catalog's own. `loc_cordoba_centro` is a Mercadona shop
 * priced by the Córdoba warehouse and by a scope of its own, with two product
 * rows. `loc_cordoba_oeste` is priced the same way and holds one.
 * `loc_sierra` is priced by a warehouse that has no label.
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

/** 72 rem and above, where the shop sits beside its chain's list of shops. */
const WIDE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(false), split: signal(true) },
};

const SHOPS = '/chains/sm_mercadona/shops';
const CENTRO = `${SHOPS}/loc_cordoba_centro`;
const OESTE = `${SHOPS}/loc_cordoba_oeste`;

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

/** The shop's page. Its chain's page and the two columns are around it. */
const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.querySelector('lib-shop-page') as HTMLElement;

const pageOf = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(ShopPage))
    .componentInstance as ShopPage;

/** The "Priced by" band. */
const priced = (fixture: ComponentFixture<TestHost>) =>
  page(fixture).querySelector('.priced') as HTMLElement;

/** What each scope of "Priced by" is called, in the order drawn. */
const scopeNames = (fixture: ComponentFixture<TestHost>) =>
  ([...priced(fixture).querySelectorAll('.scopes > li')] as HTMLElement[]).map(
    (chip) => chip.querySelector('span')?.textContent?.trim()
  );

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

afterEach(() => jest.restoreAllMocks());

describe('the page of a shop', () => {
  it('lands on the Details tab', async () => {
    await boot(CENTRO);

    expect(url()).toBe(`${CENTRO}/details`);
  });

  /** The address is what tells two shops of a chain apart. */
  it('is titled with the address, over the chain and the town', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(page(fixture).querySelector('.page-title')?.textContent).toBe(
      'Avenida del Gran Capitán 12'
    );
    expect(page(fixture).querySelector('.page-subtitle')?.textContent).toBe(
      'Mercadona, Córdoba 14001'
    );
  });

  it('leaves out of the subtitle what the shop does not have', async () => {
    // No town and no postal code: the nearest centroid was too far away.
    const fixture = await boot(`${SHOPS}/loc_sierra/details`);

    expect(page(fixture).querySelector('.page-subtitle')?.textContent).toBe(
      'Mercadona'
    );
  });

  /**
   * On a narrow screen the chain's header is hidden while a shop is open, so
   * the shop titles the page. On a wide one it sits under the chain's header,
   * beside the list, and titles a pane.
   */
  it('titles the page on a narrow screen and a pane on a wide one', async () => {
    const narrow = await boot(`${CENTRO}/details`);
    expect(page(narrow).querySelector('.page-title')?.tagName).toBe('H1');

    const wide = await boot(`${CENTRO}/details`, [WIDE]);
    expect(page(wide).querySelector('.page-title')?.tagName).toBe('H2');
    // The chain is the one h1 there is.
    expect(
      [...wide.nativeElement.querySelectorAll('h1')].map(
        (heading) => (heading as HTMLElement).textContent
      )
    ).toEqual(['Mercadona']);
  });

  it('draws the way back to the chain’s shops on a narrow screen only', async () => {
    const narrow = await boot(`${CENTRO}/details`);
    const back = page(narrow).querySelector('a.page-back');
    expect(back?.getAttribute('href')).toBe(SHOPS);
    expect(back?.getAttribute('aria-label')).toBe('catalog.shops.back');

    const wide = await boot(`${CENTRO}/details`, [WIDE]);
    expect(page(wide).querySelector('.page-back')).toBeNull();
  });

  it('is Details, Sections and Products, each under the shop', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const tabs = (
      [
        ...page(fixture).querySelectorAll('lib-page-tabs a'),
      ] as HTMLAnchorElement[]
    ).map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
      link.getAttribute('aria-current'),
    ]);

    expect(tabs).toEqual([
      ['catalog.shops.tabs.details', `${CENTRO}/details`, 'page'],
      ['catalog.shops.tabs.sections', `${CENTRO}/sections`, null],
      ['catalog.shops.tabs.products', `${CENTRO}/products`, null],
    ]);
  });

  /**
   * The Sections tab counts what the shop's own read carries, and the
   * Products tab shows no number: its list is paged and has no total.
   */
  it('counts the sections the shop’s read names, and never the products', async () => {
    alter('/locations', (gateway) => {
      const read = gateway.read.bind(gateway);
      gateway.read = async (id) => ({
        ...(await read(id)),
        sections: [{ id: 's1' }, { id: 's2' }],
      });
    });
    const fixture = await boot(`${CENTRO}/details`);
    const counts = (
      [
        ...page(fixture).querySelectorAll('lib-page-tabs a'),
      ] as HTMLAnchorElement[]
    ).map((link) => link.querySelector('.count')?.textContent?.trim() ?? null);

    expect(counts).toEqual([null, '2', null]);
  });

  /**
   * A shop is read by its own id. So an address that names another chain goes
   * to the shop's own address, and never draws the shop under that chain.
   */
  it('goes to the shop own chain when the address names another one', async () => {
    const fixture = await boot('/chains/sm_consum/shops/loc_cordoba_centro');
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
  });

  it('says so when the shop cannot be read, and draws no tab', async () => {
    const fixture = await boot(`${SHOPS}/loc_nowhere/details`);

    expect(
      page(fixture).querySelector('[role="alert"]')?.textContent
    ).toContain('resource.error.notFound');
    expect(page(fixture).querySelector('.priced')).toBeNull();
    expect(page(fixture).querySelector('.shop-body')).toBeNull();
  });
});

/**
 * The one line that explains every price the shop shows: the scopes that
 * price it, most general first, each with the mark that says how far it
 * reaches.
 */
describe('"Priced by"', () => {
  it('names the shop’s scopes, most general first', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    // The shop holds its own scope first and the warehouse second. The line
    // puts the warehouse, which covers many shops, before the shop's own.
    expect(scopeNames(fixture)).toEqual([
      'Córdoba warehouse',
      'catalog.shops.pricedBy.own',
    ]);
    expect(page(fixture).textContent).not.toContain('ps_mercadona_4661');
  });

  it('gives each scope the mark of how far it reaches', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const marks = fixture.debugElement
      .query(By.css('lib-shop-page .priced'))
      .queryAll(By.directive(ScopeMark))
      .map((mark) => mark.componentInstance as ScopeMark);

    expect(marks.map((mark) => mark.label())).toEqual([
      'catalog.priceScopeKind.REGION',
      'catalog.priceScopeKind.STORE',
    ]);
    // A region reaches further than one shop, and a lower level is wider.
    expect(marks[0].level()).toBeLessThan(marks[1].level());
  });

  /** A harvested scope has no label, and is known by the key its source prints. */
  it('calls a scope with no label by its source key', async () => {
    const fixture = await boot(`${SHOPS}/loc_sierra/details`);

    expect(scopeNames(fixture)).toEqual(['3421', 'catalog.shops.pricedBy.own']);
  });

  it('says what the line means behind an info button', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    expect(pageOf(fixture).pricedInfo).toBe(PRICED_BY_INFO);
    expect(PRICED_BY_INFO).toEqual({
      title: 'catalog.shops.pricedBy.info.title',
      points: [
        'catalog.shops.pricedBy.info.mostSpecific',
        'catalog.shops.pricedBy.info.reach',
      ],
    });
    expect(priced(fixture).querySelector('lib-info-button')).not.toBeNull();
  });

  /**
   * More than one page of general scopes, and a scope this did not read could
   * be taken for the shop's own. No names is the honest answer then.
   */
  it('names no scope when the chain’s general scopes do not fit one read', async () => {
    alter('/price-scopes', (gateway) => {
      const list = gateway.list.bind(gateway);
      gateway.list = async (query) => ({
        ...(await list(query)),
        nextCursor: 'more',
      });
    });
    const fixture = await boot(`${CENTRO}/details`);

    expect(scopeNames(fixture)).toEqual([]);
  });

  describe('"Change"', () => {
    const change = (fixture: ComponentFixture<TestHost>) =>
      priced(fixture).querySelector(
        '[data-change-scopes]'
      ) as HTMLButtonElement | null;

    const save = (fixture: ComponentFixture<TestHost>) =>
      priced(fixture).querySelector(
        '[data-save-scopes]'
      ) as HTMLButtonElement | null;

    const editor = (fixture: ComponentFixture<TestHost>) =>
      fixture.debugElement
        .query(By.css('lib-shop-page .priced'))
        .query(By.directive(ReferencesControl));

    async function open(fixture: ComponentFixture<TestHost>) {
      change(fixture)?.click();
      await settle(fixture);
      await settle(fixture);
    }

    it('opens an editor over the shop’s scopes, and sends nothing yet', async () => {
      const sent = recordWrites('/locations');
      // The Sections tab, so that the only references control is this one.
      const fixture = await boot(`${CENTRO}/sections`);
      expect(editor(fixture)).toBeNull();

      await open(fixture);

      const control = editor(fixture).componentInstance as ReferencesControl;
      expect(control.value()).toEqual([
        'ps_store_loc_cordoba_centro',
        'ps_mercadona_4661',
      ]);
      expect(control.resource()).toBe('price-scopes');
      // The shop's chain, and every kind but a single shop's.
      expect(control.scope()).toEqual({
        supermarketId: 'sm_mercadona',
        kind: ['LOCAL_AREA', 'REGION', 'NATIONAL'],
      });
      // The button that opened it steps aside for Cancel and Save.
      expect(change(fixture)).toBeNull();
      expect(sent).toEqual([]);
    });

    it('keeps the shop’s own scope, which has no remove button', async () => {
      const fixture = await boot(`${CENTRO}/sections`);
      await open(fixture);

      const chips = [
        ...editor(fixture).nativeElement.querySelectorAll('li.row'),
      ] as HTMLElement[];
      const [own, warehouse] = chips;

      expect(chips).toHaveLength(2);
      expect(own.querySelector('button')).toBeNull();
      expect(warehouse.querySelector('button')).not.toBeNull();
    });

    it('sends `priceScopeIds` on Save, and the line says what was saved', async () => {
      const sent = recordWrites('/locations');
      const fixture = await boot(`${CENTRO}/sections`);
      await open(fixture);

      // Take the warehouse out, and put the other warehouse in.
      const [, warehouse] = [
        ...editor(fixture).nativeElement.querySelectorAll('li.row'),
      ] as HTMLElement[];
      warehouse.querySelector('button')?.click();
      await settle(fixture);
      (editor(fixture).componentInstance as ReferencesControl).valueChange.emit(
        ['ps_store_loc_cordoba_centro', 'ps_mercadona_3421']
      );
      await settle(fixture);
      expect(sent).toEqual([]);

      save(fixture)?.click();
      await settle(fixture);
      await settle(fixture);
      await settle(fixture);

      expect(sent).toEqual([
        {
          act: 'update',
          input: {
            priceScopeIds: ['ps_store_loc_cordoba_centro', 'ps_mercadona_3421'],
          },
        },
      ]);
      expect(editor(fixture)).toBeNull();
      expect(change(fixture)).not.toBeNull();
      expect(scopeNames(fixture)).toEqual([
        '3421',
        'catalog.shops.pricedBy.own',
      ]);
    });

    /** The list of shops shows the scopes too, so it is told of the write. */
    it('says the shop was written, for whatever else shows it', async () => {
      const fixture = await boot(`${CENTRO}/sections`);
      const changes = TestBed.inject(ResourceChanges);
      const before = changes.version('locations');
      await open(fixture);

      save(fixture)?.click();
      await settle(fixture);
      await settle(fixture);

      expect(changes.version('locations')).toBe(before + 1);
    });

    it('sends nothing on Cancel, and keeps what the shop holds', async () => {
      const sent = recordWrites('/locations');
      const fixture = await boot(`${CENTRO}/sections`);
      await open(fixture);

      (editor(fixture).componentInstance as ReferencesControl).valueChange.emit(
        ['ps_store_loc_cordoba_centro']
      );
      await settle(fixture);
      buttonSaying(priced(fixture), 'resource.action.cancel')?.click();
      await settle(fixture);

      expect(sent).toEqual([]);
      expect(editor(fixture)).toBeNull();
      expect(scopeNames(fixture)).toEqual([
        'Córdoba warehouse',
        'catalog.shops.pricedBy.own',
      ]);
    });

    it('says why a save was refused, and keeps the picks', async () => {
      alter('/locations', (gateway) => {
        gateway.update = async () => {
          throw refusal('not_found', 404);
        };
      });
      const fixture = await boot(`${CENTRO}/sections`);
      await open(fixture);
      const picks = ['ps_store_loc_cordoba_centro', 'ps_mercadona_3421'];
      (editor(fixture).componentInstance as ReferencesControl).valueChange.emit(
        picks
      );
      await settle(fixture);

      save(fixture)?.click();
      await settle(fixture);
      await settle(fixture);

      expect(
        priced(fixture).querySelector('[role="alert"]')?.textContent
      ).toContain('resource.error.notFound');
      // The draft stays, so a refusal costs a retry and not the picks.
      expect(
        (editor(fixture).componentInstance as ReferencesControl).value()
      ).toEqual(picks);
      expect(pageOf(fixture).saving()).toBe(false);
    });
  });
});

describe('the Details tab of a shop', () => {
  const formOf = (fixture: ComponentFixture<TestHost>) =>
    fixture.debugElement.query(By.directive(LocationFormPage))
      .componentInstance as LocationFormPage;

  it('is the shop’s form, without a header and without the sections panel', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    const form = fixture.debugElement.query(By.directive(LocationFormPage))
      .nativeElement as HTMLElement;

    expect(formOf(fixture).mode).toBe('edit');
    expect(form.querySelector('lib-page-header')).toBeNull();
    // The sections used to be a panel under this form. They are a tab now.
    expect(
      fixture.debugElement.query(By.directive(LocationSections))
    ).toBeNull();
    // The chain is the address, so the form draws no control for it.
    expect(form.querySelector('#field-supermarketId')).toBeNull();
    expect(form.querySelector('#field-address')).not.toBeNull();
  });

  it('saves, stays on the tab, and retitles the page', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${CENTRO}/details`);

    formOf(fixture).change({ name: 'address', value: 'Calle Nueva 1' });
    await formOf(fixture).submit();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(sent).toEqual([
      { act: 'update', input: { address: 'Calle Nueva 1' } },
    ]);
    expect(page(fixture).textContent).toContain('resource.form.saved');
    // The page reads the shop again, so its title says what was saved.
    expect(page(fixture).querySelector('.page-title')?.textContent).toBe(
      'Calle Nueva 1'
    );
  });

  /** There is no list to go back to, so Cancel puts back what the shop holds. */
  it('puts the shop’s values back on cancel, and stays', async () => {
    const fixture = await boot(`${CENTRO}/details`);

    formOf(fixture).change({ name: 'city', value: 'Sevilla' });
    expect(formOf(fixture).store.dirty()).toBe(true);

    formOf(fixture).goBack();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/details`);
    expect(formOf(fixture).store.dirty()).toBe(false);
    expect(formOf(fixture).store.draft()['city']).toBe('Córdoba');
  });
});

describe('a new shop', () => {
  const formOf = (fixture: ComponentFixture<TestHost>) =>
    fixture.debugElement.query(By.directive(LocationFormPage))
      .componentInstance as LocationFormPage;

  it('is made under the chain the address names, with no control for it', async () => {
    const sent = recordWrites('/locations');
    const fixture = await boot(`${SHOPS}/new`);
    const form = fixture.debugElement.query(By.directive(LocationFormPage))
      .nativeElement as HTMLElement;

    expect(formOf(fixture).mode).toBe('create');
    expect(form.querySelector('#field-supermarketId')).toBeNull();
    // A page of its own, with the header every form has.
    expect(form.querySelector('lib-page-header')).not.toBeNull();

    formOf(fixture).change({ name: 'address', value: 'Calle Nueva 1' });
    // The write is all this case is about. Where the form goes next is the
    // case below.
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await formOf(fixture).submit();
    await settle(fixture);

    expect(sent).toHaveLength(1);
    expect(sent[0].act).toBe('create');
    expect(sent[0].input).toMatchObject({
      supermarketId: 'sm_mercadona',
      address: 'Calle Nueva 1',
    });
  });

  /**
   * The memory twin stores a new shop as the form sent it, and the form sends
   * no `sections`, no `priceScopeIds` and no `hasMap`. Catalog answers all
   * three on every shop, so the twin is given them here: without them the
   * page of the new shop throws on its first draw, which is a gap in the twin
   * and not something this case is about.
   */
  it('opens the shop that was made', async () => {
    alter('/locations', (gateway) => {
      const create = gateway.create.bind(gateway);
      gateway.create = (input) =>
        create({ sections: [], priceScopeIds: [], hasMap: false, ...input });
    });
    const fixture = await boot(`${SHOPS}/new`);

    formOf(fixture).change({ name: 'address', value: 'Calle Nueva 1' });
    await formOf(fixture).submit();
    await settle(fixture);
    await settle(fixture);
    await settle(fixture);

    expect(url()).toMatch(
      /^\/chains\/sm_mercadona\/shops\/(?!new\/)[^/]+\/details$/
    );
    expect(page(fixture).querySelector('.page-title')?.textContent).toBe(
      'Calle Nueva 1'
    );
  });
});

describe('the Sections tab of a shop', () => {
  it('draws the order panel, given the shop and the chain it reads', async () => {
    const fixture = await boot(`${CENTRO}/sections`);
    const panel = fixture.debugElement.query(By.directive(LocationSections))
      .componentInstance as LocationSections;

    expect(panel.locationId()).toBe('loc_cordoba_centro');
    expect(panel.supermarketId()).toBe('sm_mercadona');
    // The one seeded shop with a walk shown to shoppers.
    expect(panel.hasMap()).toBe(true);
  });

  /** The page counts the shop's sections on the tab, so a save reads it again. */
  it('reads the shop again after an order is saved', async () => {
    const fixture = await boot(`${OESTE}/sections`);
    const panel = fixture.debugElement.query(By.directive(LocationSections))
      .componentInstance as LocationSections;
    const reload = jest.spyOn(pageOf(fixture).shop, 'reload');

    panel.move(panel.order()[1], -1);
    await panel.save();
    await settle(fixture);
    await settle(fixture);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('the Products tab of a shop', () => {
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

  it('lists this shop’s rows only, with nothing to choose first', async () => {
    const fixture = await boot(`${OESTE}/products`);

    expect(tableRows(fixture)).toHaveLength(1);
    // No control of any list filters by the shop: the address already did.
    expect(
      fixture.nativeElement.querySelector(
        '[id^="filter-"][id$="supermarketLocationId"]'
      )
    ).toBeNull();
  });

  /** A tab draws no page header: the shop's page already did. */
  it('draws no header of its own, and still offers to add a product', async () => {
    const fixture = await boot(`${CENTRO}/products`);
    const list = fixture.debugElement
      .queryAll(By.directive(ResourceListPage))
      .find(
        (found) => found.componentInstance.descriptor.name === 'location-items'
      )?.nativeElement as HTMLElement;

    expect(list.querySelector('lib-page-header')).toBeNull();

    buttonSaying(list, 'catalog.locationItems.add')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/products/new`);
  });

  it('adds a product at the shop the address names, with no control for the shop', async () => {
    const sent = recordWrites('/location-items');
    const fixture = await boot(`${CENTRO}/products/new`);
    const form = fixture.debugElement.query(By.directive(RecordPage));
    const store = (form.componentInstance as RecordPage).store();
    const view = fixture.debugElement.query(By.directive(RecordView))
      .componentInstance as RecordView;

    // A record is a page of its own, beside the shop's and not a tab of it.
    expect(page(fixture)).toBeNull();
    expect(
      form.nativeElement.querySelector('#record-field-supermarketLocationId')
    ).toBeNull();
    expect(
      form.nativeElement.querySelector('#record-field-itemId')
    ).not.toBeNull();

    store.set('itemId', 'it_dish_soap');
    store.set('positionInStore', 'Aisle 9');
    await view.save();
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
    await TestBed.inject(Router).navigateByUrl(`${CENTRO}/products`);
    await settle(fixture);
    await settle(fixture);
    expect(tableRows(fixture)).toHaveLength(3);
  });

  it('opens a row on its form, beside the shop’s page', async () => {
    const fixture = await boot(`${CENTRO}/products`);

    (
      tableRows(fixture)[0].querySelector('button.title') as HTMLButtonElement
    ).click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(`${CENTRO}/products/it_milk_1l~loc_cordoba_centro`);
    expect(page(fixture)).toBeNull();
    expect(fixture.debugElement.query(By.directive(RecordPage))).not.toBeNull();
  });
});

/**
 * **The keyed outlet of a shop's page**, for the reason the chain's page
 * gives: pressing another shop in the column changes one route parameter, the
 * router keeps the page, and a form that read the old shop would keep it.
 */
describe('going from one shop to another', () => {
  it('draws the new shop’s form on the Details tab, on the page the router kept', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);
    const kept = pageOf(fixture);
    const form = () =>
      fixture.debugElement.query(By.directive(LocationFormPage))
        .componentInstance as LocationFormPage;
    const old = form();
    expect(old.store.draft()['postalCode']).toBe('14001');

    await go(fixture, `${OESTE}/details`);

    expect(pageOf(fixture)).toBe(kept);
    expect(form()).not.toBe(old);
    expect(form().store.draft()['postalCode']).toBe('14005');
    expect(page(fixture).querySelector('.page-title')?.textContent).toBe(
      'Calle Historiador Domínguez Ortiz 4'
    );
  });

  it('opens it from the column, which marks the shop that is open', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);
    const column = fixture.debugElement
      .queryAll(By.directive(ResourceListPage))
      .find((list) => list.componentInstance.descriptor.name === 'locations')
      ?.nativeElement as HTMLElement;
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

  it('lists the new shop’s products', async () => {
    const fixture = await boot(`${CENTRO}/products`, [WIDE]);
    expect(tableRows(fixture)).toHaveLength(2);

    await go(fixture, `${OESTE}/products`);

    expect(tableRows(fixture)).toHaveLength(1);
    expect(tableRows(fixture)[0].textContent).toContain('Whole milk 1 L');
  });

  it('draws the new shop’s section order', async () => {
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

  it('names the new shop’s scopes, and closes an editor left open', async () => {
    const fixture = await boot(`${CENTRO}/details`, [WIDE]);
    (
      priced(fixture).querySelector('[data-change-scopes]') as HTMLButtonElement
    ).click();
    await settle(fixture);
    expect(pageOf(fixture).changing()).toBe(true);

    await go(fixture, `${SHOPS}/loc_sierra/details`);

    expect(pageOf(fixture).changing()).toBe(false);
    expect(scopeNames(fixture)).toEqual(['3421', 'catalog.shops.pricedBy.own']);
  });
});

describe('deleting a shop', () => {
  it('asks first, then goes back to the chain’s shops', async () => {
    const fixture = await boot(`${OESTE}/details`);
    const changes = TestBed.inject(ResourceChanges);
    const chains = changes.version('supermarkets');

    buttonSaying(page(fixture), 'catalog.shops.delete')?.click();
    await settle(fixture);
    expect(
      fixture.nativeElement.querySelector('lib-confirm-dialog')?.textContent
    ).toContain('catalog.shops.deleteHeading');

    await pageOf(fixture).confirmDelete();
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
        throw refusal('not_found', 404);
      };
    });
    const fixture = await boot(`${OESTE}/details`);

    pageOf(fixture).deleting.set(true);
    await pageOf(fixture).confirmDelete();
    await settle(fixture);

    expect(url()).toBe(`${OESTE}/details`);
    expect(
      fixture.nativeElement.querySelector('lib-confirm-dialog')
    ).toBeNull();
    expect(page(fixture).querySelector('.refusal')?.textContent).toContain(
      'resource.error.notFound'
    );
  });
});
