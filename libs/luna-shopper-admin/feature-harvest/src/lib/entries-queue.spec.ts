import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  CARREFOUR_ACEITE_ENTRY,
  CARREFOUR_YOGUR_ENTRY,
  CATEGORY_SEED,
  ContentLocaleStore,
  DASHBOARD_SERVICE,
  DashboardMemory,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { QueueFrame, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { EntriesQueuePage } from './entries-queue-page';
import { ReviewChain } from './review-chain';

/**
 * The one queue (admin plan 0014, sections 1 and 5).
 *
 * Driven through the in-memory harvester, which mutates, so "advances" is a real
 * property rather than an assertion about a mock's call list: accepting really
 * does take the row out of the queue, and the next row really is the next one.
 * The calls are recorded on top of it so the route and the body can be named as
 * well.
 *
 * The clock is fixed, because whether accepting a row writes its prices depends
 * on whether their windows have closed, and a spec whose answer changes on the
 * twenty third of September is a spec that will be debugged rather than read.
 */

const MERCADONA = 'sm_mercadona';
const CARREFOUR = 'sm_carrefour';
const DEZA = 'sm_deza';

/** What the directory answers for the two chains the seed holds rows for. */
const CHAIN_NAMES: Record<string, string> = {
  [MERCADONA]: 'Mercadona',
  [DEZA]: 'Deza',
};

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

/** The memory harvester, with every call recorded. */
function recorded(): {
  service: HarvestServiceI;
  calls: { name: string; args: unknown[] }[];
} {
  const inner = new HarvestMemory();
  const calls: { name: string; args: unknown[] }[] = [];

  const service = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value;
      }

      return (...args: unknown[]) => {
        calls.push({ name: property, args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as HarvestServiceI;

  return { service, calls };
}

/**
 * The screen, optionally arrived at from a link that named its filters.
 *
 * The query parameters are put on the URL **before** the component exists,
 * because the brand is read once when it starts: the run screen links here
 * with a chain, and a suggested brands chip links here with a chain and a
 * brand. The chain is the `chain` the four queues share (admin plan 0044).
 */

/** How many times the dashboard was read, which is where the counts come from. */
let dashboardReads = 0;

/** The product the seed's proposal names, as the directory answers for it. */
const BREAD = {
  id: 'item-bread',
  title: 'Pan de molde',
  row: {
    id: 'item-bread',
    brand: 'Bimbo',
    ean: '8412600000001',
    unitSize: 460,
    defaultUnit: 'GRAM',
  },
};

/** The product the seeded accepted row is bound to (admin plan 0073). */
const OLIVE_OIL = {
  id: 'it_olive_oil_1l',
  title: 'Aceite de oliva virgen extra',
  row: {
    id: 'it_olive_oil_1l',
    brand: 'Carrefour',
    ean: '8480000000017',
    unitSize: 1,
    defaultUnit: 'LITER',
  },
};

async function render(
  queryParams: Record<string, string> = {},
  /** A wide screen, where the rows are a column beside the open row. */
  wide = false
) {
  const { service, calls } = recorded();
  dashboardReads = 0;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [EntriesQueuePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        // The directory, for the chain and item pickers and for naming a price
        // line's scope. Stubbed rather than driven off the descriptor registry,
        // which this library does not own and which the app composes.
        provide: ResourceReferences,
        useValue: {
          search: async () => [],
          resolve: async (resource: string, id: string) => {
            if (resource === 'supermarkets' && CHAIN_NAMES[id] !== undefined) {
              return { id, title: CHAIN_NAMES[id] };
            }
            // The product a proposal names, for the panel beside the row.
            if (resource === 'items' && id === BREAD.id) {
              return BREAD;
            }
            if (resource === 'items' && id === OLIVE_OIL.id) {
              return OLIVE_OIL;
            }
            // The category picker's rows, which carry the slug the create
            // sends (admin plan 0036).
            const category = CATEGORY_SEED.find((row) => row.id === id);
            return resource === 'categories' && category !== undefined
              ? { id, title: category.slug, row: category }
              : null;
          },
        },
      },
      // The seeded dashboard, with its reads counted: a decision reads the
      // counts again (admin plan 0044, target 2).
      {
        provide: DASHBOARD_SERVICE,
        useFactory: () => {
          const memory = new DashboardMemory();
          return {
            read: () => {
              dashboardReads += 1;
              return memory.read();
            },
          };
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
      // jsdom has no width, so a spec that needs the column says so.
      {
        provide: Viewport,
        useValue: { split: signal(wide), compact: signal(false) },
      },
    ],
  }).compileComponents();

  if (Object.keys(queryParams).length > 0) {
    await TestBed.inject(Router).navigate([], { queryParams });
  }

  const fixture = TestBed.createComponent(EntriesQueuePage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture: fixture as ComponentFixture<EntriesQueuePage>, calls };
}

/** The queue, opened on one chain and read. */
async function opened(chain: string, wide = false) {
  const { fixture, calls } = await render({}, wide);

  fixture.componentInstance.open(chain);
  await drain();
  fixture.detectChanges();

  return { fixture, calls, page: fixture.componentInstance };
}

const named = (
  calls: { name: string; args: unknown[] }[],
  name: string
): unknown[][] => calls.filter((call) => call.name === name).map((c) => c.args);

/** Type into the brand filter, the way a person would. */
function typeBrand(fixture: ComponentFixture<EntriesQueuePage>, value: string) {
  const input = fixture.nativeElement.querySelector(
    '[data-brand]'
  ) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** Lets a settle pass and the read that follows it finish, then redraws. */
async function settled(
  fixture: ComponentFixture<EntriesQueuePage>,
  ms: number
) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await drain();
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<EntriesQueuePage>): string =>
  fixture.nativeElement.textContent;

beforeEach(() => {
  // Inside every window the seed's leaflet prices state, so an accept writes
  // them. `Date.now` alone rather than the whole fake clock: what the answer
  // depends on is one comparison, and faking timers as well would put a zoneless
  // fixture's own scheduling on a clock nothing advances.
  jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-09-15T09:00:00.000Z'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the one queue, with no chain chosen', () => {
  /**
   * The chain is a filter and not an address. A row's key means nothing outside
   * its chain, but the row names its chain, so the queue opens on every chain's
   * rows rather than on a chooser that has to be answered before anything can
   * be seen.
   */
  it('reads every chain rather than asking which one first', async () => {
    const { fixture, calls } = await render();

    expect(named(calls, 'listEntries')[0][0]).toEqual({ cursor: undefined });
    expect(
      fixture.componentInstance.queue?.items().map((entry) => entry.id)
    ).toEqual([
      'entry-milk',
      'entry-bread',
      'entry-aceite',
      'entry-galletas',
      'entry-leche-leaflet',
      CARREFOUR_YOGUR_ENTRY,
      'entry-huevos',
    ]);
  });

  /**
   * What a suggested brands chip links to: one chain and one brand, both read
   * off the URL when the screen starts. The key arrives as text, because a key
   * is a legal spelling of itself and the box holds spellings.
   */
  it('opens on the chain and the brand a link named', async () => {
    const { fixture, calls } = await render({
      chain: MERCADONA,
      brandKey: 'hacendado',
    });

    // One read, already narrowed: the chain is in the address before the
    // queue is built, so nothing is read for every chain first.
    expect(named(calls, 'listEntries')).toHaveLength(1);
    expect(fixture.componentInstance.chosen()).toBe(MERCADONA);
    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      supermarketId: MERCADONA,
      brandKey: 'hacendado',
    });
    expect(fixture.componentInstance.brandText()).toBe('hacendado');
    expect(
      (fixture.nativeElement.querySelector('[data-brand]') as HTMLInputElement)
        .value
    ).toBe('hacendado');
  });

  /**
   * The chain used to be a gate: once one was chosen there was no way to another
   * one short of reloading the page. Both directions are one act now, and
   * clearing the picker is the second of them rather than a no-op.
   */
  it('narrows to one chain, and widens back to every chain', async () => {
    const { fixture, page } = await opened(DEZA);

    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      'entry-aceite',
      'entry-galletas',
    ]);

    page.open(MERCADONA);
    await drain();
    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      'entry-milk',
      'entry-bread',
      'entry-leche-leaflet',
      'entry-huevos',
    ]);

    page.open('');
    await drain();
    fixture.detectChanges();
    expect(page.queue?.items().length).toBe(7);
  });

  /**
   * A chain's own name for a product means nothing outside that chain, so a
   * mixed queue has to say which chain each row came from.
   */
  it('names each row’s chain on its line of the column', async () => {
    const { fixture } = await render({}, true);
    await drain();
    fixture.detectChanges();

    const chains = [
      ...fixture.nativeElement.querySelectorAll('.column .line-chain'),
    ].map((chain: Element) => chain.textContent?.trim());

    expect(chains.length).toBeGreaterThan(0);
    expect(chains).toContain('Mercadona');
  });

  /** The card names the chain of the row in front, whatever the filter says. */
  it('names the chain on the card of the row in front', async () => {
    const { fixture } = await opened(DEZA);
    await drain();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.identity .chain')?.textContent
    ).toContain('Deza');
  });

  /**
   * Admin plan 0044, target 4: one chain filter for the four queues. A change
   * of it builds the queue again, here as on the three other queues.
   */
  it('follows the chain the four queues share', async () => {
    const { fixture, calls } = await render();
    const page = fixture.componentInstance;

    TestBed.inject(ReviewChain).choose(DEZA);
    await drain();
    fixture.detectChanges();
    await drain();

    expect(page.chosen()).toBe(DEZA);
    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      supermarketId: DEZA,
    });
    expect(TestBed.inject(Router).url).toBe(`/?chain=${DEZA}`);
    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      'entry-aceite',
      'entry-galletas',
    ]);

    TestBed.inject(ReviewChain).choose('');
    await drain();
    fixture.detectChanges();
    await drain();

    expect(page.chosen()).toBe('');
    expect(named(calls, 'listEntries').at(-1)?.[0]).toEqual({
      cursor: undefined,
    });
  });

  /** The Review page above the queue draws the header and the chain filter. */
  it('draws no page header and no chain picker of its own', async () => {
    const { fixture } = await render();

    expect(fixture.nativeElement.querySelector('lib-page-header')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    expect(fixture.nativeElement.querySelector('#entries-chain')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.filters lib-reference-picker')
    ).toBeNull();
  });
});

