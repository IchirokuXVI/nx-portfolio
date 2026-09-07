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
import { PlacesQueuePage } from './places-queue-page';

/**
 * Section 7's fifth test: **each queue's confirm and reject call the right route
 * and advance to the next item.**
 *
 * The product queue moved out of this file with admin plan 0014: it grew two
 * filters, a proposal that is sometimes another row, and three decisions rather
 * than one, so it earned `entries-queue.spec.ts`. The item refs queue went
 * altogether, with the table behind it (backend plan 0086).
 *
 * Driven through the in-memory harvester, which mutates, so "advances" is a real
 * property rather than an assertion about a mock's call list: confirming really
 * does take the item out of the queue, and the next item really is the next one.
 * The calls are recorded on top of it so the route can be named as well.
 */

const drain = async () => {
  for (let i = 0; i < 8; i++) {
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

async function render<T>(component: new (...args: never[]) => T) {
  const { service, calls } = recorded();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [component as never, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
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

  const fixture = TestBed.createComponent(component as never);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture: fixture as ComponentFixture<T>, calls };
}

const named = (
  calls: { name: string; args: unknown[] }[],
  name: string
): unknown[][] => calls.filter((call) => call.name === name).map((c) => c.args);

describe('the discovered places queue', () => {
  it('reads only the places nobody has decided yet', async () => {
    const { calls } = await render(PlacesQueuePage);

    expect(named(calls, 'listPlaces')[0][0]).toMatchObject({ status: 'NEW' });
  });

  it('imports the current place and advances to the next', async () => {
    const { fixture, calls } = await render(PlacesQueuePage);
    const page = fixture.componentInstance;
    const first = page.queue.current();

    page.importPlace();
    await drain();

    expect(named(calls, 'importPlace')[0][0]).toBe(first?.id);
    expect(page.queue.current()?.id).not.toBe(first?.id);
    expect(page.queue.decided()).toBe(1);
  });

  it('rejects the current place and advances to the next', async () => {
    const { fixture, calls } = await render(PlacesQueuePage);
    const page = fixture.componentInstance;
    const first = page.queue.current();

    page.reject();
    await drain();

    expect(named(calls, 'rejectPlace')[0][0]).toBe(first?.id);
    expect(page.queue.current()?.id).not.toBe(first?.id);
  });

  /**
   * The whole reason this queue shows more than one item. `Dia` and `Maxi Dia`
   * share one Wikidata identifier and sit on the same corner, so the evidence
   * for the decision is the other row.
   */
  it('shows the near duplicate beside the place being decided', async () => {
    const { fixture } = await render(PlacesQueuePage);

    expect(fixture.componentInstance.near().length).toBeGreaterThan(0);
  });

  it('sends no chain id when the field is left blank', async () => {
    const { fixture, calls } = await render(PlacesQueuePage);

    fixture.componentInstance.importPlace();
    await drain();

    expect(named(calls, 'importPlace')[0][1]).toEqual({});
  });

  it('sends the chain id when one is typed', async () => {
    const { fixture, calls } = await render(PlacesQueuePage);

    fixture.componentInstance.supermarketId.set('  chain-7  ');
    fixture.componentInstance.importPlace();
    await drain();

    expect(named(calls, 'importPlace')[0][1]).toEqual({
      supermarketId: 'chain-7',
    });
  });
});

/**
 * Plan 0020. The places queue is the interesting one: the question it asks is
 * whether two rows are one shop, and a list is a better answer to that than one
 * row at a time is. The near duplicates panel stays in review for the cases
 * where it is not, and the screen still opens in review.
 */
describe('the discovered places queue as a list', () => {
  async function listed() {
    const rendered = await render(PlacesQueuePage);
    const toggles =
      rendered.fixture.nativeElement.querySelectorAll('.views button');
    toggles[1].click();
    await drain();
    rendered.fixture.detectChanges();
    return { ...rendered, page: rendered.fixture.componentInstance };
  }

  it('opens one at a time, and reaches the list through the toggle', async () => {
    const { fixture } = await render(PlacesQueuePage);

    expect(fixture.nativeElement.querySelector('.rows')).toBeNull();
    expect(fixture.nativeElement.querySelector('.subject')).not.toBeNull();
  });

  it('draws one row per place, with a checkbox and the review view own columns', async () => {
    const { fixture, page } = await listed();

    const rows = fixture.nativeElement.querySelectorAll('.rows li');
    expect(rows).toHaveLength(page.queue.items().length);
    expect(rows[0].querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(rows[0].textContent).toContain(
      page.queue.items()[0].name ?? page.queue.items()[0].externalRef
    );
  });

  it('opens a clicked row one at a time, with that row in front', async () => {
    const { fixture, page } = await listed();
    const second = page.queue.items()[1];

    fixture.nativeElement.querySelectorAll('.rows .cells')[1].click();
    await drain();
    fixture.detectChanges();

    expect(page.queue.current()?.id).toBe(second.id);
    expect(fixture.nativeElement.querySelector('.subject')).not.toBeNull();
  });

  /**
   * Section 4. Both calls take everything they need off the row, so both are
   * offered; nothing else here is.
   */
  it('offers exactly import and reject', async () => {
    const { fixture } = await listed();

    const labels = [
      ...fixture.nativeElement.querySelectorAll('.bulk button'),
    ].map((node: Element) => node.textContent?.trim());

    expect(labels).toEqual([
      'harvest.places.bulk.import',
      'harvest.places.bulk.reject',
    ]);
  });

  it('names the action and the exact count in the confirmation', async () => {
    const { fixture, page } = await listed();

    page.queue.selectLoaded();
    page.askReject();
    fixture.detectChanges();

    expect(page.pending()).toMatchObject({
      headingKey: 'harvest.places.bulk.rejectConfirm.heading',
      confirmKey: 'harvest.places.bulk.reject',
      count: page.queue.selectedCount(),
    });
  });

  it('writes nothing until the confirmation is answered', async () => {
    const { fixture, page, calls } = await listed();

    page.queue.selectLoaded();
    page.askReject();
    fixture.detectChanges();
    await drain();

    expect(named(calls, 'rejectPlace')).toHaveLength(0);
  });

  /**
   * The empty body is section 4's rule: catalog resolves the chain from the
   * place's own brand, so a chain typed for one place is never applied to the
   * other hundred and ninety nine.
   */
  it('imports every selected place with no chain named', async () => {
    const { page, calls } = await listed();

    page.supermarketId.set('chain-7');
    page.queue.selectLoaded();
    const wanted = page.queue.items().map((place) => place.id);
    page.askImport();
    page.go(page.pending()!);
    await drain();

    expect(named(calls, 'importPlace')).toHaveLength(wanted.length);
    for (const args of named(calls, 'importPlace')) {
      expect(args[1]).toEqual({});
    }
    expect(page.queue.items()).toEqual([]);
    expect(page.report()?.succeeded).toBe(wanted.length);
  });

  it('rejects every selected place and takes them out of the queue', async () => {
    const { page, calls } = await listed();

    page.queue.selectLoaded();
    const wanted = page.queue.items().map((place) => place.id);
    page.askReject();
    page.go(page.pending()!);
    await drain();

    expect(
      named(calls, 'rejectPlace')
        .map((args) => args[0])
        .sort()
    ).toEqual([...wanted].sort());
    expect(page.queue.items()).toEqual([]);
  });
});
