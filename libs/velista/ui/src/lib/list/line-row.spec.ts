import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  QUANTITY_REEL_CLICK_SHIELD_MS,
  QUANTITY_REEL_IDLE_MS,
  type LineRowShownProduct,
  type LineRowVm,
} from '@portfolio/velista/models';
import { LineRow } from './line-row';

/**
 * Velista plan 0043 section 7, which **replaces** `0012` section 7's row mapping in
 * full, plus the parts of the old one that survive unchanged.
 *
 * These are the rules a screenshot cannot check and a refactor is most likely to
 * quietly break. The largest of them is negative and is asserted as such: there is no
 * checkbox anywhere on this row any more, and nothing on it marks a line ready or not
 * available (section 1.1).
 */
function vm(overrides: Partial<LineRowVm> = {}): LineRowVm {
  return {
    id: 'ln-1',
    content: 'Sourdough loaf',
    quantity: 1,
    approvalStatus: 'APPROVED',
    settled: false,
    indicators: [],
    claimedBy: null,
    captionKey: null,
    write: 'none',
    overwrittenBy: null,
    interactive: true,
    adjustable: true,
    decidable: false,
    restorable: false,
    editor: null,
    ...overrides,
  };
}

async function render(
  line: LineRowVm,
  inputs: { reordering?: boolean } = {}
): Promise<ComponentFixture<LineRow>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [LineRow, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineRow);
  fixture.componentRef.setInput('line', line);
  if (inputs.reordering !== undefined) {
    fixture.componentRef.setInput('reordering', inputs.reordering);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function row(fixture: ComponentFixture<LineRow>): HTMLElement {
  return fixture.nativeElement.querySelector('.row') as HTMLElement;
}

/** The product a row shows, as `selectListState` builds it (velista `0145`). */
function shown(
  overrides: Partial<LineRowShownProduct> = {}
): LineRowShownProduct {
  return {
    kind: 'shown',
    itemId: 'milk',
    name: 'Leche semidesnatada',
    brandSize: 'Hacendado · 1 L',
    imageUrl: null,
    favorite: false,
    others: 0,
    price: '0,92 €',
    ...overrides,
  };
}

function query(
  fixture: ComponentFixture<LineRow>,
  selector: string
): Element | null {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function text(fixture: ComponentFixture<LineRow>, selector: string): string {
  return query(fixture, selector)?.textContent?.trim() ?? '';
}

/** The status words the row draws, as the testing translator renders them. */
function statusWords(fixture: ComponentFixture<LineRow>): string[] {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-status]'),
  ].map((word) => word.textContent?.trim() ?? '');
}

function reel(fixture: ComponentFixture<LineRow>): HTMLElement | null {
  return fixture.nativeElement.querySelector('lib-quantity-reel');
}

/**
 * A pointer going down, as the reel reads it.
 *
 * jsdom has no `PointerEvent`, so this is a `MouseEvent` carrying the two fields the
 * reel looks at, exactly as `quantity-reel.spec.ts` does it.
 */
function down(target: EventTarget): void {
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'isPrimary', { value: true });
  target.dispatchEvent(event);
}

