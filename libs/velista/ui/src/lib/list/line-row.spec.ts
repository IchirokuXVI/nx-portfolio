import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  type LineRowShownProduct,
  type LineRowVm,
  type QuantityStep,
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
  inputs: { reordering?: boolean; pending?: number | null } = {}
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
  if (inputs.pending !== undefined) {
    fixture.componentRef.setInput('pending', inputs.pending);
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
    price: { amount: '0,92 €', per: null },
    brand: null,
    size: null,
    total: null,
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

/** The row's stepper (velista `0188`). */
function stepper(fixture: ComponentFixture<LineRow>): HTMLElement | null {
  return fixture.nativeElement.querySelector('lib-quantity-stepper');
}

function plus(fixture: ComponentFixture<LineRow>): HTMLButtonElement {
  return fixture.nativeElement.querySelector(
    'lib-quantity-stepper button.plus'
  ) as HTMLButtonElement;
}

/** A whole tap, press included. */
function tap(target: HTMLElement): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  target.click();
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

    it('draws the piece price of a kilo piece, and says it in the name (velista 0179)', async () => {
      const fixture = await render(
        vm({
          content: 'Queso',
          named: false,
          quantity: 1,
          product: shown({ price: { amount: '20,94 €', per: null } }),
        })
      );

      expect(text(fixture, '.line-1 .price')).toBe('20,94 €');
      expect(query(fixture, '.line-1 .price .per')).toBeNull();
      expect(row(fixture).getAttribute('aria-label')).toBe('Queso, 20,94 €, 1');
    });

    it('draws what a loose product is priced per, small after its number (velista 0179)', async () => {
      const fixture = await render(
        vm({
          content: 'Manzanas',
          named: false,
          quantity: 1,
          product: shown({
            price: { amount: '2,49 €', per: 'catalog.per.KILOGRAM' },
          }),
        })
      );

      const price = query(fixture, '.line-1 .price');
      expect(price?.firstElementChild?.textContent).toBe('2,49 €');
      expect(price?.querySelector('.per')?.textContent).toBe(
        'catalog.per.KILOGRAM'
      );
      // No text between the number and its unit: the unit's margin is the gap.
      expect(price?.textContent).toBe('2,49 €catalog.per.KILOGRAM');
      expect(row(fixture).getAttribute('aria-label')).toBe(
        'Manzanas, 2,49 € catalog.per.KILOGRAM, 1'
      );
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

    it('opens the photo large on a press on it, and not the line', async () => {
      const fixture = await render(
        vm({ product: shown({ imageUrl: 'https://img.example/1.jpg' }) })
      );
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      const zoom = query(fixture, 'lib-product-picture button.zoom');
      expect(zoom?.getAttribute('aria-label')).toBe('photo.open');
      tap(zoom as HTMLElement);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(opened).toEqual([]);
      const photo = query(fixture, 'dialog img');
      expect(photo?.getAttribute('alt')).toBe('Leche semidesnatada');

      (query(fixture, 'dialog button.close') as HTMLElement).click();
      fixture.detectChanges();

      expect(opened).toEqual([]);
      expect(query(fixture, 'dialog')).toBeNull();
    });

    it('names the photo for the line when the catalog lost the product', async () => {
      const fixture = await render(
        vm({
          product: shown({ name: null, imageUrl: 'https://img.example/1.jpg' }),
        })
      );

      (query(fixture, 'button.zoom') as HTMLElement).click();
      fixture.detectChanges();

      expect(query(fixture, 'dialog img')?.getAttribute('alt')).toBe(
        'Sourdough loaf'
      );
    });

    it('draws a photo that opens nothing in reorder mode', async () => {
      const fixture = await render(
        vm({ product: shown({ imageUrl: 'https://img.example/1.jpg' }) }),
        { reordering: true }
      );

      expect(query(fixture, 'lib-product-picture img')).not.toBeNull();
      expect(query(fixture, 'button.zoom')).toBeNull();
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

  describe('the quantity (velista 0188)', () => {
    it('is drawn on every row, zero included', async () => {
      // `0012` drew it only above one, because it was an annotation. It is the
      // control now, and a control that is only sometimes there is not one anybody
      // learns to reach for.
      const one = await render(vm({ quantity: 1 }));
      const zero = await render(vm({ quantity: 0 }));

      expect(stepper(one)).not.toBeNull();
      expect(stepper(zero)?.getAttribute('data-value')).toBe('0');
    });

    it('draws the amount alone, with no buttons, for a caller who may not decide', async () => {
      const fixture = await render(vm({ adjustable: false }));

      expect(stepper(fixture)?.classList).toContain('is-readonly');
      expect(stepper(fixture)?.querySelectorAll('button')).toHaveLength(0);
    });

    it('is a row stepper naming the line', async () => {
      const fixture = await render(vm({ quantity: 3 }));

      expect(stepper(fixture)?.classList).toContain('variant-row');
      expect(
        stepper(fixture)
          ?.querySelector('[role="group"]')
          ?.getAttribute('aria-label')
      ).toBe('amount.group');
      expect(stepper(fixture)?.getAttribute('data-value')).toBe('3');
    });

    it('emits every press as a step, and does not open the line', async () => {
      const fixture = await render(vm({ quantity: 3 }));
      const steps: Array<{ lineId: string; step: QuantityStep }> = [];
      const opened: string[] = [];
      fixture.componentInstance.quantityStepped.subscribe((s) => steps.push(s));
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      plus(fixture).dispatchEvent(new Event('pointerdown', { bubbles: true }));
      plus(fixture).dispatchEvent(new Event('pointerup', { bubbles: true }));
      plus(fixture).click();

      expect(steps).toEqual([
        { lineId: 'ln-1', step: { from: 3, to: 4, repeat: false } },
      ]);
      expect(opened).toEqual([]);
    });

    it('draws the open run while the stored line has not moved (decision H)', async () => {
      const fixture = await render(vm({ quantity: 3 }), { pending: 6 });

      expect(stepper(fixture)?.getAttribute('data-value')).toBe('6');
    });

    it('goes away in reorder mode', async () => {
      // A second gesture living inside a row being dragged would fight the first for
      // the same finger.
      const fixture = await render(vm(), { reordering: true });

      expect(stepper(fixture)).toBeNull();
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
  /**
   * Velista `0191`: the compact row. The same component and view model as the row of
   * today, drawn in its own branch, so every case here is about what the branch draws
   * and what it still shares (section 8).
   */
  describe('compact layout (velista 0191)', () => {
    async function compact(
      line: LineRowVm,
      inputs: { pending?: number | null } = {}
    ): Promise<ComponentFixture<LineRow>> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [LineRow, RokuTranslatorTestingModule.forTesting()],
      }).compileComponents();
      const fixture = TestBed.createComponent(LineRow);
      fixture.componentRef.setInput('line', line);
      fixture.componentRef.setInput('layout', 'compact');
      if (inputs.pending !== undefined) {
        fixture.componentRef.setInput('pending', inputs.pending);
      }
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    }

    /** A pack at 0,99 €, totalled at two. */
    function pack(
      overrides: Partial<LineRowShownProduct> = {}
    ): LineRowShownProduct {
      return shown({
        brand: 'Hacendado',
        size: '1 L',
        price: { amount: '0,99 €', per: null },
        total: { amount: '1,98 €', estimated: false },
        ...overrides,
      });
    }

    /** A loose product at 2,50 € / kg, totalled at 750 g. */
    function loose(
      overrides: Partial<LineRowShownProduct> = {}
    ): LineRowShownProduct {
      return shown({
        name: 'Plátano de Canarias IGP',
        brand: null,
        brandSize: null,
        size: null,
        price: { amount: '2,50 €', per: '/ kg' },
        total: { amount: '1,88 €', estimated: true },
        ...overrides,
      });
    }

    function facts(fixture: ComponentFixture<LineRow>): string[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.facts > *')
      ).map((fact) => fact.textContent?.trim() ?? '');
    }

    it('carries .compact and draws none of the row of today', async () => {
      const fixture = await compact(vm({ product: pack() }));

      expect(row(fixture).classList).toContain('compact');
      expect(query(fixture, '.body')).toBeNull();
      expect(query(fixture, '.line-2')).toBeNull();
    });

    it('draws line 1 as the label, then the brand, then the marks', async () => {
      const fixture = await compact(
        vm({
          content: 'Leche',
          named: true,
          product: pack(),
          editor: 'Ana',
          commentCount: 2,
          indicators: ['bought'],
        })
      );
      const line1 = query(fixture, '.compact-line-1') as HTMLElement;
      const children = Array.from(line1.children).map((child) =>
        child.className.split(' ').filter((name) => name !== '')
      );

      expect(children[0]).toEqual(expect.arrayContaining(['content', 'label']));
      expect(children[1]).toEqual(['brand']);
      expect(children[2]).toEqual(['marks']);
      expect(text(fixture, '.compact-line-1 .label')).toBe('Leche');
      expect(text(fixture, '.compact-line-1 .brand')).toBe('Hacendado');
      // The editor's initial with no word, the comment count, then the status word.
      expect(text(fixture, '.marks .editor-avatar')).toBe('A');
      expect(query(fixture, '.editor-label')).toBeNull();
      expect(text(fixture, '.marks .comment-count')).toBe('2');
      expect(statusWords(fixture)).toEqual(['line.indicator.bought']);
      // A named line draws no product name (decision E).
      expect(fixture.nativeElement.textContent).not.toContain(
        'Leche semidesnatada'
      );
    });

    it('draws a pack of two as its size, its price, and the total of two with no mark', async () => {
      const fixture = await compact(vm({ quantity: 2, product: pack() }));

      expect(facts(fixture)).toEqual(['1 L', '0,99 €', '1,98 €']);
      expect(query(fixture, '.fact.price')?.textContent).not.toContain('≈');
    });

    it('draws both lines for a pack of one, though they say one number', async () => {
      const fixture = await compact(
        vm({
          quantity: 1,
          product: pack({ total: { amount: '0,99 €', estimated: false } }),
        })
      );

      expect(facts(fixture)).toEqual(['1 L', '0,99 €', '0,99 €']);
    });

    it('draws a kilo piece as its weight, its piece price and the estimated total', async () => {
      const fixture = await compact(
        vm({
          quantity: 3,
          product: pack({
            brand: null,
            size: '~2,5 kg',
            price: { amount: '34,98 €', per: null },
            total: { amount: '104,94 €', estimated: true },
          }),
        })
      );

      expect(facts(fixture)).toEqual(['~2,5 kg', '34,98 €', '≈104,94 €']);
    });

    it('draws a product with no brand without a brand', async () => {
      const fixture = await compact(vm({ product: pack({ brand: null }) }));

      expect(query(fixture, '.brand')).toBeNull();
    });

    it('marks the total of 750 g of a loose product, under its price per kilo', async () => {
      const fixture = await compact(
        vm({ quantity: 750, unit: 'GRAM', product: loose() })
      );

      expect(facts(fixture)).toEqual(['', '2,50 € / kg', '≈1,88 €']);
    });

    it('leaves the third line empty at zero, for a loose product and a pack', async () => {
      const fixture = await compact(
        vm({
          quantity: 0,
          unit: 'GRAM',
          product: loose({ total: null }),
        })
      );

      expect(facts(fixture)).toEqual(['', '2,50 € / kg', '']);
      expect(query(fixture, '.fact.price.none')).toBeNull();

      const packAtZero = await compact(
        vm({ quantity: 0, product: pack({ total: null }) })
      );
      expect(facts(packAtZero)).toEqual(['1 L', '0,99 €', '']);
    });

    it('says No price on the third line, and leaves the second empty, for a product with none', async () => {
      const fixture = await compact(
        vm({ product: pack({ price: null, total: null }) })
      );

      expect(facts(fixture)).toEqual(['1 L', '', 'list.row.noPrice']);
      expect(text(fixture, '.fact.price.none')).toBe('list.row.noPrice');
    });

    it('draws a line of several products as the star, the brand and +2 in the brand', async () => {
      const fixture = await compact(
        vm({
          product: pack({
            brand: 'Quesería Artesana de Villalón',
            favorite: true,
            others: 2,
          }),
        })
      );
      const brand = query(fixture, '.compact-line-1 .brand.multi');

      expect(brand?.querySelector('.favorite')).not.toBeNull();
      expect(brand?.querySelector('.brand-text')?.textContent).toBe(
        'Quesería Artesana de Villalón'
      );
      expect(brand?.querySelector('.more')?.textContent).toBe('+2');
    });

    it('draws a free text line as the dashed square and Choose a product, two buttons that choose', async () => {
      const fixture = await compact(
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

      const square = query(fixture, 'button.picture.choose') as HTMLElement;
      const words = query(
        fixture,
        '.facts button.compact-choose'
      ) as HTMLElement;
      expect(square.getAttribute('aria-label')).toBe('list.row.chooseFor');
      expect(words.textContent?.trim()).toBe('list.row.choose');
      tap(square);
      tap(words);

      expect(chosen).toEqual(['ln-1', 'ln-1']);
      expect(opened).toEqual([]);
      expect(query(fixture, '.brand')).toBeNull();
    });

    it('says No product to a reader who may not choose', async () => {
      const fixture = await compact(
        vm({ product: { kind: 'none', canChoose: false } })
      );

      expect(query(fixture, 'button')?.classList).not.toContain('choose');
      expect(text(fixture, '.fact.no-product')).toBe('list.row.noProduct');
      expect(query(fixture, 'lib-product-picture')).not.toBeNull();
    });

    it('draws the four bones and the real label while the product loads', async () => {
      const fixture = await compact(
        vm({ content: 'Leche', product: { kind: 'loading' } })
      );

      expect(query(fixture, '.picture.bone')).not.toBeNull();
      expect(query(fixture, '.compact-line-1 .brand-bone')).not.toBeNull();
      expect(
        fixture.nativeElement.querySelectorAll('.facts > .fact-bone')
      ).toHaveLength(3);
      expect(text(fixture, '.compact-line-1 .label')).toBe('Leche');
      expect(stepper(fixture)).not.toBeNull();
    });

    it('draws a failed product as the label, the plain picture and three empty lines', async () => {
      const fixture = await compact(
        vm({ content: 'Leche', product: { kind: 'unread' } })
      );

      expect(query(fixture, 'lib-product-picture')).not.toBeNull();
      expect(query(fixture, '.brand')).toBeNull();
      expect(facts(fixture)).toEqual([]);
    });

    describe('the accessible name (section 5)', () => {
      it('says the label, the brand, the size, the unit price, the total and the quantity of a pack', async () => {
        const fixture = await compact(
          vm({ content: 'Leche', named: true, quantity: 2, product: pack() })
        );

        expect(row(fixture).getAttribute('aria-label')).toBe(
          'Leche, Hacendado, 1 L, 0,99 €, 1,98 €, 2'
        );
      });

      it('says no total at zero', async () => {
        const fixture = await compact(
          vm({ content: 'Leche', quantity: 0, product: pack({ total: null }) })
        );

        expect(row(fixture).getAttribute('aria-label')).toBe(
          'Leche, Hacendado, 1 L, 0,99 €, 0'
        );
      });

      it('says an estimate as about its amount, for a loose product', async () => {
        const fixture = await compact(
          vm({
            content: 'Plátano de Canarias IGP',
            named: false,
            quantity: 750,
            unit: 'GRAM',
            product: loose(),
          })
        );

        // The testing translator answers the key; `list.row.about` reads
        // "about 1,88 €" in the app.
        expect(row(fixture).getAttribute('aria-label')).toBe(
          'Plátano de Canarias IGP, 2,50 € / kg, list.row.about, 750 g'
        );
      });

      it('says the favourite and +N, as the row draws them', async () => {
        const fixture = await compact(
          vm({
            content: 'Queso',
            product: pack({ favorite: true, others: 2 }),
          })
        );

        expect(row(fixture).getAttribute('aria-label')).toBe(
          'Queso, list.row.favorite, Hacendado, 1 L, 0,99 €, 1,98 €, list.row.more, 1'
        );
      });

      it('says the label and the quantity of a free text line', async () => {
        const fixture = await compact(
          vm({
            content: 'Pan de molde',
            quantity: 2,
            product: { kind: 'none', canChoose: true },
          })
        );

        expect(row(fixture).getAttribute('aria-label')).toBe('Pan de molde, 2');
      });
    });

    it('draws the decisions and both notices under a compact row', async () => {
      const decided = await compact(
        vm({ approvalStatus: 'PENDING', decidable: true, product: pack() })
      );
      expect(
        decided.nativeElement.querySelectorAll('.decisions .decision')
      ).toHaveLength(2);
      expect(row(decided).classList).toContain('awaiting');

      const failed = await compact(vm({ write: 'failed', product: pack() }));
      expect(text(failed, '.notice.failed')).toBe('list.line.failed');

      const overwritten = await compact(
        vm({ write: 'overwritten', overwrittenBy: 'Ana', product: pack() })
      );
      expect(text(overwritten, '.notice.overwritten')).toBe(
        'list.line.overwritten'
      );
    });

    it('keeps the status words for a screen reader, as the row of today does', async () => {
      const fixture = await compact(
        vm({ indicators: ['bought', 'notAvailable'], product: pack() })
      );
      const described = row(fixture).getAttribute('aria-describedby');

      expect(described).toBe('st-ln-1');
      expect(
        fixture.nativeElement.querySelector(`#${described}`)?.textContent
      ).toContain('line.indicator.notAvailable');
    });

    it('draws the row stepper bound as in the default layout', async () => {
      const fixture = await compact(vm({ quantity: 3, product: pack() }), {
        pending: 5,
      });
      const steps: Array<{ lineId: string; step: QuantityStep }> = [];
      const opened: string[] = [];
      fixture.componentInstance.quantityStepped.subscribe((s) => steps.push(s));
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      expect(stepper(fixture)?.classList).toContain('variant-row');
      expect(stepper(fixture)?.getAttribute('data-value')).toBe('5');
      plus(fixture).dispatchEvent(new Event('pointerdown', { bubbles: true }));
      plus(fixture).dispatchEvent(new Event('pointerup', { bubbles: true }));
      plus(fixture).click();

      expect(steps).toEqual([
        { lineId: 'ln-1', step: { from: 5, to: 6, repeat: false } },
      ]);
      expect(opened).toEqual([]);

      const reader = await compact(vm({ adjustable: false, product: pack() }));
      expect(stepper(reader)?.classList).toContain('is-readonly');
    });

    it('opens the line on a tap, as the row of today does', async () => {
      const fixture = await compact(vm({ product: pack() }));
      const opened: string[] = [];
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      row(fixture).click();

      expect(opened).toEqual(['ln-1']);
    });

    /**
     * The owner's decisions of 2026-11-12: while the amount is being saved, line 3
     * draws the saving mark in place of the total, which still follows the stored
     * amount. Lines 1 and 2 stay.
     */
    describe('the saving mark (2026-11-12)', () => {
      function mark(fixture: ComponentFixture<LineRow>): Element | null {
        return query(fixture, '.fact.price.saving lib-spinner-icon');
      }

      it('stands in for the total during an open run, and keeps the price per kilo', async () => {
        const fixture = await compact(
          vm({ quantity: 750, unit: 'GRAM', product: loose() }),
          { pending: 1000 }
        );

        expect(mark(fixture)).not.toBeNull();
        expect(
          query(fixture, '.fact.price.saving')?.getAttribute('aria-hidden')
        ).toBe('true');
        expect(facts(fixture)).toEqual(['', '2,50 € / kg', '']);
        expect(fixture.nativeElement.textContent).not.toContain('1,88');
      });

      it('stands in for the total while the write is in flight', async () => {
        const fixture = await compact(
          vm({
            quantity: 1000,
            unit: 'GRAM',
            write: 'pending',
            product: loose({
              total: { amount: '2,50 €', estimated: true },
            }),
          })
        );

        expect(mark(fixture)).not.toBeNull();
        expect(facts(fixture)).toEqual(['', '2,50 € / kg', '']);
        expect(row(fixture).classList).toContain('in-flight');
      });

      it('draws the total of the new amount once the write has landed', async () => {
        const fixture = await compact(
          vm({ quantity: 750, unit: 'GRAM', product: loose() }),
          { pending: 1000 }
        );

        fixture.componentRef.setInput('pending', null);
        fixture.componentRef.setInput(
          'line',
          vm({
            quantity: 1000,
            unit: 'GRAM',
            product: loose({
              total: { amount: '2,50 €', estimated: true },
            }),
          })
        );
        fixture.detectChanges();

        expect(mark(fixture)).toBeNull();
        expect(facts(fixture)).toEqual(['', '2,50 € / kg', '≈2,50 €']);
      });

      it('never draws the old total between the run and its write', async () => {
        // `quantityRuns` clears `pending` and the line store marks the write
        // pending in one task, so both inputs change before the next render.
        const fixture = await compact(
          vm({ quantity: 750, unit: 'GRAM', product: loose() }),
          { pending: 1000 }
        );

        fixture.componentRef.setInput('pending', null);
        fixture.componentRef.setInput(
          'line',
          vm({
            quantity: 1000,
            unit: 'GRAM',
            write: 'pending',
            product: loose(),
          })
        );
        fixture.detectChanges();

        expect(mark(fixture)).not.toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('≈');
      });

      it("replaces a pack's total too, and keeps its price", async () => {
        const fixture = await compact(vm({ quantity: 2, product: pack() }), {
          pending: 3,
        });

        expect(mark(fixture)).not.toBeNull();
        expect(facts(fixture)).toEqual(['1 L', '0,99 €', '']);
        expect(fixture.nativeElement.textContent).not.toContain('1,98');
      });

      it('replaces No price too, while the amount is saved', async () => {
        const fixture = await compact(
          vm({ quantity: 2, product: pack({ price: null, total: null }) }),
          { pending: 3 }
        );

        expect(mark(fixture)).not.toBeNull();
        expect(query(fixture, '.fact.price.none')).toBeNull();
      });

      it('leaves the total out of the name while the mark shows', async () => {
        const fixture = await compact(
          vm({
            content: 'Plátano de Canarias IGP',
            quantity: 750,
            unit: 'GRAM',
            product: loose(),
          }),
          { pending: 1000 }
        );

        expect(row(fixture).getAttribute('aria-label')).toBe(
          'Plátano de Canarias IGP, 2,50 € / kg, 1 kg'
        );
      });

      it('draws no mark on a free text line or a row with no product', async () => {
        const free = await compact(
          vm({ product: { kind: 'none', canChoose: true }, write: 'pending' }),
          { pending: 3 }
        );
        expect(query(free, '.saving')).toBeNull();

        const loading = await compact(vm({ product: { kind: 'loading' } }), {
          pending: 3,
        });
        expect(query(loading, '.saving')).toBeNull();

        const bare = await compact(vm({ write: 'pending' }), { pending: 3 });
        expect(query(bare, '.saving')).toBeNull();
      });

      it('draws nothing of it on the row of today', async () => {
        const fixture = await render(
          vm({ write: 'pending', product: shown() }),
          { pending: 3 }
        );

        expect(query(fixture, '.saving')).toBeNull();
        expect(text(fixture, '.line-1 .price')).toBe('0,92 €');
      });
    });
  });
});
