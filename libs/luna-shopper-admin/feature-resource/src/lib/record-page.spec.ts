import { Location } from '@angular/common';
import {
  Component,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type NamedAction,
  type RecordChildList,
  type ResourceGateway,
  type ResourceInput,
  type ResourceRow,
  type RowState,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { provideSections } from './admin-section';
import { RecordPage } from './record-page';
import { RecordView } from './record-view';
import { ResourceChanges } from './resource-changes';
import { ResourceSplitPage } from './resource-split-page';
import { recordRoute, resourceFormBranch } from './routes';

/**
 * The record page, mounted through the real router (admin plan 0053, section
 * 2.3): where the app goes is half of what the page does, and the ID it reads
 * can be a parameter of a route above it.
 *
 * The gateway is one object the cases bend, so each says in its own lines
 * what the server answers.
 */

interface Line extends ResourceRow {
  id: string;
  plantId: string;
  name: string;
  kind: string;
}

const LINE: Line = { id: 'l1', plantId: 'p1', name: 'Bottling', kind: 'wet' };

const server = {
  /** What a read answers. A function, so a case can count or refuse. */
  read: async (id: string): Promise<ResourceRow> => ({ ...LINE, id }),
  create: async (input: ResourceInput): Promise<ResourceRow> => ({
    ...LINE,
    ...input,
    id: 'l_new',
  }),
  update: async (id: string, input: ResourceInput): Promise<ResourceRow> => ({
    ...LINE,
    ...input,
    id,
  }),
  remove: async (id: string): Promise<void> => void id,
};
const pristine = { ...server };

const creates: ResourceInput[] = [];
const updates: { id: string; input: ResourceInput }[] = [];
const removes: string[] = [];
const ran: string[] = [];

const linesGateway: ResourceGateway<ResourceRow> = {
  list: async () => ({ items: [], nextCursor: null }),
  read: (id) => server.read(id),
  create: (input) => {
    creates.push(input);
    return server.create(input);
  },
  update: (id, input) => {
    updates.push({ id, input });
    return server.update(id, input);
  },
  remove: (id) => {
    removes.push(id);
    return server.remove(id);
  },
};

const refusal = (
  code: string,
  status: number,
  details?: Record<string, unknown>
) => new GatewayError({ code, status, correlationId: '', details });

/** What the next named action does. */
let actionFails: GatewayError | null = null;

const NAMED: readonly NamedAction<ResourceRow>[] = [
  {
    name: 'retire',
    label: 'lines.retire',
    danger: true,
    after: 'leave',
    confirm: {
      heading: 'lines.retire.heading',
      body: 'lines.retire.body',
      confirm: 'lines.retire.confirm',
    },
    run: async (row) => void ran.push(`retire:${String(row['id'])}`),
  },
  {
    name: 'clean',
    label: 'lines.clean',
    run: async (row) => {
      if (actionFails !== null) {
        throw actionFails;
      }
      ran.push(`clean:${String(row['id'])}`);
    },
  },
  {
    name: 'dry',
    label: 'lines.dry',
    // Offered only to a line that is wet.
    available: (row) => row['kind'] === 'wet',
    run: async (row) => void ran.push(`dry:${String(row['id'])}`),
  },
];

const states = signal<readonly RowState[]>([
  { label: 'lines.state.running', tone: 'good' },
]);

const PLANTS = defineResource<{ id: string; name: string }>({
  name: 'plants',
  segment: 'plants',
  labels: { one: 'plants.one', many: 'plants.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'plants.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => ({
    ...linesGateway,
    read: async (id) => ({ id, name: 'Cordoba plant' }),
  }),
});

const LINES = defineResource<Line>({
  name: 'lines',
  segment: 'lines',
  labels: { one: 'lines.one', many: 'lines.many' },
  title: (row) => row.name,
  fields: [
    {
      kind: 'reference',
      name: 'plantId',
      label: 'lines.plant',
      resource: 'plants',
      required: true,
      editable: 'create',
    },
    { kind: 'text', name: 'name', label: 'lines.name', required: true },
    { kind: 'text', name: 'kind', label: 'lines.kind' },
  ],
  // A line says its kind under its name in a column.
  list: { columns: ['name'], compact: ['name'], brief: { line: ['kind'] } },
  parent: { resource: 'plants', param: 'plantId', filter: 'plantId' },
  info: { title: 'lines.info.title', points: ['lines.info.one'] },
  rowStates: () => () => states(),
  errorLinks: {
    line_in_use: {
      resource: 'plants',
      detail: 'plantId',
      label: 'lines.seeThePlant',
    },
  },
  actions: { create: true, edit: true, delete: true, named: () => NAMED },
  gateway: () => linesGateway,
});

/** The same lines, for a resource that goes back to the list after an add. */
const BATCHES = defineResource<Line>({
  ...(LINES as unknown as Parameters<typeof defineResource<Line>>[0]),
  name: 'batches',
  segment: 'batches',
  parent: undefined,
  record: { sections: [], afterAdd: 'list' },
  actions: { create: true, edit: true },
});

/** A resource with nothing to do to it: no Edit and no menu. */
const LOGS = defineResource<Line>({
  ...(LINES as unknown as Parameters<typeof defineResource<Line>>[0]),
  name: 'logs',
  segment: 'logs',
  parent: undefined,
  actions: {},
});

interface Depot extends ResourceRow {
  id: string;
  name: string;
  lineCount: number;
}

/** How many lines the server says a depot holds. A case changes it. */
let depotLines = 2;

/**
 * The counts of a depot that no field holds, as a later plan writes them:
 * asking writes a signal at once and starts a read that answers later.
 */
@Injectable({ providedIn: 'root' })
class DepotCounts {
  readonly asked = signal<readonly string[]>([]);

  readonly of = (id: string): Signal<Record<string, number | null>> => {
    const held = signal<Record<string, number | null>>({});
    this.asked.update((ids) => [...ids, id]);
    void Promise.resolve().then(() => held.set({ logs: 7 }));
    return held.asReadonly();
  };
}

const DEPOT_LINES: RecordChildList<Depot> = {
  as: 'link',
  resource: 'lines',
  by: 'plantId',
  count: 'lineCount',
};
const DEPOT_LOGS: RecordChildList<Depot> = {
  as: 'link',
  resource: 'logs',
  by: 'plantId',
};

/** A record that holds two lists: one counted by a field, one by a read. */
const DEPOTS = defineResource<Depot>({
  name: 'depots',
  segment: 'depots',
  labels: { one: 'depots.one', many: 'depots.many' },
  title: (row) => row.name,
  fields: [
    { kind: 'text', name: 'name', label: 'depots.name' },
    { kind: 'number', name: 'lineCount', label: 'depots.lines' },
  ],
  list: { columns: ['name'], compact: ['name'] },
  record: {
    sections: [],
    children: [DEPOT_LINES, DEPOT_LOGS],
    counts: () => inject(DepotCounts).of,
  },
  actions: { edit: true },
  gateway: () => ({
    ...linesGateway,
    read: async (id) => ({ id, name: 'North depot', lineCount: depotLines }),
  }),
});

@Component({ template: 'the list' })
class ListStub {}

/**
 * The page the lines are under. It has a component, and that is the point.
 *
 * It also stands in for the split whose column lists the lines: a record
 * page asks the split above it which resource that column lists.
 */
@Component({
  imports: [RouterOutlet],
  template: '<router-outlet />',
  providers: [{ provide: ResourceSplitPage, useValue: { descriptor: LINES } }],
})
class PlantPage {}

interface Mounted {
  readonly harness: RouterTestingHarness;
  readonly page: RecordPage;
  readonly view: RecordView | null;
  readonly element: HTMLElement;
}

async function mount(
  url: string,
  compact = false,
  split = false
): Promise<Mounted> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideSections({
        key: 'plants',
        label: '',
        held: [PLANTS, LINES, BATCHES, LOGS, DEPOTS],
      }),
      {
        provide: Viewport,
        useValue: { compact: signal(compact), split: signal(split) },
      },
      provideRouter([
        {
          path: 'plants/:plantId',
          component: PlantPage,
          children: [
            { path: 'lines', pathMatch: 'full', component: ListStub },
            resourceFormBranch(LINES),
            // The plant's own record as a tab of its page: the ID is the
            // page's parameter, under the page's name for it.
            recordRoute(PLANTS, { path: 'details', idFrom: 'plantId' }),
          ],
        },
        { path: 'lines', pathMatch: 'full', component: ListStub },
        resourceFormBranch(LINES),
        { path: 'batches', pathMatch: 'full', component: ListStub },
        resourceFormBranch(BATCHES),
        { path: 'logs', pathMatch: 'full', component: ListStub },
        recordRoute(LOGS, { path: 'logs/:id' }),
        recordRoute(DEPOTS, { path: 'depots/:id' }),
        // A page that gives way to what is open under its `inside` route.
        {
          ...recordRoute(LOGS, { path: 'yards/:id', yieldsTo: 'inside' }),
          children: [
            {
              path: 'inside',
              component: PlantPage,
              children: [{ path: ':shed', component: ListStub }],
            },
            { path: 'beside', component: ListStub },
          ],
        },
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drawn(harness);
  return at(harness);
}

/** The page the outlet holds now. A navigation can have made another one. */
function at(harness: RouterTestingHarness): Mounted {
  const page = harness.fixture.debugElement.query(By.directive(RecordPage));
  const view = harness.fixture.debugElement.query(By.directive(RecordView));
  return {
    harness,
    page: page?.componentInstance,
    view: view?.componentInstance ?? null,
    element: harness.fixture.nativeElement as HTMLElement,
  };
}

/** Lets a read, a write or a navigation settle, then redraws. */
async function drawn(harness: RouterTestingHarness): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    harness.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  harness.detectChanges();
}

const url = () => TestBed.inject(Router).url;
const one = <T extends HTMLElement = HTMLElement>(
  mounted: Mounted,
  selector: string
) => mounted.element.querySelector<T>(selector);
const all = (mounted: Mounted, selector: string) =>
  Array.from(mounted.element.querySelectorAll<HTMLElement>(selector));
const chips = (mounted: Mounted) =>
  all(mounted, '.page-chips .chip').map((chip) => chip.textContent?.trim());
const menu = (mounted: Mounted) =>
  all(mounted, '.page-more-items button').map((item) =>
    item.textContent?.trim()
  );

async function press(mounted: Mounted, selector: string): Promise<void> {
  const target = one(mounted, selector);
  if (target === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  target.click();
  await drawn(mounted.harness);
}

beforeEach(() => {
  Object.assign(server, pristine);
  creates.length = 0;
  updates.length = 0;
  removes.length = 0;
  ran.length = 0;
  actionFails = null;
  depotLines = 2;
  states.set([{ label: 'lines.state.running', tone: 'good' }]);
});

describe('RecordPage, the header', () => {
  it('reads: the name, the states of the row, the info button, Edit and More', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    expect(one(mounted, 'h1')?.textContent).toBe('Bottling');
    expect(chips(mounted)).toEqual(['lines.state.running']);
    expect(one(mounted, '.page-chips .chip')?.classList).toContain('good');
    expect(one(mounted, 'lib-info-button')).not.toBeNull();
    expect(one(mounted, '[data-edit]')?.textContent).toContain(
      'resource.action.edit'
    );
    expect(one(mounted, '.page-overflow-toggle')).not.toBeNull();
  });

  /** The way back names the list, and is a link: the guard is what asks. */
  it('leads back to the list, by a link that names it', async () => {
    const mounted = await mount('/lines/l1');
    const back = one<HTMLAnchorElement>(mounted, 'a.page-back');

    expect(back?.getAttribute('aria-label')).toBe('lines.many');
    expect(back?.getAttribute('href')).toBe('/lines');
  });

  /** "Back to Cordoba plant": the testing translator answers the key. */
  it('names the parent row in the way back of a record under one', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    const back = one<HTMLAnchorElement>(mounted, 'a.page-back');

    expect(back?.getAttribute('aria-label')).toBe('record.back');
    expect(back?.getAttribute('href')).toBe('/plants/p1/lines');
  });

  it('writes the line the row has in a column under the heading', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    expect(one(mounted, '.page-subtitle')?.textContent).toBe('wet');
  });

  it('writes no line for a descriptor that states none, or a row with none', async () => {
    expect(one(await mount('/depots/d1'), '.page-subtitle')).toBeNull();

    server.read = async (id) => ({ ...LINE, id, kind: '' });
    expect(
      one(await mount('/plants/p1/lines/l1'), '.page-subtitle')
    ).toBeNull();
  });

  it('writes no line on the page that adds a record', async () => {
    const mounted = await mount('/plants/p1/lines/new');

    expect(one(mounted, '.page-subtitle')).toBeNull();
  });

  it('changes: the same name, "Editing", and neither Edit nor More', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-edit]');

    expect(one(mounted, 'h1')?.textContent).toBe('Bottling');
    expect(chips(mounted)).toEqual(['record.state.editing']);
    expect(one(mounted, 'lib-info-button')).not.toBeNull();
    expect(one(mounted, '[data-edit]')).toBeNull();
    expect(menu(mounted)).toEqual([]);
    expect(one(mounted, 'lib-save-bar')).not.toBeNull();
  });

  it('adds: "New" with the noun, no state, and neither Edit nor More', async () => {
    const mounted = await mount('/plants/p1/lines/new');

    expect(one(mounted, 'h1')?.textContent).toBe('resource.form.create');
    expect(chips(mounted)).toEqual([]);
    expect(one(mounted, 'lib-info-button')).not.toBeNull();
    expect(one(mounted, '[data-edit]')).toBeNull();
    expect(menu(mounted)).toEqual([]);
  });

  /** "Edit" needs the action and a field the form could change. */
  /** A title of nothing, or of spaces, would leave the header empty. */
  it.each(['', '   '])(
    'calls a record whose title is "%s" by its noun',
    async (name) => {
      server.read = async (id) => ({ ...LINE, id, name });

      const mounted = await mount('/plants/p1/lines/l1');

      // The testing translator answers the key.
      expect(mounted.page.title()).toBe('record.unnamed');
      expect(one(mounted, 'h1')?.textContent).toBe('record.unnamed');
      expect(mounted.page.leaveArgs().name).toBe('record.unnamed');
    }
  );

  it('offers no Edit for a resource that cannot be changed', async () => {
    const mounted = await mount('/logs/l1');

    expect(one(mounted, 'h1')?.textContent).toBe('Bottling');
    expect(one(mounted, '[data-edit]')).toBeNull();
  });
});

