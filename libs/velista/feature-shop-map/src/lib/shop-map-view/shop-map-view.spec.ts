import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MEMORY_SHOP_MAPS,
  toShopMapRead,
} from '@portfolio/velista/data-access';
import type { ShopMapBadgeCount } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  ThemeStore,
} from '@portfolio/velista/platform';
import { ShopMapView } from './shop-map-view';

const read = toShopMapRead(MEMORY_SHOP_MAPS['loc-tejares']);
if (read.kind !== 'map') {
  throw new Error('the memory map must read');
}
const DOCUMENT = read.map.document;

@Component({
  imports: [ShopMapView],
  template: `<lib-shop-map-view
    (sectionTapped)="tapped.push($event)"
    [badges]="badges()"
    [document]="document"
    label="Map of the shop"
  />`,
})
class Host {
  readonly document = DOCUMENT;
  readonly badges = signal<Record<string, ShopMapBadgeCount>>({});
  readonly tapped: string[] = [];
}

async function render() {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideVelistaTesting(), provideFakeBrowserFacade(new Map())],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(
    'lib-shop-map-view'
  ) as HTMLElement;
  return { fixture, element };
}

/** Velista `0121`: the shared canvas, mounted by velista in the shopper look. */
describe('ShopMapView', () => {
  it('mounts the canvas and names it for a screen reader', async () => {
    const { element } = await render();

    expect(element.querySelector('svg')).not.toBeNull();
    expect(element.getAttribute('aria-label')).toBe('Map of the shop');
  });

  it('binds velista’s own theme on the host, not the system’s', async () => {
    const { fixture, element } = await render();

    expect(element.getAttribute('data-theme')).toBe(
      TestBed.inject(ThemeStore).theme()
    );
    TestBed.inject(ThemeStore).setPreference('day');
    fixture.detectChanges();
    expect(element.getAttribute('data-theme')).toBe('day');
  });

  it('draws the badges it is given, and takes them away', async () => {
    const { fixture, element } = await render();

    fixture.componentInstance.badges.set({ Huevos: { count: 2, done: false } });
    fixture.detectChanges();
    expect(element.querySelectorAll('.sm-badge').length).toBe(1);

    fixture.componentInstance.badges.set({});
    fixture.detectChanges();
    expect(element.querySelectorAll('.sm-badge').length).toBe(0);
  });

  it('takes the canvas away with the component', async () => {
    const { fixture, element } = await render();

    fixture.destroy();

    expect(element.querySelector('svg')).toBeNull();
  });
});
