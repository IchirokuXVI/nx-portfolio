import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  fakeGroupMembers,
  LINE_SERVICE,
  provideFakeGroupMembers,
} from '@portfolio/velista/data-access';
import type {
  BasketProduct,
  BasketRow,
  BasketRowEntry,
  CatalogItem,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { SwapSheet } from './swap-sheet';

const MILK: BasketProduct = {
  id: 'item-milk',
  name: { en: 'Hacendado whole milk', es: 'Leche entera Hacendado' },
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

function member(id: string, en: string): CatalogItem {
  return {
    id,
    name: { en, es: en },
    brand: null,
    size: 1,
    unit: 'LITER',
    productGroupId: 'group-milk',
    category: 'DAIRY',
    offer: null,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
  };
}

function entry(lineId: string, listId: string): BasketRowEntry {
  return {
    lineId,
    listId,
    left: 1,
    bought: 0,
    asked: 1,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
  };
}

const ROW: BasketRow = {
  rowKey: 'zl-1',
  content: 'Milk',
  left: 2,
  bought: 0,
  asked: 2,
  state: 'WANTED',
  note: null,
  noteAt: null,
  mark: null,
  awaitingApproval: false,
  optionIds: [MILK.id],
  touchedBy: null,
  touchedAt: null,
  usual: null,
  entries: [entry('zl-1', 'l-home'), entry('zl-2', 'l-work')],
};

async function render(options: { failWrite?: boolean } = {}): Promise<{
  fixture: ComponentFixture<SwapSheet>;
  updateLine: jest.Mock;
  refresh: jest.Mock;
  dismiss: jest.Mock;
}> {
  TestBed.resetTestingModule();
  const updateLine = jest.fn(() =>
    options.failWrite === true
      ? Promise.reject(new Error('refused'))
      : Promise.resolve({ line: {}, absorbedLineId: null })
  );
  const refresh = jest.fn().mockResolvedValue(undefined);
  const dismiss = jest.fn().mockResolvedValue(undefined);

  await TestBed.configureTestingModule({
    imports: [SwapSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      provideFakeGroupMembers(
        fakeGroupMembers({
          members: {
            'group-milk': [
              member(MILK.id, 'Hacendado whole milk'),
              member('item-milk-pascual', 'Pascual whole milk'),
            ],
          },
        })
      ),
      {
        provide: BasketStore,
        useValue: {
          rowFor: () => ROW,
          products: signal(new Map([[MILK.id, MILK]])),
          basket: signal({ scopes: new Map() }),
          address: signal('live'),
          refresh,
        },
      },
      { provide: BasketViewStore, useValue: { readAtShop: signal(null) } },
      { provide: LINE_SERVICE, useValue: { updateLine } },
      { provide: SheetNavigation, useValue: { dismiss } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ rowKey: 'zl-1' })),
          snapshot: { paramMap: convertToParamMap({ rowKey: 'zl-1' }) },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SwapSheet);
  fixture.detectChanges();
  return { fixture, updateLine, refresh, dismiss };
}

async function settle(fixture: ComponentFixture<SwapSheet>): Promise<void> {
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function rows(fixture: ComponentFixture<SwapSheet>): HTMLButtonElement[] {
  return [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('lib-similar-products .row'),
  ];
}

describe('SwapSheet', () => {
  it('offers the other products of the group, and not the one on the row', async () => {
    const { fixture } = await render();

    expect(rows(fixture).map((row) => row.textContent)).toEqual([
      expect.stringContaining('Pascual whole milk'),
    ]);
  });

  it('changes the product on every line of the row, then closes', async () => {
    const { fixture, updateLine, refresh, dismiss } = await render();

    rows(fixture)[0].click();
    await settle(fixture);

    expect(updateLine.mock.calls).toEqual([
      ['zl-1', { itemIds: ['item-milk-pascual'] }],
      ['zl-2', { itemIds: ['item-milk-pascual'] }],
    ]);
    expect(refresh).toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledWith('/en/shopping-lists/live');
  });

  it('stays open and says so when a line refuses the change', async () => {
    const { fixture, dismiss } = await render({ failWrite: true });

    rows(fixture)[0].click();
    await settle(fixture);

    expect(dismiss).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent
    ).toContain('basket.swap.failed');
  });
});
