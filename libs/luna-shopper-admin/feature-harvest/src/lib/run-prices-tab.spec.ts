import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  type HarvestServiceI,
  type RunPriceQuery,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { RunPricesTab, toRunPriceRow } from './run-prices-tab';

/**
 * The "Prices written" tab (admin plan 0033), against the in memory harvester,
 * whose seed holds three rows for the completed walk: two it inserted and one
 * an earlier run inserted that it confirmed.
 */

const drain = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

/** What the tab asked for, so a spec can say which product it narrowed to. */
function recorded(service: HarvestServiceI) {
  const asked: RunPriceQuery[] = [];
  const wrapped = Object.assign(Object.create(service), {
    listRunPrices: (runId: string, query: RunPriceQuery) => {
      asked.push(query);
      return service.listRunPrices(runId, query);
    },
  }) as HarvestServiceI;
  return { asked, wrapped };
}

async function render(
  runId: string,
  service: HarvestServiceI = new HarvestMemory()
): Promise<ComponentFixture<RunPricesTab>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunPricesTab, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: ResourceReferences,
        useValue: {
          resolve: async (resource: string, id: string) =>
            resource === 'items' && id === 'it_milk_1l'
              ? { id, title: 'Whole milk 1 L' }
              : null,
          search: async () => [],
        },
      },
      {
        provide: ResourceRegistry,
        useValue: { pathOf: () => ['/', 'catalog', 'items'] },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunPricesTab);
  fixture.componentRef.setInput('runId', runId);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<RunPricesTab>): string =>
  fixture.nativeElement.textContent;

describe('the prices a run wrote', () => {
  it('lists the rows the run inserted and the ones it confirmed', async () => {
    const fixture = await render('run-catalog-completed');

    expect(
      fixture.componentInstance.shown().map((row) => row.writtenBy)
    ).toEqual(['INSERTED', 'INSERTED', 'CONFIRMED']);
    expect(text(fixture)).toContain('harvest.run.prices.written.INSERTED');
    expect(text(fixture)).toContain('harvest.run.prices.written.CONFIRMED');
  });

  it('names the product and links it to its prices at every scope', async () => {
    const fixture = await render('run-catalog-completed');
    const [first] = fixture.componentInstance.shown();

    expect(first.item).toBe('Whole milk 1 L');
    expect(first.link).toEqual([
      '/',
      'catalog',
      'items',
      'it_milk_1l',
      'prices',
    ]);
    const link = fixture.nativeElement.querySelector('tbody a');
    expect(link.getAttribute('href')).toBe('/catalog/items/it_milk_1l/prices');
  });

  it('keeps a product the lookup cannot name as its id', async () => {
    const fixture = await render('run-catalog-completed');

    expect(fixture.componentInstance.shown()[1].item).toBe('it_milk_6pack');
  });

  it('narrows to one product, chosen by name, sending its id', async () => {
    const { asked, wrapped } = recorded(new HarvestMemory());
    const fixture = await render('run-catalog-completed', wrapped);

    await fixture.componentInstance.narrow('it_olive_oil_1l');
    fixture.detectChanges();

    expect(asked.at(-1)?.itemId).toBe('it_olive_oil_1l');
    expect(
      fixture.componentInstance.shown().map((row) => row.writtenBy)
    ).toEqual(['CONFIRMED']);
  });

  it('says a run wrote nothing', async () => {
    const fixture = await render('run-catalog-failed');

    expect(text(fixture)).toContain('harvest.run.prices.empty');
  });

  it('says a product got nothing from this run', async () => {
    const fixture = await render('run-catalog-completed');

    await fixture.componentInstance.narrow('it_dish_soap');
    fixture.detectChanges();

    expect(text(fixture)).toContain('harvest.run.prices.emptyForItem');
  });

  it('fails inside the tab, with a retry', async () => {
    const failing = Object.assign(new HarvestMemory(), {
      listRunPrices: async () => {
        throw new GatewayError({
          code: 'service_unavailable',
          status: 503,
          correlationId: 'cid',
        });
      },
    });
    const fixture = await render('run-catalog-completed', failing);

    expect(
      fixture.nativeElement.querySelector('[role="alert"]')
    ).not.toBeNull();
    expect(text(fixture)).toContain('resource.action.retry');
  });

  it('reads a written by it does not know as unknown', () => {
    expect(
      toRunPriceRow({ id: 'p', itemId: 'i', writtenBy: 'SOMETHING' })
    ).toMatchObject({ writtenBy: 'UNKNOWN' });
    expect(toRunPriceRow({ id: 'p' })).toBeNull();
  });
});