/**
 * The card of one row (admin plan 0044, target 4): what the source says and
 * what it was matched to, side by side, then the prices it brings.
 */
describe('the one queue, the card of a row', () => {
  const frameOf = (fixture: ComponentFixture<EntriesQueuePage>): QueueFrame =>
    fixture.debugElement.query(
      (node) => node.componentInstance instanceof QueueFrame
    ).componentInstance as QueueFrame;

  async function onBread() {
    const rendered = await opened(MERCADONA);
    rendered.page.skip();
    await drain();
    rendered.fixture.detectChanges();
    await drain();
    rendered.fixture.detectChanges();
    return rendered;
  }

  it('says what the source says, under that heading', async () => {
    const { fixture, page } = await opened(DEZA);

    const says: HTMLElement = fixture.nativeElement.querySelector('.says');
    expect(says.textContent).toContain('harvest.entries.says.heading');
    expect(says.textContent).toContain(page.row()?.name);
    expect(page.lines().map((line) => line.key)).toEqual([
      'name',
      'brand',
      'size',
      'ean',
      'categoryPath',
      'externalId',
      'lastSeen',
    ]);
    // A barcode and an id are set in the mono face.
    expect(
      page
        .lines()
        .filter((line) => line.mono)
        .map((line) => line.key)
    ).toEqual(['ean', 'externalId']);
  });

  it('draws every shelf the chain files the row under, one a line (backend plan 0268)', async () => {
    const { fixture, page } = await onBread();

    expect(page.row()?.id).toBe('entry-bread');
    const line = page.lines().find((each) => each.key === 'categoryPath');
    expect(line?.list).toEqual([
      'Panaderia',
      'Desayuno / Pan de molde y tostadas',
    ]);
    const says: HTMLElement = fixture.nativeElement.querySelector('.says');
    const shelves = [...says.querySelectorAll('dd.list span')].map((span) =>
      span.textContent?.trim()
    );
    expect(shelves).toEqual([
      'Panaderia',
      'Desayuno / Pan de molde y tostadas',
    ]);
  });

  it('draws the proposed product beside it, with the reason as a state', async () => {
    const { fixture, page } = await onBread();

    expect(page.row()?.id).toBe('entry-bread');
    const proposed: HTMLElement =
      fixture.nativeElement.querySelector('.proposed');
    expect(proposed.classList.contains('has')).toBe(true);
    expect(proposed.querySelector('[data-reason]')?.textContent).toContain(
      `harvest.entries.reason.${page.row()?.matchedBy}`
    );
    // The product itself, read through the directory, once.
    expect(page.proposed()?.lines).toEqual([
      { key: 'name', value: 'Pan de molde' },
      { key: 'brand', value: 'Bimbo' },
      { key: 'size', value: expect.stringContaining('460') },
      { key: 'ean', value: '8412600000001', mono: true },
    ]);
    expect(proposed.textContent).toContain('Pan de molde');
    expect(proposed.textContent).toContain('Bimbo');
  });

  it('says there is no proposal on a row that has none', async () => {
    const { fixture, page } = await opened(MERCADONA);

    expect(page.proposal()).toBe('none');
    const proposed: HTMLElement =
      fixture.nativeElement.querySelector('.proposed');
    expect(proposed.classList.contains('has')).toBe(false);
    expect(proposed.querySelector('[data-reason]')).toBeNull();
    expect(proposed.textContent).toContain(
      'harvest.entries.proposalBadge.none'
    );
    expect(page.proposed()).toBeNull();
  });

  /** Each price says how far it reaches, as the four bar mark. */
  it('draws a scope mark on each price it brings', async () => {
    const { fixture, page } = await opened(DEZA);
    for (let round = 0; round < 3; round++) {
      await drain();
      fixture.detectChanges();
    }

    const lines = fixture.nativeElement.querySelectorAll('.prices li');
    expect(lines).toHaveLength(2);
    const marked = page.priceLines().filter((line) => line.mark !== null);
    expect(
      fixture.nativeElement.querySelectorAll('.prices li lib-scope-mark')
    ).toHaveLength(marked.length);
    for (const line of marked) {
      expect([1, 2, 3, 4]).toContain(line.mark?.level);
    }
    expect(text(fixture)).toContain('harvest.entries.prices.writes');
  });

  /**
   * The three in the bar on a phone are reject, skip and accept. Reject has a
   * shorter name there, and the long one stays its accessible name.
   */
  it('gives the frame a short name for reject, and the row that is open', async () => {
    const { fixture, page } = await opened(DEZA);
    const frame = frameOf(fixture);

    expect(frame.rejectKey()).toBe('harvest.entries.reject');
    expect(frame.rejectShortKey()).toBe('harvest.entries.rejectShort');
    expect(frame.currentId()).toBe(page.row()?.id);
    const reject: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.actions [data-action="reject"]'
    );
    expect(reject.getAttribute('aria-label')).toBe('harvest.entries.reject');
    expect(reject.querySelector('.short')?.textContent).toContain(
      'harvest.entries.rejectShort'
    );
  });

  /** One line of the column beside the open row, which this queue draws itself. */
  it('names a line of its own for the column of a split', async () => {
    const { fixture } = await opened(DEZA);
    const frame = frameOf(fixture);

    expect(frame.lineTemplate()).toBeDefined();
  });

  /** "Apply a decisions file" is a button of this queue, beside the view switch. */
  it('offers the decisions file as a tool of the queue', async () => {
    const { fixture, page } = await opened(DEZA);

    const open: HTMLButtonElement = fixture.nativeElement.querySelector(
      'lib-queue-frame .tools [data-open-decisions]'
    );
    expect(open).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-decisions-file-panel')
    ).toBeNull();

    open.click();
    fixture.detectChanges();

    expect(page.decisionsOpen()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('lib-decisions-file-panel')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-open-decisions]')
    ).toBeNull();
  });
});

