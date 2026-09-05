import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  fakeAuthService,
  GatewayError,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeSessionStore,
  type FakeAuthService,
  type FakeIdentity,
} from '@portfolio/velista/data-access';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { RegisterPage } from './register-page';

interface Options {
  readonly auth?: FakeAuthService;
  readonly identity?: FakeIdentity;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService();

  await TestBed.configureTestingModule({
    imports: [RegisterPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'anonymous'),
      provideAccountNotice(),
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  jest.spyOn(router, 'navigate').mockResolvedValue(true);

  const fixture = TestBed.createComponent(RegisterPage);
  fixture.detectChanges();

  return { fixture, auth, router, notice: TestBed.inject(AccountNotice) };
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
  confirmPassword: string = password
): void {
  fixture.componentInstance.email.set(email);
  fixture.componentInstance.password.set(password);
  fixture.componentInstance.confirmPassword.set(confirmPassword);
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
        'input'
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

      expect(fixture.componentInstance.canSubmit()).toBe(false);
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

      expect(fixture.componentInstance.error()).toEqual({
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
      expect(fixture.componentInstance.error()).toBeNull();
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

      fill(fixture, 'marta@example.com', 'short');
      submit(fixture);
      await fixture.whenStable();

      expect(fixture.componentInstance.error()).toEqual({
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

      fill(fixture, 'not-an-address', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(fixture.componentInstance.error()).toEqual({
        key: 'auth.error.badEmail',
        placement: 'email',
      });
    });
  });

  describe('Google', () => {
    it('is not rendered at all for a guest', async () => {
      const { fixture } = await render({ identity: 'TEMPORARY' });

      expect(query(fixture, 'lib-google-option')).toBeNull();
    });

    it('records rather than navigating', async () => {
      const { fixture } = await render();

      (query(fixture, 'lib-google-option button') as HTMLButtonElement).click();

      expect(fixture.componentInstance.pendingRoutes()).toEqual([
        'auth.google',
      ]);
    });
  });
});
