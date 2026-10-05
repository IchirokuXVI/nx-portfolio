import { provideLocationMocks } from '@angular/common/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  type DeploymentServiceI,
  DeploymentStore,
  GatewayError,
  ServerReachability,
  SESSION_SERVICE,
  type SessionServiceI,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  type AdminMe,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEVELOPMENT_RETRY_WAITS_MS, SignInPage } from './sign-in-page';

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
  }),
  /** What a passwordless sign in answers, one entry for each try. */
  development: readonly (AdminSession | Error)[] = [session]
) {
  const attempts: Array<{ username: string; password: string }> = [];
  const tries = { count: 0 };

  const sessionService: SessionServiceI = {
    signIn: async (username, password) => {
      attempts.push({ username, password });
      if ('error' in outcome) {
        throw outcome.error;
      }
      return outcome.session;
    },
    signInForDevelopment: async () => {
      const answer = development[Math.min(tries.count, development.length - 1)];
      tries.count += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    refresh: async () => session,
    readMe: async () => me,
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SignInPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
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

  return { fixture, attempts, tries, sessions: TestBed.inject(SessionStore) };
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
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

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

      // The name the rail writes, above the form (admin plan 0046, target 8).
      expect(text(fixture, '.entry-deployment')).toContain(
        'environment.short.staging'
      );
    });

    /**
     * A deployment that could not be established keeps its warning text: an
     * operator who cannot see which database this is must be told so.
     */
    it('says so when the deployment could not be established', async () => {
      const { fixture } = await render({ session }, async () => ({
        deployment: null,
        devAutologin: false,
      }));
      TestBed.inject(DeploymentStore).load();
      await drain();
      fixture.detectChanges();

      expect(text(fixture, '.entry-deployment')).toContain(
        'environment.short.unknown'
      );
      expect(text(fixture, '.entry-unknown')).toBe(
        'environment.unknownExplanation'
      );
    });

    /** The card, the fields and the button are the shared entry card's. */
    it('is drawn on the shared entry card, with the one first heading', async () => {
      const { fixture } = await render({ session });
      const host: HTMLElement = fixture.nativeElement;

      expect(host.querySelector('lib-entry-card form')).not.toBeNull();
      expect(host.querySelectorAll('h1')).toHaveLength(1);
      expect(host.querySelector('h1')?.textContent).toContain('signIn.heading');
    });

    /**
     * Admin plan 0041, section 7: the page shows the color of the deployment
     * as a band 8 px high at its top edge, which is the color the rail takes
     * once the operator is in. Read out of the source, because a spec here
     * loads no component styles.
     */
    it('draws a band in the deployment color at its top edge', async () => {
      const { fixture } = await render({ session });
      const host: HTMLElement = fixture.nativeElement;
      const band = host.querySelector('.band');
      const source = readFileSync(join(__dirname, 'sign-in-page.ts'), 'utf8');

      expect(band).not.toBeNull();
      expect(host.firstElementChild).toBe(band);
      expect(source).toMatch(
        /\.band \{\s*block-size: 0\.5rem;\s*background: var\(--admin-nav\);/
      );
    });

    /**
     * Color is never the only sign: the band is hidden from a screen reader
     * and the name of the deployment is on the card, in words.
     */
    it('says the deployment in words beside the band', async () => {
      const { fixture } = await render({ session });
      TestBed.inject(DeploymentStore).load();
      await drain();
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;

      expect(host.querySelector('.band')?.getAttribute('aria-hidden')).toBe(
        'true'
      );
      expect(host.querySelector('lib-entry-card')?.textContent).toContain(
        'environment.short.staging'
      );
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

      expect(text(fixture, '.entry-error')).toBe(key);
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

      expect(text(unknownUser.fixture, '.entry-error')).toBe(
        text(wrongPassword.fixture, '.entry-error')
      );
    });

    it('announces the failure to a screen reader', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });

      fill(fixture, 'ops', 'pw');
      await submit(fixture);

      expect(el(fixture, '.entry-error')?.getAttribute('role')).toBe('alert');
    });

    it('shows nothing before an attempt has been made', async () => {
      const { fixture } = await render({ error: refusal('unauthorized', 401) });

      expect(el(fixture, '.entry-error')).toBeNull();
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
      expect(el(fixture, '.entry-error')).not.toBeNull();

      fill(fixture, 'ops', 'again');
      const inFlight = fixture.componentInstance.submit();
      fixture.detectChanges();
      expect(el(fixture, '.entry-error')).toBeNull();

      await inFlight;
      await drain();
    });
  });

  /**
   * Admin plan 0049, target 1. On a server that asks for no password the form
   * is never what the operator is left with: `SessionBootstrap` tries once
   * before the first screen, and this page tries whenever that was not enough.
   */
  describe('a server that asks for no password', () => {
    const passwordless: DeploymentServiceI['read'] = async () => ({
      deployment: 'development',
      devAutologin: true,
    });

    /** The deployment is read, and the page hears what it said. */
    async function settle(fixture: ComponentFixture<SignInPage>) {
      void TestBed.inject(DeploymentStore).load();
      await drain();
      fixture.detectChanges();
      await drain();
      fixture.detectChanges();
    }

    afterEach(() => jest.useRealTimers());

    it('signs in by itself and goes in, with no form on the way', async () => {
      const { fixture, tries, attempts, sessions } = await render(
        { session },
        passwordless
      );
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');

      await settle(fixture);

      expect(tries.count).toBe(1);
      expect(attempts).toEqual([]);
      expect(sessions.signedIn()).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/');
      expect(el(fixture, 'form')).toBeNull();
    });

    it('says what it is doing in place of the form', async () => {
      const { fixture } = await render({ session }, passwordless, [
        new Error('nothing answered'),
      ]);
      jest.useFakeTimers();

      await settle(fixture);

      expect(text(fixture, '[data-entering]')).toBe('signIn.development');
      expect(el(fixture, '[data-entering]')?.getAttribute('role')).toBe(
        'status'
      );
      expect(el(fixture, 'input')).toBeNull();
    });

    /**
     * The case the owner hit: the backend was still starting, so the one try
     * before the first screen got no answer.
     */
    it('tries again when nothing answered, and goes in when something does', async () => {
      const { fixture, tries, sessions } = await render(
        { session },
        passwordless,
        [new Error('nothing answered'), new Error('still nothing'), session]
      );
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
      jest.useFakeTimers();

      await settle(fixture);
      expect(tries.count).toBe(1);
      expect(sessions.signedIn()).toBe(false);

      jest.advanceTimersByTime(DEVELOPMENT_RETRY_WAITS_MS[0]);
      await drain();
      expect(tries.count).toBe(2);

      jest.advanceTimersByTime(DEVELOPMENT_RETRY_WAITS_MS[1]);
      await drain();
      fixture.detectChanges();

      expect(tries.count).toBe(3);
      expect(sessions.signedIn()).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/');
    });

    /**
     * The form does not show on a development server at all, so a server that
     * goes on not answering is asked for as long as the page is on screen.
     */
    it('goes on trying at the last wait, and never puts the form back', async () => {
      const { fixture, tries } = await render({ session }, passwordless, [
        new Error('nothing answered'),
      ]);
      const last =
        DEVELOPMENT_RETRY_WAITS_MS[DEVELOPMENT_RETRY_WAITS_MS.length - 1];
      jest.useFakeTimers();

      await settle(fixture);
      for (const wait of DEVELOPMENT_RETRY_WAITS_MS) {
        jest.advanceTimersByTime(wait);
        await drain();
      }
      expect(tries.count).toBe(DEVELOPMENT_RETRY_WAITS_MS.length + 1);

      for (let more = 1; more <= 5; more++) {
        jest.advanceTimersByTime(last);
        await drain();
        expect(tries.count).toBe(DEVELOPMENT_RETRY_WAITS_MS.length + 1 + more);
      }
      fixture.detectChanges();

      expect(el(fixture, 'form')).toBeNull();
      expect(text(fixture, '[data-entering]')).toBe('signIn.development');
    });

    it('stops, with the form and the reason, when a later try is refused in words', async () => {
      const { fixture, tries } = await render({ session }, passwordless, [
        new Error('nothing answered'),
        new Error('still nothing'),
        refusal('rate_limited', 429, 60),
      ]);
      jest.useFakeTimers();

      await settle(fixture);
      jest.advanceTimersByTime(DEVELOPMENT_RETRY_WAITS_MS[0]);
      await drain();
      jest.advanceTimersByTime(DEVELOPMENT_RETRY_WAITS_MS[1]);
      await drain();
      fixture.detectChanges();

      expect(tries.count).toBe(3);
      expect(el(fixture, 'form')).not.toBeNull();
      expect(text(fixture, '.entry-error')).toBe('signIn.error.throttledFor');

      jest.advanceTimersByTime(60_000);
      await drain();
      expect(tries.count).toBe(3);
    });

    /**
     * The token is shared by every tab, and a failed sign in clears it. So a
     * page that waits must not ask again once another tab holds a session:
     * a try that failed then would sign that tab out.
     */
    it('goes in on a session another tab took, and asks for none of its own', async () => {
      const { fixture, tries, sessions } = await render(
        { session },
        passwordless,
        [new Error('nothing answered')]
      );
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
      jest.useFakeTimers();

      await settle(fixture);
      expect(tries.count).toBe(1);

      // What the lifecycle does when another tab writes the shared token.
      sessions.adopt(session);
      jest.advanceTimersByTime(DEVELOPMENT_RETRY_WAITS_MS[0]);
      await drain();

      expect(tries.count).toBe(1);
      expect(sessions.signedIn()).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/');

      jest.advanceTimersByTime(60_000);
      await drain();
      expect(tries.count).toBe(1);
    });

    /** The server changed its mind between the two calls (plan 0002). */
    it('does not try again a sign in the server refused in words', async () => {
      const { fixture, tries } = await render({ session }, passwordless, [
        refusal('not_configured', 501),
      ]);
      jest.useFakeTimers();

      await settle(fixture);
      jest.advanceTimersByTime(60_000);
      await drain();
      fixture.detectChanges();

      expect(tries.count).toBe(1);
      expect(el(fixture, 'form')).not.toBeNull();
      expect(text(fixture, '.entry-error')).toBe('signIn.error.notAvailable');
    });

    it('stops trying when the page is left', async () => {
      const { fixture, tries } = await render({ session }, passwordless, [
        new Error('nothing answered'),
      ]);
      jest.useFakeTimers();

      await settle(fixture);
      fixture.destroy();
      jest.advanceTimersByTime(60_000);
      await drain();

      expect(tries.count).toBe(1);
    });

    /** Production and staging: the server offers nothing, so nothing is asked. */
    it('asks for nothing on a server that wants a password', async () => {
      const { fixture, tries } = await render({ session });

      await settle(fixture);

      expect(tries.count).toBe(0);
      expect(el(fixture, 'form')).not.toBeNull();
      expect(el(fixture, '[data-entering]')).toBeNull();
    });
  });

  /**
   * Asserted directly, because it is the property the whole storage decision
   * turns on (plan 0013, section 2): `localStorage` is per origin rather than
   * per tab, so signing in here signs in every tab of this app, including the
   * ones the operator opens afterwards.
   */
  it('writes the token where every tab can read it', async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { fixture } = await render({ session });

    fill(fixture, 'ops', 'pw');
    await submit(fixture);

    expect(localStorage.getItem('luna-shopper-admin.session')).not.toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