/**
 * "Pick another product" and "Create the product" (admin plan 0044, target
 * 4). Neither is open when a row comes up.
 */
describe('the one queue, the two other ways to decide', () => {
  const decide = (fixture: ComponentFixture<EntriesQueuePage>): HTMLElement =>
    fixture.nativeElement.querySelector('.decide');

  it('opens a row with neither panel', async () => {
    const { fixture, page } = await opened(MERCADONA);

    expect(page.panel()).toBeNull();
    expect(decide(fixture).hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('#entries-item')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-create]')).toBeNull();
  });

  it('opens the picker from its link in the card, and closes it again', async () => {
    const { fixture, page } = await opened(MERCADONA);
    const link: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.links [data-panel="pick"]'
    );

    link.click();
    fixture.detectChanges();

    expect(page.panel()).toBe('pick');
    expect(link.getAttribute('aria-expanded')).toBe('true');
    expect(decide(fixture).hidden).toBe(false);
    expect(
      decide(fixture).querySelector('lib-reference-picker')
    ).not.toBeNull();
    expect(decide(fixture).querySelector('[data-create]')).toBeNull();

    link.click();
    fixture.detectChanges();

    expect(page.panel()).toBeNull();
    expect(decide(fixture).hidden).toBe(true);
  });

  it('opens the create form from its link, in place of the picker', async () => {
    const { fixture, page } = await opened(MERCADONA);

    page.openPanel('pick');
    page.openPanel('create');
    fixture.detectChanges();

    expect(page.panel()).toBe('create');
    expect(decide(fixture).querySelector('[data-create]')).not.toBeNull();
    expect(decide(fixture).querySelector('#entries-item')).toBeNull();
    expect(
      decide(fixture).querySelector('lib-references-control')
    ).not.toBeNull();
  });

  /** In the bar on a wide screen, as the frame's other actions. */
  it('offers both in the action bar as well', async () => {
    const { fixture, page } = await opened(MERCADONA);
    const other: HTMLButtonElement[] = [
      ...fixture.nativeElement.querySelectorAll('.actions .other button'),
    ];

    expect(other.map((button) => button.textContent?.trim())).toEqual([
      'harvest.entries.pick',
      'harvest.entries.create.open',
    ]);

    other[1].click();
    fixture.detectChanges();

    expect(page.panel()).toBe('create');
  });

  /**
   * Nothing to agree with yet, so the press opens the picker and decides
   * nothing. Sending an empty id would be a 400 about a field nobody filled.
   */
  it('opens the picker, and sends nothing, when accept is pressed with no product', async () => {
    const { fixture, page, calls } = await opened(MERCADONA);
    const before = page.row()?.id;

    expect(page.itemId()).toBe('');
    page.primary();
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'acceptEntry')).toHaveLength(0);
    expect(page.panel()).toBe('pick');
    expect(page.row()?.id).toBe(before);

    // The second press, with a product picked, is the accept.
    page.itemId.set('item-bread');
    page.primary();
    await drain();

    expect(named(calls, 'acceptEntry')[0]).toEqual([
      before,
      { itemId: 'item-bread' },
    ]);
  });

  /**
   * A product picked for the last row is never one press away from the next:
   * the next row opens with neither panel.
   */
  it('closes the panel when the next row comes up', async () => {
    const { fixture, page } = await opened(MERCADONA);

    page.openPanel('pick');
    page.skip();
    fixture.detectChanges();
    expect(page.panel()).toBeNull();

    page.openPanel('create');
    page.rejecting.set(true);
    page.reject();
    await drain();
    fixture.detectChanges();

    expect(page.panel()).toBeNull();
  });
});

/**
 * Admin plan 0044, target 2. A decision takes a row out of the queue, and the
 * count on the rail is the queue's length, so the counts are read again.
 */
describe('the counts, after a decision on a source product', () => {
  it('does not read them again for opening or skipping', async () => {
    const { page } = await opened(MERCADONA);
    const before = dashboardReads;

    page.skip();
    await drain();

    expect(dashboardReads).toBe(before);
  });

  it('reads the counts again after an accept', async () => {
    const { page } = await opened(MERCADONA);
    page.skip();
    const before = dashboardReads;

    page.accept();
    await drain();

    expect(dashboardReads).toBe(before + 1);
  });

  it('reads the counts again after a reject', async () => {
    const { page } = await opened(DEZA);
    const before = dashboardReads;

    page.reject();
    await drain();

    expect(dashboardReads).toBe(before + 1);
  });

  it('reads the counts again after a product is created', async () => {
    const { page } = await opened(MERCADONA);
    const before = dashboardReads;

    page.createItem();
    await drain();
    await drain();

    expect(dashboardReads).toBe(before + 1);
  });

  it('reads the queue and the counts again after a decisions file is applied', async () => {
    const { page, calls } = await opened(MERCADONA);
    const reads = named(calls, 'listEntries').length;
    const before = dashboardReads;

    page.applied();
    await drain();

    expect(named(calls, 'listEntries')).toHaveLength(reads + 1);
    expect(dashboardReads).toBe(before + 1);
  });
});