describe('RecordPage, as a pane of a split', () => {
  /** The column beside the pane is the way back. */
  it('draws no way back beside the column that lists its rows', async () => {
    const mounted = await mount('/plants/p1/lines/l1', false, true);

    expect(one(mounted, '.page-back')).toBeNull();
    expect(one(mounted, 'h1')?.textContent).toBe('Bottling');
  });

  it('draws the way back when the split shows one pane', async () => {
    const mounted = await mount('/plants/p1/lines/l1', false, false);

    expect(one(mounted, 'a.page-back')).not.toBeNull();
  });

  it('draws the way back on a wide screen when no split holds the page', async () => {
    const mounted = await mount('/lines/l1', false, true);

    expect(one(mounted, 'a.page-back')).not.toBeNull();
  });

  /**
   * The column lists the lines. A plant in the same outlet is a page of its
   * own, and nothing but its own link leads back from it.
   */
  it('draws the way back of a record of another resource inside the split', async () => {
    const mounted = await mount('/plants/p1/details', false, true);

    expect(one(mounted, 'h1')?.textContent).toBe('Cordoba plant');
    expect(one(mounted, 'a.page-back')).not.toBeNull();
  });
});

describe('RecordPage, a record under the wrong parent', () => {
  /** A record is read by its own ID, so the address can name any parent. */
  it('goes to the address of the parent the row names, and adds no step back', async () => {
    const mounted = await mount('/plants/p9/lines/l1');
    const location = TestBed.inject(Location);

    expect(url()).toBe('/plants/p1/lines/l1');
    expect(one(at(mounted.harness), 'h1')?.textContent).toBe('Bottling');
    // The wrong address was replaced: one step back leaves the record.
    location.back();
    await drawn(mounted.harness);
    expect(url()).not.toBe('/plants/p9/lines/l1');
  });

  /** Another screen asked for the form, and the wrong address still gets it. */
  it('keeps what the address asked for, so the form opens at the right address', async () => {
    const mounted = await mount('/plants/p9/lines/l1?edit=1');
    await drawn(mounted.harness);

    expect(url()).toBe('/plants/p1/lines/l1');
    expect(at(mounted.harness).page.store().mode()).toBe('edit');
  });

  it('stays where the address and the row name the same parent', async () => {
    await mount('/plants/p1/lines/l1');

    expect(url()).toBe('/plants/p1/lines/l1');
  });

  it('stays where the address names no parent, or the row names none', async () => {
    await mount('/lines/l1');
    expect(url()).toBe('/lines/l1');

    server.read = async (id) => ({ ...LINE, id, plantId: '' });
    await mount('/plants/p9/lines/l1');
    expect(url()).toBe('/plants/p9/lines/l1');
  });
});

