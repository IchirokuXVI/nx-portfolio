import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { THEME_GROUND_COLORS } from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativeSystemBars } from './native-system-bars';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

describe('NativeSystemBars', () => {
  let doubles: NativePluginDoubles;
  let bars: NativeSystemBars;

  beforeEach(() => {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    bars = TestBed.inject(NativeSystemBars);
  });

  it('draws light icons over Night and dark icons over Day', async () => {
    bars.apply('night');
    bars.apply('day');
    await Promise.resolve();
    await Promise.resolve();

    expect(doubles.styles).toEqual(['DARK', 'LIGHT']);
  });

  it('still writes the theme colour meta, as the web does', () => {
    bars.apply('day');

    expect(TestBed.inject(Meta).getTag('name="theme-color"')?.content).toBe(
      THEME_GROUND_COLORS.day
    );
  });
});
