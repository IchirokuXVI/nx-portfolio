import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { provideSections } from './admin-section';
import { RECORD_CONTEXT } from './record-context';
import { RecordPage } from './record-page';
import { ResourceChanges } from './resource-changes';
import { ResourceListPage } from './resource-list-page';
import { recordRoute, resourceFormBranch, resourceTabRoute } from './routes';

/**
 * What a record holds, drawn by the record page (admin plan 0054, sections 2
 * and 3): its tabs, its panels and its links, through the real router.
 *
 * One chain holds its shops three ways at once, which no real record does.
 * It is what lets each shape be asked about against the same rows.
 *
 * Assertions are on keys wherever a sentence is translated, because the
 * testing translator answers the key.
 */

interface Chain extends ResourceRow {
  id: string;
  name: string;
  shopCount: number;
}

interface Shop extends ResourceRow {
  id: string;
  chainId: string;
  name: string;
  itemCount: number;
}

const SHOP_ROWS: readonly Shop[] = [
  { id: 's1', chainId: 'c1', name: 'Triana', itemCount: 41 },
  { id: 's2', chainId: 'c1', name: 'Nervion', itemCount: 7 },
];

/** What the servers answer. Each case bends what it asks about. */
const server = {
  chain: async (id: string): Promise<Chain> => ({
    id,
    name: 'Alcampo',
    shopCount: 7,
  }),
  shops: async (query: ResourceQuery): Promise<ResourcePage<Shop>> => {
    void query;
    return { items: SHOP_ROWS, nextCursor: null };
  },
};
const pristine = { ...server };

/** Every list read of the shops, as it was asked. */
const shopReads: ResourceQuery[] = [];
let chainReads = 0;

/** The counts no field of the chain holds, by the key of the child. */
const held = signal<Readonly<Record<string, number | null>>>({ notes: 3 });

/** A tab the chain's own library draws. It says what the context handed it. */
@Component({
  selector: 'lib-test-notes-tab',
  template: `
    <p data-notes>{{ context.id }} {{ context.row()?.['name'] }}</p>
    <button (click)="context.reload()" type="button" data-reload>again</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class NotesTab {
  readonly context = inject(RECORD_CONTEXT);
}

/** A panel the chain's own library draws. */
@Component({
  selector: 'lib-test-facts-panel',
  template: `<p data-facts>{{ context.id }}</p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class FactsPanel {
  readonly context = inject(RECORD_CONTEXT);
}

/** What the named action of a chain is refused with, or `null`. */
let auditFails: GatewayError | null = null;

const CHAINS = defineResource<Chain>({
  name: 'chains',
  segment: 'chains',
  labels: { one: 'chains.one', many: 'chains.many' },
  title: (row) => row.name,
  fields: [
    { kind: 'text', name: 'name', label: 'chains.name', required: true },
    {
      kind: 'number',
      name: 'shopCount',
      label: 'chains.shopCount',
      editable: false,
    },
  ],
  list: { columns: ['name'], compact: ['name'] },
  actions: {
    create: true,
    edit: true,
    named: () => [
      {
        // Asks first, and destroys nothing.
        name: 'audit',
        label: 'chains.audit',
        confirm: {
          heading: 'chains.audit.heading',
          body: 'chains.audit.body',
          confirm: 'chains.audit.confirm',
        },
        run: async () => {
          if (auditFails !== null) {
            throw auditFails;
          }
        },
      },
    ],
  },
  record: {
    sections: [{ title: 'chains.section.name', fields: ['name'] }],
    children: [
      { as: 'tab', resource: 'shops', by: 'chainId', count: 'shopCount' },
      {
        as: 'tab',
        name: 'notes',
        label: 'chains.tab.notes',
        component: NotesTab,
      },
      {
        as: 'panel',
        resource: 'shops',
        by: 'chainId',
        rows: 2,
        label: 'chains.panel.shops',
        empty: 'chains.panel.noShops',
        add: 'chains.panel.addShop',
      },
      {
        as: 'panel',
        name: 'facts',
        label: 'chains.panel.facts',
        component: FactsPanel,
      },
      {
        as: 'link',
        resource: 'shops',
        by: 'chainId',
        count: 'shopCount',
        label: 'chains.link.shops',
      },
      // The offers cannot be narrowed by chain, so this is no link.
      {
        as: 'link',
        resource: 'offers',
        by: 'chainId',
        label: 'chains.link.offers',
      },
    ],
    counts: () => () => held,
  },
  gateway: () => ({
    list: async () => ({ items: [], nextCursor: null }),
    read: (id) => {
      chainReads += 1;
      return server.chain(id);
    },
    create: async (input) => ({
      id: 'c_new',
      name: '',
      shopCount: 0,
      ...input,
    }),
    update: async (id, input) => ({
      ...(await server.chain(id)),
      ...input,
    }),
    remove: async () => undefined,
  }),
});

const SHOPS = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [
    { kind: 'text', name: 'name', label: 'shops.name' },
    {
      kind: 'reference',
      name: 'chainId',
      label: 'shops.chain',
      resource: 'chains',
    },
    { kind: 'number', name: 'itemCount', label: 'shops.items' },
  ],
  list: {
    columns: ['name'],
    compact: ['name'],
    brief: { trailing: 'itemCount' },
  },
  filters: [
    { kind: 'search', param: 'query', label: 'shops.filter.query' },
    {
      kind: 'reference',
      param: 'chainId',
      label: 'shops.filter.chain',
      resource: 'chains',
    },
  ],
  actions: { create: true, edit: true },
  gateway: () => ({
    list: (query) => {
      shopReads.push(query);
      return server.shops(query);
    },
    read: async (id) => ({ ...SHOP_ROWS[0], id }),
    create: async () => SHOP_ROWS[0],
    update: async () => SHOP_ROWS[0],
    remove: async () => undefined,
  }),
});