describe('the one queue, reading', () => {
  /**
   * The queue is the two statuses nobody has decided, and the route answers
   * those when no status is sent. So the screen sends none rather than sending
   * both by name.
   */
  it('asks for the queue by sending no status at all', async () => {
    const { calls } = await opened(DEZA);

    // The last, because the first is the read the screen opens with: every
    // chain's rows, before the operator narrowed it to this one.
    expect(named(calls, 'listEntries').at(-1)?.[0]).toEqual({
      supermarketId: DEZA,
      cursor: undefined,
    });
  });

  it('lists only the rows waiting for a person', async () => {
    const { page } = await opened(DEZA);

    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      'entry-aceite',
      'entry-galletas',
    ]);
  });

  /**
   * Driven through the control rather than through the method, which is the
   * only way this can fail: an explicit `(ngModelChange)` beside a two way
   * binding fires **before** the binding writes the signal, so a handler that
   * read the signal would send the status the operator has just moved away from
   * and a spec that set the signal itself would pass forever.
   */
  it('sends the status the operator just chose, not the one before it', async () => {
    const { fixture, calls } = await opened(DEZA);

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="status"]'
    );
    select.value = 'ACTIVE';
    select.dispatchEvent(new Event('change'));
    await drain();

    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('asks for one status by name when the filter names one', async () => {
    const { page, calls } = await opened(DEZA);

    page.status.set('ACTIVE');
    page.reload();
    await drain();

    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      status: 'ACTIVE',
    });
    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      'entry-agua',
    ]);
  });

  /**
   * The brand filter is on the **key** and never on the text, which is what
   * lets one spelling find the rows every chain printed differently (backend
   * plan 0124, section 7). The rows come out of the memory harvester, so the
   * twin's own filter is under test here as well as the page's.
   */
  it('sends the key the typed brand makes, after the settle', async () => {
    const { fixture, calls, page } = await opened(MERCADONA);

    typeBrand(fixture, 'hacendado!');
    // Past the typing settle, which is 250 ms.
    await settled(fixture, 320);

    expect(page.brandFilterKey()).toBe('hacendado');
    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      brandKey: 'hacendado',
    });
    expect(text(fixture)).toContain('harvest.entries.filter.brandKey');
    expect(
      page.queue?.items().every((entry) => entry.brand === 'Hacendado')
    ).toBe(true);
  });

  /**
   * A text that makes no key is still sent, as itself: the route matches
   * nothing against it, so the answer is an empty list rather than a refusal or
   * a filter that quietly did nothing.
   */
  it('sends a text that makes no key, and says it will match nothing', async () => {
    const { fixture, calls, page } = await opened(MERCADONA);

    typeBrand(fixture, '---');
    await settled(fixture, 320);

    expect(page.brandFilterKey()).toBeNull();
    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      brandKey: '---',
    });
    expect(text(fixture)).toContain('harvest.entries.filter.brandNoKey');
    expect(page.queue?.items()).toEqual([]);
  });

  it('sends no brand at all when the box is emptied', async () => {
    const { fixture, calls } = await opened(MERCADONA);

    typeBrand(fixture, 'Hacendado');
    await settled(fixture, 320);
    typeBrand(fixture, '   ');
    await settled(fixture, 320);

    expect(named(calls, 'listEntries').at(-1)?.[0]).not.toHaveProperty(
      'brandKey'
    );
  });

  /**
   * Without this an operator working through a leaflet's rows is interleaved
   * with a walk's four thousand.
   */
  it('filters by what named the row', async () => {
    const { page, calls } = await opened(MERCADONA);

    page.sourceKind.set('OFFICIAL_LEAFLET');
    page.reload();
    await drain();

    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      sourceKind: 'OFFICIAL_LEAFLET',
    });
    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      'entry-leche-leaflet',
    ]);
  });
});

/**
 * One entry by its address (admin plan 0073): what a size example of a run
 * links to. The entry and the chain are the question, so the other filters
 * are not sent, and any of them changed ends the view.
 */
