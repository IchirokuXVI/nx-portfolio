import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  SESSION_SERVICE,
  SessionStorage,
  SessionStore,
  type DeploymentServiceI,
  type SessionServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  type AdminMe,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { SignInPage } from './sign-in-page';

/**
 * The login screen (plan 0002, sections 1 and 2).
 *
 * Zoneless, so the promise chain inside `submit` is drained by hand rather than
 * with `whenStable`, which hangs. The translator double returns the key, so the
 * assertions read as key names rather than as copy — and the error text is
 * asserted **by key**, never by rendered sentence, because the double does not
 * interpolate.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: 'Operations',
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

const me: AdminMe = {
  admin: {
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    lastLoginAt: null,
  },
  deployment: 'staging',
};

/** Let the promise chain inside `submit` run. `whenStable` hangs zoneless. */
const drain = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
};

function refusal(code: string, status: number, retryAfterSeconds?: number) {
  return new GatewayError({
    code,
    status,
    correlationId: 'cid',
    retryAfterSeconds,
  });
}

async function render(
  outcome: { session: AdminSession } | { error: unknown },
  deployment: DeploymentServiceI['read'] = async () => ({
    deployment: 'staging',
    devAutologin: false,
  })
) {
  const attempts: Array<{ username: string; password: string }> = [];

  const sessionService: SessionServiceI = {
    signIn: async (username, password) => {
      attempts.push({ username, password });
      if ('error' in outcome) {
        throw outcome.error;
      }
      return outcome.session;
    },
    signInForDevelopment: async () => session,
    refresh: async () => session,
    readMe: async () => me,
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SignInPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      { provide: SESSION_SERVICE, useValue: sessionService },
      { provide: DEPLOYMENT_SERVICE, useValue: { read: deployment } },
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SignInPage);
  fixture.detectChanges();

  return { fixture, attempts, sessions: TestBed.inject(SessionStore) };
}

const el = <T extends HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T | null => fixture.nativeElement.querySelector(selector);

const text = (fixture: ComponentFixture<unknown>, selector: string) =>
  el(fixture, selector)?.textContent?.trim();

function fill(fixture: ComponentFixture<SignInPage>, u: string, p: string) {
  fixture.componentInstance.username.set(u);
  fixture.componentInstance.password.set(p);
  fixture.detectChanges();
}

async function submit(fixture: ComponentFixture<SignInPage>) {
  await fixture.componentInstance.submit();
  await drain();
  fixture.detectChanges();
}

