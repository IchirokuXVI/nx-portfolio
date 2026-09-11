import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, BasketViewStore } from '@portfolio/velista/data-access';
import type { BasketLine, BasketPriceScope } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { FilterSheet } from './filter-sheet';

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

function line(
  id: string,
  content: string,
  listIds: readonly string[] | null
): BasketLine {
  return {
    id,
    content,
    quantity: 1,
    settled: 0,
    waitingSettled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    ...(listIds === null
      ? {}
      : {
          origins: listIds.map((listId) => ({
            id: `o-${id}-${listId}`,
            zoneId: 'z1',
            listId,
            lineId: `zl-${id}`,
            quantity: 1,
          })),
        }),
  } as BasketLine;
}

/** The owner's basket: three lines, two lists the run drew from. */
const OWNER_LINES = [
  line('l-1', 'Milk', ['l-groceries']),
  line('l-2', 'Bread', ['l-weekly']),
  line('l-3', 'Batteries', []),
];

/** A guest's: the same lines with every origin redacted, and no sources. */
const GUEST_LINES = [
  line('l-1', 'Milk', null),
  line('l-2', 'Bread', null),
  line('l-3', 'Batteries', null),
];

/**
 * One price scope, with as many shops as the case needs (velista `0078`).
 *
 * Locations are what tells an owner's basket from a guest's here, which is the same
 * test the sheet itself asks: the server sends a guest the chain and no addresses.
 */
function scope(
  priceScopeId: string,
  chain: string,
  shops: readonly string[] = []
): BasketPriceScope {
  return {
    priceScopeId,
    supermarketName: { en: chain, es: chain },
    locations: shops.map((address, index) => ({
      id: `${priceScopeId}-${index}`,
      label: null,
      address,
      city: 'Córdoba',
      postalCode: '14001',
    })),
  };
}

function render(options: {
  readonly lines: readonly BasketLine[];
  readonly sources?: readonly { zoneId: string; listId: string }[];
  readonly scopes?: readonly BasketPriceScope[];
}) {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const sources = signal(options.sources ?? []);
  const scopes = signal(
    new Map((options.scopes ?? []).map((held) => [held.priceScopeId, held]))
  );
  const store = {
    lines: signal(options.lines),
    products: signal(new Map()),
    lastAdded: signal(null),
    me: signal(null),
    basket: computed(() => ({ sources: sources(), scopes: scopes() })),
    listNames: signal(
      new Map([
        ['l-groceries', 'Groceries'],
        ['l-weekly', 'Weekly shop'],
      ])
    ),
  };

  const paramMap = convertToParamMap({ generatedListId: BASKET_ID });
  TestBed.configureTestingModule({
    imports: [FilterSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: BasketStore, useValue: store },
      BasketViewStore,
      // A fresh `Map` per test for what the sheet remembers (`0076`), rather than
      // the one `localStorage` jsdom shares with every other test in this file.
      provideFakeBrowserFacade(new Map()),
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: { navigate: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap, parent: null },
          paramMap: { subscribe: () => ({ unsubscribe: () => undefined }) },
          parent: null,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(FilterSheet);
  fixture.detectChanges();

  return { fixture, sheets, view: TestBed.inject(BasketViewStore) };
}

function legends(
  fixture: ReturnType<typeof render>['fixture']
): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('.legend'))
    .map(
      (node) => (node.nativeElement as HTMLElement).textContent?.trim() ?? ''
    );
}

function choices(fixture: ReturnType<typeof render>['fixture'], name: string) {
  return fixture.debugElement.queryAll(
    By.css(`input[name="${name}"]`)
  ) as ReturnType<typeof fixture.debugElement.queryAll>;
}

/**
 * The filter sheet (velista `0075`, section 4).
 *
 * Two ideas carry every test here. **Every control applies at once**, so there is no
 * Apply to press and no draft to lose. And **what a guest sees is decided by the
 * data**, not by a flag: no sources means no list grouping and no lists section, in
 * one place rather than two that could disagree.
 */
