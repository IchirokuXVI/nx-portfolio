import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  provideRouter,
  Router,
  RouterOutlet,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceGateway,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { provideSections } from './admin-section';
import { ResourceChanges } from './resource-changes';
import { ResourceListPage } from './resource-list-page';
import { RESOURCE_DESCRIPTOR } from './resource-route-data';
import { resourceSplitRoute, resourceTabRoute } from './routes';

/**
 * What the list page lays over `toCell`'s work (admin plan 0023, section 2):
 * the link a reference cell carries, and the name the lookup resolved.
 *
 * Both live here and not in `toCell`, because both need what only this page
 * has: the registry, which knows where a target is mounted and whether it has
 * a detail screen, and the lookup, which costs a request. The assertions are
 * on the `rows()` view model rather than on rendered text, because the testing
 * translator does not interpolate.
 */

interface Gadget {
  id: string;
  factoryId: string | null;
  noteId: string | null;
}

const GADGET_ROWS: Gadget[] = [
  { id: 'g1', factoryId: 'f1', noteId: 'n1' },
  { id: 'g2', factoryId: 'f1', noteId: null },
  { id: 'g3', factoryId: 'f_gone', noteId: null },
];

function pageOf<T extends ResourceRow>(items: readonly T[]): ResourcePage<T> {
  return { items, nextCursor: null };
}

/** Reads of the factories, counted, so the caching is observable. */
const factoryReads: string[] = [];

