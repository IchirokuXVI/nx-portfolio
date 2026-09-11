import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketLine,
  BasketLineOrigin,
  BasketParticipant,
  BasketProduct,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { QuantityReel } from '@portfolio/velista/ui';
import { BasketLineRow } from './basket-line-row';

/**
 * The row under a list heading (velista `0077`, section 4.1).
 *
 * The whole of this plan's row work is one substitution: the numbers come off the
 * origin and the glyph stays the line's. Four claims are worth a test each, and each
 * one is a way for a row to lie about a household.
 *
 * **The reel is bounded by what this list asked for**, not by the basket's summed
 * quantity, or a shopper could record six purchases against a list that wanted two.
 * **It is bound to that list's own outstanding amount**, so two households on one
 * line move independently. **The caption says which of the two numbers is which**,
 * because the glyph beside it reads the line. And **the "from" caption goes**,
 * because the heading above it already says the list.
 */

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-eggs',
    content: 'Eggs',
    quantity: 12,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    kind: 'DERIVED',
    origins: [origin(), origin({ id: 'o-2', listId: 'l2', lineId: 'zl-2' })],
    ...overrides,
  };
}

function origin(overrides: Partial<BasketLineOrigin> = {}): BasketLineOrigin {
  return {
    id: 'o-1',
    zoneId: 'z1',
    listId: 'l1',
    lineId: 'zl-1',
    quantity: 6,
    settled: 0,
    ...overrides,
  };
}

const NAMES = new Map([
  ['l1', 'Weekly shop'],
  ['l2', 'Flat 3B'],
]);

async function render(row: BasketLine, drawnFor: BasketLineOrigin | null) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketLineRow, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketLineRow);
  fixture.componentRef.setInput('line', row);
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput('products', new Map<string, BasketProduct>());
  fixture.componentRef.setInput('listNames', NAMES);
  fixture.componentRef.setInput('origin', drawnFor);
  fixture.componentRef.setInput('canReopen', false);
  fixture.componentRef.setInput('busy', false);
  fixture.componentRef.setInput('notice', null);
  fixture.detectChanges();

  return fixture;
}

type Fixture = Awaited<ReturnType<typeof render>>;

const reel = (fixture: Fixture): QuantityReel | null =>
  fixture.debugElement.query(By.directive(QuantityReel))?.componentInstance ??
  null;

const text = (fixture: Fixture, selector: string) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector(selector)
    ?.textContent?.trim() ?? null;

describe('BasketLineRow: the row under a list heading', () => {
  it('bounds the reel by what this list asked for, not by the line', async () => {
    const fixture = await render(line(), origin({ quantity: 6, settled: 2 }));

    // Six, and not the twelve the basket is asking for across both households.
    expect(reel(fixture)?.max()).toBe(6);
    // Four still to get for this list, whatever the other one has done.
    expect(reel(fixture)?.value()).toBe(4);
  });

  it('draws the basket’s own numbers on a row that is about the whole line', async () => {
    const fixture = await render(line({ settled: 2 }), null);

    expect(reel(fixture)?.max()).toBe(12);
    expect(reel(fixture)?.value()).toBe(10);
  });

  /**
   * The number is a household's and the glyph is the line's, and this caption is
   * the only thing on the row that says so. It is drawn on every row under a list
   * heading, not only on a partly settled one.
   */
  it('says what this list asked for, against the line’s own total', async () => {
    const fixture = await render(line(), origin({ quantity: 6, settled: 0 }));

    // The key alone: `RokuTranslatorTestingModule` echoes the key and drops what it
    // interpolates, so the arguments are asserted where the sentence is composed.
    expect(text(fixture, '.progress')).toBe('basket.line.listShare');
  });

  it('says what this list has got once it has got some', async () => {
    const fixture = await render(line(), origin({ quantity: 6, settled: 2 }));

    expect(text(fixture, '.progress')).toBe('basket.line.listPartly');
  });

  /**
   * The heading above the row already says "Weekly shop". Drawing it again would
   * put the same three words on every row of the section.
   */
  it('does not draw the "from" caption under that list’s own heading', async () => {
    const grouped = await render(line(), origin());
    const ungrouped = await render(line(), null);

    expect(text(grouped, '.from')).toBeNull();
    expect(text(ungrouped, '.from')).not.toBeNull();
  });

  it('names the list in the reel’s accessible name', async () => {
    const fixture = await render(line(), origin());

    expect(reel(fixture)?.label()).toBe('basket.outstanding.listLabel');
  });

  /**
   * A household that has bought none of its share is still a household with a reel:
   * the whole six are still to get for it, and the sentence under the number is what
   * stops the row reading as an untouched line.
   */
  it('draws a live reel for a list that has got none of its share', async () => {
    const fixture = await render(line(), origin({ quantity: 6, settled: 0 }));

    expect(reel(fixture)?.max()).toBe(6);
    expect(reel(fixture)?.value()).toBe(6);
    expect(text(fixture, '.settled-count')).toBeNull();
  });

  /**
   * Two households on one line move independently, which is the point of drawing the
   * line twice. Nothing about the other list's six reaches this row's number.
   */
  it('leaves the other household’s share out of this row’s number', async () => {
    const fixture = await render(
      line({ quantity: 12, settled: 6 }),
      origin({ quantity: 6, settled: 1 })
    );

    expect(reel(fixture)?.max()).toBe(6);
    expect(reel(fixture)?.value()).toBe(5);
  });

  /**
   * The glyph reads the line, always. A tick beside "6 of 6 got" under one household
   * while the other household's six are still to get would be a contradiction on one
   * row, which is why the two halves read different things on purpose.
   */
  it('keeps the status glyph on the line even where this list is finished', async () => {
    const fixture = await render(
      line({ quantity: 12, settled: 6 }),
      origin({ quantity: 6, settled: 6 })
    );

    expect(reel(fixture)?.value()).toBe(0);
    // Partly, which is the line: half the basket's twelve are still to get.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'lib-half-circle-icon'
      )
    ).not.toBeNull();
  });
});
