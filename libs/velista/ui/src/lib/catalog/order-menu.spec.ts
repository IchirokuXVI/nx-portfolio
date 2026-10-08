import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { catalogOrdersFor, type CatalogOrder } from '@portfolio/velista/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderMenu } from './order-menu';

/**
 * The order of the catalog's list (velista `0134`, section 3): a control that
 * names the order, and a popover with one radio row for each order on offer.
 *
 * The overlay is drawn into the document next to its anchor, so the queries for
 * the rows read the document and not the fixture.
 */
const BOTH: readonly CatalogOrder[] = ['relevance', 'category'];

/** Every order of stage 2, as the menu shows them while the field has text. */
const EVERY: readonly CatalogOrder[] = [
  'relevance',
  'category',
  'price',
  'unitPrice',
];

let fixture: ComponentFixture<OrderMenu>;
let picked: CatalogOrder[];

async function render(
  orders: readonly CatalogOrder[] = BOTH,
  selected: CatalogOrder = 'relevance'
): Promise<void> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrderMenu, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  fixture = TestBed.createComponent(OrderMenu);
  fixture.componentRef.setInput('orders', orders);
  fixture.componentRef.setInput('selected', selected);
  // Focus only moves on an element that is in the document.
  document.body.append(fixture.nativeElement as HTMLElement);
  fixture.detectChanges();
  await fixture.whenStable();

  picked = [];
  fixture.componentInstance.chosen.subscribe((order) => picked.push(order));
}

async function settle(): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

function control(): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '.control'
  ) as HTMLButtonElement;
}

async function open(): Promise<void> {
  control().click();
  await settle();
}

function group(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="radiogroup"]');
}

