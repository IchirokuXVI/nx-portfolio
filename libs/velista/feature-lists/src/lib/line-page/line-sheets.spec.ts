import { signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  type CatalogBrowseServiceI,
  fakeItemNames,
  type FakeItemNames,
  fakeLineStore,
  type FakeLineStore,
  fakeListStore,
  GatewayError,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
} from '@portfolio/velista/data-access';
import type {
  CatalogBrowseContext,
  CatalogItem,
  CatalogScopeOffer,
  Line,
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { LineMenuSheet } from '../line-menu-sheet/line-menu-sheet';
import { LineProductsInfoSheet } from '../line-products-info-sheet/line-products-info-sheet';
import { LineSupermarketSheet } from '../line-supermarket-sheet/line-supermarket-sheet';
import { RenameLineSheet } from '../rename-line-sheet/rename-line-sheet';
import { LineProductPrices } from './line-product-prices';

/**
 * The three sheets over the line page, at the DOM (velista `0135`, sections 3.2
 * and 6): what each one writes, and where each one goes when it closes.
 */

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';
const LINE_URL = `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/lines/${LINE_ID}`;
const MERCADONA = 'chain-mercadona';
const LIDL = 'chain-lidl';

const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Shampoo',
    quantity: 3,
    itemIds: ['normal', 'classic'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'PENDING',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    named: true,
    claimedByUserId: null,
    createdByUserId: 'user-me',
    approvedByUserId: null,
    version: 1,
    ...overrides,
  };
}

function list(myPermissions: readonly ListPermission[]): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: 'user-me',
    autoApproveLines: false,
    lineCount: 1,
    wantedCount: 1,
    myPermissions,
  } as ShoppingListSummary;
}

const CONTEXT: CatalogBrowseContext = {
  state: 'priced',
  postalCodes: ['28001'],
  chains: [
    {
      supermarketId: MERCADONA,
      name: { en: 'Mercadona', es: 'Mercadona' },
      locations: 1,
      logoUrl: null,
    },
    {
      supermarketId: LIDL,
      name: { en: 'Lidl', es: 'Lidl' },
      locations: 1,
      logoUrl: null,
    },
  ],
  scopes: [
    { priceScopeId: 'scope-m', supermarketId: MERCADONA },
    { priceScopeId: 'scope-l', supermarketId: LIDL },
  ],
  chainNames: new Map(),
};

/** Mercadona sells both products. Lidl sells neither. */
function offers(price: number): readonly CatalogScopeOffer[] {
  return [
    {
      available: true,
      offer: {
        price,
        unitPrice: null,
        currency: 'EUR',
        priceScopeId: 'scope-m',
      } as CatalogScopeOffer['offer'],
    },
  ];
}

interface Rendered<T> {
  fixture: ComponentFixture<T>;
  lines: FakeLineStore;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}

async function render<T>(
  component: Type<T>,
  options: {
    lines?: readonly Line[];
    permissions?: readonly ListPermission[];
    itemNames?: FakeItemNames;
  } = {}
): Promise<Rendered<T>> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({
    lines: options.lines ?? [line()],
    state: 'loaded',
  });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const browse = {
    context: jest.fn().mockResolvedValue(CONTEXT),
    scopeOffers: jest.fn(async (itemId: string) =>
      offers(itemId === 'normal' ? 2.15 : 3.45)
    ),
  };
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(lines),
      provideFakeItemNames(options.itemNames),
      provideFakeListStore(
        fakeListStore({
          lists: [list(options.permissions ?? ADMIN)],
          state: 'loaded',
        })
      ),
      // The line page provides it to the sheets in its outlet.
      LineProductPrices,
      {
        provide: CATALOG_BROWSE_SERVICE,
        useValue: browse as unknown as CatalogBrowseServiceI,
      },
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(component);
  await drain(fixture);

  return { fixture, lines, sheets };
}

async function drain<T>(fixture: ComponentFixture<T>): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    fixture.detectChanges();
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  }
  fixture.detectChanges();
}

function buttonWith<T>(
  fixture: ComponentFixture<T>,
  key: string
): HTMLButtonElement | null {
  return (
    fixture.debugElement
      .queryAll(By.css('button'))
      .map((element) => element.nativeElement as HTMLButtonElement)
      .find((element) => (element.textContent ?? '').includes(key)) ?? null
  );
}

