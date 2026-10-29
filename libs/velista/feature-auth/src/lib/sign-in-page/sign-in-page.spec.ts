import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeAuthService,
  fakeOperatorSettingsStore,
  GatewayError,
  GoogleSignIn,
  MEMORY_OPERATOR_SETTINGS,
  NetworkError,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeOperatorSettingsStore,
  provideFakeSessionStore,
  type FakeAuthService,
  type FakeIdentity,
} from '@portfolio/velista/data-access';
import {
  APP_RUNTIME,
  provideVelistaTesting,
  type AppRuntime,
} from '@portfolio/velista/platform';
import { LegalLinks } from '@portfolio/velista/ui';
import { SignInPage } from './sign-in-page';

interface Options {
  readonly auth?: FakeAuthService;
  readonly identity?: FakeIdentity;
  /** `?email=`, which the register screen's conflict message carries. */
  readonly email?: string;
  /** `?returnUrl=`, which the share link page and the basket page carry. */
  readonly returnUrl?: string;
  readonly google?: { readonly start: jest.Mock };
  readonly runtime?: AppRuntime;
  /** False for a deployment that published no terms (velista 0173). */
  readonly published?: boolean;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService();
  const google = options.google ?? {
    start: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [SignInPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'anonymous'),
      provideAccountNotice(),
      { provide: GoogleSignIn, useValue: google },
      { provide: APP_RUNTIME, useValue: options.runtime ?? 'web' },
      provideFakeOperatorSettingsStore(
        fakeOperatorSettingsStore(
          options.published === false
            ? { ...MEMORY_OPERATOR_SETTINGS, published: false }
            : MEMORY_OPERATOR_SETTINGS
        )
      ),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: {
              get: (key: string) =>
                key === 'email'
                  ? (options.email ?? null)
                  : key === 'returnUrl'
                    ? (options.returnUrl ?? null)
                    : null,
            },
          },
        },
      },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

  const fixture = TestBed.createComponent(SignInPage);
  fixture.detectChanges();

  return { fixture, auth, router, google };
}

function fill(
  fixture: ComponentFixture<SignInPage>,
  email: string,
  password: string
): void {
  fixture.componentInstance.email.set(email);
  fixture.componentInstance.password.set(password);
  fixture.detectChanges();
}

function submit(fixture: ComponentFixture<SignInPage>): void {
  (fixture.nativeElement as HTMLElement)
    .querySelector('form')
    ?.dispatchEvent(new Event('submit'));
}

