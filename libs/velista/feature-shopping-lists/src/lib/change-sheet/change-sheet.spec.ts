import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  CATALOG_BROWSE_SERVICE,
  fakeGroupMembers,
  ItemNames,
  ProductPickStore,
  provideFakeGroupMembers,
} from '@portfolio/velista/data-access';
import type {
  BasketListRef,
  BasketProduct,
  BasketRow,
  BasketRowEntry,
  CatalogItem,
  CatalogScopeOffer,
  ProductOffer,
} from '@portfolio/velista/models';
import {
  AppHistory,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ChangeSheet } from './change-sheet';

function offer(price: number, unitPrice: number): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope-mercadona',
  };
}

function item(
  id: string,
  en: string,
  priced: ProductOffer | null,
  groupId: string | null = 'group-milk'
): CatalogItem {
  return {
    id,
    name: { en, es: en },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: groupId,
    categories: [],
    offer: priced,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
  };
}

const MILK: CatalogItem = {
  ...item('item-milk', 'Hacendado milk', offer(0.92, 0.92)),
  brand: 'Hacendado',
  size: 1,
  unit: 'LITER',
  imageUrl: 'https://img.test/milk.png',
};
const SIX = item('item-six', 'Hacendado milk six pack', offer(5.34, 0.89));
const PASCUAL = item('item-pascual', 'Pascual milk', offer(1.15, 1.15));
const PULEVA = item('item-puleva', 'Puleva milk', null);
const OAT = item('item-oat', 'Oat drink', null, null);

const PRODUCT: BasketProduct = {
  id: MILK.id,
  name: MILK.name,
  brand: null,
  imageUrl: null,
  productGroupId: 'group-milk',
  size: null,
  unit: null,
  offer: null,
  offers: [],
  atShop: null,
  categories: [],
  sectionIds: null,
};

const LISTS = new Map<string, BasketListRef>([
  [
    'l-home',
    {
      listId: 'l-home',
      name: 'Weekly shop',
      zoneId: 'z-home',
      zoneName: 'Home',
    },
  ],
  [
    'l-work',
    { listId: 'l-work', name: 'Basics', zoneId: 'z-work', zoneName: 'Office' },
  ],
]);

function entry(
  lineId: string,
  listId: string | null,
  overrides: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  return {
    lineId,
    listId,
    content: 'Milk for coffee',
    itemIds: [MILK.id],
    favoriteItemId: null,
    canWrite: true,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    left: 1,
    bought: 0,
    asked: 1,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    version: 1,
    ...overrides,
  };
}

function rowOf(entries: readonly BasketRowEntry[]): BasketRow {
  return {
    rowKey: 'zl-1',
    content: 'Milk',
    left: entries.length,
    bought: 0,
    asked: entries.length,
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    productId: MILK.id,
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries,
  };
}

const ROW = rowOf([
  entry('zl-1', 'l-home'),
  entry('zl-2', 'l-work', { itemIds: [MILK.id, OAT.id] }),
  // A list the reader may not edit: no Change, and not in "all lists".
  entry('zl-3', 'l-home', { canWrite: false }),
]);

