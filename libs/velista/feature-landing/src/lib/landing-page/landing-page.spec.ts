import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  ApiUrl,
  AuthApi,
  fakeOperatorSettingsStore,
  GatewayError,
  GOOGLE_SILENT_DEADLINE_MS,
  GoogleSignIn,
  MEMORY_OPERATOR_SETTINGS,
  NetworkError,
  provideFakeOperatorSettingsStore,
  TokenStore,
  type FakeOperatorSettingsStore,
} from '@portfolio/velista/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import { APP_KEY } from '@portfolio/velista/models';
import {
  APP_RUNTIME,
  BackendReadiness,
  GOOGLE_CREDENTIAL,
  provideVelistaTesting,
  type AppRuntime,
  type GoogleCredentialI,
} from '@portfolio/velista/platform';
import { LegalLinks } from '@portfolio/velista/ui';
import { LandingPage } from './landing-page';

/**
 * A `RokuLocaleStore` that records what it was asked to switch to.
 *
 * The switch itself is the localization library's behaviour and is covered by its own
 * spec. What is asserted here is the **wiring**, because the wiring is what was
 * missing: the header's language control emitted an event nothing acted on, so
 * clicking it did nothing at all (plan 0007, section 6.2).
 */
function fakeLocaleStore(initial = 'en') {
  return {
    locale: signal(initial),
    switches: [] as readonly (readonly [string, string])[],
    async switchAppLocale(appKey: string, locale: string): Promise<void> {
      this.switches = [...this.switches, [appKey, locale] as const];
      this.locale.set(locale);
    },
  };
}

type FakeLocaleStore = ReturnType<typeof fakeLocaleStore>;

interface Options {
  readonly locale?: string;
  /** What the parent route's data carries, which is where the switcher reads it. */
  readonly supportedLocales?: readonly string[] | undefined;
  /** Whether the page is mounted under a parent route at all. */
  readonly withParent?: boolean;
  /**
   * Whether an account was just deleted, which is the one piece of news this screen
   * reports (plan 0015, section 5.7).
   */
  readonly accountDeleted?: boolean;
  /**
   * Whether the backend has answered (plan 0071, section 5.1).
   *
   * Defaults to true, so every spec that is about this screen rather than about the
   * startup gate reads as it did before: the four ways in are ordinary controls. The
   * gate's own specs pass false and assert that they are held.
   */
  readonly backendReady?: boolean;
  readonly google?: Partial<GoogleDouble>;
  /**
   * Provide the real `GoogleSignIn` over this picker instead of a double, for the one
   * question only it can answer: how long the front door is held (velista 0175).
   */
  readonly realGoogle?: { readonly credential: GoogleCredentialI };
  readonly runtime?: AppRuntime;
  /** The operator's settings (velista 0173). */
  readonly settings?: OperatorSettings;
  /** The settings store itself, for a spec that lands the answer late. */
  readonly settingsStore?: FakeOperatorSettingsStore;
}

/**
 * The parts of `GoogleSignIn` this page calls. By default no silent attempt is
 * allowed, so every spec that is not about the automatic sign in reads as before.
 */
