import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { BasketTotal } from '@portfolio/velista/models';
import { NoPricesNote } from './no-prices-note';

/** Twelve lines that are only words, as the mock draws. */
const WORDS: BasketTotal = {
  lines: 12,
  withProduct: 0,
  withPrice: 0,
  boughtCents: 0,
  leftCents: 0,
  totalCents: 0,
  currency: null,
};

/** Lines with a product, and no price for any of them. */
const UNPRICED: BasketTotal = { ...WORDS, withProduct: 9 };

interface NoteInputs {
  total?: BasketTotal;
  shopChosen?: boolean;
  guest?: boolean;
}

async function render(
  inputs: NoteInputs = {}
): Promise<ComponentFixture<NoPricesNote>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [NoPricesNote, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(NoPricesNote);
  fixture.componentRef.setInput('total', inputs.total ?? WORDS);
  fixture.componentRef.setInput('shopChosen', inputs.shopChosen ?? false);
  fixture.componentRef.setInput('guest', inputs.guest ?? false);
  fixture.detectChanges();
  return fixture;
}

function host(fixture: ComponentFixture<NoPricesNote>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function more(fixture: ComponentFixture<NoPricesNote>): HTMLButtonElement {
  return host(fixture).querySelector('button') as HTMLButtonElement;
}

async function expanded(inputs: NoteInputs = {}) {
  const fixture = await render(inputs);
  more(fixture).click();
  fixture.detectChanges();
  return fixture;
}

/** Every sentence of the opened part, in order. */
function sentences(fixture: ComponentFixture<NoPricesNote>): string[] {
  return Array.from(host(fixture).querySelectorAll('.body p, .body li')).map(
    (el) => el.textContent?.trim() ?? ''
  );
}

/** The small row for a basket where no line has a price (velista `0132`, section 6). */
describe('NoPricesNote', () => {
  it('is one row: an icon nobody hears, the sentence, and one button', async () => {
    const fixture = await render();

    expect(
      host(fixture).querySelector('lib-info-icon')?.getAttribute('aria-hidden')
    ).toBe('true');
    expect(host(fixture).querySelector('.title')?.textContent?.trim()).toBe(
      'basket.total.none.title'
    );
    expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
  });

  it('starts closed, and says so', async () => {
    const fixture = await render();

    expect(more(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(more(fixture).textContent?.trim()).toBe('basket.total.none.more');
    expect(host(fixture).querySelector('.body')).toBeNull();
  });

  it('opens the rest in place, and closes it again', async () => {
    const fixture = await expanded();

    expect(more(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(more(fixture).textContent?.trim()).toBe('basket.total.none.less');
    // Directly after the row, so it is what a reader reaches next.
    expect(
      host(fixture).querySelector('.head')?.nextElementSibling?.classList
    ).toContain('body');

    more(fixture).click();
    fixture.detectChanges();

    expect(more(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(host(fixture).querySelector('.body')).toBeNull();
  });

  it('ties the button to the sentence, so the button says more of what', async () => {
    const fixture = await render();
    const described = more(fixture).getAttribute('aria-describedby');

    expect(described).toBeTruthy();
    expect(host(fixture).querySelector(`#${described}`)?.textContent).toContain(
      'basket.total.none.title'
    );
  });

  it('has no close button', async () => {
    const fixture = await expanded();

    expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
  });

  it('gives lines that are only words the three steps, as an ordered list', async () => {
    const fixture = await expanded({ total: WORDS });

    expect(sentences(fixture)).toEqual([
      'basket.total.none.words',
      'basket.total.none.step1',
      'basket.total.none.step2',
      'basket.total.none.step3',
      'basket.total.none.shop',
    ]);
    expect(host(fixture).querySelectorAll('ol > li')).toHaveLength(3);
  });

  it('tells lines with a product and no price that a price can show later', async () => {
    const fixture = await expanded({ total: UNPRICED });

    expect(sentences(fixture)).toEqual(['basket.total.none.unpriced']);
  });

  it('points at the filter only while a shop is chosen', async () => {
    const fixture = await expanded({ total: UNPRICED, shopChosen: true });

    expect(sentences(fixture)).toEqual([
      'basket.total.none.unpriced',
      'basket.total.none.otherShop',
    ]);
  });

  it('never gives a guest the steps, whatever the cause', async () => {
    const words = await expanded({ total: WORDS, guest: true });
    expect(sentences(words)).toEqual(['basket.total.none.unpriced']);
    expect(host(words).querySelector('ol')).toBeNull();

    const unpriced = await expanded({
      total: UNPRICED,
      guest: true,
      shopChosen: true,
    });
    expect(sentences(unpriced)).toEqual([
      'basket.total.none.unpriced',
      'basket.total.none.otherShop',
    ]);
  });
});