/** A resource whose list has no filter by chain. */
const OFFERS = defineResource<Shop>({
  ...(SHOPS as unknown as Parameters<typeof defineResource<Shop>>[0]),
  name: 'offers',
  segment: 'offers',
  filters: [],
});

@Component({ template: 'the list' })
class ListStub {}

async function mount(url: string, compact = false) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideSections({
        key: 'catalog',
        label: '',
        resources: [CHAINS, SHOPS, OFFERS],
      }),
      {
        provide: Viewport,
        useValue: { compact: signal(compact), split: signal(false) },
      },
      provideRouter([
        { path: 'chains', pathMatch: 'full', component: ListStub },
        recordRoute(CHAINS, { path: 'chains/new', mode: 'create' }),
        // By hand and not from `lists`: the rows of the shops open, and
        // their forms are mounted beside the record, below.
        recordRoute(CHAINS, {
          path: 'chains/:id',
          tabs: { shops: resourceTabRoute(SHOPS) },
        }),
        { path: 'shops', pathMatch: 'full', component: ListStub },
        resourceFormBranch(SHOPS),
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drawn(harness);
  return harness;
}

/** Lets a read or a navigation settle, then redraws. */
async function drawn(harness: RouterTestingHarness): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    harness.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  harness.detectChanges();
}

const url = () => TestBed.inject(Router).url;
const root = (harness: RouterTestingHarness) =>
  harness.fixture.nativeElement as HTMLElement;
const one = (harness: RouterTestingHarness, selector: string) =>
  root(harness).querySelector<HTMLElement>(selector);
const all = (harness: RouterTestingHarness, selector: string) =>
  Array.from(root(harness).querySelectorAll<HTMLElement>(selector));
const page = (harness: RouterTestingHarness): RecordPage =>
  harness.fixture.debugElement.query(By.directive(RecordPage))
    .componentInstance;