describe('SignInPage', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  describe('the form', () => {
    it('asks for a username and a password, and nothing else', async () => {
      const { fixture } = await render({ session });

      expect(el(fixture, 'input#username')).not.toBeNull();
      expect(el(fixture, 'input#password')).not.toBeNull();
      expect(fixture.nativeElement.querySelectorAll('input')).toHaveLength(2);
    });

    /**
     * Every one of these is a decision from backend plan 0071: no email column,
     * recovery by the person holding the server, accounts made by a command. A
     * screen offering a recovery flow that does not exist would be worse than
     * one offering nothing.
     */
    it('offers no recovery, no registration and no third party sign in', async () => {
      const { fixture } = await render({ session });
      const html: string = fixture.nativeElement.innerHTML;

      expect(html).not.toMatch(/forgot/i);
      expect(html).not.toMatch(/reset/i);
      expect(html).not.toMatch(/register|sign up|create account/i);
      expect(html).not.toMatch(/google|oauth/i);
      expect(el(fixture, 'input[type="email"]')).toBeNull();
    });

    /**
     * The session is one short lived token with no refresh token behind it, so a
     * checkbox promising persistence would be lying.
     */
    it('offers no remember me', async () => {
      const { fixture } = await render({ session });

      expect(el(fixture, 'input[type="checkbox"]')).toBeNull();
      expect(fixture.nativeElement.innerHTML).not.toMatch(/remember/i);
    });

    /** So a password manager fills it, on a phone as well as a desktop. */
    it('is a real password field a manager can fill', async () => {
      const { fixture } = await render({ session });
      const password = el<HTMLInputElement>(fixture, 'input#password');
      const username = el<HTMLInputElement>(fixture, 'input#username');

      expect(password?.type).toBe('password');
      expect(password?.getAttribute('autocomplete')).toBe('current-password');
      expect(username?.getAttribute('autocomplete')).toBe('username');
    });

    /**
     * An operator should know which database they are signing in to *before*
     * they type a production password into a staging tab. This is what `0001`'s
     * unauthenticated environment read is for.
     */
    it('names the environment being signed in to', async () => {
      const { fixture } = await render({ session });
      TestBed.inject(DeploymentStore).load();
      await drain();
      fixture.detectChanges();

      expect(text(fixture, '.name')).toBe('environment.staging');
    });
  });

  describe('submitting', () => {
    it('will not submit until both fields have something in them', async () => {
      const { fixture, attempts } = await render({ session });

      await submit(fixture);
      expect(attempts).toHaveLength(0);

      fill(fixture, 'ops', '');
      await submit(fixture);
      expect(attempts).toHaveLength(0);

      fill(fixture, 'ops', 'pw');
      await submit(fixture);
      expect(attempts).toHaveLength(1);
    });

    it('trims the username and leaves the password alone', async () => {
      const { fixture, attempts } = await render({ session });

      fill(fixture, '  ops  ', '  pw  ');
      await submit(fixture);

      expect(attempts[0]).toEqual({ username: 'ops', password: '  pw  ' });
    });

    it('holds the session and navigates away on success', async () => {
      const { fixture, sessions } = await render({ session });
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigateByUrl');

      fill(fixture, 'ops', 'pw');
      await submit(fixture);

      expect(sessions.signedIn()).toBe(true);
      expect(sessions.token()).toBe('a.b.c');
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('does not navigate on a refusal', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');

      fill(fixture, 'ops', 'wrong');
      await submit(fixture);

      expect(navigate).not.toHaveBeenCalled();
    });

    /** One submit cannot become three while the first is still in flight. */
    it('refuses a second submit while one is in flight', async () => {
      const { fixture, attempts } = await render({ session });

      fill(fixture, 'ops', 'pw');
      const first = fixture.componentInstance.submit();
      const second = fixture.componentInstance.submit();
      await Promise.all([first, second]);
      await drain();

      expect(attempts).toHaveLength(1);
    });
  });

  describe('the four outcomes', () => {
    /**
     * Section 2, on screen. Each of these renders its own key, and the wrong
     * password case renders the same text for an unknown username as for a wrong
     * password, because plan 0071 answers both with one 401 on purpose.
     */
    it.each([
      [
        'a wrong password',
        refusal('unauthorized', 401),
        'signIn.error.invalidCredentials',
      ],
      [
        'a throttle',
        refusal('rate_limited', 429, 60),
        'signIn.error.throttledFor',
      ],
      [
        'a lockout',
        refusal('account_locked', 423, 900),
        'signIn.error.lockedOutFor',
      ],
      [
        'a deployment that cannot',
        refusal('not_configured', 501),
        'signIn.error.notAvailable',
      ],
      ['a server that said nothing', refusal('', 500), 'signIn.error.unknown'],
    ])('renders its own message for %s', async (_case, error, key) => {
      const { fixture } = await render({ error });

      fill(fixture, 'ops', 'pw');
      await submit(fixture);

      expect(text(fixture, '.error')).toBe(key);
    });

    it('says the same thing for an unknown username as for a wrong password', async () => {
      const unknownUser = await render({ error: refusal('unauthorized', 401) });
      fill(unknownUser.fixture, 'nobody', 'pw');
      await submit(unknownUser.fixture);

      const wrongPassword = await render({
        error: refusal('unauthorized', 401),
      });
      fill(wrongPassword.fixture, 'ops', 'wrong');
      await submit(wrongPassword.fixture);

      expect(text(unknownUser.fixture, '.error')).toBe(
        text(wrongPassword.fixture, '.error')
      );
    });

    it('announces the failure to a screen reader', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });

      fill(fixture, 'ops', 'pw');
      await submit(fixture);

      expect(el(fixture, '.error')?.getAttribute('role')).toBe('alert');
    });

    it('shows nothing before an attempt has been made', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });

      expect(el(fixture, '.error')).toBeNull();
    });

    /**
     * The password is cleared and the username is kept: retyping the username is
     * pure friction, because it was almost certainly not the half that was wrong.
     */
    it('clears the password and keeps the username after a refusal', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });

      fill(fixture, 'ops', 'wrong');
      await submit(fixture);

      expect(fixture.componentInstance.username()).toBe('ops');
      expect(fixture.componentInstance.password()).toBe('');
    });

    it('clears the previous message when a new attempt starts', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });
      fill(fixture, 'ops', 'wrong');
      await submit(fixture);
      expect(el(fixture, '.error')).not.toBeNull();

      fill(fixture, 'ops', 'again');
      const inFlight = fixture.componentInstance.submit();
      fixture.detectChanges();
      expect(el(fixture, '.error')).toBeNull();

      await inFlight;
      await drain();
    });
  });

  /**
   * Asserted directly, because it is the property the whole storage decision
   * turns on: `sessionStorage` is cleared when the browser closes and
   * `localStorage` is not, so a token in the wrong one outlives the sitting.
   */
  it('never writes the token to localStorage', async () => {
    localStorage.clear();
    const { fixture } = await render({ session });

    fill(fixture, 'ops', 'pw');
    await submit(fixture);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });
});