describe('RecordPage, a page that gives way to its child', () => {
  const yields = (mounted: Mounted) =>
    one(mounted, '.head')?.classList.contains('yields');

  it('gives way while a route under the named child is open', async () => {
    const mounted = await mount('/yards/y1/inside/s1');

    expect(yields(mounted)).toBe(true);
    // The header is taken away by a rule of the style sheet, below 72 rem
    // only, so the page is one page at every width.
    expect(one(mounted, '.head lib-page-header')).not.toBeNull();
  });

  it('does not give way to the child itself, or to another child', async () => {
    expect(yields(await mount('/yards/y1/inside'))).toBe(false);
    expect(yields(await mount('/yards/y1/beside'))).toBe(false);
  });

  it('follows the address', async () => {
    const mounted = await mount('/yards/y1/inside');

    await TestBed.inject(Router).navigateByUrl('/yards/y1/inside/s1');
    await drawn(mounted.harness);
    expect(yields(mounted)).toBe(true);

    await TestBed.inject(Router).navigateByUrl('/yards/y1/inside');
    await drawn(mounted.harness);
    expect(yields(mounted)).toBe(false);
  });

  /**
   * A record that is gone draws no outlet, so its child is not drawn. Its
   * header is then all there is on the page, and it stays.
   */
  it('keeps its header while the record is gone, whatever is open under it', async () => {
    server.read = async () => {
      throw refusal('not_found', 404);
    };
    const mounted = await mount('/yards/y1/inside/s1');

    expect(mounted.page.yielded()).toBe(true);
    expect(mounted.page.givesWay()).toBe(false);
    expect(yields(mounted)).toBe(false);
  });

  it('never gives way on a route that names no child', async () => {
    expect(yields(await mount('/plants/p1/lines/l1'))).toBe(false);
  });
});