const factoriesGateway: ResourceGateway<ResourceRow> = {
  list: async () => pageOf([]),
  read: async (id) => {
    factoryReads.push(id);
    if (id === 'f_gone') {
      throw new Error('gone');
    }
    return { id, name: 'Cordoba plant' };
  },
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

/** Every listing of the gadgets, so what a re-read asked for is observable. */
const gadgetListCalls: ResourceQuery[] = [];

const gadgetsGateway: ResourceGateway<ResourceRow> = {
  list: async (query: ResourceQuery = {}) => {
    gadgetListCalls.push(query);
    // A cursor, so that a page which has one can be shown to lose it.
    return {
      items: GADGET_ROWS as unknown as ResourceRow[],
      nextCursor: 'the-english-cursor',
    };
  },
  read: () => Promise.reject(new Error('not used')),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

const notesGateway: ResourceGateway<ResourceRow> = {
  list: async () => pageOf([]),
  read: async (id) => ({ id }),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

/** The target with a detail screen: `edit` gives it one. */
const FACTORIES = defineResource<{ id: string; name: string }>({
  name: 'factories',
  segment: 'factories',
  labels: { one: 'factories.one', many: 'factories.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'factories.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => factoriesGateway,
});

/** A target with no detail screen at all: its rows do not open. */
const NOTES = defineResource<{ id: string }>({
  name: 'notes',
  segment: 'notes',
  labels: { one: 'notes.one', many: 'notes.many' },
  title: (row) => row.id,
  fields: [{ kind: 'text', name: 'id', label: 'notes.id' }],
  list: { columns: ['id'], compact: ['id'] },
  gateway: () => notesGateway,
});

const GADGETS = defineResource<Gadget>({
  name: 'gadgets',
  segment: 'gadgets',
  labels: { one: 'gadgets.one', many: 'gadgets.many' },
  title: (row) => row.id,
  fields: [
    {
      kind: 'reference',
      name: 'factoryId',
      label: 'gadgets.factory',
      resource: 'factories',
      nameLookup: true,
      nullable: true,
    },
    {
      kind: 'reference',
      name: 'noteId',
      label: 'gadgets.note',
      resource: 'notes',
      nullable: true,
    },
  ],
  list: { columns: ['factoryId', 'noteId'], compact: ['factoryId'] },
  gateway: () => gadgetsGateway,
});

async function render(): Promise<ComponentFixture<ResourceListPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ResourceListPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideRouter([]),
      // The section is what the registry reads, so the links below come out
      // of the mount and not out of anything a descriptor spelled.
      provideSections({
        key: 'stuff',
        label: '',
        segment: 'stuff',
        resources: [GADGETS, FACTORIES, NOTES],
      }),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data: { [RESOURCE_DESCRIPTOR]: GADGETS } } },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ResourceListPage);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

/** Lets the load and the lookups settle, then redraws. */
async function settle(fixture: ComponentFixture<ResourceListPage>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

beforeEach(() => {
  factoryReads.length = 0;
  gadgetListCalls.length = 0;
  localStorage.clear();
});

afterEach(() => localStorage.clear());

describe('a reference cell on the list page (admin plan 0023)', () => {
  it('derives the link from the registry, so a section move carries it', async () => {
    const fixture = await render();

    const cell = fixture.componentInstance.rows()[0].cells['factoryId'];
    expect(cell.link).toEqual(['/', 'stuff', 'factories', 'f1']);
  });

  it('gives a target without a detail screen no link at all', async () => {
    const fixture = await render();

    const cell = fixture.componentInstance.rows()[0].cells['noteId'];
    expect(cell.reference).toEqual({ resource: 'notes', id: 'n1' });
    expect(cell.link).toBeUndefined();
  });

  it('fills the looked up name once per distinct id', async () => {
    const fixture = await render();
    await settle(fixture);

    const rows = fixture.componentInstance.rows();
    expect(rows[0].cells['factoryId'].text).toBe('Cordoba plant');
    expect(rows[1].cells['factoryId'].text).toBe('Cordoba plant');
    // Two rows, one id, one request.
    expect(factoryReads.filter((id) => id === 'f1')).toHaveLength(1);
  });

  /**
   * A reference can outlive what it points at. The id stays on screen, and
   * the answer is cached like any other so the gone row is not asked about
   * on every further page.
   */
  it('keeps the id for a null resolve, and never asks about it again', async () => {
    const fixture = await render();
    await settle(fixture);

    expect(fixture.componentInstance.rows()[2].cells['factoryId'].text).toBe(
      'f_gone'
    );

    await fixture.componentInstance.store.load();
    await settle(fixture);
    expect(factoryReads.filter((id) => id === 'f_gone')).toHaveLength(1);
  });

  it('leaves an empty reference as its "none" cell, unresolved', async () => {
    const fixture = await render();
    await settle(fixture);

    const cell = fixture.componentInstance.rows()[1].cells['noteId'];
    expect(cell.key).toBe('resource.value.none');
    expect(cell.reference).toBeUndefined();
    expect(cell.link).toBeUndefined();
  });
});

/**
 * A switch of the content language invalidates the page (admin plan 0026,
 * section 6).
 *
 * The thing that looks cosmetic and is not. Once backend plan `0111` lands, a
 * listing is ordered and its cursor is cut in the caller's language, so the
 * rows on screen were chosen under the old one: redrawing them under the new
 * one reorders nothing and the next page continues from a cursor cut
 * elsewhere. The page is read again from the start instead.
 */
describe('the list page when the content language changes', () => {
  it('reads the first page again and drops the cursor', async () => {
    const fixture = await render();
    await settle(fixture);

    const before = gadgetListCalls.length;
    // A page was loaded, so there is a cursor to lose.
    expect(fixture.componentInstance.store.hasMore()).toBe(true);

    TestBed.inject(ContentLocaleStore).choose('es');
    fixture.detectChanges();
    await settle(fixture);

    const since = gadgetListCalls.slice(before);
    expect(since).toHaveLength(1);
    // The first page: no cursor, rather than the one the English page ended on.
    expect(since[0].cursor).toBeUndefined();
  });

  /**
   * The resolved reference names go with the rows. They are titles this page
   * asked the lookup for in the old language, and `_asked` would otherwise stop
   * it ever asking again, so a switch would leave every reference cell reading
   * English on an otherwise Spanish screen.
   */
  it('asks the lookup again, so a resolved name is not left in the old language', async () => {
    const fixture = await render();
    await settle(fixture);

    expect(factoryReads.filter((id) => id === 'f1')).toHaveLength(1);

    TestBed.inject(ContentLocaleStore).choose('es');
    fixture.detectChanges();
    await settle(fixture);
    await settle(fixture);

    expect(factoryReads.filter((id) => id === 'f1')).toHaveLength(2);
  });

  /** What the operator narrowed by is a choice about which rows, and survives. */
  it('keeps the filter and the order', async () => {
    const fixture = await render();
    await fixture.componentInstance.store.setFilter('factoryId', 'f1');
    await fixture.componentInstance.store.setOrder('name');
    await settle(fixture);

    TestBed.inject(ContentLocaleStore).choose('es');
    fixture.detectChanges();
    await settle(fixture);

    const last = gadgetListCalls[gadgetListCalls.length - 1];
    expect(last.filters).toEqual({ factoryId: 'f1' });
    expect(last.order).toBe('name');
  });
});

/**
 * A list under a row of another resource (admin plan 0042).
 *
 * Mounted through the real router, because the whole of the feature is where
 * the list reads its parent from: a route parameter of the page it is part of.
 * That page has a component, so the router does not hand its parameters down,
 * and a fake `ActivatedRoute` would have hidden exactly that.
 */

interface Line {
  id: string;
  plantId: string;
  name: string;
  city: string;
  staff: number;
}

const LINE_ROWS: Line[] = [
  { id: 'l1', plantId: 'p1', name: 'Bottling', city: 'Sevilla', staff: 12 },
  { id: 'l2', plantId: 'p1', name: 'Labelling', city: 'Cordoba', staff: 4 },
];

/** Every listing of the lines, so what the address sent is observable. */
const lineListCalls: ResourceQuery[] = [];

const linesGateway: ResourceGateway<ResourceRow> = {
  list: async (query: ResourceQuery = {}) => {
    lineListCalls.push(query);
    return pageOf(LINE_ROWS as unknown as ResourceRow[]);
  },
  read: () => Promise.reject(new Error('not used')),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

/** What a picker asked each of the two targets below for. */
const plantSearches: ResourceQuery[] = [];
const crewSearches: ResourceQuery[] = [];

function searched(calls: ResourceQuery[]): ResourceGateway<ResourceRow> {
  return {
    list: async (query: ResourceQuery = {}) => {
      calls.push(query);
      return pageOf([]);
    },
    read: () => Promise.reject(new Error('not used')),
    create: () => Promise.reject(new Error('not used')),
    update: () => Promise.reject(new Error('not used')),
    remove: () => Promise.reject(new Error('not used')),
  };
}

const PLANTS = defineResource<{ id: string; name: string }>({
  name: 'plants',
  segment: 'plants',
  labels: { one: 'plants.one', many: 'plants.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'plants.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => searched(plantSearches),
});

/** A second resource under the same parent, which a filter can point at. */
const CREWS = defineResource<{ id: string; name: string }>({
  name: 'crews',
  segment: 'crews',
  labels: { one: 'crews.one', many: 'crews.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'crews.name' }],
  list: { columns: ['name'], compact: ['name'] },
  parent: { resource: 'plants', param: 'plantId', filter: 'plantId' },
  gateway: () => searched(crewSearches),
});

const LINES = defineResource<Line>({
  name: 'lines',
  segment: 'lines',
  labels: { one: 'lines.one', many: 'lines.many', create: 'lines.add' },
  title: (row) => row.name,
  fields: [
    {
      kind: 'reference',
      name: 'plantId',
      label: 'lines.plant',
      resource: 'plants',
    },
    { kind: 'text', name: 'name', label: 'lines.name' },
    { kind: 'text', name: 'city', label: 'lines.city' },
    { kind: 'number', name: 'staff', label: 'lines.staff' },
  ],
  list: {
    columns: ['name', 'city'],
    compact: ['name'],
    brief: { line: ['city'], trailing: 'staff' },
  },
  // The parent is declared as a filter too, which is what a descriptor that
  // predates the address had. The list must not draw it.
  filters: [
    {
      kind: 'reference',
      param: 'plantId',
      label: 'lines.plantFilter',
      resource: 'plants',
    },
    { kind: 'search', param: 'query', label: 'lines.search' },
  ],
  parent: { resource: 'plants', param: 'plantId', filter: 'plantId' },
  rowStates: () => (row) =>
    row.staff > 10 ? [{ label: 'lines.busy', tone: 'waiting' }] : [],
  actions: { create: true, edit: true },
  gateway: () => linesGateway,
});

/** The page a list is a tab of. It has a component, and that is the point. */
@Component({
  imports: [RouterOutlet],
  template: `<h1>plant</h1>
    <router-outlet />`,
})
class PlantPage {}

@Component({ template: `<p data-line-page>line</p>` })
class LinePage {}

interface Mounted {
  readonly harness: RouterTestingHarness;
  readonly page: ResourceListPage;
  readonly element: HTMLElement;
}

async function mount(
  url: string,
  options: { embed: 'tab' | 'column'; split?: boolean; underHeader?: boolean }
): Promise<Mounted> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      {
        provide: Viewport,
        useValue: {
          compact: signal(false),
          split: signal(options.split ?? false),
        },
      },
      provideSections({
        key: 'plants',
        label: '',
        held: [PLANTS, LINES, CREWS],
      }),
      provideRouter([
        {
          path: 'plants/:plantId',
          component: PlantPage,
          children: [
            options.embed === 'tab'
              ? resourceTabRoute(LINES)
              : resourceSplitRoute(LINES, {
                  listWidth: '340px',
                  underHeader: options.underHeader ?? false,
                  children: [{ path: ':lineId', component: LinePage }],
                }),
          ],
        },
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drawn(harness);

  return {
    harness,
    page: harness.routeDebugElement?.query(By.directive(ResourceListPage))
      .componentInstance,
    element: harness.routeNativeElement as HTMLElement,
  };
}

/** Lets a read settle, then redraws. */
async function drawn(harness: RouterTestingHarness): Promise<void> {
  harness.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.detectChanges();
}

const labels = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('lib-resource-filters label')).map(
    (label) => label.textContent?.trim()
  );

describe('a list under a parent row (admin plan 0042)', () => {
  beforeEach(() => {
    lineListCalls.length = 0;
  });

  it('sends the parent on every read, from a parameter of the page above', async () => {
    const { page, harness } = await mount('/plants/p1/lines', { embed: 'tab' });

    expect(lineListCalls).toHaveLength(1);
    expect(lineListCalls[0].filters).toEqual({ plantId: 'p1' });

    await page.store.setFilter('query', 'bott');
    await drawn(harness);
    expect(lineListCalls[lineListCalls.length - 1].filters).toEqual({
      plantId: 'p1',
      query: 'bott',
    });

    // Clearing drops what the operator narrowed by and keeps the address.
    await page.store.clear();
    await drawn(harness);
    expect(lineListCalls[lineListCalls.length - 1].filters).toEqual({
      plantId: 'p1',
    });
  });

  /**
   * A control for the parent would be a second place to answer a question the
   * address already answered, and the two could disagree.
   */
  it('draws no filter control for the parent, and keeps the others', async () => {
    const { page, element } = await mount('/plants/p1/lines', { embed: 'tab' });

    expect(page.filters.map((filter) => filter.param)).toEqual(['query']);
    expect(labels(element)).toEqual(['lines.search']);
  });

  /** The address is not something the operator narrowed the list by. */
  it('is not blocked and not narrowed by the parent alone', async () => {
    const { page } = await mount('/plants/p1/lines', { embed: 'tab' });

    expect(page.blockedBy()).toBeNull();
    expect(page.store.narrowed()).toBe(false);
  });

  it('reads a different parent at a different address', async () => {
    await mount('/plants/p2/lines', { embed: 'tab' });

    expect(lineListCalls[0].filters).toEqual({ plantId: 'p2' });
  });

  /**
   * A filter that points at another resource under the same parent offers
   * that parent's rows only: the scopes to narrow a chain's shops by are that
   * chain's. A target that is not under the parent is asked as it always was,
   * since a parameter its route does not declare is refused.
   */
  it('searches a reference filter under the same parent', async () => {
    plantSearches.length = 0;
    crewSearches.length = 0;
    const { page } = await mount('/plants/p1/lines', { embed: 'tab' });

    await page.lookup.search('crews', '');
    await page.lookup.search('crews', '', { shift: 'night' });
    await page.lookup.search('plants', '');

    expect(crewSearches.map((query) => query.filters)).toEqual([
      { plantId: 'p1' },
      { plantId: 'p1', shift: 'night' },
    ]);
    expect(plantSearches.map((query) => query.filters)).toEqual([{}]);
  });
});

describe('a list that is a tab of a page', () => {
  beforeEach(() => {
    lineListCalls.length = 0;
  });

  it('draws no page header, since the page above drew one', async () => {
    const { page, element } = await mount('/plants/p1/lines', { embed: 'tab' });

    expect(page.embed).toBe('tab');
    expect(page.heading()).toBe('none');
    expect(element.querySelector('lib-page-header')).toBeNull();
    // The one `h1` is the page's own.
    expect(element.querySelectorAll('h1')).toHaveLength(1);
  });

  it('still draws the create button, in the resource own words', async () => {
    const { element } = await mount('/plants/p1/lines', { embed: 'tab' });

    const create = element.querySelector('[data-create]');
    expect(create?.textContent?.trim()).toBe('lines.add');
  });

  it('keeps its table, with the states of a row beside its name', async () => {
    const { page, element } = await mount('/plants/p1/lines', { embed: 'tab' });

    expect(element.querySelector('table')).not.toBeNull();
    expect(element.querySelector('[data-row]')).toBeNull();
    expect(page.rows()[0].states).toEqual([
      { label: 'lines.busy', tone: 'waiting' },
    ]);
    // A row with no state carries no empty list, and a tab carries no brief.
    expect(page.rows()[1].states).toBeUndefined();
    expect(page.rows()[0].brief).toBeUndefined();
    expect(element.querySelector('.state-chip')?.textContent?.trim()).toBe(
      'lines.busy'
    );
  });
});

describe('a list that is a column beside the open row', () => {
  beforeEach(() => {
    lineListCalls.length = 0;
  });

  it('draws one row per line, with the open one marked', async () => {
    const { page, element } = await mount('/plants/p1/lines/l2', {
      embed: 'column',
      split: true,
    });

    const rows = Array.from(element.querySelectorAll('[data-row]'));
    expect(rows).toHaveLength(2);
    expect(element.querySelector('table')).toBeNull();
    expect(page.openId()).toBe('l2');
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([
      null,
      'true',
    ]);
    // The row that is open is drawn beside the list, not in place of it.
    expect(element.querySelector('[data-line-page]')).not.toBeNull();
  });

  it('marks nothing while no row is open', async () => {
    const { page, element } = await mount('/plants/p1/lines', {
      embed: 'column',
      split: true,
    });

    expect(page.openId()).toBeNull();
    expect(element.querySelector('[aria-current]')).toBeNull();
  });

  /**
   * The mark follows the address and not the press, so that the browser's back
   * button moves it as well.
   */
  it('follows the address, through a press and through a navigation', async () => {
    const { page, element, harness } = await mount('/plants/p1/lines', {
      embed: 'column',
      split: true,
    });
    const router = TestBed.inject(Router);

    (element.querySelector('[data-row]') as HTMLButtonElement).click();
    await drawn(harness);
    expect(router.url).toBe('/plants/p1/lines/l1');
    expect(page.openId()).toBe('l1');

    await router.navigateByUrl('/plants/p1/lines/l2');
    await drawn(harness);
    expect(
      Array.from(element.querySelectorAll('[data-row]')).map((row) =>
        row.getAttribute('aria-current')
      )
    ).toEqual([null, 'true']);

    await router.navigateByUrl('/plants/p1/lines');
    await drawn(harness);
    expect(page.openId()).toBeNull();
    // One list throughout: opening a row did not read the rows again.
    expect(lineListCalls).toHaveLength(1);
  });

  it('says one line and one number per row, without labels', async () => {
    const { page, element } = await mount('/plants/p1/lines', {
      embed: 'column',
      split: true,
    });

    expect(page.rows()[0].brief).toEqual({
      heading: 'Bottling',
      line: 'Sevilla',
      trailing: '12',
    });
    const first = element.querySelector('[data-row]') as HTMLElement;
    expect(first.querySelector('.row-heading')?.textContent?.trim()).toBe(
      'Bottling'
    );
    expect(first.querySelector('.row-trailing')?.textContent?.trim()).toBe(
      '12'
    );
    expect(first.querySelector('.state-chip')?.textContent?.trim()).toBe(
      'lines.busy'
    );
  });

  /**
   * Beside the open row the column says what it lists. It is the title of the
   * page until a row is open, and one level down once that row titles it. On a
   * narrow screen the column is the page.
   */
  it('titles a pane on a wide screen and the page on a narrow one', async () => {
    const wide = await mount('/plants/p1/lines/l1', {
      embed: 'column',
      split: true,
    });
    expect(wide.page.heading()).toBe('pane');
    expect(wide.element.querySelector('lib-page-header')).toBeNull();
    expect(
      wide.element.querySelector('.pane-head h2')?.textContent?.trim()
    ).toBe('lines.many');
    expect(wide.element.querySelector('[data-create]')).not.toBeNull();

    const closed = await mount('/plants/p1/lines', {
      embed: 'column',
      split: true,
    });
    expect(
      closed.element.querySelector('.pane-head h1')?.textContent?.trim()
    ).toBe('lines.many');

    const narrow = await mount('/plants/p1/lines', {
      embed: 'column',
      split: false,
    });
    expect(narrow.page.heading()).toBe('page');
    expect(narrow.element.querySelector('lib-page-header')).not.toBeNull();
    // Rows either way: a column is never a table.
    expect(narrow.element.querySelectorAll('[data-row]')).toHaveLength(2);
  });

  /**
   * Under a page header and its tab the column needs no title, wide or
   * narrow: the tab already says what is listed.
   */
  it('draws no title under the header of the page that holds it', async () => {
    for (const split of [true, false]) {
      const { page, element } = await mount('/plants/p1/lines', {
        embed: 'column',
        split,
        underHeader: true,
      });

      expect(page.heading()).toBe('none');
      expect(element.querySelector('lib-page-header')).toBeNull();
      expect(element.querySelector('.pane-head')).toBeNull();
      expect(element.querySelector('[data-create]')?.textContent?.trim()).toBe(
        'lines.add'
      );
      expect(element.querySelectorAll('[data-row]')).toHaveLength(2);
    }
  });
});

/**
 * A list that stays on screen while one of its rows is written (admin plan
 * 0042). The form says which resource it wrote to, and the list reads again.
 */
describe('a list that is still drawn during a write', () => {
  beforeEach(() => {
    lineListCalls.length = 0;
    gadgetListCalls.length = 0;
  });

  it('reads again after a write to its resource', async () => {
    const { harness } = await mount('/plants/p1/lines', { embed: 'tab' });
    expect(lineListCalls).toHaveLength(1);

    TestBed.inject(ResourceChanges).wrote('lines');
    await drawn(harness);

    expect(lineListCalls).toHaveLength(2);
    // The same read as the first: the address still names the parent.
    expect(lineListCalls[1].filters).toEqual({ plantId: 'p1' });
  });

  it('reads again as a column too', async () => {
    const { harness } = await mount('/plants/p1/lines/l1', {
      embed: 'column',
      split: true,
    });

    TestBed.inject(ResourceChanges).wrote('lines');
    await drawn(harness);

    expect(lineListCalls).toHaveLength(2);
  });

  it('does not read again for a write to another resource', async () => {
    const { harness } = await mount('/plants/p1/lines', { embed: 'tab' });

    TestBed.inject(ResourceChanges).wrote('plants');
    await drawn(harness);

    expect(lineListCalls).toHaveLength(1);
  });

  /**
   * A list that is the whole page is never on screen during a write, and the
   * read it makes when it is built is all it needs.
   */
  it('does not read again when the list is the whole page', async () => {
    const fixture = await render();
    const before = gadgetListCalls.length;

    TestBed.inject(ResourceChanges).wrote('gadgets');
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.componentInstance.embed).toBeNull();
    expect(gadgetListCalls).toHaveLength(before);
  });
});
