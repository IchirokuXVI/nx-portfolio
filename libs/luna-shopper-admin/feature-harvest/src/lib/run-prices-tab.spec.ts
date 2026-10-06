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
import { RunPricesTab, runUnitPrice, toRunPriceRow } from './run-prices-tab';

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
        // A product's prices are its Prices tab (admin plan 0043).
        provide: ResourceRegistry,
        useValue: {
          pathOf: (name: string, known: Record<string, string> = {}) =>
            name === 'prices'
              ? ['/', 'products', known['itemId'], 'prices']
              : null,
        },
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

  it('names the product and links it to its Prices tab, at the scope written', async () => {
    const fixture = await render('run-catalog-completed');
    const [first] = fixture.componentInstance.shown();

    expect(first.item).toBe('Whole milk 1 L');
    expect(first.link).toEqual(['/', 'products', 'it_milk_1l', 'prices']);
    expect(first.query).toEqual({ scope: first.query.scope });
    expect(first.query.scope).not.toBe('');
    const link = fixture.nativeElement.querySelector('tbody a');
    expect(link.getAttribute('href')).toBe(
      `/products/it_milk_1l/prices?scope=${first.query.scope}`
    );
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

  it('prints the basis the catalog read, and not the label of the source (backend plan 0189)', () => {
    const unitPriceOf = (row: Record<string, unknown>) => {
      const read = toRunPriceRow({ id: 'p', itemId: 'i', ...row });
      return read === null ? null : runUnitPrice(read);
    };

    // The price of a litre, which the chain sent under `100 ml`.
    expect(
      unitPriceOf({
        unitPrice: 17,
        unitPriceLabel: '100 ml',
        unitBasis: 'LITER',
      })
    ).toBe('17 / L');
    // No basis was read, so the label is what there is.
    expect(
      unitPriceOf({ unitPrice: 4.13, unitPriceLabel: '100gr', unitBasis: null })
    ).toBe('4.13 / 100gr');
    expect(unitPriceOf({ unitPrice: 0.92, unitPriceLabel: '1 L' })).toBe(
      '0.92 / 1 L'
    );
    expect(unitPriceOf({ unitPrice: 2 })).toBe('2');
    expect(unitPriceOf({ unitPriceLabel: 'kg', unitBasis: 'KILOGRAM' })).toBe(
      ''
    );
  });

  it('reads a written by it does not know as unknown', () => {
    expect(
      toRunPriceRow({ id: 'p', itemId: 'i', writtenBy: 'SOMETHING' })
    ).toMatchObject({ writtenBy: 'UNKNOWN' });
    expect(toRunPriceRow({ id: 'p' })).toBeNull();
  });
});