function query(fixture: ComponentFixture<SignInPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe('SignInPage', () => {
  describe('the form', () => {
    it('keeps the primary disabled until both fields have something in them', async () => {
      const { fixture } = await render();

      const primary = query(fixture, 'button.primary') as HTMLButtonElement;
      expect(primary.disabled).toBe(true);

      fill(fixture, 'marta@example.com', '');
      expect(
        (query(fixture, 'button.primary') as HTMLButtonElement).disabled
      ).toBe(true);

      fill(fixture, 'marta@example.com', 'password123');
      expect(
        (query(fixture, 'button.primary') as HTMLButtonElement).disabled
      ).toBe(false);
    });

    it('signs in and goes to the dashboard', async () => {
      const { fixture, auth, router } = await render();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([
        { method: 'login', email: 'marta@example.com' },
      ]);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('lands back on the page that sent them, such as a share link', async () => {
      // F6.6: signing in from a share link used to drop the link and land on
      // the dashboard (velista 0154, target 5).
      const { fixture, router } = await render({ returnUrl: '/en/s/abc' });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/s/abc');
    });

    it('goes home when the page to return to is not inside the app', async () => {
      const { fixture, router } = await render({
        returnUrl: 'https://evil.example/en/home',
      });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('carries the page to return to on to register', async () => {
      const { fixture, router } = await render({ returnUrl: '/en/s/abc' });
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      fixture.componentInstance.createAccount();

      expect(navigate).toHaveBeenCalledWith(['/en/auth/register'], {
        queryParams: { returnUrl: '/en/s/abc' },
      });
    });

    it('submits from the form, so the phone keyboard Go key works', async () => {
      // The button is `type="submit"` inside a real `<form>`, which is the whole
      // mechanism (section 7). A click and a Go key are the same event by the time
      // they reach here.
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123');
      (query(fixture, 'button.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(auth.calls).toHaveLength(1);
    });

    it('trims the address before sending it', async () => {
      const { fixture, auth } = await render();

      fill(fixture, '  marta@example.com  ', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls[0]).toEqual({
        method: 'login',
        email: 'marta@example.com',
      });
    });

    it('prefills the address the register screen handed over', async () => {
      // Being told an address is taken and then having to type it again is the moment
      // a person gives up (section 5.5).
      const { fixture } = await render({ email: 'marta@example.com' });

      expect(fixture.componentInstance.email()).toBe('marta@example.com');
    });
  });

  describe('when the pair is rejected', () => {
    const unauthorized = new GatewayError({
      code: 'unauthorized',
      status: 401,
      correlationId: 'c1',
    });

    /**
     * Section 5.4. `login()` throws the same `UnauthorizedException` whether the email
     * is unknown or the password is wrong, with a comment saying this is so the
     * response does not reveal which addresses are registered.
     */
    it('shows exactly one message, and never claims the email is unknown', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { login: unauthorized } }),
      });

      fill(fixture, 'marta@example.com', 'wrong');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      const errors = (fixture.nativeElement as HTMLElement).querySelectorAll(
        'lib-form-error'
      );
      expect(errors).toHaveLength(1);
      expect(fixture.componentInstance.error()).toEqual({
        key: 'auth.error.badCredentials',
        placement: 'pair',
      });
    });

    it('describes both fields by that one message', async () => {
      // Under the **pair**, never under one of them, and associated rather than merely
      // nearby: `role="alert"` announces it once, and `aria-describedby` is what lets
      // somebody who tabs back to a field hear it again.
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { login: unauthorized } }),
      });

      fill(fixture, 'marta@example.com', 'wrong');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      const email = query(fixture, 'input[type="email"]');
      const password = query(fixture, 'input[type="password"]');

      expect(email?.getAttribute('aria-describedby')).toBe('sign-in-error');
      expect(password?.getAttribute('aria-describedby')).toBe('sign-in-error');
      expect(query(fixture, '[role="alert"]')?.id).toBe('sign-in-error');
    });

    it('puts focus back on the first field, not on the button', async () => {
      // The fix begins where the correction is made (section 7).
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { login: unauthorized } }),
      });

      fill(fixture, 'marta@example.com', 'wrong');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(document.activeElement).toBe(
        query(fixture, 'input[type="email"]')
      );
    });

    it('lets the person try again', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { login: unauthorized } }),
      });

      fill(fixture, 'marta@example.com', 'wrong');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (query(fixture, 'button.primary') as HTMLButtonElement).disabled
      ).toBe(false);
    });

    it('says something that does not guess when the request never arrived', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({
          rejectWith: { login: new NetworkError('c1', 'auth.login') },
        }),
      });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(fixture.componentInstance.error()?.key).toBe('entry.error.failed');
    });

    it('uses the throttle copy on a 429', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({
          rejectWith: {
            login: new GatewayError({
              code: 'rate_limited',
              status: 429,
              correlationId: 'c1',
            }),
          },
        }),
      });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(fixture.componentInstance.error()?.key).toBe('auth.error.tooMany');
    });
  });

  describe('a forgotten password (velista 0148)', () => {
    it('carries the typed address to the forgot password page', async () => {
      // Somebody who just failed to sign in types nothing again.
      const { fixture, router } = await render();
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      fill(fixture, '  marta@example.com ', '');
      (query(fixture, '.quiet-row button') as HTMLButtonElement).click();

      expect(navigate).toHaveBeenCalledWith(['/en/auth/forgot-password'], {
        queryParams: { email: 'marta@example.com' },
      });
    });

    it('sends no address when none is typed', async () => {
      const { fixture, router } = await render();
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      (query(fixture, '.quiet-row button') as HTMLButtonElement).click();

      expect(navigate).toHaveBeenCalledWith(['/en/auth/forgot-password'], {});
    });
  });

  describe('Google (velista 0171)', () => {
    it('starts the sign in, which sends the document to the gateway', async () => {
      const { fixture, google, router } = await render();

      (query(fixture, 'lib-google-option button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(google.start).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('starts once however many times it is tapped while starting', async () => {
      const { fixture, google } = await render({
        google: { start: jest.fn(() => new Promise<void>(() => undefined)) },
      });
      const button = query(
        fixture,
        'lib-google-option button'
      ) as HTMLButtonElement;

      button.click();
      button.click();
      fixture.detectChanges();

      expect(google.start).toHaveBeenCalledTimes(1);
      expect(button.getAttribute('aria-busy')).toBe('true');
    });

    it('says a refused start beside the button, and leaves the fields alone', async () => {
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

      (query(fixture, 'lib-google-option button') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.googleError()?.key).toBe(
        'entry.error.failed'
      );
      expect(fixture.componentInstance.error()).toBeNull();
      expect(fixture.componentInstance.googleStarting()).toBe(false);
      const message = query(fixture, '#sign-in-google-error');
      expect(message).not.toBeNull();
      expect(
        query(fixture, 'lib-google-option button')?.getAttribute(
          'aria-describedby'
        )
      ).toBe('sign-in-google-error');
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

      expect(fixture.componentInstance.googleError()?.key).toBe(
        'support.refused'
      );
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

      expect(fixture.componentInstance.googleError()?.key).toBe(
        'entry.error.failed'
      );
    });

    /**
     * Backend 0230 links a guest in place, so the groups a guest holds stay and there is
     * no longer a reason to turn one away.
     */
    it('is offered to a guest', async () => {
      const { fixture } = await render({ identity: 'TEMPORARY' });

      expect(query(fixture, 'lib-google-option')).not.toBeNull();
    });

    it('is offered to somebody with no account', async () => {
      const { fixture } = await render({ identity: 'anonymous' });

      expect(query(fixture, 'lib-google-option')).not.toBeNull();
    });

    /** Google refuses to sign anybody in from an embedded WebView (velista 0166). */
    it('is not drawn at all in the native shell, divider included', async () => {
      const { fixture } = await render({ runtime: 'native' });

      expect(query(fixture, 'lib-google-option')).toBeNull();
      expect(query(fixture, '.divider')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('asks a password manager for the stored password, not a new one', async () => {
      const { fixture } = await render();

      expect(
        query(fixture, 'input[type="password"]')?.getAttribute('autocomplete')
      ).toBe('current-password');
    });

    it('gives the address field a real email keyboard', async () => {
      const { fixture } = await render();

      const email = query(fixture, 'input[type="email"]');
      expect(email?.getAttribute('inputmode')).toBe('email');
      expect(email?.getAttribute('autocomplete')).toBe('email');
    });

    it('names both fields with a real label', async () => {
      const { fixture } = await render();

      for (const id of ['sign-in-email', 'sign-in-password']) {
        expect(query(fixture, `label[for="${id}"]`)).not.toBeNull();
      }
    });

    it('states no password rule here, because the rule is not the users', async () => {
      // The minimum belongs on register and upgrade, where a password is being
      // chosen. On sign in it would be advice about a password that already exists.
      const { fixture } = await render();

      expect(query(fixture, '.password-rule')).toBeNull();
    });
  });

  it('links the privacy policy and the terms at its foot (velista 0172)', async () => {
    const { fixture } = await render();

    const found = fixture.debugElement.query(By.directive(LegalLinks));
    expect(found).not.toBeNull();
    const links = found.componentInstance as LegalLinks;
    expect(links.privacyUrl()).toMatch(/\/privacy$/);
    expect(links.termsUrl()).toMatch(/\/terms$/);
  });

  /**
   * Velista 0173: continuing with Google can make an account, so the line under the
   * button names the terms and the start sends their version.
   */
  describe('the terms under Google', () => {
    it('draws the line, linking the terms as a sheet over this page', async () => {
      const { fixture } = await render();
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('lib-google-option .terms-line')
      ).not.toBeNull();
      expect(fixture.componentInstance.terms.termsUrl()).toBe(
        '/en/auth/login/sheet/terms'
      );
    });

    it('sends the version with the start', async () => {
      const { fixture, google } = await render();

      await fixture.componentInstance.continueWithGoogle();

      expect(google.start).toHaveBeenCalledWith({
        acceptedTermsVersion: MEMORY_OPERATOR_SETTINGS.terms.version,
      });
    });

    it('draws no line and sends no version when no terms were published', async () => {
      const { fixture, google } = await render({ published: false });
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('lib-google-option .terms-line')).toBeNull();
      await fixture.componentInstance.continueWithGoogle();
      expect(google.start).toHaveBeenCalledWith({ acceptedTermsVersion: null });
    });
  });
});