interface GoogleDouble {
  readonly start: jest.Mock;
  readonly silentSignInAllowed: jest.Mock;
  readonly trySilent: jest.Mock;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LandingPage>;
  store: FakeLocaleStore;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
  notice: AccountNotice;
  google: GoogleDouble;
}> {
  TestBed.resetTestingModule();

  const store = fakeLocaleStore(options.locale ?? 'en');
  const parent = {
    snapshot: {
      data: { supportedLocales: options.supportedLocales ?? ['en', 'es'] },
    },
  };

  // A double rather than `provideRouter([])`, because what is being asserted is the
  // destination this page asks for, not what the router does with it. The real table
  // lives in `feature-shell`, which this library must not import, so a real router
  // here could only be given an empty table and would answer "no route matched".
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };
  const google: GoogleDouble = {
    start: jest.fn().mockResolvedValue('leaving'),
    silentSignInAllowed: jest.fn(() => false),
    trySilent: jest.fn().mockResolvedValue(false),
    ...options.google,
  };
  const googleProviders =
    options.realGoogle === undefined
      ? [{ provide: GoogleSignIn, useValue: google }]
      : [
          GoogleSignIn,
          ApiUrl,
          {
            provide: GOOGLE_CREDENTIAL,
            useValue: options.realGoogle.credential,
          },
          {
            provide: AuthApi,
            useValue: {
              mintGoogleNonce: async () => ({ nonce: 'n1', clientId: 'c1' }),
            },
          },
          { provide: TokenStore, useValue: { hasSession: () => false } },
        ];

  await TestBed.configureTestingModule({
    imports: [LandingPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      provideFakeOperatorSettingsStore(
        options.settingsStore ??
          fakeOperatorSettingsStore(
            options.settings ?? MEMORY_OPERATOR_SETTINGS
          )
      ),
      // The real `AccountNotice` rather than a double, matching `provideAccountNotice`:
      // it is one signal and two setters with no dependencies, so faking it would mean
      // writing the same object twice and would let a spec pass against behaviour the
      // app does not have.
      AccountNotice,
      { provide: RokuLocaleStore, useValue: store },
      { provide: Router, useValue: router },
      ...googleProviders,
      { provide: APP_RUNTIME, useValue: options.runtime ?? 'web' },
      {
        provide: ActivatedRoute,
        useValue: { parent: options.withParent === false ? null : parent },
      },
    ],
  }).compileComponents();

  // The startup answer, before the component is created. Held actions are the whole
  // subject of section 5.1, and `connecting` is where `BackendReadiness` starts, so a
  // spec that says nothing here would silently be testing the held screen.
  if (options.backendReady !== false) {
    TestBed.inject(BackendReadiness).reportReady();
  }

  const notice = TestBed.inject(AccountNotice);
  if (options.accountDeleted === true) {
    // Set before the component is created, which is when it reads and consumes it.
    notice.setDeleted();
  }

  const fixture = TestBed.createComponent(LandingPage);
  fixture.detectChanges();

  return { fixture, store, router, notice, google };
}

function query(fixture: ComponentFixture<LandingPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function queryAll(fixture: ComponentFixture<LandingPage>, selector: string) {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  );
}

