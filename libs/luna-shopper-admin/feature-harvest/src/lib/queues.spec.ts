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
import { EntriesQueuePage } from './entries-queue-page';
import { ItemRefsQueuePage } from './item-refs-queue-page';
import { PlacesQueuePage } from './places-queue-page';

/**
 * Section 7's fifth test: **each queue's confirm and reject call the right route
 * and advance to the next item.**
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

describe('the item refs queue', () => {
  it('reads the unresolved queue and not the whole list', async () => {
    const { calls } = await render(ItemRefsQueuePage);

    expect(named(calls, 'listUnresolvedItemRefs').length).toBe(1);
    expect(named(calls, 'listItemRefs').length).toBe(0);
  });

  it('confirms the current ref and advances', async () => {
    const { fixture, calls } = await render(ItemRefsQueuePage);
    const page = fixture.componentInstance;
    const first = page.queue.current();

    page.confirm();
    await drain();

    expect(named(calls, 'confirmItemRef')[0][0]).toBe(first?.id);
    expect(page.queue.current()?.id).not.toBe(first?.id);
  });

  it('rejects the current ref and advances', async () => {
    const { fixture, calls } = await render(ItemRefsQueuePage);
    const page = fixture.componentInstance;
    const first = page.queue.current();

    page.reject();
    await drain();

    expect(named(calls, 'rejectItemRef')[0][0]).toBe(first?.id);
    expect(page.queue.current()?.id).not.toBe(first?.id);
  });

  /**
   * The third action, and the one that makes this queue different. Without it an
   * operator whose match is wrong can only reject, which leaves the item with no
   * price rather than the right one.
   */
  it('points the ref at another product and counts that as decided', async () => {
    const { fixture, calls } = await render(ItemRefsQueuePage);
    const page = fixture.componentInstance;
    const first = page.queue.current();

    page.externalId.set('99999');
    page.correct();
    await drain();

    expect(named(calls, 'setManualItemRef')[0][0]).toEqual({
      itemId: first?.itemId,
      supermarketId: first?.supermarketId,
      externalId: '99999',
    });
    expect(page.queue.current()?.id).not.toBe(first?.id);
  });

  it('does nothing when the correction is blank', async () => {
    const { fixture, calls } = await render(ItemRefsQueuePage);

    fixture.componentInstance.externalId.set('   ');
    fixture.componentInstance.correct();
    await drain();

    expect(named(calls, 'setManualItemRef').length).toBe(0);
  });

  /**
   * Derived rather than read: there is no `GONE` status. The seed carries one of
   * each, so the queue can tell a ref nobody ever resolved from one whose
   * product has stopped appearing.
   */
  it('tells a never resolved ref from one that has gone', async () => {
    const { fixture } = await render(ItemRefsQueuePage);
    const page = fixture.componentInstance;

    const seen = [page.problem()];
    page.queue.skip();
    fixture.detectChanges();
    seen.push(page.problem());

    expect(new Set(seen)).toEqual(new Set(['unmatched', 'stale']));
  });
});

describe('the source entries queue', () => {
  /**
   * Entries are addressed under their chain, so there is no queue until one is
   * chosen. That is why this screen opens on a chooser rather than on an empty
   * list.
   */
  it('has no queue until a chain is chosen', async () => {
    const { fixture, calls } = await render(EntriesQueuePage);

    expect(fixture.componentInstance.queue).toBeNull();
    expect(named(calls, 'listEntries').length).toBe(0);
  });

  it('reads only the entries with no catalog item yet', async () => {
    const { fixture, calls } = await render(EntriesQueuePage);

    fixture.componentInstance.supermarketId.set(
      '11111111-1111-4111-8111-111111111111'
    );
    fixture.componentInstance.open();
    await drain();

    expect(named(calls, 'listEntries')[0][0]).toMatchObject({
      supermarketId: '11111111-1111-4111-8111-111111111111',
      unmatchedOnly: true,
    });
  });

  it('creates an item from the current entry and advances', async () => {
    const { fixture, calls } = await render(EntriesQueuePage);
    const page = fixture.componentInstance;

    page.supermarketId.set('11111111-1111-4111-8111-111111111111');
    page.open();
    await drain();

    const first = page.queue?.current();
    page.category.set('DAIRY');
    page.importEntry();
    await drain();

    const args = named(calls, 'createItemFromEntry')[0];
    expect(args[1]).toBe(first?.id);
    expect(args[2]).toEqual({ category: 'DAIRY' });
    expect(page.queue?.current()?.id).not.toBe(first?.id);
  });
});