describe('RecordPage, opened as a form by the address', () => {
  it('opens the form for `?edit=1`, and takes the parameter out at once', async () => {
    const mounted = await mount('/plants/p1/lines/l1?edit=1');

    expect(mounted.page.store().mode()).toBe('edit');
    expect(one(mounted, 'lib-save-bar')).not.toBeNull();
    expect(url()).toBe('/plants/p1/lines/l1');
  });

  /** The mode is a state of the page and not of the address. */
  it('reads without it', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    expect(mounted.page.store().mode()).toBe('read');
  });

  it('does not open a form the resource does not offer', async () => {
    const mounted = await mount('/logs/l1?edit=1');

    expect(mounted.page.store().mode()).toBe('read');
    expect(url()).toBe('/logs/l1');
  });
});

describe('RecordPage, after a save', () => {
  it('stays and reads after a change, and tells whoever shows the resource', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    const changes = TestBed.inject(ResourceChanges);
    let reads = 0;
    const read = server.read;
    server.read = (id) => {
      reads += 1;
      return read(id);
    };

    await press(mounted, '[data-edit]');
    mounted.page.store().set('name', 'Capping');
    await mounted.view?.save();
    await drawn(mounted.harness);

    expect(updates).toEqual([{ id: 'l1', input: { name: 'Capping' } }]);
    expect(changes.version('lines')).toBe(1);
    expect(changes.version('plants')).toBe(0);
    expect(url()).toBe('/plants/p1/lines/l1');
    expect(mounted.page.store().mode()).toBe('read');
    expect(one(mounted, 'h1')?.textContent).toBe('Capping');
    expect(one(mounted, '[data-saved]')).not.toBeNull();
    // Its own write is not news to it: the saved row is the answer it holds.
    expect(reads).toBe(0);
  });

  /**
   * The operator left while the save was on its way. The view is gone and
   * can say nothing, and the list they are on still has to read again.
   */
  it('tells whoever shows the resource about a save that answers after the page is gone', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    const changes = TestBed.inject(ResourceChanges);
    let release: () => void = () => undefined;
    const update = server.update;
    server.update = async (id, input) => {
      await new Promise<void>((resolve) => (release = resolve));
      return update(id, input);
    };

    await press(mounted, '[data-edit]');
    mounted.page.store().set('name', 'Capping');
    const saving = mounted.view?.save();
    await drawn(mounted.harness);

    const leaving = TestBed.inject(Router).navigateByUrl('/plants/p1/lines');
    await drawn(mounted.harness);
    one(mounted, '[data-leave] [data-confirm]')?.click();
    expect(await leaving).toBe(true);
    await drawn(mounted.harness);
    expect(at(mounted.harness).page).toBeUndefined();

    release();
    await expect(saving).resolves.toBeUndefined();

    expect(updates).toHaveLength(1);
    expect(changes.version('lines')).toBe(1);
    expect(url()).toBe('/plants/p1/lines');
  });

  it('tells whoever shows the resource once, and not twice', async () => {
    const mounted = await mount('/plants/p1/lines/new');
    const changes = TestBed.inject(ResourceChanges);

    mounted.page.store().set('name', 'Capping');
    await mounted.view?.save();
    await drawn(mounted.harness);

    expect(changes.version('lines')).toBe(1);
  });

  it('opens the new record after an add, and says so once', async () => {
    const mounted = await mount('/plants/p1/lines/new');
    const changes = TestBed.inject(ResourceChanges);

    mounted.page.store().set('name', 'Labelling');
    await mounted.view?.save();
    await drawn(mounted.harness);

    expect(creates).toEqual([{ plantId: 'p1', name: 'Labelling' }]);
    expect(changes.version('lines')).toBe(1);
    expect(url()).toBe('/plants/p1/lines/l_new');

    const opened = at(mounted.harness);
    expect(opened.page.store().mode()).toBe('read');
    expect(one(opened, '[data-added]')?.textContent).toContain('record.added');

    // The line belongs to the navigation that brought the record. The entry
    // of the history no longer says it, so a reload does not say it again.
    expect(
      (TestBed.inject(Location).getState() as Record<string, unknown>)['added']
    ).toBeUndefined();

    // And another record of the same route does not inherit it.
    await TestBed.inject(Router).navigateByUrl('/plants/p1/lines/l1');
    await drawn(mounted.harness);
    expect(one(at(mounted.harness), '[data-added]')).toBeNull();
  });

  it('leads to the page that adds from "Add another"', async () => {
    const mounted = await mount('/plants/p1/lines/new');
    mounted.page.store().set('name', 'Labelling');
    await mounted.view?.save();
    await drawn(mounted.harness);

    await press(at(mounted.harness), '[data-added] button');

    expect(url()).toBe('/plants/p1/lines/new');
    expect(at(mounted.harness).page.store().mode()).toBe('create');
  });

  it('goes back to the list for a resource that says so', async () => {
    const mounted = await mount('/batches/new');

    mounted.page.store().set('plantId', 'p1');
    mounted.page.store().set('name', 'Monday');
    await mounted.view?.save();
    await drawn(mounted.harness);

    expect(creates).toHaveLength(1);
    expect(url()).toBe('/batches');
  });

  it('writes nothing and goes nowhere when the save was refused', async () => {
    const mounted = await mount('/plants/p1/lines/new');
    const changes = TestBed.inject(ResourceChanges);

    // A required field left empty: the store refuses before the gateway.
    await mounted.view?.save();
    await drawn(mounted.harness);

    expect(creates).toEqual([]);
    expect(changes.version('lines')).toBe(0);
    expect(url()).toBe('/plants/p1/lines/new');
  });
});