describe('LandingPage', () => {
  describe('what the front door offers', () => {
    it('shows the hero and the illustrative list, and no dashboard chrome', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'lib-home-hero')).not.toBeNull();
      expect(query(fixture, 'lib-list-preview-card')).not.toBeNull();
      expect(query(fixture, 'lib-bottom-action-bar')).toBeNull();
    });

    it('offers exactly four ways in', async () => {
      const { fixture } = await render();

      expect(queryAll(fixture, 'lib-auth-actions button')).toHaveLength(4);
    });

    it('shows the locale switch rather than the account button', async () => {
      // Somebody who has not signed in may well be on the wrong language, and has
      // nothing else to do in the header.
      const { fixture } = await render();

      expect(query(fixture, 'lib-app-bar .locale')).not.toBeNull();
      expect(query(fixture, 'lib-app-bar .avatar')).toBeNull();
    });

    it('hides the illustrative list from assistive technology', async () => {
      // Three invented groceries read out before the two buttons that matter is
      // noise; the hero already says what the product does in words.
      const { fixture } = await render();

      expect(
        query(fixture, 'lib-list-preview-card [aria-hidden="true"]')
      ).not.toBeNull();
    });
  });

  describe('the language control', () => {
    it('labels itself with the locale actually in use', async () => {
      // It used to read `EN` on `/velista/es`, because `AppBar.locale` defaulted to
      // that string and no template ever bound it.
      const { fixture } = await render({ locale: 'es' });

      expect(query(fixture, 'lib-app-bar .locale')?.textContent).toContain(
        'ES'
      );
    });

    it('switches the app locale under this app key when one is picked', async () => {
      const { fixture, store } = await render({ locale: 'en' });

      (query(fixture, 'lib-app-bar .locale') as HTMLButtonElement).click();
      fixture.detectChanges();

      const spanish = queryAll(
        fixture,
        'lib-app-bar .menu-item'
      )[1] as HTMLButtonElement;
      spanish.click();
      fixture.detectChanges();

      expect(store.switches).toEqual([[APP_KEY, 'es']]);
    });

    it('offers the locales the parent route says are usable', async () => {
      // Read from route data rather than from `APP_USABLE_LOCALES`, which lives in
      // feature-shell: importing it back would close a cycle in the project graph.
      const { fixture } = await render({ supportedLocales: ['en'] });

      expect(fixture.componentInstance.locales).toEqual(['en']);
    });

    it('offers nothing rather than crashing when no parent carries the list', async () => {
      const { fixture } = await render({ withParent: false });

      expect(fixture.componentInstance.locales).toEqual([]);
    });
  });

  describe('the preview lines', () => {
    it('asks for a translated string per line', async () => {
      // The testing translator returns the key, so this asserts *which* keys the card
      // is fed rather than copy a translator is free to change. They render as the
      // keys themselves until rokutranslator 0004 and velista 0006 have merged, which
      // plan 0007 section 8 says is the expected result until then.
      const { fixture } = await render();

      expect(
        fixture.componentInstance.previewLines().map((line) => line.content)
      ).toEqual([
        'home.preview.line.milk.content',
        'home.preview.line.bread.content',
        'home.preview.line.tomatoes.content',
      ]);
    });

    it('re-runs on a language switch, so the card does not keep the old groceries', async () => {
      const { fixture, store } = await render({ locale: 'en' });
      const before = fixture.componentInstance.previewLines();

      store.locale.set('es');

      expect(fixture.componentInstance.previewLines()).not.toBe(before);
    });

    it('leaves the initials alone, because a letter is not translatable', async () => {
      const { fixture } = await render();

      expect(
        fixture.componentInstance.previewLines().map((line) => line.by)
      ).toEqual(['A', null, 'M']);
    });
  });

  describe('wiring', () => {
    it('sends the two built entry actions to their sheets', async () => {
      // Relative paths, so neither the locale segment nor the app's mount appears in
      // a page (extraction contract, item 5), and the same two lines are correct in
      // the standalone build.
      const { fixture, router } = await render();

      const buttons = queryAll(
        fixture,
        'lib-auth-actions button'
      ) as HTMLButtonElement[];
      buttons[0]?.click();
      buttons[1]?.click();

      expect(router.navigate.mock.calls.map(([commands]) => commands)).toEqual([
        ['sheet', 'zones', 'new'],
        ['sheet', 'zones', 'join'],
      ]);
    });

    it('sends the email action to the sign in screen', async () => {
      // Plan 0009 built it, so this is a navigation rather than a recording. Relative
      // like the two above, and a **sibling** of this page rather than a child:
      // signing in is a destination, not a sheet over the front door.
      const { fixture, router } = await render();

      const buttons = queryAll(
        fixture,
        'lib-auth-actions button'
      ) as HTMLButtonElement[];
      buttons[3]?.click();

      // The query goes with it: a refused deep link left its page there as
      // `returnUrl` (velista 0154).
      expect(router.navigate).toHaveBeenCalledWith(
        ['auth', 'login'],
        expect.objectContaining({ queryParamsHandling: 'preserve' })
      );
    });

    describe('Google (velista 0171)', () => {
      function googleButton(fixture: ComponentFixture<LandingPage>) {
        return query(
          fixture,
          'lib-auth-actions button.google'
        ) as HTMLButtonElement | null;
      }

      it('starts the sign in, which sends the document to the gateway', async () => {
        const { fixture, google, router } = await render();

        googleButton(fixture)?.click();
        await fixture.whenStable();

        expect(google.start).toHaveBeenCalledTimes(1);
        expect(router.navigate).not.toHaveBeenCalled();
      });

      it('starts once however many times it is tapped while starting', async () => {
        const { fixture, google } = await render({
          google: { start: jest.fn(() => new Promise<void>(() => undefined)) },
        });

        googleButton(fixture)?.click();
        googleButton(fixture)?.click();
        fixture.detectChanges();

        expect(google.start).toHaveBeenCalledTimes(1);
        expect(googleButton(fixture)?.getAttribute('aria-busy')).toBe('true');
      });

      it('says a refused start under the buttons', async () => {
        const { fixture } = await render({
          google: {
            start: jest.fn().mockRejectedValue(
              new GatewayError({
                code: 'not_configured',
                status: 503,
                correlationId: 'c1',
              })
            ),
          },
        });

        googleButton(fixture)?.click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.componentInstance.googleError()).toBe(
          'entry.error.failed'
        );
        expect(fixture.componentInstance.googleStarting()).toBe(false);
        expect(
          query(fixture, 'lib-auth-actions [role="status"]')
        ).not.toBeNull();
      });

      it('names a support session as the reason it was refused', async () => {
        const { fixture } = await render({
          google: {
            start: jest.fn().mockRejectedValue(
              new GatewayError({
                code: 'impersonation_not_allowed',
                status: 403,
                correlationId: 'c1',
              })
            ),
          },
        });

        await fixture.componentInstance.continueWithGoogle();

        expect(fixture.componentInstance.googleError()).toBe('support.refused');
      });

      it('answers a lost connection with the general sentence', async () => {
        const { fixture } = await render({
          google: {
            start: jest
              .fn()
              .mockRejectedValue(new NetworkError('c1', 'auth.google')),
          },
        });

        await fixture.componentInstance.continueWithGoogle();

        expect(fixture.componentInstance.googleError()).toBe(
          'entry.error.failed'
        );
      });

      /** The press asks Android's account picker there (velista 0175, target 4). */
      it('is drawn in the native shell too, divider included', async () => {
        const { fixture } = await render({ runtime: 'native' });

        expect(googleButton(fixture)).not.toBeNull();
        expect(query(fixture, 'lib-auth-actions .divider')).not.toBeNull();
        expect(queryAll(fixture, 'lib-auth-actions button')).toHaveLength(4);
      });

      it('lets go and says nothing when the system sheet is closed (velista 0175)', async () => {
        const { fixture } = await render({
          runtime: 'native',
          google: { start: jest.fn().mockResolvedValue('cancelled') },
        });

        await fixture.componentInstance.continueWithGoogle();
        fixture.detectChanges();

        expect(fixture.componentInstance.googleStarting()).toBe(false);
        expect(fixture.componentInstance.googleError()).toBeNull();
        expect(query(fixture, 'lib-auth-actions [role="status"]')).toBeNull();
      });
    });

    /**
     * Velista 0175, target 5. In the Android app, signed out, the front door tries
     * once to sign in with no tap, and holds the four ways in while it does.
     */
    describe('the automatic Google sign in', () => {
      function heldButtons(fixture: ComponentFixture<LandingPage>) {
        return (
          queryAll(fixture, 'lib-auth-actions button') as HTMLButtonElement[]
        ).filter((button) => button.getAttribute('aria-disabled') === 'true');
      }

      it('tries once, holding the ways in until it answers', async () => {
        let answer: (signedIn: boolean) => void = () => undefined;
        const { fixture, google } = await render({
          runtime: 'native',
          google: {
            silentSignInAllowed: jest.fn(() => true),
            trySilent: jest.fn(
              () => new Promise<boolean>((resolve) => (answer = resolve))
            ),
          },
        });

        expect(google.trySilent).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.signingInSilently()).toBe(true);
        expect(heldButtons(fixture)).toHaveLength(4);
        expect(
          query(fixture, 'lib-auth-actions button.google')?.getAttribute(
            'aria-busy'
          )
        ).toBe('true');

        answer(false);
        await fixture.whenStable();
        fixture.detectChanges();

        // No sentence about it: the front door is simply as it was.
        expect(fixture.componentInstance.signingInSilently()).toBe(false);
        expect(heldButtons(fixture)).toHaveLength(0);
        expect(query(fixture, 'lib-auth-actions [role="status"]')).toBeNull();
      });

      it('stays busy on success, because GoogleSignIn is taking the app home', async () => {
        const { fixture } = await render({
          runtime: 'native',
          google: {
            silentSignInAllowed: jest.fn(() => true),
            trySilent: jest.fn().mockResolvedValue(true),
          },
        });
        await fixture.whenStable();

        expect(fixture.componentInstance.signingInSilently()).toBe(true);
      });

      it('asks once however often the settings arrive', async () => {
        const settingsStore = fakeOperatorSettingsStore(null);
        const { fixture, google } = await render({
          runtime: 'native',
          settingsStore,
          google: { silentSignInAllowed: jest.fn(() => true) },
        });

        // Nothing before the settings: the feature switch is in them.
        expect(google.trySilent).not.toHaveBeenCalled();

        settingsStore.land(MEMORY_OPERATOR_SETTINGS);
        fixture.detectChanges();
        await fixture.whenStable();
        settingsStore.land({ ...MEMORY_OPERATOR_SETTINGS });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(google.trySilent).toHaveBeenCalledTimes(1);
      });

      it('does not try when a sign out switched it off, or on the web', async () => {
        // `silentSignInAllowed` is false for both: no picker on the web, and the flag
        // in storage after a sign out (asserted in `google-sign-in.spec.ts`).
        const { fixture, google } = await render({
          runtime: 'native',
          google: { silentSignInAllowed: jest.fn(() => false) },
        });

        expect(google.trySilent).not.toHaveBeenCalled();
        expect(heldButtons(fixture)).toHaveLength(0);
      });

      it('does not try where the deployment has no Google client', async () => {
        const { google } = await render({
          runtime: 'native',
          settings: {
            ...MEMORY_OPERATOR_SETTINGS,
            features: {
              ...MEMORY_OPERATOR_SETTINGS.features,
              googleSignIn: false,
            },
          },
          google: { silentSignInAllowed: jest.fn(() => true) },
        });

        expect(google.trySilent).not.toHaveBeenCalled();
      });

      describe('with a picker that never answers', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('gives up after four seconds and lets the front door go', async () => {
          const credential: GoogleCredentialI = {
            getIdToken: () => new Promise<string | null>(() => undefined),
            forget: async () => undefined,
          };
          const { fixture } = await render({
            runtime: 'native',
            realGoogle: { credential },
          });

          await jest.advanceTimersByTimeAsync(GOOGLE_SILENT_DEADLINE_MS - 1);
          fixture.detectChanges();
          expect(fixture.componentInstance.signingInSilently()).toBe(true);
          expect(heldButtons(fixture)).toHaveLength(4);

          await jest.advanceTimersByTimeAsync(1);
          fixture.detectChanges();
          expect(fixture.componentInstance.signingInSilently()).toBe(false);
          expect(heldButtons(fixture)).toHaveLength(0);
        });
      });
    });

    /**
     * Plan 0071, section 5.1. This is the one screen that draws before the app knows
     * whether it can reach the backend, so it is the one place a control could act on
     * a backend nobody has heard from, and the first of these four creates a group.
     */
    describe('while the backend has not answered', () => {
      it('holds the four ways in without disabling them', async () => {
        const { fixture, router, google } = await render({
          backendReady: false,
        });

        const buttons = queryAll(
          fixture,
          'lib-auth-actions button'
        ) as HTMLButtonElement[];

        for (const button of buttons) {
          expect(button.getAttribute('aria-disabled')).toBe('true');
          // Held, not disabled: a disabled button swallows its own click, so the
          // sentence explaining why could never be triggered by the press (D5).
          expect(button.disabled).toBe(false);
          button.click();
        }

        expect(router.navigate).not.toHaveBeenCalled();
        expect(google.start).not.toHaveBeenCalled();
      });

      // `!== 'ready'`, so an answered probe that could not reach the backend holds
      // them too: the actions cannot work either way.
      it('keeps holding them when the backend turns out to be unreachable', async () => {
        const { fixture } = await render({ backendReady: false });

        TestBed.inject(BackendReadiness).reportUnreachable();
        fixture.detectChanges();

        expect(fixture.componentInstance.actionsHeld()).toBe(true);
      });

      it('lets go as soon as the backend answers', async () => {
        const { fixture, router } = await render({ backendReady: false });

        TestBed.inject(BackendReadiness).reportReady();
        fixture.detectChanges();

        const create = queryAll(
          fixture,
          'lib-auth-actions button'
        )[0] as HTMLButtonElement;

        expect(create.hasAttribute('aria-disabled')).toBe(false);
        create.click();

        expect(router.navigate).toHaveBeenCalled();
      });
    });

    it('has an outlet for the sheet to render into', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'router-outlet')).not.toBeNull();
    });
  });

  /**
   * Plan 0015, section 5.7. After a delete there is no session, so the dashboard cannot
   * report it and the front door is where the person lands.
   */
  describe('after an account is deleted', () => {
    it('says once that the account is gone', async () => {
      const { fixture } = await render({ accountDeleted: true });

      expect(query(fixture, '.notice')).not.toBeNull();
    });

    it('says nothing on an ordinary visit', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.notice')).toBeNull();
    });

    it('consumes the notice, so a revisit does not repeat it', async () => {
      // The reason it is a one-shot store rather than router state: state survives a
      // reload through the history entry, and coming back to this URL tomorrow is not
      // the moment to be told an account was deleted.
      const { notice } = await render({ accountDeleted: true });

      expect(notice.notice()).toBeNull();
    });
  });

  it('links the privacy policy and the terms at its foot (velista 0172)', async () => {
    const { fixture } = await render();

    const found = fixture.debugElement.query(By.directive(LegalLinks));
    expect(found).not.toBeNull();
    const links = found.componentInstance as LegalLinks;
    expect(links.privacyUrl()).toBe('/en/privacy');
    expect(links.termsUrl()).toBe('/en/terms');
  });

  /** Velista 0173: Google where the deployment has it, with the line and the version. */
  describe('the terms under Google', () => {
    it('sends the version of the terms with the start', async () => {
      const { fixture, google } = await render();

      await fixture.componentInstance.continueWithGoogle();

      expect(google.start).toHaveBeenCalledWith({
        acceptedTermsVersion: MEMORY_OPERATOR_SETTINGS.terms.version,
      });
    });

    it('draws the line under the button, linking the terms page', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'lib-auth-actions .terms-line')).not.toBeNull();
      expect(fixture.componentInstance.termsUrl()).toBe('/en/terms');
    });

    it('does not offer Google where the deployment has no Google client', async () => {
      const { fixture } = await render({
        settings: {
          ...MEMORY_OPERATOR_SETTINGS,
          features: {
            ...MEMORY_OPERATOR_SETTINGS.features,
            googleSignIn: false,
          },
        },
      });

      expect(query(fixture, 'lib-auth-actions button.google')).toBeNull();
    });

    it('draws no line and sends no version when no terms were published', async () => {
      const { fixture, google } = await render({
        settings: { ...MEMORY_OPERATOR_SETTINGS, published: false },
      });

      expect(query(fixture, 'lib-auth-actions .terms-line')).toBeNull();
      await fixture.componentInstance.continueWithGoogle();
      expect(google.start).toHaveBeenCalledWith({ acceptedTermsVersion: null });
    });
  });
});