function radios(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

function radio(order: CatalogOrder): HTMLButtonElement {
  return document.querySelector(
    `[role="radio"][data-order="${order}"]`
  ) as HTMLButtonElement;
}

afterEach(() => {
  fixture?.destroy();
  (fixture?.nativeElement as HTMLElement | undefined)?.remove();
});

describe('OrderMenu', () => {
  it('is closed until it is pressed, and names the order it holds', async () => {
    await render();

    expect(group()).toBeNull();
    expect(radios()).toHaveLength(0);
    expect(control().getAttribute('aria-expanded')).toBe('false');
    expect(control().getAttribute('aria-haspopup')).toBe('true');
    expect(control().textContent).toContain('catalog.order.label');
    expect(control().textContent).toContain('catalog.order.short.relevance');
  });

  it('opens a group of radios, one for each order given, in that order', async () => {
    await render();

    await open();

    expect(group()).not.toBeNull();
    expect(radios().map((one) => one.dataset['order'])).toEqual([
      'relevance',
      'category',
    ]);
    expect(control().getAttribute('aria-expanded')).toBe('true');
  });

  it('draws no row for an order the read cannot serve', async () => {
    await render(['category'], 'category');

    await open();

    expect(radios().map((one) => one.dataset['order'])).toEqual(['category']);
  });

  it('offers the three orders of a field with no text, and no best match', async () => {
    await render(catalogOrdersFor(''), 'category');

    expect(control().textContent).toContain('catalog.order.short.category');
    await open();

    expect(radios().map((one) => one.dataset['order'])).toEqual([
      'category',
      'price',
      'unitPrice',
    ]);
  });

  it('offers best match as a fourth order while the field has text', async () => {
    await render(catalogOrdersFor('milk'), 'relevance');

    await open();

    expect(radios().map((one) => one.dataset['order'])).toEqual([
      'relevance',
      'category',
      'price',
      'unitPrice',
    ]);
  });

  it('says what each order is called and what it does', async () => {
    await render(EVERY, 'relevance');

    await open();

    for (const order of EVERY) {
      expect(radio(order).querySelector('.option-name')?.textContent).toContain(
        `catalog.order.${order}`
      );
      expect(radio(order).querySelector('.option-hint')?.textContent).toContain(
        `catalog.order.hint.${order}`
      );
    }
  });

  it('names the order it holds by its short name, whichever it is', async () => {
    for (const order of EVERY) {
      await render(EVERY, order);

      expect(control().textContent).toContain(`catalog.order.short.${order}`);

      fixture.destroy();
      (fixture.nativeElement as HTMLElement).remove();
    }
  });

  it('has a name, a short name and a hint for each order in both languages, and none for an order that is gone', () => {
    // The testing translator answers the key, so the strings are read off the
    // files the real one loads.
    for (const locale of ['en', 'es']) {
      const file = join(__dirname, '../../../assets/i18n', `${locale}.json`);
      const order = JSON.parse(readFileSync(file, 'utf8')).catalog.order;

      expect(typeof order.label).toBe('string');
      for (const one of EVERY) {
        expect([one, typeof order[one]]).toEqual([one, 'string']);
        expect([one, typeof order.short[one]]).toEqual([one, 'string']);
        expect([one, typeof order.hint[one]]).toEqual([one, 'string']);
      }
      expect(Object.keys(order).sort()).toEqual(
        [...EVERY, 'hint', 'label', 'short'].sort()
      );
      expect(Object.keys(order.short).sort()).toEqual([...EVERY].sort());
      expect(Object.keys(order.hint).sort()).toEqual([...EVERY].sort());
    }
  });

  it('names the group by its title', async () => {
    await render();

    await open();

    const titleId = group()?.getAttribute('aria-labelledby') ?? '';
    expect(titleId).not.toBe('');
    expect(document.getElementById(titleId)?.textContent).toContain(
      'catalog.order.label'
    );
    expect(
      document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')
    ).toBe(titleId);
  });

  it('checks the order that is chosen, and only that one', async () => {
    await render(BOTH, 'category');

    await open();

    expect(radio('category').getAttribute('aria-checked')).toBe('true');
    expect(radio('category').classList.contains('is-on')).toBe(true);
    expect(radio('category').getAttribute('tabindex')).toBe('0');
    expect(radio('relevance').getAttribute('aria-checked')).toBe('false');
    expect(radio('relevance').classList.contains('is-on')).toBe(false);
    expect(radio('relevance').getAttribute('tabindex')).toBe('-1');
  });

  it('enters the group at the chosen row', async () => {
    await render(BOTH, 'category');

    await open();

    expect(document.activeElement).toBe(radio('category'));
  });

  it('says which order was chosen, closes, and goes back to the control', async () => {
    await render();
    await open();

    radio('category').click();
    await settle();

    expect(picked).toEqual(['category']);
    expect(group()).toBeNull();
    expect(control().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(control());
  });

  it('closes and says nothing when the chosen order is pressed again', async () => {
    await render();
    await open();

    radio('relevance').click();
    await settle();

    expect(picked).toEqual([]);
    expect(group()).toBeNull();
    expect(control().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape, says nothing, and goes back to the control', async () => {
    await render();
    await open();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await settle();

    expect(picked).toEqual([]);
    expect(group()).toBeNull();
    expect(control().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(control());
  });

  it('closes on a second press on the control', async () => {
    await render();
    await open();

    control().click();
    await settle();

    expect(group()).toBeNull();
    expect(control().getAttribute('aria-expanded')).toBe('false');
    expect(picked).toEqual([]);
  });

  it('opens again after it was closed', async () => {
    await render();
    await open();
    radio('category').click();
    await settle();

    await open();

    expect(radios()).toHaveLength(2);
    expect(control().getAttribute('aria-expanded')).toBe('true');
  });

  it('moves between the rows with the arrow keys, round the ends', async () => {
    await render(BOTH, 'relevance');
    await open();

    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    radio('relevance').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(radio('category'));

    radio('category').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(document.activeElement).toBe(radio('relevance'));

    radio('relevance').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
    );
    expect(document.activeElement).toBe(radio('category'));
    // An arrow moves focus. It chooses nothing.
    expect(picked).toEqual([]);
  });
});
