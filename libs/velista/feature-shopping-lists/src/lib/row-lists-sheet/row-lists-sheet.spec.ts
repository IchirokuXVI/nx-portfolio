import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  RouterOutlet,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  ItemNames,
} from '@portfolio/velista/data-access';
import {
  QUANTITY_STEP_QUIET_MS,
  type BasketListRef,
  type BasketParticipant,
  type BasketProduct,
  type BasketRow,
  type BasketRowEntry,
  type ParticipantKind,
} from '@portfolio/velista/models';
import {
  AppHistory,
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { AnchoredPopover, QuantityStepper } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { RowListsSheet } from './row-lists-sheet';

/**
 * The detailed view of a basket row's lists (velista `0200`, section 2).
 *
 * The testing translator echoes keys, and a translator that echoes the values too
 * is used where the numbers of a sentence are the point.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const ROW_KEY = 'zl-1';

function product(
  id: string,
  brand: string,
  over: Partial<BasketProduct> = {}
): BasketProduct {
  return {
    id,
    name: { es: 'Leche semidesnatada', en: 'Leche semidesnatada' },
    brand,
    imageUrl: `https://img.example/${id}.jpg`,
    productGroupId: null,
    size: 1,
    unit: 'LITER',
    approxWeight: null,
    quantityStep: null,
    offer: {
      priceScopeId: 's1',
      price: 0.92,
      currency: 'EUR',
      piecePrice: null,
    } as BasketProduct['offer'],
    offers: [],
    atShop: null,
    categories: [],
    sectionIds: null,
    ...over,
  };
}

const MILK = product('p-milk', 'Hacendado');
const PULEVA = product('p-puleva', 'Puleva');

function entry(over: Partial<BasketRowEntry> = {}): BasketRowEntry {
  return {
    lineId: 'zl-1',
    listId: 'l-weekly',
    content: 'Leche',
    itemIds: ['p-milk'],
    favoriteItemId: null,
    canWrite: true,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    unit: 'UNIT',
    left: 1,
    bought: 2,
    asked: 3,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    version: 1,
    ...over,
  };
}

function row(entries: readonly BasketRowEntry[]): BasketRow {
  return {
    rowKey: ROW_KEY,
    content: 'Leche',
    productId: 'p-milk',
    unit: entries[0]?.unit ?? 'UNIT',
    left: entries.reduce((sum, held) => sum + held.left, 0),
    bought: entries.reduce((sum, held) => sum + held.bought, 0),
    asked: entries.reduce((sum, held) => sum + held.asked, 0),
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries,
  };
}

const LISTS: readonly BasketListRef[] = [
  {
    listId: 'l-weekly',
    name: 'Compra semanal',
    zoneId: 'z1',
    zoneName: 'Casa',
  },
  {
    listId: 'l-basics',
    name: 'Básicos',
    zoneId: 'z2',
    zoneName: 'Piso de la playa',
  },
];

/** Three lists on one product, one of them another group's. */
const THREE = () =>
  row([
    entry(),
    entry({
      lineId: 'zl-2',
      listId: 'l-basics',
      left: 1,
      bought: 0,
      asked: 1,
      canWrite: false,
    }),
    entry({
      lineId: 'zl-3',
      listId: null,
      canWrite: false,
      demandEditable: false,
      left: 1,
      bought: 1,
      asked: 2,
    }),
  ]);

interface World {
  readonly row?: BasketRow;
  readonly served?: readonly BasketListRef[];
  readonly meKind?: ParticipantKind;
  readonly products?: ReadonlyMap<string, BasketProduct>;
  readonly echoValues?: boolean;
}

function storeDouble(world: World) {
  const me: BasketParticipant = {
    id: 'me',
    kind: world.meKind ?? 'OWNER',
    displayName: 'Ana',
    username: null,
    guestNumber: null,
    userId: 'u-me',
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
  };
  const served = world.served ?? LISTS;
  const rows = signal<readonly BasketRow[]>([world.row ?? THREE()]);
  const products =
    world.products ??
    new Map([
      [MILK.id, MILK],
      [PULEVA.id, PULEVA],
    ]);
  const rowFor = (key: string): BasketRow | null =>
    rows().find((held) => held.rowKey === key) ??
    rows().find((held) => held.entries.some((one) => one.lineId === key)) ??
    null;
  return {
    rows,
    rowFor,
    lists: signal(new Map(served.map((ref) => [ref.listId, ref]))),
    products: signal(products),
    me: signal(me),
    finished: signal(false),
    state: signal('ready'),
    error: signal<unknown>(null),
    address: signal({ basketId: BASKET_ID }),
    basket: signal(null),
    shopRead: signal(null),
    readAt: signal(null),
    lineLeft: jest.fn(() => false),
    handOver: jest.fn(),
    setDemand: jest.fn().mockResolvedValue({ entries: [], skippedCount: 0 }),
  };
}

async function render(world: World = {}) {
  TestBed.resetTestingModule();
  const store = storeDouble(world);
  const sheetMap = convertToParamMap({ rowKey: ROW_KEY });
  const pageMap = convertToParamMap({ basketId: BASKET_ID });

  await TestBed.configureTestingModule({
    imports: [RowListsSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeBrowserFacade(new Map()),
      { provide: BasketStore, useValue: store },
      { provide: BasketViewStore, useValue: { readAtShop: signal(false) } },
      { provide: ItemNames, useValue: { nameOf: () => null } },
      {
        provide: SheetNavigation,
        useValue: {
          dismiss: jest.fn().mockResolvedValue(undefined),
          leaveTo: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: Router,
        useValue: { navigateByUrl: jest.fn().mockResolvedValue(true) },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      ...(world.echoValues === true
        ? [
            {
              provide: RokuTranslatorService,
              useValue: {
                loaded: signal(true),
                locale: signal('en'),
                getLocale: () => 'en',
                t: (key: string, _n?: string, _l?: string, values?: unknown) =>
                  values === undefined
                    ? key
                    : `${key}:${JSON.stringify(values)}`,
              },
            },
          ]
        : []),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(sheetMap),
          snapshot: {
            paramMap: sheetMap,
            parent: { paramMap: pageMap, parent: null },
          },
          parent: {
            paramMap: of(pageMap),
            snapshot: { paramMap: pageMap, parent: null },
            parent: null,
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RowListsSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    store,
    router: TestBed.inject(Router) as unknown as { navigateByUrl: jest.Mock },
    sheets: TestBed.inject(SheetNavigation) as unknown as {
      dismiss: jest.Mock;
    },
  };
}

const html = (fixture: ComponentFixture<RowListsSheet>) =>
  fixture.nativeElement as HTMLElement;

const texts = (fixture: ComponentFixture<RowListsSheet>, selector: string) =>
  [...html(fixture).querySelectorAll(selector)].map(
    (node) => node.textContent?.trim() ?? ''
  );

const steppers = (fixture: ComponentFixture<RowListsSheet>) =>
  fixture.debugElement
    .queryAll(By.directive(QuantityStepper))
    .map((held) => held.componentInstance as QuantityStepper);

/** Lets the write queue's promises run, which wait one turn before they send. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

const rowsOf = (fixture: ComponentFixture<RowListsSheet>) => [
  ...html(fixture).querySelectorAll<HTMLElement>('.rows > .row'),
];

describe('RowListsSheet (velista 0200)', () => {
  afterEach(() => jest.useRealTimers());

  it('draws the description under its title on every visit', async () => {
    for (let visit = 0; visit < 2; visit++) {
      const { fixture } = await render();
      const title = html(fixture).querySelector('.title');
      expect(title?.textContent).toContain('basket.lists.title');
      expect(title?.parentElement?.nextElementSibling?.textContent).toContain(
        'basket.lists.description'
      );
    }
  });

  describe('the product at the top', () => {
    it("draws the row's picture, name, brand and size, and price", async () => {
      const { fixture } = await render();
      const top = html(fixture).querySelector('.product');
      expect(top?.querySelector('lib-product-picture')).not.toBeNull();
      expect(texts(fixture, '.product-name')).toEqual(['Leche semidesnatada']);
      // The size is words from a key the testing translator echoes, and a size
      // whose words are only a key is left out, so the brand stands alone here.
      expect(texts(fixture, '.product-detail')).toEqual(['Hacendado']);
      expect(texts(fixture, '.product-amount')[0]).toContain('0.92');
    });

    it('draws "Change for all lists" with two changeable entries, and not with one', async () => {
      const one = await render();
      expect(html(one.fixture).querySelector('.change-all')).toBeNull();

      const two = await render({
        row: row([
          entry(),
          entry({ lineId: 'zl-2', listId: 'l-basics', asked: 1, bought: 0 }),
        ]),
      });
      const button = html(two.fixture).querySelector<HTMLButtonElement>(
        '.product .change-all'
      );
      expect(button?.textContent).toContain('basket.change.all');
      button?.click();
      expect(two.router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/rows/${ROW_KEY}/change`
      );
    });
  });

  describe('the rows', () => {
    it('draws one row per entry with "Bought N of M" in plain text', async () => {
      const { fixture } = await render({ echoValues: true });
      expect(rowsOf(fixture)).toHaveLength(3);
      expect(texts(fixture, '.row-bought')).toEqual([
        'basket.lists.bought:{"bought":"2","asked":"3"}',
        'basket.lists.bought:{"bought":"0","asked":"1"}',
        'basket.lists.bought:{"bought":"1","asked":"2"}',
      ]);
      expect(texts(fixture, '.row-name')).toEqual([
        'Compra semanal',
        'Básicos',
        'basket.entries.otherList',
      ]);
    });

    it('reads a weight in the ask\'s own name: "Bought 0,5 of 1,5 kg"', async () => {
      const { fixture } = await render({
        echoValues: true,
        row: row([
          entry({ unit: 'GRAM', left: 1000, bought: 500, asked: 1500 }),
        ]),
      });
      expect(texts(fixture, '.row-bought')).toEqual([
        'basket.lists.bought:{"bought":"0.5","asked":"1.5 kg"}',
      ]);
      expect(steppers(fixture)[0].variant()).toBe('sheet');
    });

    it('draws the stepper on every entry: enabled where the ask is editable, locked elsewhere', async () => {
      const { fixture } = await render();
      expect(steppers(fixture).map((held) => held.locked())).toEqual([
        false,
        false,
        true,
      ]);
      // Locked is its own state: no stepper here is drawn as a write in flight.
      expect(steppers(fixture).map((held) => held.disabled())).toEqual([
        false,
        false,
        false,
      ]);
      expect(steppers(fixture).map((held) => held.variant())).toEqual([
        'sheet-narrow',
        'sheet-narrow',
        'sheet-narrow',
      ]);
    });

    it('shows the whole ask, not what is left', async () => {
      const { fixture } = await render();
      // Asks 3, has 2 bought, so 1 is left: the stepper shows 3.
      expect(steppers(fixture)[0].value()).toBe(3);
    });

    it("draws a finished trip's ask as the plain number with its unit, no stepper and no popover", async () => {
      const { fixture, store } = await render({
        row: row([
          entry({ unit: 'GRAM', left: 1000, bought: 500, asked: 1500 }),
          entry({
            lineId: 'zl-3',
            listId: null,
            unit: 'GRAM',
            demandEditable: false,
            asked: 250,
            left: 250,
            bought: 0,
          }),
        ]),
      });
      store.finished.set(true);
      fixture.detectChanges();
      expect(steppers(fixture)).toEqual([]);
      const numbers = rowsOf(fixture).map((held) =>
        held.querySelector('.ask-number lib-amount-figure')
      );
      expect(numbers.every((held) => held !== null)).toBe(true);
      expect(numbers[0]?.textContent).toContain('1.5');
      expect(numbers[0]?.textContent).toContain('kg');
      expect(numbers[1]?.textContent).toContain('250');
      expect(numbers[1]?.textContent).toContain('g');
      // Nothing to press, so no reason and no popover either.
      expect(html(fixture).querySelector('[id^="row-lists-why-"]')).toBeNull();
      expect(
        fixture.debugElement.query(By.directive(AnchoredPopover))
      ).toBeNull();
    });
  });

  describe("each list's product", () => {
    it('draws its picture, its name and " · brand size"', async () => {
      const { fixture } = await render();
      const line = rowsOf(fixture)[0].querySelector('.line-product');
      expect(line?.querySelector('lib-product-picture')).not.toBeNull();
      expect(line?.querySelector('.line-name')?.textContent).toBe(
        'Leche semidesnatada'
      );
      expect(line?.querySelector('.line-brand')?.textContent).toBe(
        ' · Hacendado'
      );
      expect(line?.classList.contains('differs')).toBe(false);
    });

    it("takes the quiet amber where its product is not the row's", async () => {
      const { fixture } = await render({
        row: row([
          entry(),
          entry({
            lineId: 'zl-2',
            listId: 'l-basics',
            tripItemId: 'p-puleva',
          }),
        ]),
      });
      const lines = rowsOf(fixture).map((held) =>
        held.querySelector('.line-product')
      );
      expect(lines.map((held) => held?.classList.contains('differs'))).toEqual([
        false,
        true,
      ]);
      expect(lines[1]?.querySelector('.line-brand')?.textContent).toBe(
        ' · Puleva'
      );
    });

    it('draws "Change" only where the entry is changeable, and only it navigates', async () => {
      const { fixture, router } = await render();
      const changes = rowsOf(fixture).map((held) =>
        held.querySelector<HTMLButtonElement>('.change')
      );
      // Compra semanal and Básicos are served and written by the reader in the
      // double, so both may change; Another list may not.
      expect(changes.map((held) => held !== null)).toEqual([
        true,
        false,
        false,
      ]);
      expect(changes[0]?.textContent?.trim()).toBe('basket.lists.change');
      expect(changes[0]?.getAttribute('aria-label')).toBe(
        'basket.change.oneLabel'
      );

      rowsOf(fixture)[0].querySelector<HTMLElement>('.line-text')?.click();
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      changes[0]?.click();
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/rows/${ROW_KEY}/change/zl-1`
      );
    });

    it('keeps "Change" where the product cannot be named, with the default icon and the line\'s name', async () => {
      const { fixture, router } = await render({
        row: row([
          entry({ content: 'Leche sin lactosa', itemIds: ['p-gone'] }),
        ]),
        products: new Map(),
      });
      const line = rowsOf(fixture)[0].querySelector('.line-product');
      expect(line?.querySelector('.line-name')?.textContent).toBe(
        'Leche sin lactosa'
      );
      expect(line?.querySelector('.line-brand')).toBeNull();
      expect(line?.querySelector('lib-product-icon')).not.toBeNull();
      expect(line?.querySelector('lib-product-picture button')).toBeNull();
      line?.querySelector<HTMLButtonElement>('.change')?.click();
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/rows/${ROW_KEY}/change/zl-1`
      );
    });

    it('draws no line for an entry it can neither name nor change', async () => {
      const { fixture } = await render({
        row: row([entry({ canWrite: false, demandEditable: false })]),
        products: new Map(),
      });
      expect(rowsOf(fixture)[0].querySelector('.line-product')).toBeNull();
    });
  });

  describe('the ask', () => {
    beforeEach(() => jest.useFakeTimers());

    it('sends a typed ask once, at once', async () => {
      const { fixture, store } = await render();
      steppers(fixture)[0].stepped.emit({
        from: 3,
        to: 7,
        repeat: false,
        typed: true,
      });
      await settle();
      expect(store.setDemand).toHaveBeenCalledTimes(1);
      expect(store.setDemand).toHaveBeenCalledWith({
        lineId: 'zl-1',
        quantity: 7,
        from: 1,
      });
    });

    it('waits the quiet beat after presses, then sends the whole ask', async () => {
      const { fixture, store } = await render();
      const plus =
        rowsOf(fixture)[0].querySelector<HTMLButtonElement>('button.step.plus');
      plus?.click();
      fixture.detectChanges();
      expect(steppers(fixture)[0].value()).toBe(4);
      expect(store.setDemand).not.toHaveBeenCalled();
      jest.advanceTimersByTime(QUANTITY_STEP_QUIET_MS);
      await settle();
      // Asks 3 with 2 bought: one plus sends 4, never 2, with the left it saw.
      expect(store.setDemand).toHaveBeenCalledTimes(1);
      expect(store.setDemand).toHaveBeenCalledWith({
        lineId: 'zl-1',
        quantity: 4,
        from: 1,
      });
      for (const [body] of store.setDemand.mock.calls) {
        expect(body.quantity).not.toBe(2);
      }
    });

    it('sends the left the run started from when a socket patch lands during the run', async () => {
      const { fixture, store } = await render();
      rowsOf(fixture)[0]
        .querySelector<HTMLButtonElement>('button.step.plus')
        ?.click();
      // Somebody else buys the last one while the presses gather: left is now 0.
      store.rows.set([
        row([
          entry({ left: 0, bought: 3, asked: 3 }),
          ...THREE().entries.slice(1),
        ]),
      ]);
      fixture.detectChanges();
      jest.advanceTimersByTime(QUANTITY_STEP_QUIET_MS);
      await settle();
      // The person saw 1 left, so the server is asked to judge from 1.
      expect(store.setDemand).toHaveBeenCalledWith({
        lineId: 'zl-1',
        quantity: 4,
        from: 1,
      });
    });

    it("sends a run queued behind a write from that write's answer, never from a newer left", async () => {
      const { fixture, store } = await render();
      let answer: (value: unknown) => void = () => undefined;
      store.setDemand.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      steppers(fixture)[0].stepped.emit({
        from: 3,
        to: 5,
        repeat: false,
        typed: true,
      });
      await settle();
      fixture.detectChanges();
      // A second run while the first is in flight, from the amount it drew.
      steppers(fixture)[0].stepped.emit({
        from: 5,
        to: 6,
        repeat: false,
        typed: true,
      });
      await settle();
      expect(store.setDemand).toHaveBeenCalledTimes(1);
      expect(store.setDemand).toHaveBeenLastCalledWith({
        lineId: 'zl-1',
        quantity: 5,
        from: 1,
      });

      // The first write answers: asks 5 with 2 bought, so 3 are left. Right after
      // its answer is read, somebody else's change lands: asks 11, 9 left.
      const others = THREE().entries.slice(1);
      store.rows.set([row([entry({ asked: 5, left: 3 }), ...others])]);
      store.lineLeft.mockImplementationOnce(() => {
        store.rows.set([row([entry({ asked: 11, left: 9 }), ...others])]);
        return false;
      });
      answer({ entries: [], skippedCount: 0 });
      await settle();
      await settle();

      expect(store.setDemand).toHaveBeenCalledTimes(2);
      // From what this view's own write answered, so the server says stale.
      expect(store.setDemand).toHaveBeenLastCalledWith({
        lineId: 'zl-1',
        quantity: 6,
        from: 3,
      });
    });

    it('sends a run queued behind a refused write from the left the refused one sent', async () => {
      const { fixture, store } = await render();
      let refuse: (value: unknown) => void = () => undefined;
      store.setDemand.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            refuse = resolve;
          })
      );
      steppers(fixture)[0].stepped.emit({
        from: 3,
        to: 5,
        repeat: false,
        typed: true,
      });
      await settle();
      steppers(fixture)[0].stepped.emit({
        from: 5,
        to: 6,
        repeat: false,
        typed: true,
      });
      // The refusal re-reads the basket, where somebody else's change shows.
      store.rows.set([
        row([entry({ asked: 11, left: 9 }), ...THREE().entries.slice(1)]),
      ]);
      refuse(null);
      await settle();
      await settle();
      expect(store.setDemand).toHaveBeenLastCalledWith({
        lineId: 'zl-1',
        quantity: 6,
        from: 1,
      });
    });
  });

  describe('an ask the reader may not change', () => {
    it('opens the popover for a group the reader is not in, and sends nothing', async () => {
      const { fixture, store } = await render();
      const disabled = steppers(fixture)[2];
      disabled.disabledPress.emit();
      fixture.detectChanges();

      const popover = fixture.debugElement.query(By.directive(AnchoredPopover))
        .componentInstance as AnchoredPopover;
      expect(popover.open()).toBe(true);
      expect(popover.pointer()).toBe(true);
      expect(popover.align()).toBe('end');
      expect(popover.frame()).toBe('note');
      expect(popover.keepInSight()).toBe(rowsOf(fixture)[2]);
      expect(store.setDemand).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('basket.lists.notInGroup');
    });

    it("says the group's name for the reader's own group", async () => {
      const { fixture } = await render({
        echoValues: true,
        row: row([entry({ demandEditable: false })]),
      });
      steppers(fixture)[0].disabledPress.emit();
      fixture.detectChanges();
      expect(document.body.textContent).toContain(
        'basket.lists.ownGroup:{"group":"Casa"}'
      );
    });

    it('opens on a click, Enter and Space on the stepper itself, and writes nothing', async () => {
      const { fixture, store } = await render();
      const host = rowsOf(fixture)[2];
      const plus = host.querySelector<HTMLButtonElement>('button.step.plus');
      const field = host.querySelector<HTMLInputElement>('input');
      const isOpen = () =>
        fixture.debugElement.query(By.directive(AnchoredPopover)) !== null;

      plus?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 })
      );
      fixture.detectChanges();
      expect(isOpen()).toBe(true);

      // A second press closes it, as a toggle.
      plus?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 })
      );
      fixture.detectChanges();
      expect(isOpen()).toBe(false);

      field?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      fixture.detectChanges();
      expect(isOpen()).toBe(true);
      fixture.componentInstance['unexplain']('zl-3');
      fixture.detectChanges();

      field?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true })
      );
      fixture.detectChanges();
      expect(isOpen()).toBe(true);
      expect(store.setDemand).not.toHaveBeenCalled();
    });

    it('closes on a press of its own stepper that is also a press outside, and the next press opens it', async () => {
      const { fixture } = await render();
      const locked = steppers(fixture)[2];
      const isOpen = () =>
        fixture.debugElement.query(By.directive(AnchoredPopover)) !== null;
      locked.disabledPress.emit();
      fixture.detectChanges();
      expect(isOpen()).toBe(true);

      // The overlay hears the press first, as outside it, then the stepper does.
      fixture.componentInstance['unexplain']('zl-3', 'outside');
      locked.disabledPress.emit();
      fixture.detectChanges();
      expect(isOpen()).toBe(false);

      locked.disabledPress.emit();
      fixture.detectChanges();
      expect(isOpen()).toBe(true);
    });

    it('links the reason with aria-describedby before any press', async () => {
      const { fixture } = await render();
      const field = rowsOf(fixture)[2].querySelector('input');
      const id = field?.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      expect(html(fixture).querySelector(`#${id}`)?.textContent?.trim()).toBe(
        'basket.lists.notInGroup'
      );
      // An editable ask names no reason.
      expect(
        rowsOf(fixture)[0]
          .querySelector('input')
          ?.hasAttribute('aria-describedby')
      ).toBe(false);
    });

    it("names the own group's reason too", async () => {
      const { fixture } = await render({
        row: row([entry({ demandEditable: false })]),
      });
      const field = rowsOf(fixture)[0].querySelector('input');
      const id = field?.getAttribute('aria-describedby');
      expect(html(fixture).querySelector(`#${id}`)?.textContent?.trim()).toBe(
        'basket.lists.ownGroup'
      );
    });
  });

  describe('pictures', () => {
    it('opens the picture viewer from a picture with a photo', async () => {
      const { fixture } = await render();
      const zoom =
        html(fixture).querySelector<HTMLButtonElement>('.product .zoom');
      expect(zoom?.getAttribute('aria-label')).toBe('photo.open');
      zoom?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const viewer = html(fixture).querySelector('lib-photo-viewer dialog');
      expect(viewer?.getAttribute('aria-label')).toBe('Leche semidesnatada');
    });

    it('draws the default icon and no button for a product with no photo', async () => {
      const { fixture } = await render({
        products: new Map([[MILK.id, { ...MILK, imageUrl: null }]]),
      });
      const pictures = [
        ...html(fixture).querySelectorAll('lib-product-picture'),
      ];
      expect(pictures.length).toBeGreaterThan(0);
      for (const picture of pictures) {
        expect(picture.querySelector('button')).toBeNull();
        expect(picture.querySelector('lib-product-icon')).not.toBeNull();
      }
    });
  });

  describe('the way back', () => {
    it('returns to the row sheet with its URL as the fallback', async () => {
      const { fixture, sheets } = await render();
      html(fixture).querySelector<HTMLButtonElement>('.back')?.click();
      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/rows/${ROW_KEY}/settle`
      );
    });
  });

  describe('the change sheets, over the real router', () => {
    /** The basket page under the sheets, with its outlet. */
    @Component({
      selector: 'lib-test-basket-page',
      imports: [RouterOutlet],
      template: '<router-outlet />',
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class TestBasketPage {}

    /** The row sheet the detailed view is pushed over. */
    @Component({
      selector: 'lib-test-row-sheet',
      template: '<p class="row-sheet">row sheet</p>',
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class TestRowSheet {}

    /**
     * A change sheet whose cancel is the real one's: `SheetNavigation.dismiss` with
     * the row sheet's URL as the fallback.
     */
    @Component({
      selector: 'lib-test-change-sheet',
      template:
        '<button (click)="cancel()" class="cancel" type="button">x</button>',
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class TestChangeSheet {
      private readonly _sheet = inject(SheetNavigation);
      cancel(): void {
        void this._sheet.dismiss(`${PAGE}/sheet/rows/${ROW_KEY}/settle`);
      }
    }

    const PAGE = `/velista/en/shopping-lists/${BASKET_ID}`;
    const LISTS_URL = `${PAGE}/sheet/rows/${ROW_KEY}/lists`;

    async function routed(rowOf: BasketRow) {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RokuTranslatorTestingModule.forTesting()],
        providers: [
          provideRouter([
            {
              path: 'velista/en/shopping-lists/:basketId',
              component: TestBasketPage,
              children: [
                { path: 'sheet/rows/:rowKey/settle', component: TestRowSheet },
                { path: 'sheet/rows/:rowKey/lists', component: RowListsSheet },
                {
                  path: 'sheet/rows/:rowKey/change',
                  component: TestChangeSheet,
                },
                {
                  path: 'sheet/rows/:rowKey/change/:lineId',
                  component: TestChangeSheet,
                },
              ],
            },
          ]),
          provideLocationMocks(),
          provideVelistaTesting({ basePath: '/velista' }),
          provideFakeBrowserFacade(new Map()),
          provideEnvironmentInitializer(() => inject(AppHistory).watch()),
          { provide: BasketStore, useValue: storeDouble({ row: rowOf }) },
          { provide: BasketViewStore, useValue: { readAtShop: signal(false) } },
          { provide: ItemNames, useValue: { nameOf: () => null } },
          { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
        ],
      }).compileComponents();
      const harness = await RouterTestingHarness.create();
      TestBed.inject(Router).setUpLocationChangeListener();
      await harness.navigateByUrl(PAGE);
      await harness.navigateByUrl(`${PAGE}/sheet/rows/${ROW_KEY}/settle`);
      await harness.navigateByUrl(LISTS_URL);
      return { harness, location: TestBed.inject(Location) };
    }

    async function settleRouted(harness: RouterTestingHarness): Promise<void> {
      await new Promise<void>((resolve) => setTimeout(resolve));
      await harness.fixture.whenStable();
      harness.detectChanges();
    }

    it.each([
      ['"Change"', '.line-product .change'],
      ['"Change for all lists"', '.change-all'],
    ])(
      'the back of the sheet %s opens returns to the detailed view',
      async (_name, selector) => {
        const { harness, location } = await routed(
          row([
            entry(),
            entry({ lineId: 'zl-2', listId: 'l-basics', asked: 1, bought: 0 }),
          ])
        );
        const host = harness.fixture.nativeElement as HTMLElement;
        host.querySelector<HTMLButtonElement>(selector)?.click();
        await settleRouted(harness);
        expect(host.querySelector('lib-test-change-sheet')).not.toBeNull();

        host.querySelector<HTMLButtonElement>('.cancel')?.click();
        await settleRouted(harness);

        expect(location.path()).toBe(LISTS_URL);
        expect(host.querySelector('lib-row-lists-sheet')).not.toBeNull();
      }
    );
  });
});
