import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting, TEST_BRAND } from '@portfolio/velista/platform';
import { AppBar } from './app-bar';

interface Options {
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

    it('takes its accessible name from the wordmark', async () => {
      // Not an `aria-label` of its own. The visible word is the brand, so a second
      // name on the lockup would be one nobody can ask for by what they see.
      const fixture = await render();

      const lockup = host(fixture).querySelector('.lockup');

      expect(lockup?.getAttribute('aria-label')).toBeNull();
      expect(
        lockup?.querySelector('lib-brand-wordmark')?.getAttribute('aria-label')
      ).toBe(TEST_BRAND.name);
    });

    it('is not a control', async () => {
      // The front door, where the destination would be the page already being
      // looked at.
      const fixture = await render();

      const lockup = host(fixture).querySelector('.lockup');

      expect(lockup?.tagName).toBe('DIV');
      expect(host(fixture).querySelector('a')).toBeNull();
    });
  });

  /**
   * Velista `0130`, section 3. The assistant, the account button and the offline mark
   * were this bar's signed in half. They are home's page header now, and this bar is
   * the front door's alone.
   */
  describe('what moved to the home page header', () => {
    it('draws no assistant, no account button and no offline mark', async () => {
      // R1 opens no socket at all while anonymous, so a mark here would be
      // permanently on and would mean nothing.
      const fixture = await render();

      expect(host(fixture).querySelector('.assistant')).toBeNull();
      expect(host(fixture).querySelector('.avatar')).toBeNull();
      expect(host(fixture).querySelector('.offline-mark')).toBeNull();
      // The locale control is the one button until its menu opens.
      expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
    });

    it('declares no tour anchor', async () => {
      // The `assistant` anchor is home's (velista `0099`). A second element declaring
      // it is refused by the registry, loudly, and lights nothing.
      const fixture = await render();

      expect(host(fixture).querySelector('[libTourAnchor]')).toBeNull();
    });

    it('keeps none of the inputs and outputs only that half read', async () => {
      const bar = (await render()).componentInstance;

      for (const gone of [
        'signedIn',
        'homeUrl',
        'accountInitial',
        'connected',
        'bordered',
        'openAssistant',
        'account',
      ]) {
        expect(gone in bar).toBe(false);
      }
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
  });
});
