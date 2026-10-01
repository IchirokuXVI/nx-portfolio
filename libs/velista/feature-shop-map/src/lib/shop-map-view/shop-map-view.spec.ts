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
    (areaTapped)="tapped.push($event.id)"
    (noteTapped)="tapped.push($event.id)"
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

  // Velista 0129, target 6: the canvas reports any area and any note.
  it('hands on a tap on an area of the map', async () => {
    // A size before the canvas mounts: jsdom gives every element none, and a
    // map fitted into nothing puts everything on one point.
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      toJSON: () => ({}),
    } as DOMRect);
    const { fixture, element } = await render();
    const svg = element.querySelector('svg') as SVGSVGElement;
    const shown = /matrix\(([^)]+)\)/
      .exec(
        element.querySelector('g[transform]')?.getAttribute('transform') ?? ''
      )?.[1]
      .split(' ')
      .map(Number) ?? [1, 0, 0, 1, 0, 0];
    // One with no note on it: a note is asked before the area under it.
    const area = DOCUMENT.areas.find(
      (one) =>
        one.kind !== 'path' &&
        one.kind !== 'blocked' &&
        DOCUMENT.marks.every(
          (mark) =>
            Math.hypot(
              mark.x - (one.x + one.w / 2),
              mark.y - (one.y + one.h / 2)
            ) > 2
        )
    );
    if (area === undefined) {
      throw new Error('the memory map must hold an area');
    }
    const at = {
      clientX: (area.x + area.w / 2) * shown[0] + shown[4],
      clientY: (area.y + area.h / 2) * shown[0] + shown[5],
    };
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new MouseEvent(type, { ...at, bubbles: true, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'touch' });
      svg.dispatchEvent(event);
    }

    expect(fixture.componentInstance.tapped).toEqual([area.id]);
    jest.restoreAllMocks();
  });

  it('takes the canvas away with the component', async () => {
    const { fixture, element } = await render();

    fixture.destroy();

    expect(element.querySelector('svg')).toBeNull();
  });
});
