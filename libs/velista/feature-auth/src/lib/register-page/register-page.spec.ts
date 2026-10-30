import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
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
  type FakeOperatorSettingsStore,
} from '@portfolio/velista/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import {
  APP_RUNTIME,
  provideVelistaTesting,
  type AppRuntime,
} from '@portfolio/velista/platform';
import { LegalLinks } from '@portfolio/velista/ui';
import { AccountForm } from '../account-form/account-form';
import { RegisterPage } from './register-page';

interface Options {
  readonly auth?: FakeAuthService;
  readonly identity?: FakeIdentity;
  readonly google?: { readonly start: jest.Mock };
  readonly runtime?: AppRuntime;
  /** The operator's settings; null for a store that has not answered. */
  readonly settings?: OperatorSettings | null;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService();
  const google = options.google ?? {
    start: jest.fn().mockResolvedValue(undefined),
  };
  const settings: FakeOperatorSettingsStore = fakeOperatorSettingsStore(
    options.settings === undefined ? MEMORY_OPERATOR_SETTINGS : options.settings
  );

  await TestBed.configureTestingModule({
    imports: [RegisterPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'anonymous'),
      provideAccountNotice(),
      { provide: GoogleSignIn, useValue: google },
      { provide: APP_RUNTIME, useValue: options.runtime ?? 'web' },
      provideFakeOperatorSettingsStore(settings),
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  jest.spyOn(router, 'navigate').mockResolvedValue(true);

  const fixture = TestBed.createComponent(RegisterPage);
  fixture.detectChanges();

  return {
    fixture,
    auth,
    router,
    google,
    settings,
    notice: TestBed.inject(AccountNotice),
  };
}

/** The form register shares with upgrade (velista 0173), which holds the fields. */
function form(fixture: ComponentFixture<RegisterPage>): AccountForm {
  return fixture.debugElement.query(By.directive(AccountForm))
    .componentInstance as AccountForm;
}

/**
 * Fill the form the way somebody who typed it correctly would.
 *
 * The confirmation defaults to the password, because that is the ordinary case and no
 * test about registering should have to restate it. The mismatch tests pass the two
 * separately, which is the whole of what they are about.
 */
function fill(
  fixture: ComponentFixture<RegisterPage>,
  email: string,
  password: string,
  confirmPassword: string = password,
  accepted = true
): void {
  form(fixture).email.set(email);
  form(fixture).password.set(password);
  form(fixture).confirmPassword.set(confirmPassword);
  form(fixture).accepted.set(accepted);
  fixture.detectChanges();
}

function submit(fixture: ComponentFixture<RegisterPage>): void {
  (fixture.nativeElement as HTMLElement)
    .querySelector('form')
    ?.dispatchEvent(new Event('submit'));
}

function query(fixture: ComponentFixture<RegisterPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe('RegisterPage', () => {
  describe('the form', () => {
    it('asks for three fields and only three', async () => {
      // No display name: the backend generates a username regardless of what is sent,
      // and nothing in the app renders a display name. No strength meter either,
      // because nothing the server checks is behind one. The confirmation is the one
      // check that exists nowhere else: the server sees a single string and cannot
      // know it was mistyped.
      const { fixture } = await render();

      const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll(
        'input:not([type="checkbox"])'
      );
      expect(inputs).toHaveLength(3);
      expect(query(fixture, 'input[type="email"]')).not.toBeNull();
      expect(query(fixture, '#register-password')).not.toBeNull();
      expect(query(fixture, '#register-confirm-password')).not.toBeNull();
    });

    it('states the password rule once, under the first box', async () => {
      // Repeating it under the confirmation would read as a second, different
      // requirement rather than the same one restated.
      const { fixture } = await render();

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '.password-rule'
        )
      ).toHaveLength(1);
    });

    it('will not submit until the confirmation has something in it', async () => {
      const { fixture } = await render();

      fill(fixture, 'marta@example.com', 'password123', '');

      expect(form(fixture).canSubmit()).toBe(false);
    });

    it('states the password minimum before it is broken', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.password-rule')).not.toBeNull();
    });

    it('asks a password manager to save a new password', async () => {
      const { fixture } = await render();

      expect(
        query(fixture, 'input[type="password"]')?.getAttribute('autocomplete')
      ).toBe('new-password');
    });
  });

  /**
   * Section 5.2. `register()` issues tokens as its last act and sends the confirmation
   * email outside the transaction, with a comment saying delivery failure must not roll
   * back a successful registration, because verification is optional. `login()` never
   * looks at `emailVerifiedAt` either. A blocking step here would be a barrier this
   * product does not have, and would strand everybody whenever mail delivery failed.
   */
  describe('after registering', () => {
    it('lands on the dashboard, signed in, with no wall in between', async () => {
      const { fixture, auth, router } = await render();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([
        { method: 'register', email: 'marta@example.com' },
      ]);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('leaves the address behind, so the dashboard nudge can name it', async () => {
      // The only place the app knows the address: the token pair carries none and
      // `GET /v1/account/me` is out of scope for this plan.
      const { fixture, notice } = await render();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(notice.notice()).toEqual({
        kind: 'registered',
        email: 'marta@example.com',
      });
    });
  });

  /**
   * The one check on a password anywhere in this product.
   *
   * The server sees a single string and cannot know it was mistyped, and a typo
   * produces an account whose password is not the one its owner believes they chose.
   * Signing in then fails with the deliberately incurious "that email and password do
   * not match", and the reset flow this app cannot reach yet is what would be needed
   * to recover it.
   */
  describe('when the two passwords differ', () => {
    it('never sends the request', async () => {
      const { fixture, auth, router } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([]);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('says which of the two boxes to look at', async () => {
      const { fixture } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();

      expect(form(fixture).shown()).toEqual({
        key: 'auth.error.passwordMismatch',
        placement: 'password',
      });
    });

    it('puts the cursor in the confirmation, not in the password', async () => {
      // The first box holds what is being confirmed, so sending somebody back to it
      // invites them to change the wrong one.
      const { fixture } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();

      expect(document.activeElement?.id).toBe('register-confirm-password');
    });

    it('compares exactly, since a space is a character somebody may have meant', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password123 ');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([]);
    });

    it('goes through once the two agree', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();

      fill(fixture, 'marta@example.com', 'password123', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([
        { method: 'register', email: 'marta@example.com' },
      ]);
      expect(form(fixture).shown()).toBeNull();
    });
  });

  describe('when the address is already taken', () => {
    const conflict = new GatewayError({
      code: 'conflict',
      status: 409,
      correlationId: 'c1',
    });

    async function rejected() {
      return render({
        auth: fakeAuthService({ rejectWith: { register: conflict } }),
      });
    }

    it('offers a route rather than only a refusal', async () => {
      const { fixture } = await rejected();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.error()).toEqual({
        key: 'auth.error.emailTaken',
        placement: 'email',
        action: 'signIn',
      });
      expect(query(fixture, 'lib-form-error button')).not.toBeNull();
    });

    it('carries the typed address to the sign in screen', async () => {
      // The whole point of the offer: being told an address is taken and then having
      // to type it again is the moment a person gives up (section 5.5).
      const { fixture, router } = await rejected();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      (query(fixture, 'lib-form-error button') as HTMLButtonElement).click();

      expect(router.navigate).toHaveBeenCalledWith(['/en/auth/login'], {
        queryParams: { email: 'marta@example.com' },
      });
    });

    it('places the message against the address, which is the field at fault', async () => {
      const { fixture } = await rejected();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        query(fixture, 'input[type="email"]')?.getAttribute('aria-describedby')
      ).toBe('register-error');
      // Not the password: nothing is wrong with it, and marking it would send the
      // person to fix the one thing they do not need to change.
      expect(
        query(fixture, 'input[type="password"]')?.getAttribute(
          'aria-describedby'
        )
      ).toBeNull();
    });
  });

  /**
   * Velista `0160`, items 3 and 4: an address or a password the server would refuse is
   * answered on screen, in the app's words, and the request is spared. The button stays
   * enabled, which is plan 0009 section 5.5.
   */
  describe('before the request', () => {
    it('lets the app say it, not the browser', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'form')?.hasAttribute('novalidate')).toBe(true);
    });

    it('draws the app sentence for an address with no @, and sends nothing', async () => {
      const { fixture, auth, router } = await render();

      fill(fixture, 'ana-sin-arroba', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(form(fixture).shown()).toEqual({
        key: 'auth.error.badEmail',
        placement: 'email',
      });
      expect(query(fixture, 'lib-form-error')?.textContent).toContain(
        'auth.error.badEmail'
      );
      expect(
        query(fixture, 'input[type="email"]')?.getAttribute('aria-invalid')
      ).toBe('true');
      expect(document.activeElement?.id).toBe('register-email');
      expect(auth.calls).toEqual([]);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('draws the short password sentence for seven characters, and sends nothing', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'abcdefg');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(form(fixture).shown()).toEqual({
        key: 'auth.error.shortPassword',
        placement: 'password',
      });
      expect(
        query(fixture, '#register-password')?.getAttribute('aria-invalid')
      ).toBe('true');
      expect(document.activeElement?.id).toBe('register-password');
      expect(auth.calls).toEqual([]);
      // The rule is not a condition on the button (plan 0009, section 5.5).
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it('lets eight characters through', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'abcdefgh');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([
        { method: 'register', email: 'marta@example.com' },
      ]);
    });

    it('leaves the first password box alone on a mismatch', async () => {
      // Its contents are the ones being confirmed, so it is not the box at fault.
      const { fixture } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        query(fixture, '#register-password')?.getAttribute('aria-invalid')
      ).toBe('false');
      expect(
        query(fixture, '#register-confirm-password')?.getAttribute(
          'aria-invalid'
        )
      ).toBe('true');
    });
  });

  describe('a 400 from the DTO', () => {
    it('puts a short password against the password field', async () => {
      // The one case where a message is not shared between the fields (section 5.5).
      // The problem document's `errors` is read for its keys, never its strings.
      const { fixture } = await render({
        auth: fakeAuthService({
          rejectWith: {
            register: new GatewayError({
              code: 'validation_failed',
              status: 400,
              correlationId: 'c1',
              fieldErrors: { password: ['too short'] },
            }),
          },
        }),
      });

      // Long enough for the client, refused by the server all the same: the server
      // stays the authority.
      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(form(fixture).shown()).toEqual({
        key: 'auth.error.shortPassword',
        placement: 'password',
      });
    });

    it('puts a bad address against the address field', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({
          rejectWith: {
            register: new GatewayError({
              code: 'validation_failed',
              status: 400,
              correlationId: 'c1',
              fieldErrors: { email: ['must be an email'] },
            }),
          },
        }),
      });

      fill(fixture, 'marta@example.c', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(form(fixture).shown()).toEqual({
        key: 'auth.error.badEmail',
        placement: 'email',
      });
    });
  });

  describe('Google (velista 0171)', () => {
    it('starts the sign in, which sends the document to the gateway', async () => {
      const { fixture, google, router } = await render();

      (query(fixture, 'lib-google-option button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(google.start).toHaveBeenCalledTimes(1);
      // The line under the button names the terms, so their version goes with it
      // (velista 0173).
      expect(google.start).toHaveBeenCalledWith({
        acceptedTermsVersion: MEMORY_OPERATOR_SETTINGS.terms.version,
      });
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
      expect(form(fixture).shown()).toBeNull();
      expect(fixture.componentInstance.googleStarting()).toBe(false);
      const message = query(fixture, '#register-google-error');
      expect(message).not.toBeNull();
      expect(
        query(fixture, 'lib-google-option button')?.getAttribute(
          'aria-describedby'
        )
      ).toBe('register-google-error');
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

    /** The press asks Android's account picker there (velista 0177, target 4). */
    it('is drawn in the native shell too', async () => {
      const { fixture } = await render({ runtime: 'native' });

      expect(query(fixture, 'lib-google-option')).not.toBeNull();
    });

    it('lets go and says nothing when the system sheet is closed (velista 0177)', async () => {
      const { fixture } = await render({
        runtime: 'native',
        google: { start: jest.fn().mockResolvedValue('cancelled') },
      });

      await fixture.componentInstance.continueWithGoogle();

      expect(fixture.componentInstance.googleStarting()).toBe(false);
      expect(fixture.componentInstance.googleError()).toBeNull();
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

  /** Velista 0173: the terms, accepted with a box, and their version sent. */
  describe('the terms', () => {
    const version = MEMORY_OPERATOR_SETTINGS.terms.version;

    it('sends the version of the terms the box was ticked for', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.termsVersions).toEqual([version]);
    });

    it('answers a press with the box clear under the box, and sends nothing', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password123', false);
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.calls).toEqual([]);
      const box = query(fixture, '#register-terms');
      expect(box?.getAttribute('aria-invalid')).toBe('true');
      expect(box?.getAttribute('aria-describedby')).toBe(
        'register-terms-error'
      );
      expect(query(fixture, '#register-terms-error')?.textContent).toContain(
        'legal.accept.unticked'
      );
      expect(document.activeElement?.id).toBe('register-terms');
      // Not a condition on the button (plan 0009 section 5.5, plan 0160).
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it('reads the settings again on a stale version, and clears the box', async () => {
      const stale = new GatewayError({
        code: 'terms_version_stale',
        status: 409,
        correlationId: 'c1',
        details: { currentVersion: version + '+2026-12-01' },
      });
      const { fixture, settings } = await render({
        auth: fakeAuthService({ rejectWith: { register: stale } }),
      });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(settings.reloads()).toBe(1);
      expect(form(fixture).accepted()).toBe(false);
      expect(query(fixture, '#register-terms-error')?.textContent).toContain(
        'legal.accept.stale'
      );
    });

    it('links the privacy policy under the box, outside its label', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.privacy-line')).not.toBeNull();
      expect(query(fixture, 'label .privacy-line')).toBeNull();
      expect(form(fixture).privacyUrl()).toBe(
        '/en/auth/register/sheet/privacy'
      );
      expect(form(fixture).termsUrl()).toBe('/en/auth/register/sheet/terms');
    });

    it('draws no box and sends no version when the operator published nothing', async () => {
      const { fixture, auth, google } = await render({
        settings: { ...MEMORY_OPERATOR_SETTINGS, published: false },
      });

      expect(query(fixture, '#register-terms')).toBeNull();
      expect(query(fixture, '.terms-line')).toBeNull();

      fill(fixture, 'marta@example.com', 'password123', 'password123', false);
      submit(fixture);
      await fixture.whenStable();
      await fixture.componentInstance.continueWithGoogle();

      expect(auth.termsVersions).toEqual([null]);
      expect(google.start).toHaveBeenCalledWith({ acceptedTermsVersion: null });
    });

    it('offers Google only where the deployment has it', async () => {
      const { fixture } = await render({
        settings: {
          ...MEMORY_OPERATOR_SETTINGS,
          features: {
            ...MEMORY_OPERATOR_SETTINGS.features,
            googleSignIn: false,
          },
        },
      });

      expect(query(fixture, 'lib-google-option')).toBeNull();
    });

    it('shows a stale version at the Google start beside the button, with the terms', async () => {
      const { fixture, settings } = await render({
        google: {
          start: jest.fn().mockRejectedValue(
            new GatewayError({
              code: 'terms_version_stale',
              status: 409,
              correlationId: 'c1',
              details: { currentVersion: 'next' },
            })
          ),
        },
      });

      await fixture.componentInstance.continueWithGoogle();
      fixture.detectChanges();

      expect(fixture.componentInstance.googleError()).toEqual({
        key: 'legal.accept.stale',
        placement: 'terms',
        link: 'terms',
      });
      expect(settings.reloads()).toBe(1);
      expect(query(fixture, '#register-google-error')).not.toBeNull();
    });
  });
});
