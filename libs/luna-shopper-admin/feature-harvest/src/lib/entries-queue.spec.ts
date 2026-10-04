import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
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
import { QueueFrame } from '@portfolio/luna-shopper-admin/ui';
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

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';

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

async function render(queryParams: Record<string, string> = {}) {
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
async function opened(chain: string) {
  const { fixture, calls } = await render();

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
    ]);

    page.open('');
    await drain();
    fixture.detectChanges();
    expect(page.queue?.items().length).toBe(5);
  });

  /**
   * A chain's own name for a product means nothing outside that chain, so a
   * mixed queue has to say which chain each row came from. Once a chain is
   * chosen the filter says it, and the badge would be the same word on every
   * row.
   */
  it('names each row’s chain in the list, and stops once one chain is chosen', async () => {
    const { fixture } = await render();
    await drain();
    fixture.detectChanges();
    const toList = () => {
      (
        fixture.nativeElement.querySelector(
          '.views [data-view="list"]'
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
    };

    toList();
    expect(
      fixture.nativeElement.querySelectorAll('.rows .chain').length
    ).toBeGreaterThan(0);
    expect(text(fixture)).toContain('Mercadona');

    fixture.componentInstance.open(DEZA);
    await drain();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.rows .chain').length).toBe(
      0
    );
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
    expect(frame.rowTemplate()).toBeDefined();
    expect(frame.lineTemplate()).not.toBe(frame.rowTemplate());
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
    expect(decide(fixture).querySelector('lib-reference-picker')).not.toBeNull();
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
    expect(decide(fixture).querySelector('lib-references-control')).not.toBeNull();
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

  it('reads the counts again once after a batch, and not once per row', async () => {
    const { page } = await opened(MERCADONA);
    page.queue?.selectLoaded();
    expect(page.queue?.selectedCount()).toBeGreaterThan(1);
    const before = dashboardReads;

    page.askReject();
    const pending = page.pending();
    page.go(pending as NonNullable<typeof pending>);
    for (let round = 0; round < 6; round++) {
      await drain();
    }

    expect(page.queue?.items()).toEqual([]);
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
 * Plan 0020. The same rows as a list, with a checkbox, for the ordinary end of
 * a crawl where two hundred rows are obviously not products this shop tracks
 * and each one costs a separate press.
 */
describe('the source products queue as a list', () => {
  /** The screen opens one at a time, so the list is reached through the toggle. */
  async function listed(chain: string) {
    const rendered = await opened(chain);
    const toggles =
      rendered.fixture.nativeElement.querySelectorAll('.views button');
    toggles[1].click();
    await drain();
    rendered.fixture.detectChanges();
    return rendered;
  }

  it('draws one row per item, with a checkbox and the review view own columns', async () => {
    const { fixture, page } = await listed(MERCADONA);

    const rows = fixture.nativeElement.querySelectorAll('.rows li');
    expect(rows).toHaveLength(page.queue!.items().length);
    expect(rows[0].querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(rows[0].textContent).toContain('Leche entera');
    expect(rows[0].textContent).toContain('harvest.entries.timesSeen');
  });

  it('opens a clicked row one at a time and points the controls at it', async () => {
    const { fixture, page } = await listed(MERCADONA);
    const second = page.listRows()[1];

    fixture.nativeElement.querySelectorAll('.rows .cells')[1].click();
    await drain();
    fixture.detectChanges();

    expect(page.row()?.id).toBe(second.id);
    // The picker follows the subject. A picker still holding the last row's
    // product is exactly how a name gets bound to the wrong one.
    expect(page.itemId()).toBe(second.itemId);
  });

  /**
   * Section 4. Accepting to an item the operator picks and creating a product
   * are each a choice about one row, so neither is offered over a selection.
   */
  it('offers exactly accept as proposed and reject', async () => {
    const { fixture } = await listed(MERCADONA);

    const labels = [
      ...fixture.nativeElement.querySelectorAll('.bulk button'),
    ].map((node: Element) => node.textContent?.trim());

    expect(labels).toEqual([
      'harvest.entries.bulk.accept',
      'harvest.entries.bulk.reject',
    ]);
  });

  /**
   * A count that appears only in the failure report afterwards is a count that
   * arrives too late to change the decision.
   */
  it('states what accepting will act on and what it will leave alone, before it runs', async () => {
    const { page } = await listed(MERCADONA);

    page.queue!.selectLoaded();

    // Of the chain's queued rows only the one the ladder proposed a product for
    // can be accepted as proposed; the rest carry no `itemId` to send.
    expect(page.acceptable().map((entry) => entry.id)).toEqual(['entry-bread']);
    expect(page.unproposed()).toBe(page.queue!.selectedCount() - 1);
  });

  it('names the action and the exact count in the confirmation', async () => {
    const { fixture, page } = await listed(MERCADONA);

    page.queue!.selectLoaded();
    page.askAccept();
    fixture.detectChanges();

    expect(page.pending()).toMatchObject({
      headingKey: 'harvest.entries.bulk.acceptConfirm.heading',
      confirmKey: 'harvest.entries.bulk.accept',
      count: 1,
      leftAlone: page.queue!.selectedCount() - 1,
    });
  });

  it('writes nothing until the confirmation is answered', async () => {
    const { fixture, page, calls } = await listed(MERCADONA);

    page.queue!.selectLoaded();
    page.askReject();
    fixture.detectChanges();
    await drain();

    expect(named(calls, 'rejectEntry')).toHaveLength(0);
  });

  it('rejects every selected row and takes them all out of the queue', async () => {
    const { page, calls } = await listed(MERCADONA);

    page.queue!.selectLoaded();
    const wanted = page.queue!.items().map((entry) => entry.id);
    page.askReject();
    page.go(page.pending()!);
    await drain();

    expect(
      named(calls, 'rejectEntry')
        .map((args) => args[0])
        .sort()
    ).toEqual([...wanted].sort());
    expect(page.queue!.items()).toEqual([]);
    expect(page.report()?.succeeded).toBe(wanted.length);
  });

  /**
   * The row's own proposal and nothing else, so a bulk accept is never one
   * operator's choice applied to rows they did not look at.
   */
  it('accepts a proposed row with its own item, and leaves the rest alone', async () => {
    const { page, calls } = await listed(MERCADONA);

    page.queue!.selectLoaded();
    page.askAccept();
    page.go(page.pending()!);
    await drain();

    expect(named(calls, 'acceptEntry')).toEqual([
      ['entry-bread', { itemId: 'item-bread' }],
    ]);
    expect(page.report()?.skipped.map((line) => line.name)).toEqual([
      'Leche entera',
      'LECHE ENTERA HACENDADO',
    ]);
    expect(page.report()?.failed).toEqual([]);
  });
});