const textOf = <T>(fixture: ComponentFixture<T>): string =>
  fixture.nativeElement.textContent ?? '';

const updates = (lines: FakeLineStore) =>
  lines.calls.filter((call) => call.kind === 'update');

describe('LineMenuSheet', () => {
  it('is titled with the line and offers the name and the delete', async () => {
    const { fixture } = await render(LineMenuSheet);

    expect(textOf(fixture)).toContain('Shampoo');
    expect(buttonWith(fixture, 'list.menu.rename')).not.toBeNull();
    expect(buttonWith(fixture, 'list.menu.delete')).not.toBeNull();
  });

  it('offers Add a name for a line with no name of its own (velista 0144)', async () => {
    const { fixture, sheets } = await render(LineMenuSheet, {
      lines: [line({ named: false })],
    });

    expect(buttonWith(fixture, 'list.menu.rename')).toBeNull();
    const add = buttonWith(fixture, 'list.menu.addName');
    expect(add?.getAttribute('aria-label')).toBe('list.menu.addNameLabel');

    add?.click();
    await drain(fixture);
    expect(sheets.leaveTo).toHaveBeenCalledWith(`${LINE_URL}/sheet/name`);
  });

  it('replaces itself with the sheet of the row that was pressed', async () => {
    const rename = await render(LineMenuSheet);
    buttonWith(rename.fixture, 'list.menu.rename')?.click();
    await drain(rename.fixture);
    expect(rename.sheets.leaveTo).toHaveBeenCalledWith(
      `${LINE_URL}/sheet/name`
    );

    const remove = await render(LineMenuSheet);
    buttonWith(remove.fixture, 'list.menu.delete')?.click();
    await drain(remove.fixture);
    expect(remove.sheets.leaveTo).toHaveBeenCalledWith(
      `${LINE_URL}/sheet/confirm/delete`
    );
  });

  it('leaves out a row the reader may not use, and never disables one', async () => {
    // A writer on an approved line may fix its name and may not delete it.
    const { fixture } = await render(LineMenuSheet, {
      permissions: ['READ', 'WRITE'],
      lines: [line({ approvalStatus: 'APPROVED' })],
    });

    expect(buttonWith(fixture, 'list.menu.rename')).not.toBeNull();
    expect(buttonWith(fixture, 'list.menu.delete')).toBeNull();
    expect(fixture.nativeElement.querySelector('button:disabled')).toBeNull();
  });

  it('closes onto the line page', async () => {
    const { fixture, sheets } = await render(LineMenuSheet);

    await fixture.componentInstance.dismiss();

    expect(sheets.dismiss).toHaveBeenCalledWith(LINE_URL);
  });
});

describe('LineProductsInfoSheet', () => {
  it('says which product a shopper gets, in four sentences that name the line', async () => {
    const { fixture } = await render(LineProductsInfoSheet);

    expect(fixture.nativeElement.querySelectorAll('.say')).toHaveLength(4);
    expect(textOf(fixture)).toContain('list.page.about.title');
    expect(fixture.componentInstance.lineName()).toBe('Shampoo');
  });

  it('closes onto the line page', async () => {
    const { fixture, sheets } = await render(LineProductsInfoSheet);

    buttonWith(fixture, 'list.page.about.close')?.click();
    await drain(fixture);

    expect(sheets.dismiss).toHaveBeenCalledWith(LINE_URL);
  });
});