describe('RecordPage, a record under a parent row', () => {
  /** A row made under a plant belongs to it, and the address already says so. */
  it('fills in the parent the address names, and calls that no change', async () => {
    const mounted = await mount('/plants/p1/lines/new');

    expect(mounted.page.store().draft()['plantId']).toBe('p1');
    expect(mounted.page.dirty()).toBe(false);
    expect(
      one(mounted, 'lib-locked-value [data-reason]')?.textContent
    ).toContain('record.locked.fromAddress');
    expect(one(mounted, '#record-field-plantId')).toBeNull();
  });

  /** The address wins over a query string that names another parent. */
  it('does not let a query parameter name a different parent', async () => {
    const mounted = await mount('/plants/p1/lines/new?plantId=p9');

    expect(mounted.page.store().draft()['plantId']).toBe('p1');
  });

  it('fills in the fields a caller named in the query string', async () => {
    const mounted = await mount('/lines/new?plantId=p9&kind=dry&nothing=x');

    expect(mounted.page.store().draft()).toEqual({
      plantId: 'p9',
      name: '',
      kind: 'dry',
    });
    // With no parent in the address, the page asks for it.
    expect(one(mounted, '#record-field-plantId')).not.toBeNull();
  });

  it('reads the ID from the route above, under the name the route gives', async () => {
    const mounted = await mount('/plants/p7/details');

    expect(mounted.page.store().row()).toEqual({
      id: 'p7',
      name: 'Cordoba plant',
    });
    expect(one(mounted, 'h1')?.textContent).toBe('Cordoba plant');
  });
});

