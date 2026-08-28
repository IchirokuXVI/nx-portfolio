import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { type AppBrand } from '@portfolio/velista/models';
import { provideVelistaTesting, ThemeStore } from '@portfolio/velista/platform';
import { AppLayout } from './app-layout';

async function createFixture(
  override: Partial<AppBrand> = {}
): Promise<ComponentFixture<AppLayout>> {
  await TestBed.configureTestingModule({
    imports: [AppLayout, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([]), provideVelistaTesting({ brand: override })],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppLayout);
  fixture.detectChanges();
  return fixture;
}

describe('AppLayout', () => {
  // Plan 0001, the extraction contract, item 4: the app's tokens live on its own
  // root element, never on `:root`, so the shell's global styles and this app's
  // tokens cannot reach each other.
  it('carries the token scope and the default theme on one element', async () => {
    const fixture = await createFixture();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-night');
  });

  it('follows the theme store when the choice changes', async () => {
    const fixture = await createFixture();
    const host: HTMLElement = fixture.nativeElement;

    TestBed.inject(ThemeStore).setPreference('day');
    fixture.detectChanges();

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-day');
    expect(host.classList).not.toContain('theme-night');
  });

  it('lets the brand pin a theme, so a rebrand ships its palette', async () => {
    const fixture = await createFixture({ themeClass: 'theme-dusk' });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-dusk');

    // A brand that ships one palette means one palette: the preference is inert,
    // because a `theme-day` the rebrand never defined would leave the app with
    // primitives and no semantic layer.
    TestBed.inject(ThemeStore).setPreference('day');
    fixture.detectChanges();

    expect(host.classList).toContain('theme-dusk');
    expect(host.classList).not.toContain('theme-day');
  });

  it('renders the outlet every page mounts into', async () => {
    const fixture = await createFixture();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('router-outlet')
    ).not.toBeNull();
  });
});
