import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
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
import {
  LOCATIONS,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import {
  provideResources,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { ResourceQuery } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { ReviewChain } from './review-chain';
import { ShopsQueuePage } from './shops-queue-page';

/**
 * The shops a source names (admin plan 0011, section 7).
 *
 * Driven through the in-memory harvester, which mutates, so "leaves the queue"
 * is a real property rather than an assertion about a mock's call list: a shop
 * that is ignored really does stop matching the default filter. The calls are
 * recorded on top of it so the route can be named as well.
 *
 * The chain is Mercadona's seeded uuid, because the queue reads nothing at all
 * until one is chosen and there is no route that lists every source's shops.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';

const drain = async () => {
  for (let i = 0; i < 12; i++) {
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

/** How many times the dashboard was read, which is where the counts come from. */
let dashboardReads = 0;

/**
 * A wide screen, where the rows of a queue are a column beside the open row.
 * jsdom has no width, so the spec states one.
 */
const WIDE = {
  provide: Viewport,
  useValue: { split: signal(true), compact: signal(false) },
};

async function render(url?: string) {
  const { service, calls } = recorded();
  dashboardReads = 0;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ShopsQueuePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      // The picker resolves what a row points at and searches for what to map
      // it to, so both descriptors have to be mounted or every lookup answers
      // nothing.
      provideResources(SUPERMARKETS, LOCATIONS),
      { provide: HARVEST_SERVICE, useValue: service },
      // The seeded dashboard, with its reads counted: the chains that have
      // shops waiting come from it, and a decision reads it again.
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
      WIDE,
    ],
  }).compileComponents();

  if (url !== undefined) {
    await TestBed.inject(Router).navigateByUrl(url);
  }

  const fixture = TestBed.createComponent(ShopsQueuePage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture, calls, page: fixture.componentInstance };
}

/** The page, with Mercadona chosen and its first read settled. */
async function opened() {
  const rendered = await render();
  rendered.page.chooseChain(MERCADONA);
  await drain();
  rendered.fixture.detectChanges();
  return rendered;
}

const named = (
  calls: { name: string; args: unknown[] }[],
  name: string
): unknown[][] => calls.filter((call) => call.name === name).map((c) => c.args);

const dialogOf = (fixture: ComponentFixture<ShopsQueuePage>): ConfirmDialog => {
  const element = fixture.debugElement.query(
    (node) => node.componentInstance instanceof ConfirmDialog
  );
  return element.componentInstance as ConfirmDialog;
};