describe('RecordPage, where the focus goes', () => {
  /** The button that was pressed leaves the page with the press. */
  it('puts it on the first control of the form after "Edit"', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    one(mounted, '[data-edit]')?.focus();
    await press(mounted, '[data-edit]');

    expect(one(mounted, '[data-edit]')).toBeNull();
    // The plant is fixed once the line exists, so the name is the first.
    expect(document.activeElement?.id).toBe('record-field-name');
  });

  /** The bar leaves the page with the save. */
  it('puts it on the heading after a save', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    await press(mounted, '[data-edit]');
    mounted.page.store().set('name', 'Capping');
    await drawn(mounted.harness);

    await press(mounted, 'lib-save-bar [data-save]');

    const heading = one(mounted, 'h1');
    expect(heading?.textContent).toBe('Capping');
    expect(document.activeElement).toBe(heading);
    // Reachable by a script, and not a stop of the Tab key.
    expect(heading?.getAttribute('tabindex')).toBe('-1');
  });

  it('leaves it alone when the save was refused', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    server.update = () => Promise.reject(refusal('conflict', 409));
    await press(mounted, '[data-edit]');
    mounted.page.store().set('name', 'Capping');
    await drawn(mounted.harness);

    await press(mounted, 'lib-save-bar [data-save]');

    expect(document.activeElement).not.toBe(one(mounted, 'h1'));
  });
});

describe('RecordPage, the states of the page', () => {
  it('loading: the header and the frame at once, and only the values wait', async () => {
    server.read = () => new Promise(() => undefined);
    const mounted = await mount('/plants/p1/lines/l1');

    expect(one(mounted, '.page-titles')?.classList).toContain('pending');
    expect(one(mounted, 'h1')?.textContent).toBe('record.state.loading');
    expect(one(mounted, 'a.page-back')).not.toBeNull();
    expect(all(mounted, '.sections [data-loading]')).toHaveLength(3);
    expect(one(mounted, '.body')?.getAttribute('aria-busy')).toBe('true');
    expect(one(mounted, 'p[role="status"]')?.textContent).toContain(
      'record.state.loading'
    );
    expect(one(mounted, '[data-edit]')).toBeNull();
  });

  it('not found: says so, and offers the list', async () => {
    server.read = () => Promise.reject(refusal('not_found', 404));
    const mounted = await mount('/plants/p1/lines/l404');

    expect(one(mounted, 'h1')?.textContent).toBe(
      'record.state.missing.heading'
    );
    expect(one(mounted, '[data-missing] p')?.textContent).toContain(
      'record.state.missing.body'
    );
    expect(one(mounted, '[data-missing] a')?.getAttribute('href')).toBe(
      '/plants/p1/lines'
    );
    // Never an empty record.
    expect(one(mounted, 'lib-record-view')).toBeNull();
    expect(one(mounted, '[data-no-answer]')).toBeNull();
  });

  /** A read that failed is never drawn as "not found". */
  it('no answer: one refused line and "Try again", and no section', async () => {
    let answers = false;
    server.read = (id) =>
      answers ? pristine.read(id) : Promise.reject(refusal('', 0));
    const mounted = await mount('/plants/p1/lines/l1');

    const line = one(mounted, '[data-no-answer]');
    expect(line?.getAttribute('role')).toBe('alert');
    expect(line?.textContent).toContain('record.state.noAnswer');
    expect(one(mounted, '[data-missing]')).toBeNull();
    expect(one(mounted, 'lib-record-view')).toBeNull();
    expect(one(mounted, 'lib-record-section')).toBeNull();

    answers = true;
    await press(mounted, '[data-no-answer] button');

    expect(one(mounted, 'h1')?.textContent).toBe('Bottling');
    expect(one(mounted, 'lib-record-view')).not.toBeNull();
  });

  it('says the sentence of a refusal that is not a silence', async () => {
    server.read = () => Promise.reject(refusal('forbidden', 403));
    const mounted = await mount('/plants/p1/lines/l1');

    expect(one(mounted, '[data-no-answer]')?.textContent).toContain(
      'resource.error.forbidden'
    );
  });

  it('nothing yet: an empty value reads "None"', async () => {
    server.read = async (id) => ({ ...LINE, id, kind: '' });
    const mounted = await mount('/plants/p1/lines/l1');

    expect(one(mounted, '.sections [data-none]')).not.toBeNull();
  });
});

describe('RecordPage, the More menu', () => {
  it('holds the named actions, then the ones that destroy, then the delete', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    expect(menu(mounted)).toEqual([
      'lines.clean',
      'lines.dry',
      'lines.retire',
      'record.delete.action',
    ]);
    expect(
      all(mounted, '.page-more-danger button').map((item) =>
        item.textContent?.trim()
      )
    ).toEqual(['lines.retire', 'record.delete.action']);
    expect(one(mounted, '[data-delete] lib-trash-icon')).not.toBeNull();
    expect(
      one(mounted, '.page-overflow-toggle')?.getAttribute('aria-label')
    ).toBe('record.more');
  });

  it('leaves out an action this record cannot have done to it', async () => {
    server.read = async (id) => ({ ...LINE, id, kind: 'dry' });
    const mounted = await mount('/plants/p1/lines/l1');

    expect(menu(mounted)).not.toContain('lines.dry');
  });

  it('draws no entry for a resource with nothing to do', async () => {
    const mounted = await mount('/logs/l1');

    expect(menu(mounted)).toEqual([]);
  });

  it('runs an action with no question on the press, and reads again', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    let reads = 0;
    server.read = async (id) => {
      reads += 1;
      return { ...LINE, id, name: 'Cleaned' };
    };

    await press(mounted, '[data-action="clean"]');

    expect(ran).toEqual(['clean:l1']);
    expect(reads).toBe(1);
    expect(one(mounted, 'h1')?.textContent).toBe('Cleaned');
    expect(TestBed.inject(ResourceChanges).version('lines')).toBe(1);
    expect(url()).toBe('/plants/p1/lines/l1');
  });

  it('draws the refusal of an action above the first section', async () => {
    actionFails = refusal('conflict', 409);
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-action="clean"]');

    expect(ran).toEqual([]);
    expect(one(mounted, '[data-refusal]')?.textContent).toContain(
      'resource.error.conflict'
    );
    expect(TestBed.inject(ResourceChanges).version('lines')).toBe(0);
  });
});

