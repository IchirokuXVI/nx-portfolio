import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { BasketShop, NearbyShop } from '@portfolio/velista/models';
import { NearMeButton } from './near-me-button';
import { ShopPickMessage } from './shop-pick-message';
import {
  nearbyShopRow,
  recentShopRow,
  shopRowOf,
  shopSentenceOf,
} from './shop-rows';

const SHOP: BasketShop = {
  id: 'loc-1',
  supermarketId: 'sm-1',
  chain: { en: 'Mercadona', es: 'Mercadona' },
  label: null,
  address: 'Calle Mayor 3',
  city: 'Córdoba',
  postalCode: '14001',
  inProfile: true,
};

/**
 * The pieces "Near me" is drawn with (velista `0103`): the button in the title
 * row, the message after a pick, and the rows the two new sections are made of.
 */
describe('Near me pieces', () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [
        NearMeButton,
        ShopPickMessage,
        RokuTranslatorTestingModule.forTesting(),
      ],
    }).compileComponents();
  });

  describe('NearMeButton', () => {
    it('reports a press, and says Near me', () => {
      const fixture = TestBed.createComponent(NearMeButton);
      fixture.detectChanges();
      let presses = 0;
      fixture.componentInstance.pressed.subscribe(() => presses++);

      const button = fixture.nativeElement.querySelector(
        'button'
      ) as HTMLButtonElement;
      button.click();

      expect(presses).toBe(1);
      expect(button.textContent).toContain('basket.view.shop.near.button');
    });

    it('says Finding you while busy, swallows a second press, and never disables', () => {
      const fixture = TestBed.createComponent(NearMeButton);
      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      let presses = 0;
      fixture.componentInstance.pressed.subscribe(() => presses++);

      const button = fixture.nativeElement.querySelector(
        'button'
      ) as HTMLButtonElement;
      button.click();

      expect(presses).toBe(0);
      expect(button.textContent).toContain('basket.view.shop.near.finding');
      expect(button.getAttribute('aria-busy')).toBe('true');
      // A disabled button drops focus to the body, and Escape no longer reaches
      // the sheet.
      expect(button.disabled).toBe(false);
    });
  });

  describe('ShopPickMessage', () => {
    it('names the shop and the distance, and reports Change and the x apart', () => {
      const fixture = TestBed.createComponent(ShopPickMessage);
      fixture.componentRef.setInput('shop', 'Mercadona, Calle Mayor 3');
      fixture.componentRef.setInput('distance', '120 m');
      fixture.detectChanges();
      const taps: string[] = [];
      fixture.componentInstance.changeShop.subscribe(() => taps.push('change'));
      fixture.componentInstance.dismissed.subscribe(() => taps.push('dismiss'));

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[role="status"]')?.textContent).toContain(
        'basket.view.shop.near.picked'
      );
      (root.querySelector('.change') as HTMLButtonElement).click();
      (root.querySelector('.dismiss') as HTMLButtonElement).click();

      expect(taps).toEqual(['change', 'dismiss']);
    });
  });

  describe('the rows', () => {
    it('draws a candidate with its distance, and the warning when the server said outside', () => {
      const near: NearbyShop = {
        ...SHOP,
        inProfile: false,
        distanceMetres: 140,
        excluded: false,
      };

      const row = nearbyShopRow(near, 'en');

      expect(row.aside).toEqual({ text: '140 m', kind: 'distance' });
      expect(row.outsideAreas).toBe(true);
      expect(row.where).toBe('Calle Mayor 3, Córdoba');
    });

    it('says today and yesterday in words, and a weekday or a date after that', () => {
      const words = { today: 'TODAY', yesterday: 'YESTERDAY' };
      const now = new Date(2026, 8, 24, 18, 0);

      const day = (at: Date) =>
        recentShopRow({ shop: SHOP, lastBoughtAt: at }, 'en', words, now).aside
          ?.text;

      expect(day(new Date(2026, 8, 24, 9, 0))).toBe('TODAY');
      expect(day(new Date(2026, 8, 23, 22, 0))).toBe('YESTERDAY');
      expect(day(new Date(2026, 8, 22, 12, 0))).toBe('Tuesday');
      expect(day(new Date(2026, 8, 2, 12, 0))).toBe('Sep 2');
    });

    it('names a shop in one sentence, chain first, then its own name or street', () => {
      expect(shopSentenceOf(SHOP, 'en')).toBe('Mercadona, Calle Mayor 3');
      expect(
        shopSentenceOf(
          { ...SHOP, label: { en: 'Tejares', es: 'Tejares' } },
          'en'
        )
      ).toBe('Mercadona, Tejares');
      expect(shopRowOf({ ...SHOP, inProfile: true }, 'en').outsideAreas).toBe(
        false
      );
    });
  });
});