describe('the source shops queue', () => {
  /**
   * `source_locations` is unique on (chain, code) and the mapping only means
   * anything inside one chain, so there is no route that lists every source's
   * shops and no screen that could use one.
   */
  it('reads nothing until a chain is chosen', async () => {
    const { calls, fixture, page } = await render();

    expect(named(calls, 'listShops')).toHaveLength(0);
    expect(page.queue).toBeNull();
    expect(fixture.nativeElement.querySelector('lib-queue-frame')).toBeNull();
  });

  /**
   * Admin plan 0044, target 4. With no chain chosen the queue lists the chains
   * that have shops waiting, with the count of each, most first.
   */
  it('lists the chains that have shops waiting while none is chosen', async () => {
    const { fixture, page } = await render();

    // The seed holds four unmapped shops of Mercadona and none of the others,
    // and a chain with nothing waiting is not offered.
    expect(page.waitingChains()).toEqual([
      { supermarketId: MERCADONA, count: 4 },
    ]);
    const rows: HTMLButtonElement[] = [
      ...fixture.nativeElement.querySelectorAll('.chains button'),
    ];
    expect(rows.map((row) => row.getAttribute('data-chain'))).toEqual([
      MERCADONA,
    ]);
    expect(rows[0].querySelector('.waiting')?.textContent).toBe('4');
    expect(fixture.nativeElement.textContent).toContain(
      'harvest.shops.chains.heading'
    );
  });

  it('chooses the chain that is pressed, through the filter the four queues share', async () => {
    const { fixture, page, calls } = await render();

    (
      fixture.nativeElement.querySelector(
        `.chains button[data-chain="${MERCADONA}"]`
      ) as HTMLButtonElement
    ).click();
    await drain();
    fixture.detectChanges();
    await drain();
    fixture.detectChanges();

    expect(TestBed.inject(ReviewChain).chain()).toBe(MERCADONA);
    expect(TestBed.inject(Router).url).toBe(`/?chain=${MERCADONA}`);
    expect(page.supermarketId()).toBe(MERCADONA);
    expect(named(calls, 'listShops')[0][0]).toMatchObject({
      supermarketId: MERCADONA,
    });
    expect(fixture.nativeElement.querySelector('.chains')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-queue-frame')
    ).not.toBeNull();
  });

  /** The chain is kept in the address, so a link and a reload open on it. */
  it('opens on the chain the address names', async () => {
    const { page, calls } = await render(`/?chain=${MERCADONA}`);

    expect(page.supermarketId()).toBe(MERCADONA);
    expect(named(calls, 'listShops')[0][0]).toMatchObject({
      supermarketId: MERCADONA,
      status: 'UNMAPPED',
    });
  });

  it('goes back to the list of chains when the filter is cleared', async () => {
    const { fixture, page } = await render(`/?chain=${MERCADONA}`);

    TestBed.inject(ReviewChain).choose('');
    await drain();
    fixture.detectChanges();

    expect(page.queue).toBeNull();
    expect(fixture.nativeElement.querySelector('.chains')).not.toBeNull();
  });

  /** The Review page above the queue draws the header (admin plan 0044). */
  it('draws no page header, and keeps what a row is behind an info button', async () => {
    const { fixture } = await render();

    expect(fixture.nativeElement.querySelector('lib-page-header')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.filters lib-info-button')
    ).not.toBeNull();
  });

  it('reads the chosen chain, waiting to be mapped, because that is what the queue is for', async () => {
    const { calls } = await opened();

    expect(named(calls, 'listShops')[0][0]).toMatchObject({
      supermarketId: MERCADONA,
      status: 'UNMAPPED',
    });
  });

  it('reads the other two states when they are asked for', async () => {
    const { page, calls } = await opened();

    page.chooseStatus({
      target: { value: 'IGNORED' },
    } as unknown as Event);
    await drain();

    expect(named(calls, 'listShops')[1][0]).toMatchObject({
      status: 'IGNORED',
    });
  });

  /** `status=` is not a status, and the route validates what it is given. */
  it('sends no status at all for every state', async () => {
    const { page, calls } = await opened();

    page.chooseStatus({ target: { value: '' } } as unknown as Event);
    await drain();

    expect(named(calls, 'listShops')[1][0]).not.toHaveProperty('status');
  });

  it('shows only the chosen chain, not every source', async () => {
    const { page } = await opened();

    expect(page.rows().length).toBeGreaterThan(0);
    expect(page.rows().map((row) => row.code)).not.toContain('0421');
  });

  /**
   * Section 2's six columns, from a seeded chain. The code is the source's own
   * key and the printed name is what it displayed, and neither is ours to edit,
   * which is why this is a bespoke screen rather than a descriptor.
   */
  it('draws the code, the printed name and what nobody has mapped yet', async () => {
    const { page } = await opened();
    const [row] = page.rows();

    expect(row.code).toBe('T1');
    expect(row.printedName).toBe('Ronda del Marrubial');
    expect(row.mappedTo).toBe('');
    expect(row.lastSeen).not.toBe('');
  });

  /**
   * A row bound by the automatic name match and a row bound by a person look
   * identical otherwise and carry different confidence, so `matchedBy` is a
   * column rather than a detail.
   */
  it('names the shop of ours a mapped row points at, and who bound it', async () => {
    const { page } = await opened();

    page.chooseStatus({ target: { value: 'ACTIVE' } } as unknown as Event);
    await drain();

    const automatic = page.rows().find((row) => row.code === 'C1');
    const byHand = page.rows().find((row) => row.code === 'C2');

    expect(automatic?.matchedBy).toBe('NAME_SIZE');
    expect(byHand?.matchedBy).toBe('MANUAL');
    expect(automatic?.mappedTo).toContain('Gran Capitán');
  });

  /**
   * A read that answered is not a failure, whatever it answered.
   *
   * `gatewayErrorKey` used to name the unknown failure for no failure at all,
   * and this screen guards the banner on truthiness, so every chain drew "That
   * did not work, and the server did not say why" over its own rows. It was
   * loudest on a chain with no shops in the chosen state, where the banner and
   * the empty sentence appeared together and contradicted each other.
   */
  it('says nothing went wrong when nothing went wrong', async () => {
    const { page, fixture } = await opened();

    expect(page.errorKey()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.error.unknown'
    );
  });

  it('draws the empty state alone when the chain has no shop in that state', async () => {
    const { page, fixture } = await render();

    // Carrefour's one seeded row is `UNMAPPED`, so asking for its ignored ones
    // is a read that answers nothing rather than a read that went wrong.
    page.chooseChain(CARREFOUR);
    await drain();
    page.chooseStatus({ target: { value: 'IGNORED' } } as unknown as Event);
    await drain();
    fixture.detectChanges();

    expect(page.errorKey()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('harvest.shops.empty');
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.error.unknown'
    );
  });
});