describe('RecordPage, the questions', () => {
  it('asks before a named action that says so, with its own words', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-action="retire"]');

    const dialog = one(mounted, '[data-action-question]');
    expect(dialog?.querySelector('h2')?.textContent).toContain(
      'lines.retire.heading'
    );
    expect(dialog?.querySelector('p')?.textContent).toContain(
      'lines.retire.body'
    );
    expect(dialog?.querySelector('[data-confirm]')?.textContent).toContain(
      'lines.retire.confirm'
    );
    // The action says `danger`, so the button that goes through is red.
    expect(dialog?.querySelector('[data-confirm]')?.classList).toContain(
      'danger'
    );
    expect(ran).toEqual([]);

    // Dismissed, nothing ran.
    await press(mounted, '[data-action-question] [data-dismiss]');
    expect(ran).toEqual([]);
    expect(one(mounted, '[data-action-question]')).toBeNull();
  });

  /** After such an action the record is gone, so the app goes to the list. */
  it('goes to the list after an action that says `leave`', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-action="retire"]');
    await press(mounted, '[data-action-question] [data-confirm]');

    expect(ran).toEqual(['retire:l1']);
    expect(url()).toBe('/plants/p1/lines');
    expect(TestBed.inject(ResourceChanges).version('lines')).toBe(1);
  });

  it('asks before a delete, names the record, and keeps it on "Keep it"', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-delete]');

    const dialog = one(mounted, '[data-delete-question]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toContain(
      'record.delete.heading'
    );
    expect(dialog.querySelector('p')?.textContent).toContain(
      'record.delete.body'
    );
    // "Keep it" first, then the button that deletes.
    expect(
      Array.from(dialog.querySelectorAll('.controls button')).map((button) =>
        button.textContent?.trim()
      )
    ).toEqual(['record.delete.keep', 'record.delete.confirm']);

    await press(mounted, '[data-delete-question] [data-dismiss]');

    expect(removes).toEqual([]);
    expect(one(mounted, '[data-delete-question]')).toBeNull();
    expect(url()).toBe('/plants/p1/lines/l1');
  });

  it('deletes once confirmed, tells the lists, and goes to the list', async () => {
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-delete]');
    await press(mounted, '[data-delete-question] [data-confirm]');

    expect(removes).toEqual(['l1']);
    expect(TestBed.inject(ResourceChanges).version('lines')).toBe(1);
    expect(url()).toBe('/plants/p1/lines');
  });

  it('says why a delete was refused, with the link the resource declared', async () => {
    server.remove = () =>
      Promise.reject(refusal('line_in_use', 409, { plantId: 'p4' }));
    const mounted = await mount('/plants/p1/lines/l1');

    await press(mounted, '[data-delete]');
    await press(mounted, '[data-delete-question] [data-confirm]');

    const dialog = one(mounted, '[data-delete-refused]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toContain(
      'record.delete.refused'
    );
    expect(dialog.querySelector('p')?.textContent).toContain(
      'resource.error.conflict'
    );
    expect(dialog.querySelector('a')?.textContent?.trim()).toBe(
      'lines.seeThePlant'
    );
    expect(dialog.querySelector('a')?.getAttribute('href')).toBe('/plants/p4');
    // One way out, and it says "Close".
    expect(
      Array.from(dialog.querySelectorAll('.controls button')).map((button) =>
        button.textContent?.trim()
      )
    ).toEqual(['record.delete.close']);
    // Still the record, still reading, and no line above the sections.
    expect(url()).toBe('/plants/p1/lines/l1');
    expect(one(mounted, '[data-refusal]')).toBeNull();
    expect(TestBed.inject(ResourceChanges).version('lines')).toBe(0);

    await press(mounted, '[data-delete-refused] [data-confirm]');
    expect(one(mounted, '[data-delete-refused]')).toBeNull();
  });

  /** One press can throw away thirty fields. */
  it('asks before Cancel throws changes away, and goes back to reading', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    await press(mounted, '[data-edit]');
    mounted.page.store().set('name', 'Capping');
    await drawn(mounted.harness);

    await press(mounted, 'lib-save-bar [data-cancel]');

    const dialog = one(mounted, '[data-leave]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toContain(
      'resource.confirm.discard.heading'
    );
    expect(dialog.querySelector('p')?.textContent).toContain(
      'record.leave.body'
    );
    expect(dialog.querySelector('[data-confirm]')?.textContent).toContain(
      'resource.confirm.discard.confirm'
    );
    // "Stay here" is the primary button, and it has the focus.
    const stay = dialog.querySelector('[data-dismiss]') as HTMLElement;
    expect(stay.textContent).toContain('record.leave.stay');
    expect(stay.classList).toContain('primary');
    expect(document.activeElement).toBe(stay);

    await press(mounted, '[data-leave] [data-dismiss]');
    expect(mounted.page.store().mode()).toBe('edit');
    expect(mounted.page.store().draft()['name']).toBe('Capping');

    await press(mounted, 'lib-save-bar [data-cancel]');
    await press(mounted, '[data-leave] [data-confirm]');
    expect(mounted.page.store().mode()).toBe('read');
    expect(one(mounted, 'h1')?.textContent).toBe('Bottling');
    expect(updates).toEqual([]);
  });

  it('cancels at once when nothing changed', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    await press(mounted, '[data-edit]');

    await press(mounted, 'lib-save-bar [data-cancel]');

    expect(one(mounted, '[data-leave]')).toBeNull();
    expect(mounted.page.store().mode()).toBe('read');
  });

  /** A record that does not exist has no reading mode: Cancel is the way out. */
  it('goes to the list from the Cancel of a new record', async () => {
    const mounted = await mount('/plants/p1/lines/new');

    await press(mounted, 'lib-save-bar [data-cancel]');

    expect(url()).toBe('/plants/p1/lines');
  });
});

