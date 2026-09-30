import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { Basket, BasketRow } from '@portfolio/velista/models';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import {
  settle,
  shopMapTesting,
  type ShopMapHarnessOptions,
} from '../shop-map.testing';
import { ShopMapPage } from './shop-map-page';

function row(rowKey: string, state: BasketRow['state']): BasketRow {
  return {
    rowKey,
    content: rowKey,
    left: 1,
    bought: 0,
    asked: 1,
    state,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: ['i-eggs'],
    touchedBy: null,
    touchedAt: null,
    entries: [],
    usual: null,
  };
}

const BASKET = {
  rows: [row('eggs', 'WANTED'), row('more eggs', 'DONE')],
  products: new Map([
    ['i-eggs', { id: 'i-eggs', sectionIds: ['sec-mercadona-eggs'] }],
  ]),
} as unknown as Basket;

async function render(options: ShopMapHarnessOptions & { failing?: boolean }) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting(options);
  harness.maps.failing = options.failing ?? false;
  await TestBed.configureTestingModule({
    imports: [ShopMapPage, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(ShopMapPage);
  fixture.detectChanges();
  await settle(() => fixture.detectChanges());
  return { fixture, ...harness };
}

function text(
  fixture: ComponentFixture<ShopMapPage>,
  selector: string
): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((node) => node.textContent?.trim() ?? '');
}

function view(fixture: ComponentFixture<ShopMapPage>): ShopMapView {
  return fixture.debugElement.query(By.directive(ShopMapView))
    .componentInstance as ShopMapView;
}

/** Velista `0121`, target 3: the map every shopper sees. */
describe('ShopMapPage', () => {
  it('titles the map and names the shop under it', async () => {
    const { fixture } = await render({ params: { locationId: 'loc-tejares' } });

    expect(text(fixture, '.title')).toEqual(['shopMap.title']);
    expect(text(fixture, '.subtitle')).toEqual([
      'Mercadona · Ronda de los Tejares 32',
    ]);
  });

  it('draws the map in the drawn look (velista 0128)', async () => {
    const { fixture } = await render({ params: { locationId: 'loc-tejares' } });

    expect(view(fixture).look()).toBe('shopper-drawn');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('rect.sm-label-tag')
    ).not.toBeNull();
  });

  it('opened from the shop page, offers no list and marks no section', async () => {
    const { fixture } = await render({ params: { locationId: 'loc-tejares' } });

    expect(text(fixture, '.chip')).toEqual([]);
    expect(view(fixture).badges()).toEqual({});
    expect(text(fixture, '.hint')).toEqual(['shopMap.hintAll']);
  });

  it('opened from the basket, counts its lines on the sections that hold them', async () => {
    const { fixture } = await render({
      params: { locationId: 'loc-tejares' },
      query: { basket: 'live' },
      basket: BASKET,
    });

    expect(text(fixture, '.chip')).toEqual(['shopMap.mine', 'shopMap.all']);
    expect(view(fixture).badges()).toEqual({
      Huevos: { count: 1, done: false },
    });
    expect(text(fixture, '.hint')).toEqual(['shopMap.hint']);
  });

  it('shows every section alike under All sections', async () => {
    const { fixture } = await render({
      params: { locationId: 'loc-tejares' },
      query: { basket: 'live' },
      basket: BASKET,
    });

    (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('.chip')[1]
      ?.click();
    fixture.detectChanges();

    expect(view(fixture).badges()).toEqual({});
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelectorAll('.chip')[1]
        ?.getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('opens a tapped section’s sheet over the map, keeping the basket', async () => {
    const { fixture } = await render({
      params: { locationId: 'loc-tejares' },
      query: { basket: 'live' },
      basket: BASKET,
    });
    const go = jest.spyOn(TestBed.inject(Router), 'navigate');
    go.mockResolvedValue(true);

    view(fixture).sectionTapped.emit('huevos ');

    expect(go).toHaveBeenCalledWith(
      ['sheet', 'sections', 'sec-mercadona-eggs'],
      expect.objectContaining({ queryParamsHandling: 'preserve' })
    );
  });

  it('opens nothing for a section the map did not resolve', async () => {
    const { fixture } = await render({ params: { locationId: 'loc-tejares' } });
    const go = jest.spyOn(TestBed.inject(Router), 'navigate');

    view(fixture).sectionTapped.emit('Pescadería');

    expect(go).not.toHaveBeenCalled();
  });

  it('says a shop has no map yet', async () => {
    const { fixture } = await render({ params: { locationId: 'loc-centro' } });

    expect(text(fixture, '.state-text')).toEqual(['shopMap.none']);
  });

  it('says the map would not load, and tries again', async () => {
    const { fixture, maps } = await render({
      params: { locationId: 'loc-tejares' },
      failing: true,
    });

    expect(text(fixture, '.state-text')).toEqual(['shopMap.failed']);
    maps.failing = false;
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.retry')
      ?.click();
    await settle(() => fixture.detectChanges());

    expect(text(fixture, '.state-text')).toEqual([]);
  });

  it('goes back to the basket it counts from on a cold load', async () => {
    const { fixture, pages } = await render({
      params: { locationId: 'loc-tejares' },
      query: { basket: 'b-1' },
      basket: BASKET,
    });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.back')
      ?.click();

    expect(pages.back).toHaveBeenCalledWith('/en/shopping-lists/b-1');
  });

  it('goes back to the shop page when it counts from no basket', async () => {
    const { fixture, pages } = await render({
      params: { locationId: 'loc-tejares' },
    });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.back')
      ?.click();

    expect(pages.back).toHaveBeenCalledWith('/en/shops/loc-tejares');
  });

  it('reads no shop for a guest, whose map still draws', async () => {
    const { fixture, details } = await render({
      params: { locationId: 'loc-tejares' },
      authenticated: false,
    });

    expect(details.asked).toEqual([]);
    expect(text(fixture, '.subtitle')).toEqual([]);
    expect(
      fixture.debugElement.query(By.directive(ShopMapView))
    ).not.toBeNull();
  });

  describe('the Walks button (velista 0122)', () => {
    it('is drawn for an account that maps, and opens the shop’s walks', async () => {
      const { fixture } = await render({
        params: { locationId: 'loc-tejares' },
      });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      expect(text(fixture, '.walks > span')).toEqual(['shopWalks.open']);
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('.walks')
        ?.click();

      expect(navigate).toHaveBeenCalledWith('/en/shops/loc-tejares/walks');
    });

    it('is absent for anybody else, and while me has not answered', async () => {
      for (const permissions of [[], null]) {
        const { fixture } = await render({
          params: { locationId: 'loc-tejares' },
          permissions,
        });

        expect(text(fixture, '.walks')).toEqual([]);
      }
    });
  });
});
