import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type { BasketProduct, BasketRow } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketRow as BasketRowComponent } from './basket-row';

const MILK: BasketProduct = {
  id: 'item-milk',
  name: { en: 'Whole milk', es: 'Leche entera' },
  brand: 'Hacendado',
  imageUrl: null,
  productGroupId: 'group-milk',
  size: 1,
  unit: 'LITER',
  offer: null,
  offers: [],
  atShop: null,
  categories: ['DAIRY'],
};

function row(): BasketRow {
  return {
    rowKey: 'zl-1',
    content: 'Milk',
    left: 1,
    bought: 0,
    asked: 1,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [MILK.id],
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries: [],
  };
}

async function render(inputs: { canSwap?: boolean; groupCheaper?: boolean }) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [BasketRowComponent, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketRowComponent);
  fixture.componentRef.setInput('row', row());
  fixture.componentRef.setInput('people', new Map());
  fixture.componentRef.setInput('products', new Map([[MILK.id, MILK]]));
  fixture.componentRef.setInput('canSwap', inputs.canSwap ?? false);
  fixture.componentRef.setInput('groupCheaper', inputs.groupCheaper ?? false);
  fixture.detectChanges();
  return fixture;
}

function host(fixture: { nativeElement: unknown }): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('BasketRow, change product', () => {
  it('offers the change as a control of its own, named after the product', async () => {
    const fixture = await render({ canSwap: true });
    const swaps: void[] = [];
    fixture.componentInstance.swap.subscribe(() => swaps.push(undefined));

    const button = host(fixture).querySelector<HTMLButtonElement>('.swap');
    button?.click();

    expect(button?.getAttribute('aria-label')).toBe('basket.swap.openLabel');
    expect(swaps).toHaveLength(1);
    // Pressing it does not open the row's own sheet.
    expect(host(fixture).querySelector('.body .swap')).toBeNull();
  });

  it('draws no change control when the page does not offer one', async () => {
    const fixture = await render({ canSwap: false });

    expect(host(fixture).querySelector('.swap')).toBeNull();
  });
});

describe('BasketRow, a cheaper similar product', () => {
  it('says so in words on the product line, and in the row name', async () => {
    const fixture = await render({ groupCheaper: true });

    expect(host(fixture).querySelector('.product')?.textContent).toContain(
      'basket.swap.cheaper'
    );
    expect(
      host(fixture).querySelector('.body')?.getAttribute('aria-label')
    ).toContain('basket.swap.cheaper');
  });

  it('draws nothing when the product is the best price of its group', async () => {
    const fixture = await render({ groupCheaper: false });

    expect(host(fixture).textContent).not.toContain('basket.swap.cheaper');
  });
});