interface Options {
  readonly lineId?: string;
  readonly row?: BasketRow;
  readonly guest?: boolean;
  readonly atShop?: boolean;
  readonly failNames?: boolean;
  readonly refuse?: boolean;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ChangeSheet>;
  changeProduct: jest.Mock;
  dismiss: jest.Mock;
  navigateByUrl: jest.SpyInstance;
  pick: ProductPickStore;
}> {
  TestBed.resetTestingModule();
  const changeProduct = jest.fn(() => Promise.resolve(options.refuse !== true));
  const dismiss = jest.fn().mockResolvedValue(undefined);
  const known = new Map(
    [MILK, SIX, PASCUAL, PULEVA, OAT].map((held) => [held.id, held])
  );
  const scopeOffers = jest.fn(
    async (): Promise<readonly CatalogScopeOffer[]> => [
      { offer: offer(1.5, 1.5), available: true },
    ]
  );
  const params = convertToParamMap({
    rowKey: 'zl-1',
    ...(options.lineId === undefined ? {} : { lineId: options.lineId }),
  });

  await TestBed.configureTestingModule({
    imports: [ChangeSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      provideFakeGroupMembers(
        fakeGroupMembers({
          members: { 'group-milk': [MILK, SIX, PASCUAL, PULEVA] },
        })
      ),
      {
        provide: ItemNames,
        useValue: {
          ensure: async () => undefined,
          nameOf: (itemId: string) => known.get(itemId) ?? null,
          anyFailed: () => options.failNames === true,
        },
      },
      { provide: CATALOG_BROWSE_SERVICE, useValue: { scopeOffers } },
      ProductPickStore,
      { provide: AppHistory, useValue: { depth: () => 2 } },
      {
        provide: BasketStore,
        useValue: {
          rowFor: () => options.row ?? ROW,
          products: signal(new Map([[MILK.id, PRODUCT]])),
          basket: signal({ scopes: new Map() }),
          address: signal('live'),
          me: signal({ kind: options.guest === true ? 'GUEST' : 'REGISTERED' }),
          finished: signal(false),
          lists: signal(LISTS),
          state: signal('ready'),
          shopRead: signal(null),
          error: signal(null),
          changeProduct,
        },
      },
      {
        provide: BasketViewStore,
        useValue: { pricedAtShop: signal(options.atShop === true) },
      },
      { provide: SheetNavigation, useValue: { dismiss } },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(params), snapshot: { paramMap: params } },
      },
    ],
  }).compileComponents();

  const navigateByUrl = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(ChangeSheet);
  fixture.detectChanges();
  await settle(fixture);
  return {
    fixture,
    changeProduct,
    dismiss,
    navigateByUrl,
    pick: TestBed.inject(ProductPickStore),
  };
}

async function settle(fixture: ComponentFixture<ChangeSheet>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function host(fixture: ComponentFixture<ChangeSheet>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function radios(fixture: ComponentFixture<ChangeSheet>): HTMLInputElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];
}

function names(fixture: ComponentFixture<ChangeSheet>): string[] {
  return [...host(fixture).querySelectorAll('.choice .name')].map(
    (name) => name.textContent?.trim() ?? ''
  );
}

function useButton(fixture: ComponentFixture<ChangeSheet>): HTMLButtonElement {
  const button = host(fixture).querySelector<HTMLButtonElement>('.use');
  if (button === null) {
    throw new Error('no Use button');
  }
  return button;
}

