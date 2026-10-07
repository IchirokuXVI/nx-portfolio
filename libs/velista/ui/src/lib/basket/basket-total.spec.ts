import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { BasketTotal } from '@portfolio/velista/models';
import { BasketTotalNumber } from './basket-total';
import { basketTotalAmounts } from './basket-total-amounts';

/** The basket of the mock: 12 lines, 9 with a product, 7 priced at the shop. */
const MOCK: BasketTotal = {
  lines: 12,
  withProduct: 9,
  withPrice: 7,
  boughtCents: 1160,
  leftCents: 1247,
  totalCents: 2407,
  currency: 'EUR',
};

async function render(
  inputs: { total?: BasketTotal; chainName?: string | null } = {}
): Promise<ComponentFixture<BasketTotalNumber>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [BasketTotalNumber, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketTotalNumber);
  fixture.componentRef.setInput('total', inputs.total ?? MOCK);
  fixture.componentRef.setInput('locale', 'es');
  fixture.componentRef.setInput('chainName', inputs.chainName ?? null);
  fixture.detectChanges();
  return fixture;
}

function number(fixture: ComponentFixture<BasketTotalNumber>) {
  return (fixture.nativeElement as HTMLElement).querySelector(
    'button'
  ) as HTMLButtonElement;
}

/** The popover is drawn in the overlay, which is under the body and not the host. */
function popover(): HTMLElement | null {
  return document.querySelector(
    '[role="dialog"][aria-labelledby="basket-total-title"]'
  );
}

async function opened(
  inputs: { total?: BasketTotal; chainName?: string | null } = {}
) {
  const fixture = await render(inputs);
  number(fixture).click();
  fixture.detectChanges();
  return fixture;
}

/**
 * The number in the tools row and the popover it opens (velista `0132`, sections
 * 3 and 5).
 *
 * The testing translator answers with the key and drops what it was given, so
 * the sentences are asserted by key and the money by the function that made it.
 */
describe('BasketTotalNumber', () => {
  it('is one real button, named in words and drawn through the tilde string', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(number(fixture).getAttribute('type')).toBe('button');
    // Rule T5: the tilde is in the translation, so the page writes none.
    expect(number(fixture).textContent?.trim()).toBe('basket.total.amount');
    expect(number(fixture).getAttribute('aria-label')).toBe(
      'basket.total.open'
    );
  });

  it('carries no glyph and no live region', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('svg, [class*="icon"]')).toBeNull();
    expect(host.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it('opens the popover from the number, and closes it on a second press', async () => {
    const fixture = await render();

    expect(number(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(popover()).toBeNull();

    number(fixture).click();
    fixture.detectChanges();

    expect(number(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(
      popover()?.querySelector('#basket-total-title')?.textContent
    ).toContain('basket.total.title');

    number(fixture).click();
    fixture.detectChanges();

    expect(number(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(popover()).toBeNull();
  });

  it('closes on Escape and hands focus back to the number', async () => {
    const fixture = await opened();

    popover()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    fixture.detectChanges();

    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(number(fixture));
  });

  it('closes on a press outside it, and leaves focus where the press put it', async () => {
    const fixture = await opened();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    elsewhere.click();
    fixture.detectChanges();

    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('writes three rows, the sum last, each amount through the tilde string', async () => {
    await opened();
    const entries = Array.from(popover()?.querySelectorAll('.entry') ?? []);

    expect(
      entries.map((entry) => entry.querySelector('dt')?.textContent?.trim())
    ).toEqual([
      'basket.total.bought',
      'basket.total.left',
      'basket.total.total',
    ]);
    expect(
      entries.map((entry) => entry.querySelector('dd')?.textContent?.trim())
    ).toEqual([
      'basket.total.amount',
      'basket.total.amount',
      'basket.total.amount',
    ]);
    expect(entries[2].classList).toContain('is-sum');
  });

  it('counts the priced lines at the chain when a shop is chosen', async () => {
    await opened({ chainName: 'Mercadona' });
    const counts = popover()?.querySelector('.counts');

    expect(counts?.querySelector('.with-product')?.textContent?.trim()).toBe(
      'basket.total.withProduct'
    );
    expect(counts?.querySelector('.with-price')?.textContent?.trim()).toBe(
      'basket.total.withPriceAt'
    );
  });

  it('counts them with no chain named when no shop is chosen', async () => {
    await opened({ chainName: null });

    expect(popover()?.querySelector('.with-price')?.textContent?.trim()).toBe(
      'basket.total.withPrice'
    );
  });

  it('leaves the second count out when no line has a product', async () => {
    await opened({
      total: { ...MOCK, withProduct: 0, withPrice: 0 },
      chainName: 'Mercadona',
    });

    expect(popover()?.querySelector('.with-product')).not.toBeNull();
    expect(popover()?.querySelector('.with-price')).toBeNull();
  });

  it('says why the prices are not final, last', async () => {
    await opened();

    expect(
      popover()?.querySelector('.explain')?.lastElementChild?.textContent
    ).toContain('basket.total.why');
  });
});

/** Cents in, money out: the one place the sum becomes major units again. */
describe('basketTotalAmounts', () => {
  // `Intl` separates the number from the sign with a no-break space.
  const plain = (text: string) => text.replace(/\s/g, ' ');

  it('formats each side from its cents, in the reader’s language', () => {
    const es = basketTotalAmounts(MOCK, 'es');

    expect(plain(es.bought)).toBe('11,60 €');
    expect(plain(es.left)).toBe('12,47 €');
    expect(plain(es.total)).toBe('24,07 €');
    expect(basketTotalAmounts(MOCK, 'en').total).toBe('€24.07');
  });

  it('adds no tilde, which is the translation’s to place', () => {
    expect(basketTotalAmounts(MOCK, 'es').total).not.toContain('~');
  });

  it('writes the bare number for a total with no currency', () => {
    expect(basketTotalAmounts({ ...MOCK, currency: null }, 'en').total).toBe(
      '24.07'
    );
  });
});