describe('FilterSheet', () => {
  it('draws order and group by for every reader', () => {
    const { fixture } = render({ lines: GUEST_LINES });

    expect(legends(fixture)).toEqual([
      'basket.view.order.legend',
      'basket.view.group.legend',
    ]);
    expect(choices(fixture, 'basket-order')).toHaveLength(2);
  });

  /**
   * The redaction rule, and the reason it is one question: `sourceLists` is empty for
   * a reader the server sent no sources to, and the same emptiness hides both.
   */
  it('draws no list grouping and no lists section for a reader with no sources', () => {
    const { fixture } = render({ lines: GUEST_LINES });

    expect(legends(fixture)).not.toContain('basket.view.lists.legend');
    expect(choices(fixture, 'basket-grouping')).toHaveLength(2);
    expect(
      fixture.debugElement.queryAll(By.css('input[type="checkbox"]'))
    ).toHaveLength(0);
  });

  it('draws the lists section and the list grouping for a reader with sources', () => {
    const { fixture } = render({
      lines: OWNER_LINES,
      sources: [
        { zoneId: 'z1', listId: 'l-groceries' },
        { zoneId: 'z1', listId: 'l-weekly' },
      ],
    });

    expect(legends(fixture)).toContain('basket.view.lists.legend');
    expect(choices(fixture, 'basket-grouping')).toHaveLength(3);

    const boxes = fixture.debugElement.queryAll(
      By.css('input[type="checkbox"]')
    );
    expect(boxes).toHaveLength(2);
    // Everything kept until something is unchecked, which is the default.
    expect(boxes.every((box) => box.nativeElement.checked)).toBe(true);
  });

  it('names each list and says how many lines reach it', () => {
    const { fixture } = render({
      lines: OWNER_LINES,
      sources: [
        { zoneId: 'z1', listId: 'l-groceries' },
        { zoneId: 'z1', listId: 'l-weekly' },
      ],
    });

    expect(
      fixture.debugElement
        .queryAll(By.css('.choice-count'))
        .map((node) => (node.nativeElement as HTMLElement).textContent?.trim())
    ).toEqual(['1', '1']);
  });

  it('applies an order the moment the radio is tapped', () => {
    const { fixture, view } = render({ lines: OWNER_LINES });

    const alpha = fixture.debugElement.queryAll(
      By.css('input[name="basket-order"]')
    )[1];
    alpha.nativeElement.click();
    fixture.detectChanges();

    expect(view.order()).toBe('alpha');
    // No Apply and no Cancel: there is one button in the footer and it closes.
    expect(
      fixture.debugElement.queryAll(By.css('[sheetFooter] button'))
    ).toHaveLength(1);
  });

  it('applies a grouping the moment the radio is tapped', () => {
    const { fixture, view } = render({ lines: OWNER_LINES });

    fixture.debugElement
      .queryAll(By.css('input[name="basket-grouping"]'))[1]
      .nativeElement.click();
    fixture.detectChanges();

    expect(view.grouping()).toBe('category');
  });

  describe('the list checkboxes', () => {
    function renderWithLists() {
      return render({
        lines: OWNER_LINES,
        sources: [
          { zoneId: 'z1', listId: 'l-groceries' },
          { zoneId: 'z1', listId: 'l-weekly' },
        ],
      });
    }

    it('drops a list when it is unchecked', () => {
      const { fixture, view } = renderWithLists();

      fixture.debugElement
        .queryAll(By.css('input[type="checkbox"]'))[1]
        .nativeElement.click();
      fixture.detectChanges();

      expect([...(view.lists() ?? [])]).toEqual(['l-groceries']);
    });

    /**
     * The refusal shows up as a checkbox that **does not move**, which is why the
     * control is bound to the store's answer rather than to the event.
     */
    it('refuses to uncheck the last kept list, and the box stays checked', () => {
      const { fixture, view } = renderWithLists();
      const boxes = fixture.debugElement.queryAll(
        By.css('input[type="checkbox"]')
      );

      boxes[1].nativeElement.click();
      fixture.detectChanges();
      boxes[0].nativeElement.click();
      fixture.detectChanges();

      expect([...(view.lists() ?? [])]).toEqual(['l-groceries']);
      expect(
        fixture.debugElement.queryAll(By.css('input[type="checkbox"]'))[0]
          .nativeElement.checked
      ).toBe(true);
    });
  });

  it('puts everything back on reset', () => {
    const { fixture, view } = render({ lines: OWNER_LINES });
    view.setOrder('alpha');
    view.setGrouping('category');
    fixture.detectChanges();

    fixture.debugElement.query(By.css('.reset')).nativeElement.click();
    fixture.detectChanges();

    expect(view.order()).toBe('shop');
    expect(view.grouping()).toBe('none');
  });

  /**
   * Asserted on the key and its argument rather than on rendered text, because the
   * copy is a plural rule with a count substituted into it and a test that read the
   * sentence would be testing the translator.
   */
  it('says how many lines the page shows, on the footer button', () => {
    const { fixture, view } = render({ lines: OWNER_LINES });

    const button = fixture.debugElement.query(By.css('.confirm'))
      .nativeElement as HTMLElement;
    expect(button.textContent).toContain('basket.view.show');
    expect(view.visibleCount()).toBe(3);
  });

  /** `dismiss` and not `leaveTo`: there is nothing to commit, so every way out is one. */
  it('closes on the footer button without writing anything', () => {
    const { fixture, sheets } = render({ lines: OWNER_LINES });

    fixture.debugElement.query(By.css('.confirm')).nativeElement.click();

    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.leaveTo).not.toHaveBeenCalled();
  });

  /**
   * PRICES FROM, and the three things it draws (velista `0078`, section 3).
   *
   * A basket with no scopes, a basket with scopes and nothing chosen, and a basket
   * with a shop chosen. The first is the state staging and production are in, the
   * second is the one every basket opens in, and the third is the point of the plan.
   */
  describe('the prices section', () => {
    it('is absent for a basket with no price scopes', () => {
      const { fixture } = render({ lines: OWNER_LINES });

      expect(legends(fixture)).not.toContain('basket.view.shop.legend');
    });

    it('draws "One shop" disabled with Choose before anything is picked', () => {
      const { fixture } = render({
        lines: OWNER_LINES,
        scopes: [scope('s-merca', 'Mercadona', ['Ronda de los Tejares 32'])],
      });

      expect(legends(fixture)).toContain('basket.view.shop.legend');

      const shopRadio = fixture.debugElement
        .queryAll(By.css('input[name="basket-shop"]'))
        .map((node) => node.nativeElement as HTMLInputElement);
      expect(shopRadio).toHaveLength(2);
      // The first radio is "any of your shops" and is what a basket opens on.
      expect(shopRadio[0].checked).toBe(true);
      // Disabled and not hidden, so the group reads as two choices with one not
      // yet available (section 7).
      expect(shopRadio[1].disabled).toBe(true);

      expect(text(fixture, '.shops .is-muted')).toBe('basket.view.shop.none');
      expect(text(fixture, '.shops .pick')).toBe('basket.view.shop.choose');
    });

    it('draws the chain, the shop and Change once one is picked', () => {
      const { fixture, view } = render({
        lines: OWNER_LINES,
        scopes: [scope('s-merca', 'Mercadona', ['Ronda de los Tejares 32'])],
      });

      view.setShop('s-merca');
      fixture.detectChanges();

      expect(text(fixture, '.shops .choice-body .choice-title')).toBe(
        'Mercadona'
      );
      expect(text(fixture, '.shops .choice-body .choice-hint')).toBe(
        'Ronda de los Tejares 32'
      );
      expect(text(fixture, '.shops .pick')).toBe('basket.view.shop.change');

      const shopRadio = fixture.debugElement
        .queryAll(By.css('input[name="basket-shop"]'))
        .map((node) => node.nativeElement as HTMLInputElement);
      expect(shopRadio[1].disabled).toBe(false);
      expect(shopRadio[1].checked).toBe(true);
    });

    /**
     * The radio switches the two views without opening the picker.
     *
     * Somebody comparing "what does this shop charge" with "what is the cheapest"
     * should not have to choose the shop again on the way back.
     */
    it('switches between the two without leaving the sheet', () => {
      const { fixture, view, sheets } = render({
        lines: OWNER_LINES,
        scopes: [scope('s-merca', 'Mercadona', ['Ronda de los Tejares 32'])],
      });

      view.setShop('s-merca');
      fixture.detectChanges();

      fixture.debugElement
        .queryAll(By.css('input[name="basket-shop"]'))[0]
        .triggerEventHandler('change', { target: {} });
      expect(view.shop()).toBeNull();

      fixture.detectChanges();
      fixture.debugElement
        .queryAll(By.css('input[name="basket-shop"]'))[1]
        .triggerEventHandler('change', { target: {} });
      expect(view.shop()).toBe('s-merca');

      expect(sheets.leaveTo).not.toHaveBeenCalled();
    });

    /** A guest is told these are "the shops" and never "your shops". */
    it('says whose shops these are from the locations the server sent', () => {
      const { fixture } = render({
        lines: GUEST_LINES,
        scopes: [scope('s-merca', 'Mercadona')],
      });

      expect(text(fixture, '.shops .choice-title')).toBe(
        'basket.view.shop.anyGuest'
      );
    });

    /** Change leaves for the picker with `leaveTo`, so nothing is stacked. */
    it('leaves for the shop picker rather than pushing it', () => {
      const { fixture, sheets } = render({
        lines: OWNER_LINES,
        scopes: [scope('s-merca', 'Mercadona', ['Ronda de los Tejares 32'])],
      });

      fixture.debugElement.query(By.css('.shops .pick')).nativeElement.click();

      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/en/shopping-lists/${BASKET_ID}/sheet/filter/shop`
      );
    });
  });
});

/** The first match's trimmed text, which is what most of these assert on. */
function text(
  fixture: ReturnType<typeof render>['fixture'],
  selector: string
): string {
  const node = fixture.debugElement.query(By.css(selector));
  return (
    (node?.nativeElement as HTMLElement | undefined)?.textContent?.trim() ?? ''
  );
}
