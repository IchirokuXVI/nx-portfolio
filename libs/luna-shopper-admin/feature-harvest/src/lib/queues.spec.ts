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
