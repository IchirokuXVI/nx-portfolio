import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_STANDALONE_ORIGIN } from '@portfolio/velista/models';
import {
  InstallStore,
  provideFakeBrowserFacade,
  provideVelistaTesting,
  type InstallGuide,
  type InstallState,
} from '@portfolio/velista/platform';
import { InstallPage } from './install-page';

interface Options {
  /** `''` is velista's own origin; `/velista` is the portfolio's mounted copy. */
  readonly basePath?: string;
  readonly install?: InstallState;
  readonly guide?: InstallGuide;
  readonly standaloneOrigin?: string;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<InstallPage>;
  state: ReturnType<typeof signal<InstallState>>;
  prompt: jest.Mock;
  router: { navigateByUrl: jest.Mock };
  opened: string[];
}> {
  TestBed.resetTestingModule();

  const state = signal<InstallState>(options.install ?? 'manual');
  const prompt = jest.fn().mockResolvedValue('accepted');
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
  const opened: string[] = [];

  await TestBed.configureTestingModule({
    imports: [InstallPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '' }),
      provideFakeBrowserFacade(undefined, {
        openExternal: (url: string) => void opened.push(url),
      }),
      {
        provide: APP_STANDALONE_ORIGIN,
        useValue: options.standaloneOrigin ?? 'https://velista.app',
      },
      {
        provide: InstallStore,
        useValue: {
          prompt,
          state,
          guide: signal<InstallGuide>(options.guide ?? 'android-menu'),
          canPrompt: signal(false),
        },
      },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(InstallPage);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, state, prompt, router, opened };
}

function query(fixture: ComponentFixture<InstallPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function text(fixture: ComponentFixture<InstallPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('InstallPage', () => {
  /**
   * D3 and D4, which are the two decisions the whole screen is built on: the steps are
   * the floor, the button is the improvement, and the slot is occupied from the first
   * frame so nothing moves under a reader.
   */
  describe('the primary slot', () => {
    it('holds the steps before the browser has said anything', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'lib-install-steps')).not.toBeNull();
      expect(query(fixture, '.primary')).toBeNull();
    });

    it('never waits for an answer that may never come', async () => {
      // Acceptance criterion 1, and D4: no spinner, no skeleton, no `aria-busy`.
      // There is nothing loading on this page, and it makes no request at all.
      const { fixture } = await render();

      expect(query(fixture, 'lib-spinner-icon')).toBeNull();
      expect(query(fixture, '[aria-busy]')).toBeNull();
    });

    it('puts the button above the steps and folds them when a prompt arrives', async () => {
      const { fixture, state } = await render();

      state.set('ready');
      fixture.detectChanges();

      expect(query(fixture, 'lib-install-panel .primary')).not.toBeNull();
      // Folded, not removed and not moved to a second screen (D3).
      expect(query(fixture, 'lib-install-steps')).toBeNull();
      expect(query(fixture, '.reveal')).not.toBeNull();
    });

    it('unfolds the same steps on the same page, as a disclosure', async () => {
      const { fixture } = await render({ install: 'ready' });

      const reveal = query(fixture, '.reveal') as HTMLButtonElement;
      expect(reveal.getAttribute('aria-expanded')).toBe('false');

      reveal.click();
      fixture.detectChanges();

      expect(reveal.getAttribute('aria-expanded')).toBe('true');
      expect(query(fixture, 'lib-install-steps')).not.toBeNull();
    });

    it('asks the browser when the button is pressed', async () => {
      const { fixture, prompt } = await render({ install: 'ready' });

      (query(fixture, 'lib-install-panel .primary') as HTMLElement).click();
      await fixture.whenStable();

      expect(prompt).toHaveBeenCalled();
    });
  });

  /** Rule I4: no state of this page is a dead end. */
  describe('when it is already installed', () => {
    it('confirms, and still offers the steps', async () => {
      const { fixture } = await render({ install: 'installed' });

      expect(text(fixture)).toContain('install.installed.title');
      expect(query(fixture, '.reveal')?.textContent).toContain(
        'install.installed.reveal'
      );

      (query(fixture, '.reveal') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(query(fixture, 'lib-install-steps')).not.toBeNull();
    });

    it('offers a way onward rather than leaving the reader here', async () => {
      const { fixture, router } = await render({ install: 'installed' });

      (query(fixture, '.secondary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en');
    });
  });

  /** D5. Mounted under the portfolio's shell, installing would install the portfolio. */
  describe('under the shell', () => {
    it('points at the app’s own origin and offers no install at all', async () => {
      const { fixture, prompt } = await render({ basePath: '/velista' });

      expect(text(fixture)).toContain('install.elsewhere.title');
      expect(query(fixture, 'lib-install-panel')).toBeNull();
      expect(query(fixture, 'lib-install-steps')).toBeNull();
      expect(prompt).not.toHaveBeenCalled();
    });

    it('opens that origin, and says it without its scheme', async () => {
      const { fixture, opened } = await render({ basePath: '/velista' });

      // The scheme comes off for the copy, which is how a person says an address out
      // loud, and stays on for what is actually opened. Asserted on the component
      // rather than the rendered text because the testing translator returns keys
      // without interpolating them.
      expect(fixture.componentInstance.originLabel()).toBe('velista.app');

      (query(fixture, '.primary') as HTMLButtonElement).click();

      expect(opened).toEqual(['https://velista.app']);
    });

    it('offers no action when no origin was configured', async () => {
      // The token's default is the empty string, meaning unknown.
      const { fixture, opened } = await render({
        basePath: '/velista',
        standaloneOrigin: '',
      });

      expect(query(fixture, '.primary')).toBeNull();
      expect(opened).toEqual([]);
    });
  });

  /**
   * Section 7. One polite region, present from the first frame, because a region
   * created at the moment its text appears is often not announced at all.
   */
  describe('announcing the improvement', () => {
    it('has the region before it has anything to say', async () => {
      const { fixture } = await render();

      const live = query(fixture, '.live');
      expect(live?.getAttribute('aria-live')).toBe('polite');
      expect(live?.textContent?.trim()).toBe('');
    });

    it('announces the button when it arrives', async () => {
      const { fixture, state } = await render();

      state.set('ready');
      fixture.detectChanges();

      expect(query(fixture, '.live')?.textContent).toContain(
        'install.announce.ready'
      );
    });

    it('says nothing to somebody who arrived with the prompt already in hand', async () => {
      // That is not a change, it is the page they can see.
      const { fixture } = await render({ install: 'ready' });

      expect(query(fixture, '.live')?.textContent?.trim()).toBe('');
    });
  });
});