describe('mapping a source shop', () => {
  it('binds the picked shop of ours and moves the row out of the queue', async () => {
    const { page, fixture, calls } = await opened();
    const [row] = page.rows();

    page.startMapping(row);
    await page.pickLocation('loc_sierra');
    fixture.detectChanges();
    await page.confirmMapping();
    await drain();

    expect(named(calls, 'mapShop')[0]).toEqual([
      row.id,
      { supermarketLocationId: 'loc_sierra' },
    ]);
    // `ACTIVE` no longer matches the default filter, so the row leaves. That is
    // what makes this a queue rather than a table.
    expect(page.rows().map((shop) => shop.id)).not.toContain(row.id);
  });

  it('leaves a mapped row in place when its state is the one being listed', async () => {
    const { page, fixture, calls } = await opened();

    page.chooseStatus({ target: { value: '' } } as unknown as Event);
    await drain();
    fixture.detectChanges();

    const row = page.rows().find((candidate) => candidate.canMap);
    page.startMapping(row!);
    await page.pickLocation('loc_sierra');
    fixture.detectChanges();
    await page.confirmMapping();
    await drain();

    const after = page.rows().find((candidate) => candidate.id === row!.id);
    expect(after?.status).toBe('ACTIVE');
    expect(after?.matchedBy).toBe('MANUAL');
    expect(named(calls, 'mapShop')).toHaveLength(1);
  });

  /**
   * Backend plan 0084 section 7 is explicit: mapping a shop does not backfill
   * the availability the run skipped, and the next run writes it. Without that
   * line the natural reading of a green `ACTIVE` badge is "the data is here
   * now".
   *
   * Asserted on the dialog's inputs rather than on the rendered text, because
   * the sentence interpolates and the testing translator does not.
   */
  it('says what mapping does not do, before it does it', async () => {
    const { page, fixture } = await opened();
    const [row] = page.rows();

    page.startMapping(row);
    await page.pickLocation('loc_sierra');
    fixture.detectChanges();

    const dialog = dialogOf(fixture);
    expect(dialog.bodyKey()).toBe('harvest.shops.map.notBackfilled');
    expect(dialog.bodyArgs()).toEqual({
      shop: 'Ronda del Marrubial',
      location: expect.stringContaining('Trassierra'),
    });
  });

  it('writes nothing until the sentence has been read', async () => {
    const { page, fixture, calls } = await opened();

    page.startMapping(page.rows()[0]);
    await page.pickLocation('loc_sierra');
    fixture.detectChanges();

    expect(named(calls, 'mapShop')).toHaveLength(0);
  });

  /**
   * The picker is over one chain's shops, and `LOCATIONS` is listed under its
   * chain: without the scope there is no collection to read and the picker
   * answers an empty page whatever is typed.
   */
  it('offers only the chosen chain shops to map to', async () => {
    const { page } = await opened();

    expect(page.locationScope()).toEqual({ supermarketId: MERCADONA });
  });
});

/**
 * Admin plan 0044, target 2. A decision takes a row out of the queue, and the
 * count on the rail is the queue's length, so the counts are read again.
 */
describe('the counts, after a decision on a source shop', () => {
  it('reads the counts again after one shop is ignored', async () => {
    const { page } = await opened();
    const before = dashboardReads;

    await page.ignore(page.rows()[0]);
    await drain();

    expect(dashboardReads).toBe(before + 1);
  });
});

