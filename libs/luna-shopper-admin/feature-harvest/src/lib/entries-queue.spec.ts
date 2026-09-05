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
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { EntriesQueuePage } from './entries-queue-page';

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

async function render() {
  const { service, calls } = recorded();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [EntriesQueuePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
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
          resolve: async () => null,
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

describe('the one queue, before a chain is chosen', () => {
  /**
   * A row is keyed on (`supermarketId`, `externalId`), so there is no route that
   * answers every chain's rows. That is why this screen opens on a chooser
   * rather than on an empty list.
   */
  it('has no queue and reads nothing', async () => {
    const { fixture, calls } = await render();

    expect(fixture.componentInstance.queue).toBeNull();
    expect(named(calls, 'listEntries').length).toBe(0);
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

    expect(named(calls, 'listEntries')[0][0]).toEqual({
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
    page.category.set('DAIRY');
    page.createItem();
    await drain();

    expect(named(calls, 'createItemFromEntry')[0][1]).toEqual({
      name: { es: 'Leche entera de vaca' },
      category: 'DAIRY',
    });
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