function up(target: EventTarget): void {
  const event = new MouseEvent('pointerup', { bubbles: true, clientX: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

/**
 * A whole tap, press included.
 *
 * The press is the part that matters here: the row decides whether it is listening at
 * `pointerdown`, because focus leaves the reel between the press and the click and the
 * overlay the tap was dismissing is gone by then.
 */
function tap(target: HTMLElement): void {
  down(target);
  target.click();
}

/** Open the reel by tapping it, and leave it up. */
function openReel(fixture: ComponentFixture<LineRow>): void {
  const el = reel(fixture) as HTMLElement;
  down(el);
  up(el);
  fixture.detectChanges();
}

function overlay(fixture: ComponentFixture<LineRow>): HTMLElement | null {
  return fixture.nativeElement.querySelector('.overlay');
}

describe('LineRow', () => {
  /**
   * Section 1.1, and the reason this plan is a rewrite of the row rather than an edit
   * to it. Asserted as an absence because that is what it is: every one of these
   * passing by accident would mean the checkbox had come back.
   */
  describe('what 0043 takes away', () => {
    it('is a button rather than a checkbox, with nothing checked about it', async () => {
      const fixture = await render(vm());

      expect(row(fixture).getAttribute('role')).toBe('button');
      expect(row(fixture).hasAttribute('aria-checked')).toBe(false);
    });

    it('has no control anywhere on it that marks a line not available', async () => {
      // Every action a row can carry, so this cannot pass by the fixture happening
      // not to include one.
      const fixture = await render(vm());

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('markNotAvailable');
      expect(text).not.toContain('markPending');
    });

    it('never strikes a settled line through, however quietly it is drawn', async () => {
      // The muting is a class the stylesheet reads; what matters here is that the
      // row does not claim the line is crossed out. A settled line is the record
      // that survives every trip (section 3.2).
      const fixture = await render(vm({ quantity: 0, settled: true }));

      expect(row(fixture).classList.contains('settled')).toBe(true);
      expect(row(fixture).classList.contains('struck')).toBe(false);
    });
  });

  describe('the accessible name', () => {
    it('is the content and the quantity, always', async () => {
      const fixture = await render(vm({ content: 'Milk', quantity: 1 }));

      // The number is in it even at one, where `0012` left it out. The quantity is
      // the line's state now rather than an annotation above one of them.
      expect(row(fixture).getAttribute('aria-label')).toBe('Milk, 1');
    });

    it('draws the detail of a row built without a catalog on line 2, and says it', async () => {
      const fixture = await render(
        vm({ content: 'Milk', quantity: 2, detail: '1 L · Oatly' })
      );

      expect(text(fixture, '.line-2 .brand-size')).toBe('1 L · Oatly');
      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Milk, 1 L · Oatly, 2'
      );
    });

    it('says the product, its brand and size, and the price of a named line (velista 0145)', async () => {
      const fixture = await render(
        vm({ content: 'Leche', named: true, quantity: 6, product: shown() })
      );

      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Leche, Leche semidesnatada, Hacendado · 1 L, 0,92 €, 6'
      );
    });

    it('says only the name and the price of a line that is not named', async () => {
      const fixture = await render(
        vm({
          content: 'Leche semidesnatada',
          named: false,
          quantity: 6,
          product: shown(),
        })
      );

      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Leche semidesnatada, 0,92 €, 6'
      );
    });

    it('says the star and the other products, which the name hides from a screen reader (velista 0145)', async () => {
      const named = await render(
        vm({
          content: 'Leche',
          named: true,
          quantity: 6,
          product: shown({ favorite: true, others: 2 }),
        })
      );

      expect(row(named).getAttribute('aria-label')).toBe(
        'Leche, list.row.favorite, Leche semidesnatada, Hacendado · 1 L, 0,92 €, list.row.more, 6'
      );

      const notNamed = await render(
        vm({
          content: 'Leche semidesnatada',
          named: false,
          quantity: 6,
          product: shown({ favorite: true, others: 1 }),
        })
      );

      expect(row(notNamed).getAttribute('aria-label')).toBe(
        'Leche semidesnatada, list.row.favorite, 0,92 €, list.row.more, 6'
      );
    });

    it('says zero rather than dropping it', async () => {
      const fixture = await render(vm({ content: 'Olive oil', quantity: 0 }));

      expect(row(fixture).getAttribute('aria-label')).toBe('Olive oil, 0');
    });

    it('does not grow the indicators or the caption into the name', async () => {
      const fixture = await render(
        vm({
          quantity: 0,
          settled: true,
          indicators: ['bought'],
          captionKey: 'list.line.awaitingApproval',
        })
      );

      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf, 0');
      // Both are descriptions instead, which is where a screen reader user can reach
      // them on demand rather than having them read out on every focus.
      expect(row(fixture).getAttribute('aria-describedby')).toBe('st-ln-1');
    });

    it('describes nothing when there is nothing to describe', async () => {
      const fixture = await render(vm());

      expect(row(fixture).hasAttribute('aria-describedby')).toBe(false);
    });
  });

  /** Velista 0145, section 4: one word on the row, every word for a screen reader. */
  describe('the status word', () => {
    it('draws nothing at all on an ordinary row', async () => {
      const fixture = await render(vm());

      expect(statusWords(fixture)).toEqual([]);
    });

    it('draws nothing on a line at zero that has never been bought', async () => {
      // The never wanted case: somebody typed it and it has not been needed yet.
      const fixture = await render(
        vm({ quantity: 0, settled: false, indicators: [] })
      );

      expect(statusWords(fixture)).toEqual([]);
    });

    it('draws one word, the first of section 4, and describes them all', async () => {
      const fixture = await render(
        vm({
          approvalStatus: 'PENDING',
          captionKey: 'list.line.awaitingApproval',
          indicators: ['notAvailable', 'claimed'],
          claimedBy: 'Ana',
        })
      );

      expect(statusWords(fixture)).toEqual(['list.line.awaitingApproval']);
      const described = text(fixture, '#st-ln-1');
      expect(described.indexOf('awaitingApproval')).toBeLessThan(
        described.indexOf('claimedBy')
      );
      expect(described.indexOf('claimedBy')).toBeLessThan(
        described.indexOf('notAvailable')
      );
    });

    it('puts somebody buying it before not available, and that before bought', async () => {
      const fixture = await render(
        vm({
          indicators: ['bought', 'notAvailable', 'claimed'],
          claimedBy: 'Ana',
        })
      );

      expect(statusWords(fixture)).toEqual(['line.indicator.claimedBy']);
    });

    it('names whoever is buying it, and says somebody when it cannot', async () => {
      const named = await render(
        vm({ indicators: ['claimed'], claimedBy: 'Ana' })
      );
      expect(statusWords(named)).toEqual(['line.indicator.claimedBy']);

      const anonymous = await render(
        vm({ indicators: ['claimed'], claimedBy: null })
      );
      expect(statusWords(anonymous)).toEqual(['line.indicator.claimed']);
    });

    it('ends line 2, so a row has no third line', async () => {
      const fixture = await render(
        vm({ indicators: ['bought'], settled: true, product: shown() })
      );
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('.line-2 [data-status]')).not.toBeNull();
      expect(
        host.querySelectorAll('.body > :not(.visually-hidden)')
      ).toHaveLength(2);
    });
  });

  /** Velista 0145, section 3: a picture and two lines. */
  describe('the two lines', () => {
    it('draws a named line: its name in the heavier weight, the price, then the product', async () => {
      const fixture = await render(
        vm({ content: 'Leche', named: true, product: shown() })
      );

      expect(text(fixture, '.line-1 .content')).toBe('Leche');
      expect(query(fixture, '.content.own')).not.toBeNull();
      expect(text(fixture, '.line-1 .price')).toBe('0,92 €');
      expect(text(fixture, '.line-2 .product-name')).toBe(
        'Leche semidesnatada'
      );
      expect(text(fixture, '.line-2 .brand-size')).toBe('Hacendado · 1 L');
    });

    it('draws a line that is not named: the product name as its name, the brand and size alone', async () => {
      const fixture = await render(
        vm({
          content: 'Tomate frito',
          named: false,
          product: shown({
            name: 'Tomate frito',
            brandSize: 'Hacendado · 400 g',
          }),
        })
      );

      expect(query(fixture, '.content.own')).toBeNull();
      expect(query(fixture, '.line-2 .product-name')).toBeNull();
      expect(text(fixture, '.line-2 .brand-size')).toBe('Hacendado · 400 g');
    });

    it('says No price for a product with none', async () => {
      const fixture = await render(vm({ product: shown({ price: null }) }));

      expect(text(fixture, '.line-1 .price.none')).toBe('list.row.noPrice');
    });

    it('draws the star of the favourite with a name of its own', async () => {
      const fixture = await render(
        vm({ named: true, product: shown({ favorite: true }) })
      );

      expect(query(fixture, '.favorite')?.getAttribute('aria-label')).toBe(
        'list.row.favorite'
      );
      expect(query(fixture, '.favorite lib-star-filled-icon')).not.toBeNull();
    });

    it('says how many more products will do, in words as well', async () => {
      const fixture = await render(vm({ product: shown({ others: 2 }) }));

      expect(text(fixture, '.more')).toBe('+2');
      expect(query(fixture, '.more')?.getAttribute('aria-label')).toBe(
        'list.row.more'
      );
    });

    it('draws no "+N" on a line with one product', async () => {
      const fixture = await render(vm({ product: shown({ others: 0 }) }));

      expect(query(fixture, '.more')).toBeNull();
    });

    it('draws the photo, and the product icon with none', async () => {
      const photo = await render(
        vm({ product: shown({ imageUrl: 'https://img.example/1.jpg' }) })
      );
      expect(query(photo, 'lib-product-picture img')).not.toBeNull();

      const none = await render(vm({ product: shown({ imageUrl: null }) }));
      expect(
        query(none, 'lib-product-picture lib-product-icon')
      ).not.toBeNull();
    });

    it('draws bones for the picture and line 2 while the product loads, and keeps the name', async () => {
      const fixture = await render(
        vm({ content: 'Leche', named: true, product: { kind: 'loading' } })
      );

      expect(text(fixture, '.line-1 .content')).toBe('Leche');
      expect(query(fixture, '.picture.bone')).not.toBeNull();
      expect(query(fixture, '.line-2 .line-bone')).not.toBeNull();
    });

    it('draws the name and no product when the products did not load', async () => {
      const fixture = await render(
        vm({ content: 'Leche', product: { kind: 'unread' } })
      );

      expect(text(fixture, '.line-1 .content')).toBe('Leche');
      expect(query(fixture, '.price')).toBeNull();
      expect(query(fixture, '.choose')).toBeNull();
    });
  });

  /** Velista 0145, section 5. */
  describe('a row with no product', () => {
    it('asks for one with the plus and the words, two buttons for one action', async () => {
      const fixture = await render(
        vm({
          content: 'Pan de molde',
          product: { kind: 'none', canChoose: true },
        })
      );
      const chosen: string[] = [];
      fixture.componentInstance.chooseProduct.subscribe((id) =>
        chosen.push(id)
      );
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      const plus = query(fixture, 'button.choose') as HTMLButtonElement;
      expect(plus.getAttribute('aria-label')).toBe('list.row.chooseFor');
      plus.click();
      (query(fixture, 'button.ask') as HTMLButtonElement).click();

      expect(text(fixture, 'button.ask')).toBe('list.row.choose');
      expect(chosen).toEqual(['ln-1', 'ln-1']);
      // Neither opens the line under it.
      expect(opened).toEqual([]);
    });

    it('does not open the line on Enter in either button', async () => {
      const fixture = await render(
        vm({ product: { kind: 'none', canChoose: true } })
      );
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      query(fixture, 'button.ask')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      expect(opened).toEqual([]);
    });

    it('says No product to a reader who may not change the line, with no button', async () => {
      const fixture = await render(
        vm({ product: { kind: 'none', canChoose: false } })
      );

      expect(query(fixture, 'button.choose')).toBeNull();
      expect(query(fixture, 'button.ask')).toBeNull();
      expect(text(fixture, '.no-product')).toBe('list.row.noProduct');
      expect(query(fixture, 'lib-product-picture')).not.toBeNull();
    });

    it('offers no choice in reorder mode', async () => {
      const fixture = await render(
        vm({ product: { kind: 'none', canChoose: true } }),
        { reordering: true }
      );

      expect(query(fixture, 'button.choose')).toBeNull();
    });
  });

  describe('the quantity', () => {
    it('is drawn on every row, zero included', async () => {
      // `0012` drew it only above one, because it was an annotation. It is the
      // control now, and a control that is only sometimes there is not one anybody
      // learns to reach for.
      const one = await render(vm({ quantity: 1 }));
      const zero = await render(vm({ quantity: 0 }));

      expect(reel(one)).not.toBeNull();
      expect(reel(zero)).not.toBeNull();
    });

    it('is read only for a caller who may not decide', async () => {
      const fixture = await render(vm({ adjustable: false }));

      expect(reel(fixture)?.getAttribute('aria-readonly')).toBe('true');
    });

    it('is a spinbutton naming the line, with a floor of zero', async () => {
      const fixture = await render(vm({ quantity: 3 }));

      expect(reel(fixture)?.getAttribute('role')).toBe('spinbutton');
      expect(reel(fixture)?.getAttribute('aria-valuenow')).toBe('3');
      expect(reel(fixture)?.getAttribute('aria-valuemin')).toBe('0');
    });

    it('goes away in reorder mode', async () => {
      // A second gesture living inside a row being dragged would fight the first for
      // the same finger.
      const fixture = await render(vm(), { reordering: true });

      expect(reel(fixture)).toBeNull();
    });
  });

  describe('what a tap does', () => {
    it('opens the line rather than ticking it off', async () => {
      const fixture = await render(vm());
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual(['ln-1']);
    });

    it('opens on Enter and on Space', async () => {
      for (const key of ['Enter', ' ']) {
        const fixture = await render(vm());
        const opened: string[] = [];
        fixture.componentInstance.opened.subscribe((id) => opened.push(id));

        row(fixture).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true })
        );

        expect(opened).toEqual(['ln-1']);
      }
    });

    it('does nothing at all in reorder mode', async () => {
      const fixture = await render(vm(), { reordering: true });
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual([]);
      expect(row(fixture).hasAttribute('role')).toBe(false);
    });

    it('does nothing for a row that cannot be opened', async () => {
      const fixture = await render(vm({ interactive: false }));
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual([]);
    });
  });

  /**
   * The overlay stands over the row it belongs to, so the tap that dismisses it lands
   * on the row underneath. It closes the reel and stops there: it was aimed at the
   * thing on top, and opening the detail sheet on the way out answers a question
   * nobody asked.
   */
  describe('a tap on a line whose reel is up', () => {
    it('closes the reel and does not open the line', async () => {
      const fixture = await render(vm());
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      openReel(fixture);
      expect(overlay(fixture)).not.toBeNull();

      tap(row(fixture));
      fixture.detectChanges();

      expect(overlay(fixture)).toBeNull();
      expect(opened).toEqual([]);
    });

    it('hears the very next tap, which is the one that was meant for the row', async () => {
      const fixture = await render(vm());
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      openReel(fixture);
      tap(row(fixture));
      fixture.detectChanges();
      tap(row(fixture));

      expect(opened).toEqual(['ln-1']);
    });

    it('still hears a tap on the reel itself', async () => {
      // "Somewhere else on the line" is the rule. The reel is not somewhere else.
      const fixture = await render(vm({ quantity: 2 }));
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      openReel(fixture);
      const three = fixture.nativeElement.querySelector(
        '[data-reel-value="3"]'
      ) as HTMLElement;
      down(three);
      up(three);
      fixture.detectChanges();

      // The reel moved, the overlay is still up, and the row heard nothing.
      expect(
        (fixture.nativeElement.querySelector('.current') as HTMLElement)
          .textContent
      ).toContain('3');
      expect(overlay(fixture)).not.toBeNull();
      expect(opened).toEqual([]);
    });
  });

  describe('the beat after the reel closes on its own', () => {
    it('swallows a tap for a moment, then goes back to opening the line', async () => {
      // A finger already falling towards a number does not stop when the thing it was
      // falling towards disappears.
      const fixture = await render(vm());
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      // Fake timers only from here: `render` awaits `whenStable`, which never
      // resolves under them.
      jest.useFakeTimers();
      try {
        openReel(fixture);
        jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
        fixture.detectChanges();

        // Closed by itself, and nobody spent a tap doing it.
        expect(overlay(fixture)).toBeNull();

        tap(row(fixture));
        expect(opened).toEqual([]);

        jest.advanceTimersByTime(QUANTITY_REEL_CLICK_SHIELD_MS + 1);
        tap(row(fixture));
        expect(opened).toEqual(['ln-1']);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('somebody else editing', () => {
    it('draws their initial and the word, and nothing when nobody is', async () => {
      const editing = await render(vm({ editor: 'Ana' }));
      expect(
        editing.nativeElement.querySelector('.editor-avatar')?.textContent
      ).toBe('A');

      const alone = await render(vm());
      expect(alone.nativeElement.querySelector('.editor')).toBeNull();
    });

    it('takes the initial as a code point', async () => {
      // Slicing a string cuts a surrogate pair in half and renders the replacement
      // character for a name that starts with an emoji.
      const fixture = await render(vm({ editor: '🌞 Ana' }));

      expect(
        fixture.nativeElement.querySelector('.editor-avatar')?.textContent
      ).toBe('🌞');
    });

    it('leaves the row a tappable button', async () => {
      // Advisory and nothing more (plan 0022, section 3.4). It is not a lock, and the
      // one thing it must never become is a guard.
      const fixture = await render(vm({ editor: 'Ana' }));
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual(['ln-1']);
    });

    it('stays out of the accessible name of the row', async () => {
      const fixture = await render(vm({ editor: 'Ana' }));

      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf, 1');
    });
  });

  describe('a write in flight', () => {
    it('is aria-busy and keeps its accessible name', async () => {
      const fixture = await render(vm({ write: 'pending' }));

      expect(row(fixture).getAttribute('aria-busy')).toBe('true');
      expect(row(fixture).getAttribute('aria-label')).toBe('Sourdough loaf, 1');
    });

    it('is not busy when nothing is outstanding', async () => {
      const fixture = await render(vm());

      expect(row(fixture).hasAttribute('aria-busy')).toBe(false);
    });

    it('offers a retry on the failed notice rather than a toast', async () => {
      const fixture = await render(vm({ write: 'failed' }));
      const retried: string[] = [];
      fixture.componentInstance.retry.subscribe((id) => retried.push(id));

      (
        fixture.nativeElement.querySelector('.notice.failed') as HTMLElement
      ).click();

      expect(retried).toEqual(['ln-1']);
    });

    it('names whoever overwrote the row, or says somebody did', async () => {
      const named = await render(
        vm({ write: 'overwritten', overwrittenBy: 'Marc' })
      );
      expect(
        named.nativeElement.querySelector('.notice.overwritten')?.textContent
      ).toContain('overwritten');

      const anonymous = await render(
        vm({ write: 'overwritten', overwrittenBy: null })
      );
      expect(
        anonymous.nativeElement.querySelector('.notice.overwritten')
          ?.textContent
      ).toContain('overwrittenBySomeone');
    });
  });

  describe('reorder mode', () => {
    it('drops the role rather than keeping one it dishonours', async () => {
      const fixture = await render(vm(), { reordering: true });

      expect(row(fixture).hasAttribute('role')).toBe(false);
      expect(row(fixture).hasAttribute('aria-label')).toBe(false);
    });

    it('grows a focusable grip with real keys on it', async () => {
      const fixture = await render(vm(), { reordering: true });

      const steps = fixture.nativeElement.querySelectorAll('.grip-step');
      expect(steps).toHaveLength(2);
    });

    it('emits a move rather than reordering its own siblings', async () => {
      const fixture = await render(vm(), { reordering: true });
      const acted: string[] = [];
      fixture.componentInstance.act.subscribe((e) => acted.push(e.action));

      const steps = [
        ...fixture.nativeElement.querySelectorAll('.grip-step'),
      ] as HTMLElement[];
      steps[0].click();
      steps[1].click();

      expect(acted).toEqual(['moveUp', 'moveDown']);
    });
  });

  describe('what the row offers', () => {
    it('draws no menu, and a tap opens the line (velista plan 0083)', async () => {
      // The three dots went: the detail sheet a tap opens edits the line and reaches
      // its comments and its delete.
      const fixture = await render(vm());
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(host.querySelector('[aria-haspopup]')).toBeNull();
      expect(host.querySelector('lib-ellipsis-icon')).toBeNull();

      row(fixture).click();
      expect(opened).toEqual(['ln-1']);
    });

    it('shows the two decisions only when the row is decidable', async () => {
      const undecided = await render(vm());
      expect(undecided.nativeElement.querySelector('.decisions')).toBeNull();

      const waiting = await render(
        vm({ approvalStatus: 'PENDING', decidable: true })
      );
      expect(waiting.nativeElement.querySelectorAll('.decision')).toHaveLength(
        2
      );
    });

    it('offers putting a turned down line back, to whoever decides', async () => {
      const fixture = await render(
        vm({ approvalStatus: 'REJECTED', restorable: true })
      );

      expect(
        fixture.nativeElement.querySelector('.decision')?.textContent
      ).toContain('restore');
    });
  });

  describe('the comment count', () => {
    it('is absent at zero rather than drawn as a zero', async () => {
      const unknown = await render(vm());
      expect(unknown.nativeElement.querySelector('.comment-count')).toBeNull();

      const none = await render(vm({ commentCount: 0 }));
      expect(none.nativeElement.querySelector('.comment-count')).toBeNull();
    });

    it('is drawn when there is something to say', async () => {
      const fixture = await render(vm({ commentCount: 3 }));

      expect(
        fixture.nativeElement.querySelector('.comment-count')?.textContent
      ).toContain('3');
    });
  });
});