describe('ignoring a source shop', () => {
  /**
   * DEZA publishes eighteen centres and ten of them appear in the product
   * listing, so eight rows exist to be ignored once and never seen again.
   */
  it('takes it out of the default filter', async () => {
    const { page, calls } = await opened();
    const [row] = page.rows();

    await page.ignore(row);

    expect(named(calls, 'ignoreShop')[0][0]).toBe(row.id);
    expect(page.rows().map((shop) => shop.id)).not.toContain(row.id);
  });

  it('offers a way back, on the state that has one', async () => {
    const { page, calls } = await opened();

    page.chooseStatus({ target: { value: 'IGNORED' } } as unknown as Event);
    await drain();

    const [row] = page.rows();
    expect(row.canUnignore).toBe(true);

    await page.unignore(row);
    expect(named(calls, 'unignoreShop')[0][0]).toBe(row.id);
  });
});

/**
 * An ignored shop cannot be ignored again. The button stays in the bar,
 * disabled, so that Skip does not move into its slot: two quick presses on
 * Skip must never land on the next row's "Ignore".
 */
describe('the decide bar of a source shop that cannot be ignored', () => {
  const actionsOf = (fixture: ComponentFixture<ShopsQueuePage>): string[] =>
    [
      ...fixture.nativeElement.querySelectorAll(
        '.actions.decide > [data-action]'
      ),
    ].map((button) => (button as HTMLElement).dataset['action'] ?? '');
  const reject = (fixture: ComponentFixture<ShopsQueuePage>) =>
    fixture.nativeElement.querySelector(
      '.actions.decide [data-action="reject"]'
    ) as HTMLButtonElement | null;

  async function inReview(status?: string) {
    const rendered = await opened();
    if (status !== undefined) {
      rendered.page.chooseStatus({
        target: { value: status },
      } as unknown as Event);
      await drain();
      rendered.fixture.detectChanges();
    }
    return rendered;
  }

  it('offers Ignore on a shop that waits', async () => {
    const { fixture, page } = await inReview();

    expect(page.current()?.canIgnore).toBe(true);
    expect(actionsOf(fixture)).toEqual(['confirm', 'skip', 'reject']);
    expect(reject(fixture)?.disabled).toBe(false);
  });

  it('keeps Ignore in its slot, disabled, on a shop that is ignored', async () => {
    const { fixture, page, calls } = await inReview('IGNORED');

    expect(page.current()?.canIgnore).toBe(false);
    // The same three, in the same places.
    expect(actionsOf(fixture)).toEqual(['confirm', 'skip', 'reject']);
    expect(reject(fixture)?.disabled).toBe(true);

    reject(fixture)?.click();
    await drain();
    expect(named(calls, 'ignoreShop')).toHaveLength(0);
  });
});

describe('unmapping a source shop', () => {
  it('is offered on a mapped row and puts it back in the queue', async () => {
    const { page, calls } = await opened();

    page.chooseStatus({ target: { value: 'ACTIVE' } } as unknown as Event);
    await drain();

    const [row] = page.rows();
    expect(row.canUnmap).toBe(true);
    expect(row.canMap).toBe(false);

    await page.unmap(row);

    expect(named(calls, 'unmapShop')[0][0]).toBe(row.id);
    expect(page.rows().map((shop) => shop.id)).not.toContain(row.id);
  });
});

/**
 * Section 4, and the test that the filter added there actually reaches the
 * request. A picker whose target declares no `search` filter does not fail: it
 * drops the term and asks for the first page, so every search answers with the
 * same twenty shops and the three hundredth cannot be reached by typing at all.
 */
describe('the locations picker', () => {
  function listing() {
    const seen: ResourceQuery[] = [];

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideResources({
          ...LOCATIONS,
          gateway: () => ({
            list: async (query: ResourceQuery) => {
              seen.push(query);
              return { items: [], nextCursor: null };
            },
            read: async () => {
              throw new Error('not used');
            },
            create: async () => {
              throw new Error('not used');
            },
            update: async () => {
              throw new Error('not used');
            },
            remove: async () => undefined,
          }),
        }),
      ],
    });

    return { references: TestBed.inject(ResourceReferences), seen };
  }

  it('sends what was typed as the descriptor own search parameter', async () => {
    const { references, seen } = listing();

    await references.search('locations', 'gran capit', {
      supermarketId: MERCADONA,
    });

    expect(seen[0].filters).toEqual({
      supermarketId: MERCADONA,
      query: 'gran capit',
    });
  });

  /**
   * The scope is what addresses the collection rather than what narrows it, so
   * it goes even when nothing has been typed. Without it the list has no URL.
   */
  it('sends the chain even with an empty term', async () => {
    const { references, seen } = listing();

    await references.search('locations', '   ', {
      supermarketId: MERCADONA,
    });

    expect(seen[0].filters).toEqual({ supermarketId: MERCADONA });
  });
});