describe('ChangeSheet', () => {
  describe('for one list', () => {
    it('names the list and the line, and offers one list of products', async () => {
      const { fixture } = await render({ lineId: 'zl-1' });

      expect(host(fixture).querySelector('.title')?.textContent).toContain(
        'basket.change.title'
      );
      expect(host(fixture).querySelector('.sub')?.textContent).toBe(
        'Weekly shop · Milk for coffee'
      );
      // The chosen one first, then by the price for each kilo or litre, then what
      // has no price, each once. No heading between the line's and the group's.
      expect(names(fixture)).toEqual([
        'Hacendado milk',
        'Hacendado milk six pack',
        'Pascual milk',
        'Puleva milk',
      ]);
      expect(host(fixture).querySelectorAll('.choices h3')).toHaveLength(0);
    });

    it('marks the product chosen now, chosen, and a cheaper option in words', async () => {
      const { fixture } = await render({ lineId: 'zl-1' });

      expect(radios(fixture)[0].checked).toBe(true);
      const captions = [...host(fixture).querySelectorAll('.choice')].map(
        (row) => row.querySelector('.caption')?.textContent?.trim() ?? null
      );
      expect(captions).toEqual([
        'basket.change.chosenNow',
        'basket.change.cheaper',
        null,
        null,
      ]);
    });

    it('names each radio by the whole card: name, brand, price and caption', async () => {
      const { fixture } = await render({ lineId: 'zl-1' });

      // The testing translator answers keys, so the size is dropped and the
      // captions and "no price" read as their keys.
      expect(
        radios(fixture).map((radio) => radio.getAttribute('aria-label'))
      ).toEqual([
        'Hacendado milk, Hacendado, €0.92, basket.change.chosenNow',
        'Hacendado milk six pack, €5.34, basket.change.cheaper',
        'Pascual milk, €1.15',
        'Puleva milk, catalog.row.noPrice',
      ]);
    });

    it('draws each choice as the compact card: picture, detail, and the radio at the right', async () => {
      const { fixture } = await render({ lineId: 'zl-1' });

      const first = host(fixture).querySelector('lib-product-row.choice');
      expect(first?.querySelector('.row')?.classList.contains('compact')).toBe(
        true
      );
      expect(first?.querySelector('img')?.getAttribute('src')).toBe(
        'https://img.test/milk.png'
      );
      // The name alone, with the brand on the detail line. The testing translator
      // answers keys, which `productSizeText` drops, so the size is not drawn here.
      expect(first?.querySelector('.name')?.textContent?.trim()).toBe(
        'Hacendado milk'
      );
      expect(first?.querySelector('.detail')?.textContent).toBe('Hacendado');
      // The whole card is the label, and the radio is its last part: the right edge.
      const label = first?.querySelector('label.open');
      expect(label?.lastElementChild?.matches('input[type="radio"]')).toBe(
        true
      );
      expect(label?.querySelector('.price .amount')?.textContent).toBe('€0.92');
      // A product with no photo draws the glyph.
      expect(
        host(fixture)
          .querySelectorAll('lib-product-row.choice')[1]
          ?.querySelector('img')
      ).toBeNull();
    });

    it('chooses a product by a press anywhere on its card', async () => {
      const { fixture } = await render({ lineId: 'zl-1' });

      host(fixture)
        .querySelectorAll<HTMLElement>('lib-product-row.choice .name')[2]
        ?.click();
      fixture.detectChanges();

      expect(radios(fixture).map((radio) => radio.checked)).toEqual([
        false,
        false,
        true,
        false,
      ]);
      expect(radios(fixture).map((radio) => radio.name)).toEqual(
        Array(4).fill('basket-change-product')
      );
      expect(useButton(fixture).disabled).toBe(false);
    });

    it('marks what the shop does not sell, last, and still lets it be chosen', async () => {
      const { fixture } = await render({ lineId: 'zl-1', atShop: true });

      expect(names(fixture).at(-1)).toBe('Puleva milk');
      expect(
        host(fixture).querySelector('.choice:last-child .caption')?.textContent
      ).toContain('basket.change.notSold');
      expect(radios(fixture).at(-1)?.disabled).toBe(false);
    });

    it('keeps the button disabled until another product is chosen', async () => {
      const { fixture } = await render({ lineId: 'zl-1' });

      expect(useButton(fixture).disabled).toBe(true);
      expect(useButton(fixture).textContent).toContain('basket.change.use');

      radios(fixture)[2].click();
      fixture.detectChanges();
      fixture.detectChanges();

      expect(useButton(fixture).disabled).toBe(false);
    });

    it('opens with "Keep it for next time" on and sends it', async () => {
      const { fixture, changeProduct, dismiss } = await render({
        lineId: 'zl-1',
      });
      const box = host(fixture).querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      );
      expect(box?.checked).toBe(true);

      radios(fixture)[2].click();
      fixture.detectChanges();
      useButton(fixture).click();
      await settle(fixture);

      expect(changeProduct).toHaveBeenCalledWith(
        'zl-1',
        { lineIds: ['zl-1'], itemId: PASCUAL.id, keep: true },
        expect.objectContaining({ id: PASCUAL.id })
      );
      // Back to the row's sheet.
      expect(dismiss).toHaveBeenCalledWith(
        '/en/shopping-lists/live/sheet/rows/zl-1/settle'
      );
    });

    it('sends the change for this trip only with the checkbox off', async () => {
      const { fixture, changeProduct } = await render({ lineId: 'zl-1' });

      host(fixture)
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
      fixture.detectChanges();
      radios(fixture)[1].click();
      fixture.detectChanges();
      useButton(fixture).click();
      await settle(fixture);

      expect(changeProduct).toHaveBeenCalledWith(
        'zl-1',
        { lineIds: ['zl-1'], itemId: SIX.id, keep: false },
        expect.anything()
      );
    });

    it('stays open with the page’s own words when the change is refused', async () => {
      const { fixture, dismiss } = await render({
        lineId: 'zl-1',
        refuse: true,
      });

      radios(fixture)[2].click();
      fixture.detectChanges();
      useButton(fixture).click();
      await settle(fixture);

      expect(dismiss).not.toHaveBeenCalled();
      expect(host(fixture).querySelector('.error')?.textContent).toContain(
        'basket.error.failed'
      );
    });
  });

  describe('for all lists', () => {
    it('covers the lists the reader may change, and says how many in the title', async () => {
      const { fixture } = await render();

      expect(host(fixture).querySelector('.title')?.textContent).toContain(
        'basket.change.titleAll'
      );
      expect(host(fixture).querySelector('.sub')?.textContent).toContain(
        'Weekly shop'
      );
      expect(host(fixture).querySelector('.sub')?.textContent).toContain(
        'Basics'
      );
      // The other product of the second line is offered too, priced by itself.
      expect(names(fixture)).toContain('Oat drink');
    });

    it('sends every line it covers, and not the one the reader may not edit', async () => {
      const { fixture, changeProduct } = await render();

      radios(fixture)[1].click();
      fixture.detectChanges();
      useButton(fixture).click();
      await settle(fixture);

      expect(changeProduct).toHaveBeenCalledWith(
        'zl-1',
        { lineIds: ['zl-1', 'zl-2'], itemId: SIX.id, keep: true },
        expect.anything()
      );
      expect(useButton(fixture).textContent).toContain('basket.change.useAll');
    });
  });

  it('draws one row with a retry when the products could not be read', async () => {
    const { fixture } = await render({ lineId: 'zl-1', failNames: true });

    expect(radios(fixture)).toHaveLength(0);
    expect(host(fixture).querySelector('.failed')?.textContent).toContain(
      'basket.change.failedRead'
    );
    expect(host(fixture).querySelector('.retry')).not.toBeNull();
  });

  it('goes back to the row when a guest reaches its URL', async () => {
    const { dismiss } = await render({ lineId: 'zl-1', guest: true });

    expect(dismiss).toHaveBeenCalledWith(
      '/en/shopping-lists/live/sheet/rows/zl-1/settle'
    );
  });

  it('goes back to the row for a list the reader may not edit', async () => {
    const { dismiss } = await render({ lineId: 'zl-3' });

    expect(dismiss).toHaveBeenCalled();
  });

  describe('the catalog to choose', () => {
    it('opens the catalog page for the line, on its words, and asks it to come back here', async () => {
      const { fixture, navigateByUrl, pick } = await render({ lineId: 'zl-1' });

      host(fixture).querySelector<HTMLButtonElement>('.catalog')?.click();

      expect(pick.request()).toMatchObject({
        kind: 'one',
        lineId: 'zl-1',
        forLabel: 'basket.change.pickFor',
        forDetail: 'Milk for coffee',
        chosenId: MILK.id,
        returnDepth: 2,
        callerState: { keep: true },
      });
      const url = TestBed.inject(Router).serializeUrl(
        navigateByUrl.mock.calls[0][0]
      );
      expect(url).toBe(
        '/en/zones/z-home/lists/l-home/lines/zl-1/product?q=Milk%20for%20coffee'
      );
    });

    it('comes back with the product chosen there, chosen in the list', async () => {
      TestBed.resetTestingModule();
      const first = await render({ lineId: 'zl-1' });
      const pick = first.pick;
      pick.open({
        kind: 'one',
        lineId: 'zl-1',
        forLabel: '',
        forDetail: '',
        chosenId: MILK.id,
        returnUrl: '',
        returnDepth: 0,
        callerState: { keep: false },
      });
      pick.choose(OAT.id);
      pick.use();

      // The sheet is drawn again when the catalog pops back onto it.
      const fixture = TestBed.createComponent(ChangeSheet);
      fixture.detectChanges();
      await settle(fixture);

      expect(names(fixture).slice(0, 2)).toEqual([
        'Hacendado milk',
        'Oat drink',
      ]);
      expect(radios(fixture)[1].checked).toBe(true);
      expect(
        host(fixture).querySelector<HTMLInputElement>('input[type="checkbox"]')
          ?.checked
      ).toBe(false);
    });
  });
});
