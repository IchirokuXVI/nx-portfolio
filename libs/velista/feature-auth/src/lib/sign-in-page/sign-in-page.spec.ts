import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeAuthService,
  GatewayError,
  NetworkError,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeSessionStore,
  type FakeAuthService,
  type FakeIdentity,
} from '@portfolio/velista/data-access';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { SignInPage } from './sign-in-page';

interface Options {
  readonly auth?: FakeAuthService;
  readonly identity?: FakeIdentity;
  /** `?email=`, which the register screen's conflict message carries. */
  readonly email?: string;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService();

  await TestBed.configureTestingModule({
    imports: [SignInPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'anonymous'),
      provideAccountNotice(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: {
              get: (key: string) =>
                key === 'email' ? (options.email ?? null) : null,
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

  return { fixture, auth, router };
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

  describe('Google', () => {
    it('records rather than navigating, until the gateway redirects', async () => {
      const { fixture, router } = await render();

      (query(fixture, 'lib-google-option button') as HTMLButtonElement).click();

      expect(fixture.componentInstance.pendingRoutes()).toEqual([
        'auth.google',
      ]);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    /**
     * The acceptance criterion, and it is not defensive tidiness: until the gateway
     * passes `linkUserId`, `googleLogin` takes the create branch and mints a **fresh
     * registered user**, so a guest who tapped this would lose every group exactly as
     * rule C2 describes for register (section 5.6).
     */
    it('is not rendered at all for a guest', async () => {
      const { fixture } = await render({ identity: 'TEMPORARY' });

      expect(query(fixture, 'lib-google-option')).toBeNull();
    });

    it('is rendered for somebody with no account, who is who it is for', async () => {
      const { fixture } = await render({ identity: 'anonymous' });

      expect(query(fixture, 'lib-google-option')).not.toBeNull();
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
});
