import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { StatTile } from './stat-tile';

/**
 * The headline number.
 *
 * A router is provided, and it is the one provider these specs add beyond the
 * translator double. `routerLink` is what makes the whole tile open its screen,
 * so a spec that left the router out would be asserting on a tile that cannot do
 * the one thing a link changes.
 */

async function render(
  inputs: Record<string, unknown>
): Promise<ComponentFixture<StatTile>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [StatTile, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(StatTile);
  fixture.componentRef.setInput('label', 'Users');
  fixture.componentRef.setInput('value', 0);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<unknown>, selector: string) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector(selector)
    ?.textContent?.trim();

const one = (fixture: ComponentFixture<unknown>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector);

describe('StatTile', () => {
  it('groups the value with Intl rather than printing the raw number', async () => {
    const fixture = await render({ value: 12345 });

    expect(text(fixture, '.value')).toBe(
      new Intl.NumberFormat('en').format(12345)
    );
  });

  /**
   * The sign is the whole content of a delta: without one it reads as a count,
   * and this is a difference. Zero carries none, because "no change" is not a
   * direction. There is no colour on any of the three, since an increase in
   * failed sign ins is not good and this component does not know which number it
   * is holding.
   */
  it.each<[number, string]>([
    [12, '+12'],
    [-3, '−3'],
    [0, '0'],
  ])('signs a delta of %s as %s', async (value, expected) => {
    const fixture = await render({
      value: 100,
      delta: { value, caption: 'in the last 7 days' },
    });

    expect(text(fixture, '.amount')).toBe(expected);
    expect(text(fixture, '.caption')).toBe('in the last 7 days');
  });

  it('draws a sparkline only when it is given a trend', async () => {
    const without = await render({ value: 5 });
    expect(one(without, '.spark')).toBeNull();

    const with_ = await render({ value: 5, trend: [1, 4, 2, 9, 5] });
    const path = one(with_, '.spark path');
    expect(path?.getAttribute('d')).toMatch(/^M[\d.,]+L/);
  });

  /**
   * Without a link the tile is a `div` and nothing about it suggests it opens.
   * The chevron is the visible half of the same promise, so the two appear and
   * disappear together.
   */
  it('is an anchor with a chevron only when it is given a link', async () => {
    const plain = await render({ value: 5 });
    expect(one(plain, 'a')).toBeNull();
    expect(one(plain, '.chevron')).toBeNull();
    expect(one(plain, 'div.tile')).not.toBeNull();

    const linked = await render({ value: 5, link: ['/harvest', 'entries'] });
    expect(one(linked, 'a.tile')?.getAttribute('href')).toBe(
      '/harvest/entries'
    );
    expect(one(linked, '.chevron')).not.toBeNull();
  });

  it('wears the attention wash only when it is asked to', async () => {
    const quiet = await render({ value: 0 });
    expect(one(quiet, '.tile')?.classList.contains('attention')).toBe(false);

    const loud = await render({ value: 3, tone: 'attention' });
    expect(one(loud, '.tile')?.classList.contains('attention')).toBe(true);
  });
});
