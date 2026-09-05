import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
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
  ITEMS,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import { AliasesQueuePage } from './aliases-queue-page';
import { queuedAliases } from './queued-aliases';
import { HARVEST_LINKS, HARVEST_SEGMENT } from './routes';

/**
 * The printed names a leaflet import could not resolve (admin plan 0010,
 * section 7).
 *
 * Driven through the in-memory harvester, which mutates, so "leaves the queue"
 * is a real property rather than an assertion about a mock's call list: a
 * rejected name really does stop matching, and the next row really is the next
 * one. The calls are recorded on top of it so the route can be named as well.
 *
 * The chain is DEZA's seeded uuid, because the queue reads nothing at all until
 * one is chosen and there is no route that lists every chain's names.
 */

const DEZA = '33333333-3333-4333-8333-333333333333';

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

async function render(queryParams: Record<string, string> = {}) {
  const { service, calls } = recorded();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AliasesQueuePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      // The chain chooser and the product picker each read a descriptor, so
      // both have to be mounted or every lookup answers nothing.
      provideResources(SUPERMARKETS, ITEMS),
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
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(queryParams) },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AliasesQueuePage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture, calls, page: fixture.componentInstance };
}

/** The page, with DEZA chosen and its first read settled. */
async function opened() {
  const rendered = await render();
  rendered.page.open(DEZA);
  await drain();
  rendered.fixture.detectChanges();
  return rendered;
}

const named = (
  calls: { name: string; args: unknown[] }[],
  name: string
): unknown[][] => calls.filter((call) => call.name === name).map((c) => c.args);

describe('the leaflet names queue', () => {
  it('reads nothing until a chain is chosen', async () => {
    const { page, calls } = await render();

    expect(page.chosen()).toBe('');
    expect(page.queue).toBeNull();
    expect(named(calls, 'listAliases')).toEqual([]);
  });

  /**
   * A run's own link names the chain, so an operator arriving from the run that
   * queued these rows is not asked to pick it again.
   */
  it('opens on the chain a link named', async () => {
    const { page, calls } = await render({ supermarketId: DEZA });
    await drain();

    expect(page.chosen()).toBe(DEZA);
    expect(named(calls, 'listAliases')[0][0]).toMatchObject({
      supermarketId: DEZA,
    });
  });

  /**
   * No status asked for, which is the queue: `CANDIDATE` and `UNRESOLVED`
   * together. A rejection is not a question and must not come back as one.
   */
  it('asks for the rows waiting for a person and no others', async () => {
    const { page, calls } = await opened();

    expect(named(calls, 'listAliases')[0][0]).not.toHaveProperty('status');
    expect(
      page.queue!.items().every((alias) => alias.status !== 'REJECTED')
    ).toBe(true);
  });

  /**
   * The fuzzy rung proposed a product and wrote nothing. Agreeing is one press,
   * because the candidate is already in the picker.
   */
  it('preselects the candidate the run proposed', async () => {
    const { page } = await opened();
    // Skip past the row with no candidate to the one that has one.
    while (page.row()?.candidateItemId === '') {
      page.queue!.skip();
      page.itemId.set(page.row()?.candidateItemId ?? '');
    }

    expect(page.candidate()).toBe(true);
    expect(page.itemId()).toBe('item-milk');
  });

  it('accepts to the picked product and advances', async () => {
    const { page, calls, fixture } = await opened();
    const first = page.queue!.current();
    page.itemId.set('item-bread');

    page.accept();
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'acceptAlias')[0]).toEqual([
      first?.id,
      { itemId: 'item-bread' },
    ]);
    expect(page.queue!.current()?.id).not.toBe(first?.id);
  });

  /** Sending an empty id would be a 400 about a field nobody filled in. */
  it('does not accept with no product picked', async () => {
    const { page, calls } = await opened();
    page.itemId.set('');

    page.accept();
    await drain();

    expect(named(calls, 'acceptAlias')).toEqual([]);
  });

  /**
   * Accepting writes the price the row was queued for, and the confirmation
   * says so. Asserted on the component's own value rather than on rendered
   * text, because the sentence interpolates and the testing translator does
   * not interpolate.
   */
  it('says what accepting wrote, for the row it was queued for', async () => {
    const { page, fixture } = await opened();
    const queued = page.row();
    page.itemId.set('item-bread');

    page.accept();
    await drain();
    fixture.detectChanges();

    expect(page.written()).toEqual({
      count: 1,
      name: queued?.printedName,
      price: queued?.price,
    });
  });

  /**
   * A new product from a leaflet is saved with **no English name** (backend
   * plan 0079). Before that, the only way to save one was to copy the Spanish
   * string into English, where it claimed to be a translation.
   */
  it('creates a product with the edited name and no English one', async () => {
    const { page, calls, fixture } = await opened();
    const first = page.queue!.current();

    page.nameEs.set('Cerveza Radler Cruzcampo lata 33 cl');
    page.brand.set('Cruzcampo');
    page.category.set('BEVERAGES');
    page.defaultUnit.set('UNIT');

    page.createItem();
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'createItemFromAlias')[0]).toEqual([
      first?.id,
      {
        name: { es: 'Cerveza Radler Cruzcampo lata 33 cl' },
        brand: 'Cruzcampo',
        category: 'BEVERAGES',
        defaultUnit: 'UNIT',
      },
    ]);
  });

  it('sends an English name when the operator typed one', async () => {
    const { page, calls } = await opened();

    page.nameEs.set('Leche entera');
    page.nameEn.set('Whole milk');
    page.createItem();
    await drain();

    expect(named(calls, 'createItemFromAlias')[0][1]).toMatchObject({
      name: { es: 'Leche entera', en: 'Whole milk' },
    });
  });

  /** The printed name is what the new product's Spanish name starts from. */
  it('starts the new product name from what the leaflet printed', async () => {
    const { page } = await opened();

    expect(page.nameEs()).toBe(page.row()?.printedName);
    expect(page.nameEn()).toBe('');
    expect(page.brand()).toBe(page.row()?.printedBrand);
  });

  /**
   * The picker must not still hold the previous row's product. The queue's
   * whole hazard is binding a printed name to the wrong product.
   */
  it('points the controls at the next row after a decision', async () => {
    const { page, fixture } = await opened();
    page.itemId.set('item-bread');

    page.accept();
    await drain();
    fixture.detectChanges();

    const next = page.row();
    expect(page.itemId()).toBe(next?.candidateItemId ?? '');
    expect(page.nameEs()).toBe(next?.printedName ?? '');
  });

  it('rejects the current row and takes it out of the queue', async () => {
    const { page, calls, fixture } = await opened();
    const first = page.queue!.current();

    page.reject();
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'rejectAlias')[0]).toEqual([first?.id]);
    expect(page.queue!.items().some((alias) => alias.id === first?.id)).toBe(
      false
    );
  });

  /**
   * The navigation badge and this page are the same number, because the page is
   * the only thing that knows which chain it is for.
   */
  it('gives the navigation the count the queue is showing', async () => {
    const { page, fixture } = await opened();

    expect(queuedAliases()).toBe(page.queue!.items().length);

    page.reject();
    await drain();
    fixture.detectChanges();

    expect(queuedAliases()).toBe(page.queue!.items().length);
  });

  it('puts the badge on the queue link and on no other', async () => {
    const withBadge = HARVEST_LINKS.filter((link) => link.badge !== undefined);

    expect(withBadge.map((link) => link.path)).toEqual([
      `/${HARVEST_SEGMENT}/leaflets/queue`,
    ]);
  });
});
