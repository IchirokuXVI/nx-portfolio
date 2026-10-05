import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { SUPERMARKETS } from '@portfolio/luna-shopper-admin/feature-catalog';
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { PlacesQueuePage } from './places-queue-page';

/** A chain the catalog seed holds, so the picker's lookup can name it. */
const MERCADONA = 'sm_mercadona';

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

async function render<T>(
  component: new (...args: never[]) => T,
  options: { split?: boolean } = {}
) {
  const { service, calls } = recorded();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [component as never, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      // The chain picker resolves and searches through the supermarkets
      // descriptor, so it has to be mounted or every lookup answers nothing.
      provideResources(SUPERMARKETS),
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
      // The column of a queue is drawn at the split width only, and jsdom has
      // no width. A spec that needs the column says so.
      {
        provide: Viewport,
        useValue: {
          split: signal(options.split === true),
          compact: signal(false),
        },
      },
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
    expect(page.queue.items().map((place) => place.id)).not.toContain(
      first?.id
    );
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

  it('sends no chain id when the picker is left empty', async () => {
    const { fixture, calls } = await render(PlacesQueuePage);

    fixture.componentInstance.importPlace();
    await drain();

    expect(named(calls, 'importPlace')[0][1]).toEqual({});
  });

  it('sends the picked chain, and resets the picker after the decision', async () => {
    const { fixture, calls } = await render(PlacesQueuePage);

    fixture.componentInstance.supermarketId.set(MERCADONA);
    fixture.componentInstance.importPlace();
    await drain();

    expect(named(calls, 'importPlace')[0][1]).toEqual({
      supermarketId: MERCADONA,
    });
    // The reset the old text input had, kept: a leftover choice would quietly
    // file the next place under the previous chain.
    expect(fixture.componentInstance.supermarketId()).toBe('');
  });
});

/**
 * Admin plan 0049, targets 5, 6 and 7. The queue had a second view, a list
 * with a checkbox on each row and a bar of bulk actions (plan 0020). It is
 * gone. The rows are a column beside the open place on a wide screen, and
 * pressing one opens it where it sits.
 */
describe('the discovered places queue, a column and no list', () => {
  const lines = (fixture: ComponentFixture<PlacesQueuePage>) =>
    [
      ...fixture.nativeElement.querySelectorAll('.column button.line'),
    ] as HTMLButtonElement[];

  it('draws no list of checkboxes and no bulk action', async () => {
    const { fixture } = await render(PlacesQueuePage, { split: true });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.subject')).not.toBeNull();
    expect(host.querySelector('.rows')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector('.bulk')).toBeNull();
    expect(host.textContent).not.toContain('harvest.places.bulk');
  });

  /** "Grouped by chain" is a view of this queue's own, and it stays. */
  it('offers one at a time and grouped by chain, and no "As a list"', async () => {
    const { fixture } = await render(PlacesQueuePage);

    const views = [
      ...fixture.nativeElement.querySelectorAll('.views button'),
    ].map((button: HTMLElement) => button.dataset['view']);

    expect(views).toEqual(['review', 'groups']);
  });

  it('says no count of places left and decided', async () => {
    const { fixture } = await render(PlacesQueuePage, { split: true });

    expect(fixture.nativeElement.textContent).not.toContain(
      'harvest.queue.tally'
    );
  });

  it('draws one line per place in the column, by name', async () => {
    const { fixture } = await render(PlacesQueuePage, { split: true });
    const page = fixture.componentInstance;

    expect(lines(fixture)).toHaveLength(page.queue.items().length);
    expect(lines(fixture)[0].textContent).toContain(
      page.queue.items()[0].name ?? page.queue.items()[0].externalRef
    );
  });

  /**
   * The owner's words: "if you select row 5, the top 4 should still be
   * available, and the list won't scroll or anything."
   */
  it('opens a pressed line where it sits, and moves no other line', async () => {
    const { fixture } = await render(PlacesQueuePage, { split: true });
    const page = fixture.componentInstance;
    const before = page.queue.items().map((place) => place.id);
    const said = lines(fixture).map((line) => line.textContent);
    const at = before.length - 1;

    lines(fixture)[at].click();
    await drain();
    fixture.detectChanges();

    expect(page.queue.current()?.id).toBe(before[at]);
    expect(page.queue.items().map((place) => place.id)).toEqual(before);
    expect(lines(fixture).map((line) => line.textContent)).toEqual(said);
    expect(
      lines(fixture).map((line) => line.getAttribute('aria-current'))
    ).toEqual(before.map((_, index) => (index === at ? 'true' : null)));
  });

  it('goes to the next line on a skip, and moves no line', async () => {
    const { fixture } = await render(PlacesQueuePage, { split: true });
    const page = fixture.componentInstance;
    const before = page.queue.items().map((place) => place.id);

    (
      fixture.nativeElement.querySelector(
        '[data-action="skip"]'
      ) as HTMLButtonElement
    ).click();
    await drain();
    fixture.detectChanges();

    expect(page.queue.current()?.id).toBe(before[1]);
    expect(page.queue.items().map((place) => place.id)).toEqual(before);
  });
});
