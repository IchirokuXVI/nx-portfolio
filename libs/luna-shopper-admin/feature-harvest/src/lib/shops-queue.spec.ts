import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
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
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
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

async function render() {
  const { service, calls } = recorded();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ShopsQueuePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      // The picker resolves what a row points at and searches for what to map
      // it to, so both descriptors have to be mounted or every lookup answers
      // nothing.
      provideResources(SUPERMARKETS, LOCATIONS),
      { provide: HARVEST_SERVICE, useValue: service },
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
    const { calls, fixture } = await render();

    expect(named(calls, 'listShops')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain(
      'harvest.shops.chooseChain'
    );
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
