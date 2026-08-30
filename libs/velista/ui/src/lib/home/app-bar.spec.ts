import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { AppBar } from './app-bar';

interface Options {
  readonly signedIn?: boolean;
  readonly locale?: string;
  readonly locales?: readonly string[];
}

async function render(
  options: Options = {}
): Promise<ComponentFixture<AppBar>> {
  await TestBed.configureTestingModule({
    imports: [AppBar, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppBar);
  fixture.componentRef.setInput('signedIn', options.signedIn ?? false);
  fixture.componentRef.setInput('locale', options.locale ?? 'EN');
  fixture.componentRef.setInput('locales', options.locales ?? ['en', 'es']);
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<AppBar>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function trigger(fixture: ComponentFixture<AppBar>): HTMLButtonElement {
  const button = host(fixture).querySelector<HTMLButtonElement>('.locale');
  if (button === null) {
    throw new Error('the locale control is not rendered');
  }
  return button;
}

function entries(fixture: ComponentFixture<AppBar>): HTMLButtonElement[] {
  return Array.from(host(fixture).querySelectorAll('.menu-item'));
}

function openMenu(fixture: ComponentFixture<AppBar>): void {
  trigger(fixture).click();
  fixture.detectChanges();
}

describe('AppBar', () => {
  describe('the lockup', () => {
    it('renders exactly one brand mark', async () => {
      // The header used to place a `lib-brand-mark` next to the wordmark, and the
      // wordmark draws its own, so the sailboat appeared twice and the identity
      // carried two accessible names (plan 0007, section 6.1). Asserted rather than
      // fixed and forgotten, because the duplicate is invisible in a diff.
      const fixture = await render();

      expect(host(fixture).querySelectorAll('lib-brand-mark')).toHaveLength(1);
    });
  });

  describe('the second button', () => {
    it('opens the assistant, and no longer offers search', async () => {
      // Plan 0032, section 1. `openSearch` called `_notYetRouted('search')` on every
      // page that bound it and there was never a search page behind it, so the slot is
      // spent rather than a feature removed. The assertion is on the **output**, not
      // on the glyph: the icon may be reconsidered and the contract may not.
      const fixture = await render({ signedIn: true });
      const opened: number[] = [];
      fixture.componentInstance.openAssistant.subscribe(() =>
        opened.push(opened.length)
      );

      const button =
        host(fixture).querySelector<HTMLButtonElement>('.assistant');
      button?.click();

      expect(button).not.toBeNull();
      expect(opened).toHaveLength(1);
      expect('openSearch' in fixture.componentInstance).toBe(false);
    });

    it('keeps both header buttons at the minimum touch target', async () => {
      // The slot did not change shape, which is half of why spending it is cheap.
      const fixture = await render({ signedIn: true });

      expect(host(fixture).querySelectorAll('.icon-button')).toHaveLength(2);
    });
  });

  describe('the locale menu', () => {
    it('stays out of the DOM until the control is used', async () => {
      const fixture = await render();

      expect(host(fixture).querySelector('.menu')).toBeNull();
      expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    });

    it('opens one entry per locale, marking the current one', async () => {
      const fixture = await render({ locale: 'ES', locales: ['en', 'es'] });

      openMenu(fixture);

      const options = entries(fixture);
      expect(options.map((option) => option.textContent?.trim())).toEqual([
        'EN',
        'ES',
      ]);
      // Not signalled by colour alone.
      expect(
        options.map((option) => option.getAttribute('aria-current'))
      ).toEqual([null, 'true']);
    });

    it('tracks the open state in aria-expanded', async () => {
      const fixture = await render();

      openMenu(fixture);
      expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');

      openMenu(fixture);
      expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    });

    it('emits the picked locale and closes', async () => {
      const fixture = await render({ locale: 'EN' });
      const picked: string[] = [];
      fixture.componentInstance.localeChange.subscribe((locale) =>
        picked.push(locale)
      );

      openMenu(fixture);
      entries(fixture)[1].click();
      fixture.detectChanges();

      expect(picked).toEqual(['es']);
      expect(host(fixture).querySelector('.menu')).toBeNull();
    });

    it('closes on a click outside it', async () => {
      const fixture = await render();

      openMenu(fixture);
      document.body.click();
      fixture.detectChanges();

      expect(host(fixture).querySelector('.menu')).toBeNull();
    });

    it('closes on Escape and gives focus back to the control', async () => {
      const fixture = await render();

      openMenu(fixture);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();

      expect(host(fixture).querySelector('.menu')).toBeNull();
      expect(document.activeElement).toBe(trigger(fixture));
    });

    it('offers no disclosure at all when there is one language', async () => {
      // A chevron that opens nothing is the control that lied in the first place, so
      // the degenerate case renders the label and stops there.
      const fixture = await render({ locales: [] });

      trigger(fixture).click();
      fixture.detectChanges();

      expect(host(fixture).querySelector('.menu')).toBeNull();
      expect(host(fixture).querySelector('.chevron')).toBeNull();
      expect(trigger(fixture).getAttribute('aria-haspopup')).toBeNull();
    });

    it('is not in the signed-in header at all', async () => {
      const fixture = await render({ signedIn: true });

      expect(host(fixture).querySelector('.locale')).toBeNull();
      expect(host(fixture).querySelector('.avatar')).not.toBeNull();
    });
  });
});
