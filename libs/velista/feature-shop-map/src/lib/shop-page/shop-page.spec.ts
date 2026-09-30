import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { MEMORY_SHOP_DETAILS } from '@portfolio/velista/data-access';
import { settle, shopMapTesting } from '../shop-map.testing';
import { ShopPage, shopPageText } from './shop-page';

async function render(locationId: string, failing = false) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({ params: { locationId } });
  harness.details.failing = failing;
  await TestBed.configureTestingModule({
    imports: [ShopPage, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(ShopPage);
  fixture.detectChanges();
  await settle(() => fixture.detectChanges());
  return { fixture, ...harness };
}

function text(fixture: ComponentFixture<ShopPage>, selector: string): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((node) => node.textContent?.trim() ?? '');
}

/** Velista `0121`, target 2: a shop's own page. */
describe('ShopPage', () => {
  it('names the shop by its street when it has no name, and the chain under it', async () => {
    const { fixture } = await render('loc-tejares');

    expect(text(fixture, '.title')).toEqual(['Ronda de los Tejares 32']);
    expect(text(fixture, '.subtitle')).toEqual(['Mercadona']);
  });

  it('draws the address, the size and See the map', async () => {
    const { fixture } = await render('loc-tejares');

    expect(text(fixture, '.fact-sub')).toEqual([
      '14008 Córdoba',
      'shopPage.sizeSource',
    ]);
    expect(text(fixture, '.see-map')).toEqual(['shopPage.seeMap']);
  });

  it('lists the sections in the order they are walked, numbered', async () => {
    const { fixture } = await render('loc-tejares');

    expect(text(fixture, '.section-number')).toEqual(['1']);
    expect(text(fixture, '.section-name')).toEqual(['Eggs']);
  });

  it('leaves out the size, the map and the sections when the shop has none', async () => {
    const { fixture } = await render('loc-centro');

    expect(text(fixture, '.fact-main')).toEqual(['Calle Gondomar 4']);
    expect(text(fixture, '.see-map')).toEqual([]);
    expect(text(fixture, '.sections')).toEqual([]);
  });

  it('opens the map with no basket', async () => {
    const { fixture } = await render('loc-tejares');
    const go = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
    go.mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.see-map')
      ?.click();

    expect(go).toHaveBeenCalledWith('/en/shops/loc-tejares/map');
  });

  it('goes back, home on a cold load', async () => {
    const { fixture, pages } = await render('loc-tejares');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.back')
      ?.click();

    expect(pages.back).toHaveBeenCalledWith('/en/home');
  });

  it('says so when the shop would not load, and tries again', async () => {
    const { fixture, details } = await render('loc-tejares', true);

    expect(text(fixture, '.title')).toEqual(['shopPage.failed']);
    details.failing = false;
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.retry')
      ?.click();
    await settle(() => fixture.detectChanges());

    expect(text(fixture, '.title')).toEqual(['Ronda de los Tejares 32']);
  });

  it('says so for a shop the catalog does not know', async () => {
    const { fixture } = await render('loc-nowhere');

    expect(text(fixture, '.title')).toEqual(['shopPage.missing']);
  });
});

describe('shopPageText', () => {
  const shop = MEMORY_SHOP_DETAILS['loc-tejares'];

  it('prefers the shop’s own name, and puts the street under it', () => {
    expect(
      shopPageText({ ...shop, label: { en: 'Tejares', es: 'Tejares' } }, 'en')
    ).toEqual({
      title: 'Tejares',
      chain: 'Mercadona',
      street: 'Ronda de los Tejares 32',
      place: '14008 Córdoba',
    });
  });

  it('falls back to the town, then the chain', () => {
    expect(shopPageText({ ...shop, address: null }, 'en').title).toBe(
      'Córdoba'
    );
    expect(
      shopPageText({ ...shop, address: null, city: null }, 'en')
    ).toMatchObject({ title: 'Mercadona', chain: null });
  });
});
