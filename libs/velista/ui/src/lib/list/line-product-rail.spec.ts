import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineProductCardVm } from '@portfolio/velista/models';
import { LineProductRail } from './line-product-rail';

/**
 * The cards of a line, at the DOM (velista `0135`, sections 3 and 3.1): what a
 * card says where the price goes, and who gets a star to press.
 */

function card(overrides: Partial<LineProductCardVm> = {}): LineProductCardVm {
  return {
    itemId: 'normal',
    name: 'Shampoo for normal hair',
    detail: '400 ml · Deliplus',
    imageUrl: null,
    priceKind: 'priced',
    price: '2,15 €',
    caption: 'Mercadona · 5,38 € / L',
    cheapest: false,
    favorite: false,
    ...overrides,
  };
}

async function render(inputs: {
  cards: readonly LineProductCardVm[];
  canFavorite?: boolean;
  busy?: boolean;
  supermarket?: string | null;
}): Promise<{
  fixture: ComponentFixture<LineProductRail>;
  opened: string[];
  favorited: string[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LineProductRail, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineProductRail);
  fixture.componentRef.setInput('cards', inputs.cards);
  fixture.componentRef.setInput('canFavorite', inputs.canFavorite ?? false);
  fixture.componentRef.setInput('busy', inputs.busy ?? false);
  fixture.componentRef.setInput('supermarket', inputs.supermarket ?? null);

  const opened: string[] = [];
  const favorited: string[] = [];
  fixture.componentInstance.opened.subscribe((id) => opened.push(id));
  fixture.componentInstance.favorited.subscribe((id) => favorited.push(id));

  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, opened, favorited };
}

const root = (fixture: ComponentFixture<LineProductRail>): HTMLElement =>
  fixture.nativeElement as HTMLElement;

describe('LineProductRail', () => {
  it('draws the name, the detail, the price and the caption of a card', async () => {
    const { fixture } = await render({ cards: [card()] });
    const text = root(fixture).textContent ?? '';

    expect(text).toContain('Shampoo for normal hair');
    expect(text).toContain('400 ml · Deliplus');
    expect(text).toContain('2,15 €');
    expect(text).toContain('Mercadona · 5,38 € / L');
  });

  it('opens the product of the card that was pressed', async () => {
    const { fixture, opened } = await render({ cards: [card()] });

    (root(fixture).querySelector('.open') as HTMLButtonElement).click();

    expect(opened).toEqual(['normal']);
  });

  it('puts the word on the cheapest card only', async () => {
    const { fixture } = await render({
      cards: [card({ cheapest: true }), card({ itemId: 'classic' })],
    });

    expect(root(fixture).querySelectorAll('.word')).toHaveLength(1);
  });

  it('names a product the catalog has not named', async () => {
    const { fixture } = await render({ cards: [card({ name: null })] });

    expect(root(fixture).textContent).toContain('list.detail.unnamedProduct');
  });

  describe('where the price goes', () => {
    it('says no price in words', async () => {
      const { fixture } = await render({
        cards: [card({ priceKind: 'noPrice', price: null, caption: null })],
      });

      expect(root(fixture).textContent).toContain('list.page.card.noPrice');
      expect(root(fixture).querySelector('.price')).toBeNull();
    });

    it('says the supermarket of the line does not sell it', async () => {
      const { fixture } = await render({
        cards: [card({ priceKind: 'notSold', price: null, caption: null })],
        supermarket: 'Mercadona',
      });

      expect(root(fixture).textContent).toContain('list.page.card.notSold');
    });

    it('draws a bone while the price is read, and no words', async () => {
      const { fixture } = await render({
        cards: [card({ priceKind: 'loading', price: null, caption: null })],
      });

      expect(root(fixture).querySelector('.price.bone')).not.toBeNull();
      expect(root(fixture).textContent).not.toContain('list.page.card.noPrice');
    });
  });

  describe('the star', () => {
    it('is a button on each card for somebody who may edit, pressed on the favourite', async () => {
      const { fixture, favorited } = await render({
        cards: [card({ favorite: true }), card({ itemId: 'classic' })],
        canFavorite: true,
      });
      const stars = [
        ...root(fixture).querySelectorAll<HTMLButtonElement>('button.star'),
      ];

      expect(stars.map((star) => star.getAttribute('aria-pressed'))).toEqual([
        'true',
        'false',
      ]);
      expect(stars[0].getAttribute('aria-label')).toContain(
        'list.page.card.favoriteOn'
      );
      expect(stars[1].getAttribute('aria-label')).toContain(
        'list.page.card.favoriteOff'
      );

      stars[1].click();
      expect(favorited).toEqual(['classic']);
    });

    it('is not a child of the button that opens the product', async () => {
      const { fixture } = await render({
        cards: [card()],
        canFavorite: true,
      });

      expect(root(fixture).querySelector('.open button')).toBeNull();
    });

    it('is a mark on the favourite alone for a reader who may not edit', async () => {
      const { fixture } = await render({
        cards: [card({ favorite: true }), card({ itemId: 'classic' })],
      });

      expect(root(fixture).querySelectorAll('button.star')).toHaveLength(0);
      const marks = root(fixture).querySelectorAll('.star.is-mark');
      expect(marks).toHaveLength(1);
      expect(marks[0].textContent).toContain('list.page.card.favorite');
    });

    it('waits while a write is out', async () => {
      const { fixture } = await render({
        cards: [card()],
        canFavorite: true,
        busy: true,
      });

      expect(
        (root(fixture).querySelector('button.star') as HTMLButtonElement)
          .disabled
      ).toBe(true);
    });
  });
});

describe('LineProductRail, the picture (velista 0162, section 3)', () => {
  it('draws the shared picture: the photo, or the glyph for none and for a failed one', async () => {
    const { fixture } = await render({
      cards: [
        card({ itemId: 'a', imageUrl: 'https://img.test/a.jpg' }),
        card({ itemId: 'b', imageUrl: null }),
      ],
    });
    const pictures = [
      ...root(fixture).querySelectorAll('button.open > lib-product-picture'),
    ];

    expect(pictures).toHaveLength(2);
    expect(pictures[0]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.test/a.jpg'
    );
    expect(pictures[1]?.querySelector('lib-product-icon')).not.toBeNull();
    // Inside the card's button, so it opens nothing of its own.
    expect(pictures[0]?.querySelector('button')).toBeNull();

    pictures[0]?.querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(pictures[0]?.querySelector('img')).toBeNull();
    expect(pictures[0]?.querySelector('lib-product-icon')).not.toBeNull();
  });
});