describe('the one queue, narrowed to one entry', () => {
  const notice = (fixture: ComponentFixture<EntriesQueuePage>) =>
    fixture.nativeElement.querySelector(
      '[data-entry-notice]'
    ) as HTMLElement | null;

  it('asks with the entry and the chain only, opens the row and says so', async () => {
    const { fixture, calls } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
      brandKey: 'hacendado',
    });
    const page = fixture.componentInstance;

    expect(named(calls, 'listEntries')).toEqual([
      [
        {
          entryId: CARREFOUR_YOGUR_ENTRY,
          supermarketId: CARREFOUR,
          cursor: undefined,
        },
      ],
    ]);
    expect(page.row()?.id).toBe(CARREFOUR_YOGUR_ENTRY);
    expect(notice(fixture)?.textContent).toContain('harvest.entries.entry.one');
    expect(notice(fixture)?.textContent).toContain('harvest.entries.entry.all');
  });

  it('reaches a decided row, which the default queue does not list', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_ACEITE_ENTRY,
      chain: CARREFOUR,
    });

    expect(fixture.componentInstance.queue?.current()).toMatchObject({
      id: CARREFOUR_ACEITE_ENTRY,
      status: 'ACTIVE',
    });
    expect(text(fixture)).toContain('Aceite de oliva virgen extra 1 l');
  });

  it('shows the whole queue again from the button, and keeps the chain', async () => {
    const { fixture, calls } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });
    const page = fixture.componentInstance;

    (
      fixture.nativeElement.querySelector('[data-entry-all]') as HTMLElement
    ).click();
    await drain();
    fixture.detectChanges();

    expect(page.entryFilter()).toBeNull();
    expect(notice(fixture)).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/?chain=${CARREFOUR}`);
    expect(named(calls, 'listEntries').at(-1)?.[0]).toEqual({
      supermarketId: CARREFOUR,
      cursor: undefined,
    });
  });

  it('ends the view when a filter changes', async () => {
    const { fixture, calls } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="status"]'
    );
    select.value = 'ACTIVE';
    select.dispatchEvent(new Event('change'));
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.entryFilter()).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/?chain=${CARREFOUR}`);
    const last = named(calls, 'listEntries').at(-1)?.[0];
    expect(last).toMatchObject({ status: 'ACTIVE', supermarketId: CARREFOUR });
    expect(last).not.toHaveProperty('entryId');
  });

  it('ends the view when the chain changes', async () => {
    const { fixture, calls } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });

    TestBed.inject(ReviewChain).choose(DEZA);
    await drain();
    fixture.detectChanges();
    await drain();

    expect(fixture.componentInstance.entryFilter()).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/?chain=${DEZA}`);
    expect(named(calls, 'listEntries').at(-1)?.[0]).toEqual({
      supermarketId: DEZA,
      cursor: undefined,
    });
  });

  it('asks nothing for a value that is not an id, and draws the empty state under the notice', async () => {
    const { fixture, calls } = await render({
      entry: 'not-an-id',
      chain: CARREFOUR,
    });

    expect(named(calls, 'listEntries')).toEqual([]);
    expect(fixture.componentInstance.queue?.empty()).toBe(true);
    expect(notice(fixture)).not.toBeNull();
    // An address that names nothing is not a queue with nothing left in it
    // (decision 45a).
    expect(text(fixture)).toContain('harvest.entries.entry.empty');
    expect(text(fixture)).not.toContain('harvest.entries.empty');
  });

  it('says no entry has the address when the answer is empty', async () => {
    // An id of the right shape that names nothing, and a known entry under
    // a chain that is not its own.
    for (const params of [
      { entry: 'ffffffff-ffff-4fff-8fff-ffffffffffff', chain: CARREFOUR },
      { entry: CARREFOUR_YOGUR_ENTRY, chain: DEZA },
    ]) {
      const { fixture } = await render(params);

      expect(fixture.componentInstance.queue?.empty()).toBe(true);
      expect(text(fixture)).toContain('harvest.entries.entry.empty');
      expect(text(fixture)).not.toContain('harvest.entries.empty');
    }
  });

  it('keeps the old sentence for an ordinary empty queue', async () => {
    const { fixture, page } = await opened(DEZA);

    page.brandText.set('nothing-carries-this');
    page.reload();
    await drain();
    fixture.detectChanges();

    expect(page.queue?.empty()).toBe(true);
    expect(text(fixture)).toContain('harvest.entries.empty');
    expect(text(fixture)).not.toContain('harvest.entries.entry.empty');
  });

  /** Not sent while one entry is shown, so it claims no filter then. */
  it('disables the State select while one entry is shown, and only then', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });
    await drain();
    fixture.detectChanges();
    const select = (): HTMLSelectElement =>
      fixture.nativeElement.querySelector('select[name="status"]');
    const kind = (): HTMLSelectElement =>
      fixture.nativeElement.querySelector('select[name="sourceKind"]');

    expect(select().disabled).toBe(true);
    expect(kind().disabled).toBe(false);
    expect(
      (fixture.nativeElement.querySelector('[data-brand]') as HTMLInputElement)
        .disabled
    ).toBe(false);

    fixture.componentInstance.showWholeQueue();
    await drain();
    fixture.detectChanges();
    await drain();
    fixture.detectChanges();

    expect(select().disabled).toBe(false);
  });

  it('leaves the State select enabled on the whole queue', async () => {
    const { fixture } = await opened(DEZA);
    await drain();
    fixture.detectChanges();

    expect(
      (
        fixture.nativeElement.querySelector(
          'select[name="status"]'
        ) as HTMLSelectElement
      ).disabled
    ).toBe(false);
  });

  it('keeps the row in the answer after a decision, as the decision left it', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });
    const page = fixture.componentInstance;

    page.reject();
    await drain();
    await drain();
    fixture.detectChanges();

    expect(page.queue?.current()).toMatchObject({
      id: CARREFOUR_YOGUR_ENTRY,
      status: 'REJECTED',
    });
    expect(notice(fixture)).not.toBeNull();
  });
});

/**
 * Decision 47b (admin plan 0073): a decided row says its status, and a bound
 * row's product is named as bound rather than proposed. No action changes.
 */
describe('the one queue, the status of a row', () => {
  const status = (fixture: ComponentFixture<EntriesQueuePage>) =>
    (
      fixture.nativeElement.querySelector(
        '.identity [data-status]'
      ) as HTMLElement | null
    )?.textContent?.trim();
  const heading = (fixture: ComponentFixture<EntriesQueuePage>) =>
    (
      fixture.nativeElement.querySelector(
        '[data-proposal-heading]'
      ) as HTMLElement
    ).textContent?.trim();
  const hint = (fixture: ComponentFixture<EntriesQueuePage>) =>
    (
      fixture.nativeElement.querySelector(
        '[data-proposal-hint]'
      ) as HTMLElement | null
    )?.textContent?.trim();
  const badges = (fixture: ComponentFixture<EntriesQueuePage>) =>
    [
      ...fixture.nativeElement.querySelectorAll('.column [data-line-badge]'),
    ].map((badge: Element) => badge.textContent?.trim());

  async function settle(fixture: ComponentFixture<EntriesQueuePage>) {
    for (let round = 0; round < 3; round++) {
      await drain();
      fixture.detectChanges();
    }
  }

  it('draws a bound row as bound in the one entry view', async () => {
    const { fixture } = await render(
      { entry: CARREFOUR_ACEITE_ENTRY, chain: CARREFOUR },
      true
    );
    await settle(fixture);

    expect(status(fixture)).toBe('harvest.entryStatus.ACTIVE');
    expect(heading(fixture)).toBe('harvest.entries.proposal.boundHeading');
    expect(hint(fixture)).toBe('harvest.entries.proposal.bound');
    expect(text(fixture)).not.toContain('harvest.entries.proposal.item');
    expect(badges(fixture)).toEqual(['harvest.entries.proposalBadge.bound']);
    // The bound product, drawn as the proposal panel draws one. Its link
    // needs the products mounted, which this spec does not do.
    const proposed: HTMLElement =
      fixture.nativeElement.querySelector('.proposed');
    expect(proposed.textContent).toContain('Aceite de oliva virgen extra');
  });

  it('draws a bound row as bound under the State filter', async () => {
    const { fixture } = await render({}, true);
    const page = fixture.componentInstance;

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="status"]'
    );
    select.value = 'ACTIVE';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    const rows = page.listRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === 'ACTIVE')).toBe(true);
    expect(status(fixture)).toBe('harvest.entryStatus.ACTIVE');
    expect(heading(fixture)).toBe('harvest.entries.proposal.boundHeading');
    expect(hint(fixture)).toBe('harvest.entries.proposal.bound');
    expect(badges(fixture)).toEqual(
      rows.map(() => 'harvest.entries.proposalBadge.bound')
    );
  });

  it('keeps every button of a bound row', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_ACEITE_ENTRY,
      chain: CARREFOUR,
    });
    const page = fixture.componentInstance;
    await settle(fixture);
    const host: HTMLElement = fixture.nativeElement;

    for (const action of ['confirm', 'skip', 'reject']) {
      const button = host.querySelector(
        `.actions [data-action="${action}"]`
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(false);
    }
    expect(page.confirmKey()).toBe('harvest.entries.accept');
    expect(
      [...host.querySelectorAll('.actions .other button')].map((button) =>
        button.textContent?.trim()
      )
    ).toEqual(['harvest.entries.pick', 'harvest.entries.create.open']);
    expect(host.querySelector('.links [data-panel="pick"]')).not.toBeNull();
    expect(host.querySelector('.links [data-panel="create"]')).not.toBeNull();
  });

  it('leaves a waiting row as it was, with its status said', async () => {
    const { fixture, page } = await opened(MERCADONA, true);
    page.skip();
    await settle(fixture);

    expect(page.row()?.id).toBe('entry-bread');
    expect(status(fixture)).toBe('harvest.entryStatus.CANDIDATE');
    expect(heading(fixture)).toBe('harvest.entries.proposal.heading');
    expect(hint(fixture)).toBe('harvest.entries.proposal.item');
    expect(badges(fixture)).not.toContain(
      'harvest.entries.proposalBadge.bound'
    );
    expect(badges(fixture)).toContain('harvest.entries.proposalBadge.item');
  });

  it('says the status of a waiting row in the one entry view', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });

    expect(status(fixture)).toBe('harvest.entryStatus.UNRESOLVED');
    expect(heading(fixture)).toBe('harvest.entries.proposal.heading');
  });

  it('says a rejected row is rejected', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });

    fixture.componentInstance.reject();
    await settle(fixture);

    expect(status(fixture)).toBe('harvest.entryStatus.REJECTED');
    expect(heading(fixture)).toBe('harvest.entries.proposal.heading');
  });
});

describe('the one queue, drawing a row', () => {
  /**
   * The badge is the one thing that tells a Mercadona product from a Mercadona
   * leaflet tile of the same product, and the two are two rows on purpose.
   */
  it('wears the source kind as a badge', async () => {
    const { fixture, page } = await opened(DEZA);

    expect(page.row()?.sourceKind).toBe('OFFICIAL_LEAFLET');
    expect(text(fixture)).toContain('harvest.sourceKind.OFFICIAL_LEAFLET');
  });

  /**
   * Two regional leaflets print one product, and each price belongs to its own
   * scope. A single price column had to pick one of them, which is why the
   * prices left the row.
   */
  it('draws one price line per scope', async () => {
    const { page } = await opened(DEZA);

    expect(page.priceLines().length).toBe(2);
    expect(page.priceLines().map((line) => line.scopeId)).toEqual([
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555553',
    ]);
    expect(page.priceLines()[0].window).not.toBe('');
  });

  /**
   * Backend plan 0190: the kind is on the price. A row that a website and a
   * leaflet both print holds a price of each for one scope, so the kind is
   * drawn on every line and a line is tracked by the scope and the kind.
   */
  it('says on each price line what stated it', async () => {
    const { fixture, page } = await opened(DEZA);
    for (let round = 0; round < 3; round++) {
      await drain();
      fixture.detectChanges();
    }

    expect(page.priceLines().map((line) => line.sourceKind)).toEqual([
      'OFFICIAL_LEAFLET',
      'OFFICIAL_LEAFLET',
    ]);
    const kinds = [
      ...fixture.nativeElement.querySelectorAll('.prices li .kind'),
    ].map((each: Element) => each.textContent?.trim());
    expect(kinds).toEqual([
      'catalog.priceSourceKind.OFFICIAL_LEAFLET',
      'catalog.priceSourceKind.OFFICIAL_LEAFLET',
    ]);
    // One key per line, also when two lines share a scope.
    const keys = page.priceLines().map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(
      '55555555-5555-4555-8555-555555555552|OFFICIAL_LEAFLET'
    );
  });

  /**
   * For a DEZA row that is the truth rather than a gap: the site prints no price
   * anywhere. Saying so is what stops an operator reading a working accept as a
   * failure.
   */
  it('says a row has no price rather than drawing a blank', async () => {
    const { fixture, page } = await opened(DEZA);

    page.skip();
    fixture.detectChanges();

    expect(page.row()?.id).toBe('entry-galletas');
    expect(page.row()?.prices).toEqual([]);
    expect(text(fixture)).toContain('harvest.entries.prices.none');
  });

  /** The producer's own bag, shown in full and folded, and never interpreted. */
  it('shows everything else the source sent', async () => {
    const { page } = await opened(DEZA);

    expect(page.row()?.extra.map((line) => line.key)).toEqual([
      'page',
      'promotion',
      'raw_text',
    ]);
  });
});

describe('the one queue, deciding a row', () => {
  /**
   * A proposal is preselected, so agreeing with one is a single press rather
   * than a search for a product somebody has already named.
   */
  it('preselects the proposed product and accepts it', async () => {
    const { fixture, page, calls } = await opened(MERCADONA);

    // The first row has no proposal; the second is the one the ladder answered.
    page.skip();
    fixture.detectChanges();

    expect(page.row()?.id).toBe('entry-bread');
    expect(page.proposal()).toBe('item');
    // Preselected by the skip, which is what makes agreeing one press.
    expect(page.itemId()).toBe('item-bread');

    page.accept();
    await drain();

    const args = named(calls, 'acceptEntry')[0];
    expect(args[0]).toBe('entry-bread');
    expect(args[1]).toEqual({ itemId: 'item-bread' });
  });

  /**
   * The sibling carries the barcode, so it is the row to create the product
   * from. Confirming here would bind the product to the wrong one of the two.
   */
  it('opens the sibling row instead of accepting', async () => {
    const { fixture, page, calls } = await opened(MERCADONA);

    page.skip();
    page.skip();
    fixture.detectChanges();

    expect(page.row()?.id).toBe('entry-leche-leaflet');
    expect(page.proposal()).toBe('sibling');
    expect(page.siblingName()).toBe('Leche entera');
    expect(page.confirmKey()).toBe('harvest.entries.openSibling');

    page.primary();
    await drain();
    fixture.detectChanges();

    expect(page.row()?.id).toBe('entry-milk');
    expect(named(calls, 'acceptEntry').length).toBe(0);
  });

  /**
   * The row already holds a default for every field, and the backend fills in
   * what is absent. A create that echoed the row back would be this screen
   * asserting values it merely displayed.
   */
  it('sends only the fields the operator changed', async () => {
    const { page, calls } = await opened(MERCADONA);

    page.nameEs.set('Leche entera de vaca');
    page.categoryIds.set(['cat_milk', 'cat_lactose-free-and-fortified-milk']);
    page.createItem();
    await drain();

    // The picker holds ids and the harvest route takes slugs, in the order
    // picked (backend plan 0166, section 3).
    expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({
      name: { es: 'Leche entera de vaca' },
      categorySlugs: ['milk', 'lactose-free-and-fortified-milk'],
    });
  });

  /**
   * No pick means "resolve from the source path", which the memory twin
   * answers the way catalog answers a path nothing maps.
   */
  it('lands a product created with no pick on uncategorised', async () => {
    const { page, calls } = await opened(MERCADONA);

    page.createItem();
    await drain();

    const call = named(calls, 'createItemFromEntry')[0];
    expect(call[1]).not.toHaveProperty('categorySlugs');
    const service = new HarvestMemory();
    const result = await service.createItemFromEntry(
      call[0] as string,
      call[1] as Record<string, never>
    );
    expect(result.createdItem?.categories.map((row) => row.slug)).toEqual([
      'uncategorised',
    ]);
  });

  it('clears the picked categories once the row is decided', async () => {
    const { page } = await opened(MERCADONA);

    page.categoryIds.set(['cat_milk']);
    page.createItem();
    await drain();

    expect(page.categoryIds()).toEqual([]);
  });

  it('sends nothing at all when the operator changed nothing', async () => {
    const { page, calls } = await opened(MERCADONA);

    page.createItem();
    await drain();

    expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({});
  });

  /** Admin plan 0068, criterion 3. */
  describe('a row with no size and a weight', () => {
    /**
     * The queue opened on a first row that states the weight of one piece.
     * Every row of the seed is a fixed pack, so the read is bent here.
     */
    async function openedOnPiece(soldByWeight: boolean) {
      const listEntries = HarvestMemory.prototype.listEntries;
      jest
        .spyOn(HarvestMemory.prototype, 'listEntries')
        .mockImplementation(async function (this: HarvestMemory, query) {
          const page = await listEntries.call(this, query);
          return {
            ...page,
            items: page.items.map((entry, index) =>
              index === 0
                ? { ...entry, unitSize: null, soldByWeight, approxWeight: 1560 }
                : entry
            ),
          };
        });
      const held = await opened(MERCADONA);
      held.page.openPanel('create');
      held.fixture.detectChanges();
      return held;
    }

    const weightLine = (fixture: ComponentFixture<EntriesQueuePage>) =>
      fixture.nativeElement.querySelector(
        '[data-weight]'
      ) as HTMLElement | null;

    it('proposes the kilo, no size and the weight for a row sold by weight', async () => {
      const { fixture, page } = await openedOnPiece(true);

      expect(page.defaultUnit()).toBe('KILOGRAM');
      expect(page.unitSize()).toBe('');
      expect(page.shownWeight()).toBe(1560);
      expect(weightLine(fixture)?.textContent).toContain('1560');
      expect(weightLine(fixture)?.textContent).toContain(
        'harvest.entries.create.approxWeightHelp'
      );
    });

    it('proposes a unit, no size and the weight for a row not sold by weight', async () => {
      const { page } = await openedOnPiece(false);

      expect(page.defaultUnit()).toBe('UNIT');
      expect(page.unitSize()).toBe('');
      expect(page.shownWeight()).toBe(1560);
    });

    it('sends nothing when the proposal is left as it is, and the server derives it', async () => {
      const { page, calls } = await openedOnPiece(true);

      page.createItem();
      await drain();

      expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({});
    });

    it('drops the weight line once a size is typed, and sends the size', async () => {
      const { fixture, page, calls } = await openedOnPiece(true);

      page.unitSize.set('250');
      page.defaultUnit.set('GRAM');
      fixture.detectChanges();
      expect(weightLine(fixture)).toBeNull();

      page.createItem();
      await drain();

      expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({
        unitSize: 250,
        defaultUnit: 'GRAM',
      });
    });

    it('sends the unit a person chose over the proposal', async () => {
      const { page, calls } = await openedOnPiece(true);

      page.defaultUnit.set('UNIT');
      page.createItem();
      await drain();

      expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({
        defaultUnit: 'UNIT',
      });
    });

    const sizeBox = (fixture: ComponentFixture<EntriesQueuePage>) =>
      fixture.nativeElement.querySelector(
        '[data-size]'
      ) as HTMLInputElement | null;

    it('offers no size box beside Kilogram, and choosing it empties the box', async () => {
      const { fixture, page } = await openedOnPiece(false);

      page.unitSize.set('400');
      fixture.detectChanges();
      expect(sizeBox(fixture)).not.toBeNull();

      const select = fixture.nativeElement.querySelector(
        '[data-unit]'
      ) as HTMLSelectElement;
      select.value = 'KILOGRAM';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(page.defaultUnit()).toBe('KILOGRAM');
      expect(page.unitSize()).toBe('');
      expect(sizeBox(fixture)).toBeNull();
    });

    it('sends the kept unit beside a typed size', async () => {
      const { page, calls } = await openedOnPiece(false);

      page.unitSize.set('6');
      page.createItem();
      await drain();

      expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({
        unitSize: 6,
        defaultUnit: 'UNIT',
      });
    });

    it('drops the weight line while the unit differs from the proposal, and draws it again when put back', async () => {
      const { fixture, page } = await openedOnPiece(true);

      page.defaultUnit.set('UNIT');
      fixture.detectChanges();
      expect(page.shownWeight()).toBeNull();
      expect(weightLine(fixture)).toBeNull();

      page.defaultUnit.set('KILOGRAM');
      fixture.detectChanges();
      expect(page.shownWeight()).toBe(1560);
      expect(weightLine(fixture)).not.toBeNull();
    });

    it('sends nothing when "As the row says" is chosen over a proposed unit', async () => {
      const { fixture, page, calls } = await openedOnPiece(true);

      page.defaultUnit.set('');
      fixture.detectChanges();
      expect(weightLine(fixture)).not.toBeNull();

      page.createItem();
      await drain();

      expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({});
    });

    it('opens any other row with no unit and no weight line', async () => {
      const { fixture, page } = await opened(MERCADONA);
      page.openPanel('create');
      fixture.detectChanges();

      expect(page.defaultUnit()).toBe('');
      expect(page.shownWeight()).toBeNull();
      expect(weightLine(fixture)).toBeNull();
    });
  });

  /**
   * An empty English name is not a name. Storing one would hide the missing
   * translation tag that asks somebody to write a real one (backend plan 0079).
   */
  it('sends an English name only when one was typed', async () => {
    const { page, calls } = await opened(MERCADONA);

    page.nameEn.set('Whole milk');
    page.createItem();
    await drain();

    expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({
      name: { es: 'Leche entera', en: 'Whole milk' },
    });
  });

  /**
   * Accepting the wrong product is corrected by accepting the right one.
   * Rejecting takes a row out of every future run's questions, so it is asked
   * about first.
   */
  it('asks before rejecting, and rejects nothing until answered', async () => {
    const { fixture, page, calls } = await opened(DEZA);

    page.rejecting.set(true);
    fixture.detectChanges();

    expect(named(calls, 'rejectEntry').length).toBe(0);
    expect(text(fixture)).toContain('harvest.entries.rejectConfirm.heading');

    page.reject();
    await drain();

    expect(named(calls, 'rejectEntry')[0][0]).toBe('entry-aceite');
    expect(page.rejecting()).toBe(false);
    expect(page.queue?.current()?.id).toBe('entry-galletas');
  });
});

/**
 * The sentence that says what an accept wrote (admin plan 0014, section 1).
 *
 * Asserted on the component's own state rather than on the rendered text: the
 * sentence interpolates a count, a name and a list of prices, and the testing
 * translator answers with the key and interpolates nothing. What the DOM can
 * prove is the **choice of key**, which is the half that branches.
 */
describe('the one queue, saying what it wrote', () => {
  it('names two prices when the row carried two', async () => {
    const { fixture, page } = await opened(DEZA);

    page.itemId.set('item-oil');
    page.accept();
    await drain();
    fixture.detectChanges();

    expect(page.written()).toMatchObject({
      count: 2,
      name: 'Aceite de Oliva Virgen Serie Oro Coosur',
    });
    expect(page.written()?.prices).toContain(',');
    expect(page.writtenKey()).toBe('harvest.entries.written.many');
    expect(text(fixture)).toContain('harvest.entries.written.many');
  });

  it('names one price when the row carried one', async () => {
    const { page } = await opened(MERCADONA);

    page.itemId.set('item-milk');
    page.accept();
    await drain();

    expect(page.written()).toMatchObject({ count: 1 });
    expect(page.writtenKey()).toBe('harvest.entries.written.one');
  });

  /**
   * The sentence has to say **why** nothing was written, or an operator who
   * accepts a DEZA row reads a working accept as a failure.
   */
  it('says why nothing was written for a row with no price', async () => {
    const { fixture, page } = await opened(DEZA);

    page.skip();
    fixture.detectChanges();

    page.itemId.set('item-biscuits');
    page.accept();
    await drain();

    expect(page.written()).toMatchObject({
      count: 0,
      name: 'Galletas Maria Cuetara',
      prices: '',
    });
    expect(page.writtenKey()).toBe('harvest.entries.written.none');
  });
});

/**
 * Admin plan 0049, targets 5, 6 and 7. The queue had a second view, a list
 * with a checkbox on each row and a bar of bulk actions (plan 0020). It is
 * gone. The rows are a column beside the open row on a wide screen, and
 * pressing one opens it where it sits.
 */
describe('the source products queue, a column and no list', () => {
  const lines = (fixture: ComponentFixture<EntriesQueuePage>) =>
    [
      ...fixture.nativeElement.querySelectorAll('.column button.line'),
    ] as HTMLButtonElement[];

  it('draws no list of checkboxes, no bulk action and no view switch', async () => {
    const { fixture } = await opened(MERCADONA, true);
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.subject')).not.toBeNull();
    expect(host.querySelector('.rows')).toBeNull();
    expect(host.querySelector('.bulk')).toBeNull();
    expect(host.querySelector('.views')).toBeNull();
    expect(text(fixture)).not.toContain('harvest.entries.bulk');
    expect(text(fixture)).not.toContain('harvest.queue.view');
  });

  it('says no count of rows left and decided', async () => {
    const { fixture } = await opened(MERCADONA, true);

    expect(text(fixture)).not.toContain('harvest.queue.tally');
  });

  it('draws one line per row in the column, by name', async () => {
    const { fixture, page } = await opened(MERCADONA, true);

    expect(lines(fixture)).toHaveLength(page.listRows().length);
    expect(lines(fixture)[0].textContent).toContain('Leche entera');
  });

  /**
   * The owner's words: "if you select row 5, the top 4 should still be
   * available, and the list won't scroll or anything."
   */
  it('opens a pressed line where it sits, and points the controls at it', async () => {
    const { fixture, page } = await opened(MERCADONA, true);
    const before = page.listRows().map((row) => row.id);
    const at = before.length - 1;
    expect(at).toBeGreaterThan(0);
    const chosen = page.listRows()[at];

    lines(fixture)[at].click();
    await drain();
    fixture.detectChanges();

    expect(page.row()?.id).toBe(chosen.id);
    // The picker follows the subject. A picker still holding the last row's
    // product is exactly how a name gets bound to the wrong one.
    expect(page.itemId()).toBe(chosen.itemId);
    // No row changed its place, and the rows above the chosen one are there.
    expect(page.listRows().map((row) => row.id)).toEqual(before);
    expect(
      lines(fixture).map((line) => line.getAttribute('aria-current'))
    ).toEqual(before.map((_, index) => (index === at ? 'true' : null)));
  });

  it('goes to the next line on a skip, and moves no line', async () => {
    const { fixture, page } = await opened(MERCADONA, true);
    const before = page.listRows().map((row) => row.id);

    page.skip();
    await drain();
    fixture.detectChanges();

    expect(page.row()?.id).toBe(before[1]);
    expect(page.listRows().map((row) => row.id)).toEqual(before);
  });

  /** The row under a decided one comes up, and the rows above it stay. */
  it('brings up the row under a rejected one and keeps the rows above it', async () => {
    const { fixture, page } = await opened(MERCADONA, true);
    const before = page.listRows().map((row) => row.id);
    expect(before.length).toBeGreaterThan(2);

    lines(fixture)[1].click();
    await drain();
    page.reject();
    await drain();
    fixture.detectChanges();

    expect(page.listRows().map((row) => row.id)).toEqual([
      before[0],
      ...before.slice(2),
    ]);
    expect(page.row()?.id).toBe(before[2]);
  });
});

/**
 * A row whose own price and comparison price disprove its size (backend plan
 * 0249) wears a chip on its identity line and its line of the column, and the
 * size it states carries a sentence with both sizes (admin plan 0072). The
 * seeded yogurt states 125 g and its price per kilo implies 500 g.
 */
describe('the one queue, a size in doubt', () => {
  const host = (fixture: ComponentFixture<EntriesQueuePage>): HTMLElement =>
    fixture.nativeElement;

  it('draws the chip and the sentence on a doubted entry', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_YOGUR_ENTRY,
      chain: CARREFOUR,
    });
    const page = fixture.componentInstance;

    expect(
      host(fixture).querySelector('.identity [data-size-doubt]')?.textContent
    ).toContain('harvest.entries.sizeDoubt.chip');
    const sentence = host(fixture).querySelector(
      '.says [data-size-doubt-sentence]'
    );
    expect(sentence?.textContent).toContain(
      'harvest.entries.sizeDoubt.sentence'
    );
    // The sentence sits with the size the row states.
    expect(sentence?.closest('dd')?.textContent).toContain('125 g');
    // Asserted as values: the testing translator does not interpolate.
    expect(page.doubtWords()).toEqual({
      stated: '125 g',
      implied: '500 g',
      label: 'kg',
    });
    // Four times the size, and no pack stated: the guess, said as one.
    expect(page.row()?.sizeDoubt?.packGuess).toBe(4);
    expect(
      host(fixture).querySelector('[data-size-doubt-pack]')?.textContent
    ).toContain('harvest.entries.sizeDoubt.pack');
  });

  it('draws no pack guess when the ratio is no whole number', async () => {
    const { fixture } = await render({
      entry: CARREFOUR_ACEITE_ENTRY,
      chain: CARREFOUR,
    });

    expect(
      host(fixture).querySelector('.identity [data-size-doubt]')
    ).not.toBeNull();
    expect(fixture.componentInstance.doubtWords()?.label).toBe('l');
    expect(host(fixture).querySelector('[data-size-doubt-pack]')).toBeNull();
  });

  it('words a row sized in units through the plural of a count', async () => {
    const { fixture, page } = await opened(MERCADONA);

    page.openRow('entry-huevos');
    fixture.detectChanges();

    expect(page.row()?.id).toBe('entry-huevos');
    // The testing translator answers the key: the count goes through the
    // plural, and the label reads as the harvester keys it.
    expect(fixture.componentInstance.doubtWords()).toEqual({
      stated: 'harvest.entries.sizeDoubt.units',
      implied: 'harvest.entries.sizeDoubt.units',
      label: 'ud',
    });
  });

  it('draws none of it on an entry nobody doubts', async () => {
    const { fixture, page } = await opened(MERCADONA);

    expect(page.row()?.sizeDoubt).toBeNull();
    expect(page.doubtWords()).toBeNull();
    expect(host(fixture).querySelector('[data-size-doubt]')).toBeNull();
    expect(
      host(fixture).querySelector('[data-size-doubt-sentence]')
    ).toBeNull();
  });

  it('draws the chip on the lines of the doubted rows only', async () => {
    const { fixture } = await render({}, true);
    await drain();
    fixture.detectChanges();

    const lines = [
      ...host(fixture).querySelectorAll('.column button.line'),
    ] as HTMLElement[];
    const doubted = lines.filter(
      (line) => line.querySelector('[data-line-size-doubt]') !== null
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(doubted).toHaveLength(2);
    expect(doubted[0].textContent).toContain('Yogur natural Carrefour 125 g');
    expect(doubted[1].textContent).toContain('Huevos frescos camperos L');
    expect(doubted[0].textContent).toContain('harvest.entries.sizeDoubt.chip');
  });

  it('narrows the queue to the doubted rows, and widens it back', async () => {
    const { fixture, calls } = await render();
    const page = fixture.componentInstance;
    const box = host(fixture).querySelector(
      '[data-size-doubt-filter]'
    ) as HTMLInputElement;

    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'listEntries').at(-1)?.[0]).toMatchObject({
      sizeDoubt: true,
    });
    // The bound olive oil is doubted too, and the queue lists only what waits.
    expect(page.queue?.items().map((entry) => entry.id)).toEqual([
      CARREFOUR_YOGUR_ENTRY,
      'entry-huevos',
    ]);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await drain();

    expect(named(calls, 'listEntries').at(-1)?.[0]).not.toHaveProperty(
      'sizeDoubt'
    );
    expect(page.queue?.items().length).toBeGreaterThan(1);
  });
});
