import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { APP_BRAND, AppBrand } from '@portfolio/velista/models';
import { AppLayout } from './app-layout';

const brand: AppBrand = {
  name: 'Test Product',
  shortName: 'Test',
  wordmarkSrc: 'mark.svg',
  iconSrc: 'icon.svg',
};

async function createFixture(
  override: Partial<AppBrand> = {}
): Promise<ComponentFixture<AppLayout>> {
  await TestBed.configureTestingModule({
    imports: [AppLayout, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      { provide: APP_BRAND, useValue: { ...brand, ...override } },
    ],
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

  it('lets the brand override the theme, so a rebrand ships its palette', async () => {
    const fixture = await createFixture({ themeClass: 'theme-day' });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.classList).toContain('app-root');
    expect(host.classList).toContain('theme-day');
    expect(host.classList).not.toContain('theme-night');
  });

  it('renders the outlet every page mounts into', async () => {
    const fixture = await createFixture();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('router-outlet')
    ).not.toBeNull();
  });
});