describe('RecordPage, a record another screen wrote', () => {
  it('reads again while it reads', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    server.read = async (id) => ({ ...LINE, id, name: 'Renamed elsewhere' });

    TestBed.inject(ResourceChanges).wrote('lines');
    await drawn(mounted.harness);

    expect(one(mounted, 'h1')?.textContent).toBe('Renamed elsewhere');
  });

  /** A form is never read again under the operator. */
  it('waits while it is a form, and catches up when it reads again', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    let reads = 0;
    server.read = async (id) => {
      reads += 1;
      return { ...LINE, id, name: 'Renamed elsewhere' };
    };
    await press(mounted, '[data-edit]');

    TestBed.inject(ResourceChanges).wrote('lines');
    await drawn(mounted.harness);
    expect(reads).toBe(0);
    expect(mounted.page.store().draft()['name']).toBe('Bottling');

    await press(mounted, 'lib-save-bar [data-cancel]');
    expect(reads).toBe(1);
    expect(one(mounted, 'h1')?.textContent).toBe('Renamed elsewhere');
  });
});

describe('RecordPage, the counts no field of the record holds', () => {
  /**
   * Asking for them writes a signal and starts a read. Inside a `computed`
   * that is NG0600, so the page asks once as the record opens.
   */
  it('asks once as the record opens, and draws what arrives later', async () => {
    const mounted = await mount('/depots/d1');

    expect(TestBed.inject(DepotCounts).asked()).toEqual(['d1']);
    expect(mounted.page.context.countOf(DEPOT_LOGS)).toBe(7);
    expect(mounted.page.context.countOf(DEPOT_LINES)).toBe(2);
  });

  it('asks again for the next record of the same page', async () => {
    const mounted = await mount('/depots/d1');

    await TestBed.inject(Router).navigateByUrl('/depots/d2');
    await drawn(mounted.harness);

    expect(TestBed.inject(DepotCounts).asked()).toEqual(['d1', 'd2']);
    expect(mounted.page.context.countOf(DEPOT_LOGS)).toBe(7);
  });
});

describe('RecordPage, a row written in a list the record holds', () => {
  it('reads the record again, so a count a field holds is not stale', async () => {
    const mounted = await mount('/depots/d1');
    expect(mounted.page.context.countOf(DEPOT_LINES)).toBe(2);
    depotLines = 3;

    TestBed.inject(ResourceChanges).wrote('lines');
    await drawn(mounted.harness);

    expect(mounted.page.context.countOf(DEPOT_LINES)).toBe(3);
    // The counts of another read are asked for when a record opens, and a
    // reload opens none.
    expect(TestBed.inject(DepotCounts).asked()).toEqual(['d1']);
  });

  /** A draft is never thrown away for a count. */
  it('waits while the record is a form, and catches up afterwards', async () => {
    const mounted = await mount('/depots/d1');
    await press(mounted, '[data-edit]');
    depotLines = 3;

    TestBed.inject(ResourceChanges).wrote('lines');
    await drawn(mounted.harness);
    expect(mounted.page.store().mode()).toBe('edit');
    expect(mounted.page.context.countOf(DEPOT_LINES)).toBe(2);

    await press(mounted, 'lib-save-bar [data-cancel]');
    expect(mounted.page.context.countOf(DEPOT_LINES)).toBe(3);
  });

  it('does not read again for a resource it holds no list of', async () => {
    const mounted = await mount('/depots/d1');
    depotLines = 3;

    TestBed.inject(ResourceChanges).wrote('batches');
    await drawn(mounted.harness);

    expect(mounted.page.context.countOf(DEPOT_LINES)).toBe(2);
  });
});

describe('RecordPage, one component for every ID of its route', () => {
  it('opens the next record on the page the router kept', async () => {
    const mounted = await mount('/plants/p1/lines/l1');
    server.read = async (id) => ({ ...LINE, id, name: `Line ${id}` });

    await TestBed.inject(Router).navigateByUrl('/plants/p1/lines/l2');
    await drawn(mounted.harness);

    const next = at(mounted.harness);
    expect(next.page).toBe(mounted.page);
    expect(one(next, 'h1')?.textContent).toBe('Line l2');
    expect(one(next, 'lib-record-id code')?.textContent).toBe('l2');
  });
});
