import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, BasketViewStore } from '@portfolio/velista/data-access';
import type { BasketLine } from '@portfolio/velista/models';
import {
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

function render(options: {
  readonly lines: readonly BasketLine[];
  readonly sources?: readonly { zoneId: string; listId: string }[];
}) {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const sources = signal(options.sources ?? []);
  const store = {
    lines: signal(options.lines),
    products: signal(new Map()),
    lastAdded: signal(null),
    me: signal(null),
    basket: computed(() => ({ sources: sources() })),
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

  /** PRICES FROM is `0078`'s, and a control that cannot act is not drawn. */
  it('draws no prices section', () => {
    const { fixture } = render({ lines: OWNER_LINES });

    expect(legends(fixture)).not.toContain('basket.view.prices.legend');
  });
});