const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

async function press(
  harness: RouterTestingHarness,
  selector: string
): Promise<void> {
  const target = one(harness, selector);
  if (target === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  target.click();
  await drawn(harness);
}

/** The tabs under the header: the label of each, and its count. */
const tabs = (harness: RouterTestingHarness) =>
  all(harness, 'lib-page-tabs a').map((tab) => ({
    label: text(tab.firstElementChild ?? tab)?.split(' ')[0],
    count: text(tab.querySelector('.count')) ?? null,
    href: tab.getAttribute('href'),
  }));

beforeEach(() => {
  Object.assign(server, pristine);
  shopReads.length = 0;
  chainReads = 0;
  auditFails = null;
  held.set({ notes: 3 });
});

describe('the tabs of a record', () => {
  it('draws Details first, then each tab in the order of the children', async () => {
    const harness = await mount('/chains/c1');

    expect(tabs(harness).map((tab) => tab.href)).toEqual([
      '/chains/c1/details',
      '/chains/c1/shops',
      '/chains/c1/notes',
    ]);
    expect(text(one(harness, 'lib-page-tabs'))).toContain('record.tab.details');
    // A list is called what its resource calls many, and a part by its label.
    expect(text(one(harness, 'lib-page-tabs'))).toContain('shops.many');
    expect(text(one(harness, 'lib-page-tabs'))).toContain('chains.tab.notes');
  });

  it('opens the record on its first tab', async () => {
    await mount('/chains/c1');

    expect(url()).toBe('/chains/c1/details');
  });

  it('counts a tab from the field it names, then from what another read holds', async () => {
    const harness = await mount('/chains/c1');

    expect(tabs(harness).map((tab) => tab.count)).toEqual([null, '7', '3']);

    // The second source is a signal, so the tab follows it.
    held.set({ notes: 5 });
    await drawn(harness);
    expect(tabs(harness).map((tab) => tab.count)).toEqual([null, '7', '5']);

    // Nothing holds one: the label is drawn alone.
    held.set({});
    await drawn(harness);
    expect(tabs(harness).map((tab) => tab.count)).toEqual([null, '7', null]);
  });

  it('draws no tabs on a record that is gone', async () => {
    server.chain = async () => {
      throw Object.assign(new Error('gone'), {
        code: 'not_found',
        status: 404,
      });
    };
    const harness = await mount('/chains/c1');

    expect(one(harness, '[data-missing]')).not.toBeNull();
    expect(tabs(harness)).toEqual([]);
  });

  it('fixes a list tab to the record, and offers no control for that', async () => {
    const harness = await mount('/chains/c1/shops');
    const list: ResourceListPage = harness.fixture.debugElement.query(
      By.directive(ResourceListPage)
    ).componentInstance;

    expect(shopReads.at(-1)?.filters).toEqual({ chainId: 'c1' });
    expect(list.filters.map((filter) => filter.param)).toEqual(['query']);
    // The list is a tab: the page above it drew the header.
    expect(list.embed).toBe('tab');
  });

  it('hands the record to a part through RECORD_CONTEXT, and reads it again on reload', async () => {
    const harness = await mount('/chains/c1/notes');

    expect(text(one(harness, '[data-notes]'))).toBe('c1 Alcampo');

    const before = chainReads;
    server.chain = async (id) => ({ id, name: 'Renamed', shopCount: 9 });
    await press(harness, '[data-reload]');

    expect(chainReads).toBe(before + 1);
    expect(text(one(harness, '[data-notes]'))).toBe('c1 Renamed');
    expect(one(harness, 'h1')?.textContent).toBe('Renamed');
  });

  it('builds the tab again for another record', async () => {
    const harness = await mount('/chains/c1/notes');
    server.chain = async (id) => ({ id, name: `Chain ${id}`, shopCount: 1 });

    await TestBed.inject(Router).navigateByUrl('/chains/c2/notes');
    await drawn(harness);

    expect(text(one(harness, '[data-notes]'))).toBe('c2 Chain c2');
  });

  /**
   * The More menu is over every tab, so what it was refused is too (admin
   * plan 0057). Once, also on Details, where the view could say it again.
   */
  it.each(['notes', 'details'])(
    'says the refusal of an action above the tab %s',
    async (tab) => {
      auditFails = new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
      });
      const harness = await mount(`/chains/c1/${tab}`);

      await press(harness, '[data-action="audit"]');
      await press(harness, '[data-action-question] [data-confirm]');

      const said = all(harness, '[data-refusal]');
      expect(said).toHaveLength(1);
      expect(said[0].textContent).toContain('resource.error.conflict');
      // Above the tab, and the tab is still drawn.
      expect(
        said[0].compareDocumentPosition(one(harness, '.under') as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(url()).toBe(`/chains/c1/${tab}`);

      // The next action that goes through takes it away.
      auditFails = null;
      await press(harness, '[data-action="audit"]');
      await press(harness, '[data-action-question] [data-confirm]');

      expect(all(harness, '[data-refusal]')).toHaveLength(0);
    }
  );

  it('names the record in the heading of a question, and keeps red for an action that destroys', async () => {
    const harness = await mount('/chains/c1/notes');

    await press(harness, '[data-action="audit"]');

    const dialog = harness.fixture.debugElement.query(
      By.directive(ConfirmDialog)
    ).componentInstance as ConfirmDialog;
    expect(dialog.headingArgs()).toEqual({ name: 'Alcampo' });
    expect(dialog.bodyArgs()).toEqual({ name: 'Alcampo' });
    expect(dialog.tone()).toBe('primary');
    expect(
      one(harness, '[data-action-question] [data-confirm]')?.classList
    ).toContain('primary');
  });

  it('goes to Details for Edit, from whichever tab is open', async () => {
    const harness = await mount('/chains/c1/notes');

    await press(harness, '[data-edit]');

    expect(url()).toBe('/chains/c1/details');
    expect(page(harness).store().mode()).toBe('edit');
    // The tabs stay while the page is a form.
    expect(tabs(harness)).toHaveLength(3);
  });

  it('opens the form on Details for ?edit=1 on the record itself', async () => {
    const harness = await mount('/chains/c1?edit=1');

    expect(url()).toBe('/chains/c1/details');
    expect(page(harness).store().mode()).toBe('edit');
  });

  /**
   * The read answers when it answers: before the page is drawn, a turn
   * later as a gateway in memory does, or long after. One navigation opens
   * the form and takes the parameter out, so no order of the two can leave
   * `?edit=1` in the address, where a reload would open the form again.
   */
  it.each([
    ['at once', 0],
    ['a turn later', 1],
    ['after the page is drawn', 30],
  ])('leaves no ?edit=1 behind when the read answers %s', async (_, wait) => {
    const chain = server.chain;
    server.chain = async (id) => {
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      return chain(id);
    };

    const harness = await mount('/chains/c1?edit=1');
    await new Promise((resolve) => setTimeout(resolve, wait));
    await drawn(harness);

    expect(url()).toBe('/chains/c1/details');
    expect(page(harness).store().mode()).toBe('edit');
  });

  it('takes ?edit=1 out for a record that is not there, and opens no form', async () => {
    server.chain = async () => {
      throw new GatewayError({ code: 'not_found', status: 404 });
    };

    const harness = await mount('/chains/c1?edit=1');

    expect(url()).toBe('/chains/c1/details');
    expect(page(harness).store().mode()).toBe('read');
  });

  it('asks before another tab is opened over changes, and stays on "Stay here"', async () => {
    const harness = await mount('/chains/c1/details');
    await press(harness, '[data-edit]');
    page(harness).store().set('name', 'Alcampo SA');
    await drawn(harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/chains/c1/notes');
    await drawn(harness);

    expect(one(harness, '[data-leave]')).not.toBeNull();
    await press(harness, '[data-leave] [data-dismiss]');

    expect(await leaving).toBe(false);
    expect(url()).toBe('/chains/c1/details');
    expect(page(harness).store().draft()['name']).toBe('Alcampo SA');
  });

  it('leaves for the other tab and drops the draft on "Leave"', async () => {
    const harness = await mount('/chains/c1/details');
    await press(harness, '[data-edit]');
    page(harness).store().set('name', 'Alcampo SA');
    await drawn(harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/chains/c1/notes');
    await drawn(harness);
    await press(harness, '[data-leave] [data-confirm]');

    expect(await leaving).toBe(true);
    expect(url()).toBe('/chains/c1/notes');
    expect(page(harness).store().mode()).toBe('read');
  });

  it('closes a form with nothing changed when another tab is opened', async () => {
    const harness = await mount('/chains/c1/details');
    await press(harness, '[data-edit]');

    await TestBed.inject(Router).navigateByUrl('/chains/c1/notes');
    await drawn(harness);

    expect(one(harness, '[data-leave]')).toBeNull();
    expect(page(harness).store().mode()).toBe('read');
  });
});

describe('the panels of a record', () => {
  it('reads `rows` rows of the child, narrowed to the record', async () => {
    const harness = await mount('/chains/c1/details');

    expect(shopReads).toEqual([{ limit: 2, filters: { chainId: 'c1' } }]);
    expect(
      all(harness, 'lib-record-list-panel li .title').map((row) => text(row))
    ).toEqual(['Triana', 'Nervion']);
  });

  it('links each row to its own page, and ends it with the brief value', async () => {
    const harness = await mount('/chains/c1/details');
    const rows = all(harness, 'lib-record-list-panel li a');

    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/shops/s1',
      '/shops/s2',
    ]);
    // A number is said with what it counts. The testing translator answers
    // the key of that sentence.
    expect(text(rows[0].querySelector('.num'))).toBe(
      'record.collection.trailing'
    );
  });

  it('draws "See all" for a nextCursor, to the list narrowed to the record', async () => {
    server.shops = async () => ({ items: SHOP_ROWS, nextCursor: 'more' });
    const harness = await mount('/chains/c1/details');

    expect(one(harness, '[data-see-all]')?.getAttribute('href')).toBe(
      '/shops?chainId=c1'
    );
  });

  it('draws no "See all" when the read held every row', async () => {
    const harness = await mount('/chains/c1/details');

    expect(one(harness, '[data-see-all]')).toBeNull();
  });

  it('leads the button of `add` to the form, with `by` filled in', async () => {
    const harness = await mount('/chains/c1/details');
    const add = one(harness, 'lib-record-list-panel [data-add]');

    expect(text(add)).toBe('chains.panel.addShop');
    expect(add?.getAttribute('href')).toBe('/shops/new?chainId=c1');
  });

  it('says what the descriptor says when the record holds none', async () => {
    server.shops = async () => ({ items: [], nextCursor: null });
    const harness = await mount('/chains/c1/details');

    expect(
      text(one(harness, 'lib-record-list-panel [data-collection-empty]'))
    ).toBe('chains.panel.noShops');
  });

  it('fails alone, and reads again on "Try again"', async () => {
    server.shops = async () => {
      throw new Error('out');
    };
    const harness = await mount('/chains/c1/details');

    expect(one(harness, '[data-collection-error]')).not.toBeNull();
    // The rest of the page stays: the section, the other panel and the links.
    expect(text(one(harness, 'lib-record-section'))).toContain(
      'chains.section.name'
    );
    expect(one(harness, '[data-facts]')).not.toBeNull();
    expect(one(harness, '[data-links]')).not.toBeNull();

    server.shops = pristine.shops;
    await press(harness, '[data-collection-error] button');

    expect(one(harness, '[data-collection-error]')).toBeNull();
    expect(all(harness, 'lib-record-list-panel li')).toHaveLength(2);
  });

  it('reads again when something writes the resource of the child', async () => {
    const harness = await mount('/chains/c1/details');
    expect(shopReads).toHaveLength(1);

    TestBed.inject(ResourceChanges).wrote('shops');
    await drawn(harness);

    expect(shopReads).toHaveLength(2);
  });

  it('draws a part where the descriptor put it, and hands it the record', async () => {
    const harness = await mount('/chains/c1/details');

    expect(text(one(harness, '[data-facts]'))).toBe('c1');
    // After the panel of shops and before the links, as `children` says.
    const order = all(
      harness,
      'lib-record-list-panel, lib-test-facts-panel, [data-links]'
    ).map((element) => element.tagName.toLowerCase());
    expect(order).toEqual([
      'lib-record-list-panel',
      'lib-test-facts-panel',
      'section',
    ]);
  });

  it('stays in the page while the record is a form', async () => {
    const harness = await mount('/chains/c1/details');
    await press(harness, '[data-edit]');

    expect(all(harness, 'lib-record-list-panel li')).toHaveLength(2);
    expect(one(harness, '[data-links]')).not.toBeNull();
  });

  it('is one row that opens the list on a phone, and reads no row', async () => {
    const harness = await mount('/chains/c1/details', true);

    expect(one(harness, 'lib-record-list-panel')).toBeNull();
    expect(shopReads).toEqual([]);
    const rows = all(harness, '[data-links] lib-record-collection');
    expect(rows.map((row) => text(row.querySelector('.title')))).toEqual([
      'chains.panel.shops',
      'chains.link.shops',
      'chains.link.offers',
    ]);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe(
      '/shops?chainId=c1'
    );
  });
});

describe('the links of a record', () => {
  it('share one last panel, a row each', async () => {
    const harness = await mount('/chains/c1/details');

    expect(
      all(harness, '[data-links] lib-record-collection').map((row) =>
        text(row.querySelector('.title'))
      )
    ).toEqual(['chains.link.shops', 'chains.link.offers']);
  });

  it('leads to the list narrowed to the record, beside the count', async () => {
    const harness = await mount('/chains/c1/details');
    const link = all(harness, '[data-links] lib-record-collection')[0];

    expect(link.querySelector('a')?.getAttribute('href')).toBe(
      '/shops?chainId=c1'
    );
    expect(text(link.querySelector('[data-count]'))).toBe('7');
  });

  it('is a line and no link when the list cannot be narrowed', async () => {
    const harness = await mount('/chains/c1/details');
    const offers = all(harness, '[data-links] lib-record-collection')[1];

    expect(offers.querySelector('a')).toBeNull();
    expect(text(offers)).toBe('chains.link.offers');
  });

  it('says "None yet" for a count of 0', async () => {
    server.chain = async (id) => ({ id, name: 'Alcampo', shopCount: 0 });
    const harness = await mount('/chains/c1/details');
    const link = all(harness, '[data-links] lib-record-collection')[0];

    expect(link.querySelector('a')).toBeNull();
    expect(text(link)).toContain('record.collection.none');
  });
});

describe('a record that does not exist yet', () => {
  it('draws no tab, no panel and no link', async () => {
    const harness = await mount('/chains/new');

    expect(tabs(harness)).toEqual([]);
    expect(one(harness, 'lib-record-children')).toBeNull();
    expect(shopReads).toEqual([]);
  });

  it('opens on Details once it is added, where "added" is said', async () => {
    const harness = await mount('/chains/new');
    page(harness).store().set('name', 'Dia');
    await drawn(harness);
    await press(harness, 'lib-save-bar [data-save]');

    expect(url()).toBe('/chains/c_new/details');
    expect(one(harness, '[data-added]')).not.toBeNull();
  });
});
