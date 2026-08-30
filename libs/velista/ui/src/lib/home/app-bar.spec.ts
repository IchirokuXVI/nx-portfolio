import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { AppBar } from './app-bar';

interface Options {
  readonly signedIn?: boolean;
  readonly locale?: string;
  readonly locales?: readonly string[];
  readonly connected?: boolean;
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
  fixture.componentRef.setInput('connected', options.connected ?? true);
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

  describe('the offline mark', () => {
    it('is absent while the connection is up', async () => {
      const fixture = await render({ signedIn: true, connected: true });

      expect(host(fixture).querySelector('.offline-mark')).toBeNull();
    });

    it('is drawn, and named, when the connection is down', async () => {
      // Plan 0035, section 5.3. Until this, a dead socket had one symptom in the whole
      // app and it was on one screen, so somebody on the dashboard had no way to know
      // that nothing in front of them would ever change again.
      const fixture = await render({ signedIn: true, connected: false });

      const mark = host(fixture).querySelector('.offline-mark');
      expect(mark).not.toBeNull();
      expect(mark?.getAttribute('aria-label')).toBe('connection.notLive');
    });

    it('is not a control', async () => {
      // It reports a state and there is nowhere for it to lead, and a button that
      // leads nowhere is worse than no button.
      const fixture = await render({ signedIn: true, connected: false });

      expect(host(fixture).querySelector('.offline-mark button')).toBeNull();
      expect(host(fixture).querySelectorAll('.icon-button')).toHaveLength(2);
    });

    it('stays off the anonymous header', async () => {
      // R1 opens no socket at all while anonymous, so a mark there would be
      // permanently on and would mean nothing.
      const fixture = await render({ signedIn: false, connected: false });

      expect(host(fixture).querySelector('.offline-mark')).toBeNull();
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