/**
 * Admin plan 0049, targets 5, 6 and 7. This queue opened as a list with a
 * checkbox on each row and a bar of bulk actions (plan 0020). The list is
 * gone: the queue opens on its first row, the rows are a column beside it,
 * and pressing one opens it where it sits.
 */
describe('the source shops queue, a column and no list', () => {
  const lines = (fixture: ComponentFixture<ShopsQueuePage>) =>
    [
      ...fixture.nativeElement.querySelectorAll('.column button.line'),
    ] as HTMLButtonElement[];

  it('opens on its first row, with no list of checkboxes and no bulk action', async () => {
    const { fixture, page } = await opened();
    const host: HTMLElement = fixture.nativeElement;

    expect(page.current()?.id).toBe(page.rows()[0].id);
    expect(host.querySelector('.subject')).not.toBeNull();
    expect(host.querySelector('.rows')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector('.bulk')).toBeNull();
  });

  it('draws no view switch and no count of rows left and decided', async () => {
    const { fixture } = await opened();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.views')).toBeNull();
    expect(host.textContent).not.toContain('harvest.queue.view');
    expect(host.textContent).not.toContain('harvest.queue.tally');
  });

  it('draws the columns it already had on every line', async () => {
    const { fixture, page } = await opened();
    const [first] = lines(fixture);

    expect(lines(fixture)).toHaveLength(page.rows().length);
    expect(first.textContent).toContain('T1');
    expect(first.textContent).toContain('Ronda del Marrubial');
    // The match rule is a column and not a detail: a row the automatic match
    // bound and a row a person bound differ in nothing else.
    expect(first.textContent).toContain('harvest.match.NAME_SIZE');
  });

  /**
   * The owner's words: "if you select row 5, the top 4 should still be
   * available, and the list won't scroll or anything."
   */
  it('opens a pressed line where it sits, and moves no other line', async () => {
    const { fixture, page } = await opened();
    const before = page.rows().map((row) => row.id);
    const at = before.length - 1;
    expect(at).toBeGreaterThan(0);

    lines(fixture)[at].click();
    await drain();
    fixture.detectChanges();

    expect(page.current()?.id).toBe(before[at]);
    expect(page.rows().map((row) => row.id)).toEqual(before);
    expect(
      lines(fixture).map((line) => line.getAttribute('aria-current'))
    ).toEqual(before.map((_, index) => (index === at ? 'true' : null)));
  });

  it('goes to the next line on a skip, and moves no line', async () => {
    const { fixture, page } = await opened();
    const before = page.rows().map((row) => row.id);

    (
      fixture.nativeElement.querySelector(
        '[data-action="skip"]'
      ) as HTMLButtonElement
    ).click();
    await drain();
    fixture.detectChanges();

    expect(page.current()?.id).toBe(before[1]);
    expect(page.rows().map((row) => row.id)).toEqual(before);
  });

  /** A row that stays after its decision keeps its place, and stays open. */
  it('keeps a decided row that stays where it was, and open', async () => {
    const { fixture, page } = await opened();

    page.chooseStatus({ target: { value: '' } } as unknown as Event);
    await drain();
    fixture.detectChanges();

    const before = page.rows().map((row) => row.id);
    const at = page.rows().findIndex((row) => row.canIgnore);
    lines(fixture)[at].click();
    await drain();
    await page.ignore(page.rows()[at]);
    fixture.detectChanges();

    expect(page.rows().map((row) => row.id)).toEqual(before);
    expect(page.current()?.id).toBe(before[at]);
    expect(page.current()?.status).toBe('IGNORED');
  });

  /** A picker opened for one row does not follow the operator to another. */
  it('drops a mapping that was being picked when another line is opened', async () => {
    const { fixture, page } = await opened();

    page.startMapping(page.rows()[0]);
    expect(page.mapping()).not.toBeNull();

    lines(fixture)[1].click();
    await drain();

    expect(page.mapping()).toBeNull();
  });
});

/**
 * Section 1.1. The screen used to read one page of a hundred and never look at
 * the cursor, so a chain with more than a hundred source locations showed a
 * hundred of them with nothing on the screen saying so.
 */