describe('RenameLineSheet', () => {
  function type(fixture: ComponentFixture<RenameLineSheet>, value: string) {
    const field = fixture.nativeElement.querySelector(
      'input'
    ) as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('starts with the name of the line, and Save waits for a change', async () => {
    const { fixture } = await render(RenameLineSheet);

    expect(
      (fixture.nativeElement.querySelector('input') as HTMLInputElement).value
    ).toBe('Shampoo');
    expect(buttonWith(fixture, 'list.rename.save')?.disabled).toBe(true);
  });

  it('saves the new name, trimmed, and closes onto the line page', async () => {
    const { fixture, lines, sheets } = await render(RenameLineSheet);

    type(fixture, '  Champú  ');
    buttonWith(fixture, 'list.rename.save')?.click();
    await drain(fixture);

    expect(updates(lines)).toEqual([
      { kind: 'update', lineId: LINE_ID, content: 'Champú' },
    ]);
    expect(sheets.dismiss).toHaveBeenCalledWith(LINE_URL);
  });

  it('does not save an empty name on a line with no product', async () => {
    const { fixture, lines } = await render(RenameLineSheet, {
      lines: [line({ itemIds: [] })],
    });

    type(fixture, '   ');
    expect(buttonWith(fixture, 'list.rename.save')?.disabled).toBe(true);
    await fixture.componentInstance.save();

    expect(updates(lines)).toEqual([]);
  });

  describe('the name sheet (velista 0144, section 4)', () => {
    const NORMAL: CatalogItem = {
      id: 'normal',
      name: { en: 'Shampoo for normal hair', es: 'Champú cabello normal' },
      brand: 'Deliplus',
      size: 400,
      unit: 'MILLILITER',
      productGroupId: null,
    } as CatalogItem;

    function named(): FakeItemNames {
      return fakeItemNames({ items: [NORMAL] });
    }

    function field(fixture: ComponentFixture<RenameLineSheet>): HTMLInputElement {
      return fixture.nativeElement.querySelector('input') as HTMLInputElement;
    }

    it('says what a name is for, and names the product the line shows', async () => {
      const { fixture } = await render(RenameLineSheet, { itemNames: named() });
      const text = fixture.nativeElement.textContent as string;

      expect(text).toContain('list.rename.title');
      expect(text).toContain('list.rename.note');
      expect(fixture.nativeElement.querySelector('.product')?.textContent).toContain(
        'Shampoo for normal hair'
      );
    });

    it('draws no product line for a line with none', async () => {
      const { fixture } = await render(RenameLineSheet, {
        lines: [line({ itemIds: [] })],
        itemNames: named(),
      });

      expect(fixture.nativeElement.querySelector('.product')).toBeNull();
    });

    it('starts empty for a line that is not named, and waits for words', async () => {
      const { fixture, lines } = await render(RenameLineSheet, {
        lines: [line({ named: false, content: 'Shampoo for normal hair' })],
        itemNames: named(),
      });

      expect(field(fixture).value).toBe('');
      expect(field(fixture).placeholder).toBe('Shampoo for normal hair');
      expect(buttonWith(fixture, 'list.rename.save')?.disabled).toBe(true);

      type(fixture, 'For the gym bag');
      buttonWith(fixture, 'list.rename.save')?.click();
      await drain(fixture);

      expect(updates(lines)).toEqual([
        { kind: 'update', lineId: LINE_ID, content: 'For the gym bag' },
      ]);
    });

    it('starts empty for an old line named after its product', async () => {
      const { fixture } = await render(RenameLineSheet, {
        lines: [line({ named: true, content: 'Champú cabello normal' })],
        itemNames: named(),
      });

      expect(field(fixture).value).toBe('');
    });

    it('takes the name away with an empty save, sending the product name', async () => {
      const { fixture, lines, sheets } = await render(RenameLineSheet, {
        itemNames: named(),
      });

      type(fixture, '');
      expect(buttonWith(fixture, 'list.rename.save')?.disabled).toBe(false);
      buttonWith(fixture, 'list.rename.save')?.click();
      await drain(fixture);

      expect(updates(lines)).toEqual([
        {
          kind: 'update',
          lineId: LINE_ID,
          named: false,
          content: 'Shampoo for normal hair',
        },
      ]);
      expect(sheets.dismiss).toHaveBeenCalledWith(LINE_URL);
    });

    it('takes the name away with no words while the product name is not loaded', async () => {
      const { fixture, lines } = await render(RenameLineSheet);

      type(fixture, '');
      buttonWith(fixture, 'list.rename.save')?.click();
      await drain(fixture);

      expect(updates(lines)).toEqual([
        { kind: 'update', lineId: LINE_ID, named: false },
      ]);
    });

    it('closes with Cancel, writing nothing', async () => {
      const { fixture, lines, sheets } = await render(RenameLineSheet);

      buttonWith(fixture, 'list.rename.cancel')?.click();
      await drain(fixture);

      expect(updates(lines)).toEqual([]);
      expect(sheets.dismiss).toHaveBeenCalledWith(LINE_URL);
    });
  });

  it('asks before a merge, and merges with the confirmation', async () => {
    const { fixture, lines, sheets } = await render(RenameLineSheet, {
      lines: [line(), line({ id: 'ln-2', content: 'Champú', quantity: 2 })],
    });
    lines.answerNextUpdate({
      state: 'failed',
      error: new GatewayError({
        code: 'line_merge_required',
        status: 409,
        correlationId: 'spec',
        details: {
          otherLineId: 'ln-2',
          otherContent: 'Champú',
          otherQuantity: 2,
        },
      }),
    });

    type(fixture, 'Champú');
    await fixture.componentInstance.save();
    await drain(fixture);

    expect(textOf(fixture)).toContain('list.merge.taken');
    expect(sheets.dismiss).not.toHaveBeenCalled();

    // The earlier line survives, so the sheet goes to the page of that line.
    lines.answerNextUpdate({
      state: 'succeeded',
      line: { id: 'ln-2', content: 'Champú', quantity: 5 },
      absorbedLineId: LINE_ID,
    });
    buttonWith(fixture, 'list.merge.confirm')?.click();
    await drain(fixture);

    expect(updates(lines)[1]).toEqual({
      kind: 'update',
      lineId: LINE_ID,
      content: 'Champú',
      confirmMerge: true,
    });
    expect(sheets.leaveTo).toHaveBeenCalledWith(
      LINE_URL.replace(LINE_ID, 'ln-2')
    );
  });

  it('stays open and says so when the save is refused', async () => {
    const { fixture, lines, sheets } = await render(RenameLineSheet);
    lines.setWriteOutcome('failed');

    type(fixture, 'Champú');
    await fixture.componentInstance.save();
    await drain(fixture);

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(sheets.dismiss).not.toHaveBeenCalled();
  });
});

describe('LineSupermarketSheet', () => {
  function radios(
    fixture: ComponentFixture<LineSupermarketSheet>
  ): HTMLInputElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[type="radio"]'
      ),
    ];
  }

  it('offers any supermarket and the ones near the reader, with what each sells', async () => {
    const { fixture } = await render(LineSupermarketSheet);
    const choices = fixture.componentInstance.choices();

    expect(choices.map((choice) => choice.name)).toEqual([
      'list.supermarket.any',
      'Mercadona',
      'Lidl',
    ]);
    expect(choices[0].selected).toBe(true);
    expect(choices[1]).toMatchObject({
      detailKey: 'list.supermarket.all',
      detailArgs: { count: 2 },
    });
    expect(choices[1].price).toContain('list.supermarket.from');
    expect(choices[2]).toMatchObject({
      detailKey: 'list.supermarket.none',
      price: null,
    });
    expect(radios(fixture)).toHaveLength(3);
  });

  it('writes the supermarket that was picked and closes', async () => {
    const { fixture, lines, sheets } = await render(LineSupermarketSheet);

    radios(fixture)[1].click();
    await drain(fixture);

    expect(updates(lines)).toEqual([
      { kind: 'update', lineId: LINE_ID, preferredSupermarketId: MERCADONA },
    ]);
    expect(sheets.dismiss).toHaveBeenCalledWith(LINE_URL);
  });

  it('clears it with Any supermarket', async () => {
    const { fixture, lines } = await render(LineSupermarketSheet, {
      lines: [line({ preferredSupermarketId: MERCADONA })],
    });

    await fixture.componentInstance.pick(null);

    expect(updates(lines)).toEqual([
      { kind: 'update', lineId: LINE_ID, preferredSupermarketId: null },
    ]);
  });

  it('closes with nothing written when the answer is the one it has', async () => {
    const { fixture, lines, sheets } = await render(LineSupermarketSheet);

    await fixture.componentInstance.pick(null);

    expect(updates(lines)).toEqual([]);
    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
  });

  it('stays open and says so when the write is refused', async () => {
    const { fixture, lines, sheets } = await render(LineSupermarketSheet);
    lines.setWriteOutcome('failed');

    await fixture.componentInstance.pick(LIDL);
    await drain(fixture);

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(sheets.dismiss).not.toHaveBeenCalled();
    expect(radios(fixture).every((radio) => !radio.disabled)).toBe(true);
  });

  it('keeps a supermarket that is not near the reader, and says so', async () => {
    const { fixture } = await render(LineSupermarketSheet, {
      lines: [line({ preferredSupermarketId: 'chain-far' })],
    });
    const last = fixture.componentInstance.choices().at(-1);

    expect(last).toMatchObject({
      supermarketId: 'chain-far',
      name: 'list.supermarket.other',
      detailKey: 'list.supermarket.notNear',
      selected: true,
    });
  });
});