describe('a chain with more shops than one page', () => {
  const MANY = 150;

  function paged(): HarvestServiceI {
    const shops = Array.from({ length: MANY }, (_, at) => ({
      id: `shop-${at}`,
      supermarketId: MERCADONA,
      externalId: `T${at}`,
      printedName: `Shop ${at}`,
      supermarketLocationId: null,
      status: 'UNMAPPED' as const,
      matchedBy: 'NAME_SIZE' as const,
      firstSeenAt: '2026-08-28T08:00:00.000Z',
      lastSeenAt: '2026-08-30T08:00:00.000Z',
      firstRunId: null,
      lastRunId: null,
    }));

    return {
      listShops: async (query: { cursor?: string; limit?: number }) => {
        const from = Number(query.cursor ?? '0');
        const next = from + (query.limit ?? 25);
        return {
          items: shops.slice(from, next),
          nextCursor: next < shops.length ? String(next) : null,
        };
      },
    } as unknown as HarvestServiceI;
  }

  async function many() {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ShopsQueuePage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        ContentLocaleStore,
        WIDE,
        ServerReachability,
        provideRouter([]),
        provideLocationMocks(),
        provideResources(SUPERMARKETS, LOCATIONS),
        { provide: HARVEST_SERVICE, useValue: paged() },
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

    const fixture = TestBed.createComponent(ShopsQueuePage);
    fixture.detectChanges();
    await drain();

    fixture.componentInstance.chooseChain(MERCADONA);
    await drain();
    fixture.detectChanges();

    return { fixture, page: fixture.componentInstance };
  }

  it('says there are more rather than stopping silently', async () => {
    const { fixture, page } = await many();

    expect(page.rows().length).toBeLessThan(MANY);
    expect(page.queue?.canLoadMore()).toBe(true);
    expect(fixture.nativeElement.querySelector('.more')).not.toBeNull();
  });

  it('reads the next page when the button asks for it', async () => {
    const { fixture, page } = await many();
    const first = page.rows().length;

    fixture.nativeElement.querySelector('.more').click();
    await drain();
    fixture.detectChanges();

    expect(page.rows().length).toBeGreaterThan(first);
  });
});

/**
 * Admin plan 0034, section 3; backend plan 0154. Each unmapped shop shows the
 * shops of ours it may be, best first, with a strong mark where every printed
 * token was found, and one press maps it. Nothing maps without that press.
 */
describe('the source shops queue, with candidates', () => {
  async function reviewing() {
    return opened();
  }

  it('lists the candidates best first, with the strong one marked', async () => {
    const { fixture, page } = await reviewing();

    expect(page.current()?.id).toBe('shop-t1');
    expect(
      page.current()?.candidates.map((found) => found.supermarketLocationId)
    ).toEqual(['loc_cordoba_centro', 'loc_cordoba_oeste']);

    const items = fixture.nativeElement.querySelectorAll('.candidates li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Marrubial');
    expect(items[0].textContent).toContain('harvest.shops.candidates.strong');
    expect(items[1].textContent).not.toContain(
      'harvest.shops.candidates.strong'
    );
  });

  it('maps nothing until a candidate is pressed', async () => {
    const { calls } = await reviewing();

    expect(named(calls, 'mapShop')).toHaveLength(0);
  });

  it('maps the shop to the pressed candidate, in one press', async () => {
    const { fixture, page, calls } = await reviewing();

    fixture.nativeElement.querySelectorAll('.candidates li button')[1].click();
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'mapShop')).toEqual([
      ['shop-t1', { supermarketLocationId: 'loc_cordoba_oeste' }],
    ]);
    // Mapped, so it leaves the default filter and no dialog was asked for.
    expect(page.rows().some((row) => row.id === 'shop-t1')).toBe(false);
    expect(page.confirming()).toBeNull();
  });

  it('offers no candidates on a row that is already mapped', async () => {
    const { page } = await opened();

    page.chooseStatus({ target: { value: 'ACTIVE' } } as unknown as Event);
    await drain();

    expect(page.rows().length).toBeGreaterThan(0);
    for (const row of page.rows()) {
      expect(row.candidates).toEqual([]);
    }
  });

  it('names the best candidate on a line of the column', async () => {
    const { fixture } = await opened();

    expect(
      fixture.nativeElement.querySelector('.column').textContent
    ).toContain('harvest.shops.candidates.best');
  });
});
