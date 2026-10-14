import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  fakeAuthService,
  fakeProfileStore,
  fakeZoneStore,
  NetworkError,
  PendingRecoveryLink,
  profileFor,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeProfileStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  type FakeAuthService,
  type FakeIdentity,
  type FakeProfileStore,
  type RecoveryOutcome,
} from '@portfolio/velista/data-access';
import type { MyZone } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { ResetPasswordPage } from './reset-password-page';

function zone(id: string): MyZone {
  return {
    id,
    name: `Group ${id}`,
    joinCode: 'ABCD1234',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 1,
      listCount: 0,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

const SIGNED_IN: RecoveryOutcome = {
  state: 'signed-in',
  tokens: {
    userId: 'u-owner',
    kind: 'REGISTERED',
    username: 'marta',
    accessToken: 'access',
    refreshToken: 'refresh',
  },
};

interface Options {
  readonly token?: string | null;
  readonly mode?: string | null;
  readonly auth?: FakeAuthService;
  readonly identity?: FakeIdentity;
  readonly profile?: FakeProfileStore;
  readonly zones?: readonly MyZone[];
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const reload = jest.fn();

  const auth = options.auth ?? fakeAuthService({ userId: 'u-owner' });
  const profile =
    options.profile ??
    fakeProfileStore({
      profile: profileFor({
        username: 'luis_ortega',
        email: 'luis@example.com',
      }),
    });
  const token = options.token === undefined ? 'link-token' : options.token;
  const params: Record<string, string | null> = {
    token,
    mode: options.mode ?? null,
  };

  await TestBed.configureTestingModule({
    imports: [ResetPasswordPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(undefined, { reload }),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'anonymous', {
        username: 'luis_ortega',
      }),
      provideFakeProfileStore(profile),
      provideFakeZoneStore(fakeZoneStore({ zones: options.zones ?? [] })),
      provideAccountNotice(),
      PendingRecoveryLink,
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: {
              get: (key: string) => params[key] ?? null,
              has: (key: string) => (params[key] ?? null) !== null,
            },
          },
        },
      },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  jest.spyOn(router, 'navigate').mockResolvedValue(true);

  const fixture = TestBed.createComponent(ResetPasswordPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, auth, router, profile, reload };
}

function host(fixture: ComponentFixture<ResetPasswordPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function text(fixture: ComponentFixture<ResetPasswordPage>): string {
  return host(fixture).textContent ?? '';
}

async function settle(fixture: ComponentFixture<ResetPasswordPage>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function typeAndSave(
  fixture: ComponentFixture<ResetPasswordPage>,
  password = 'a new password'
) {
  fixture.componentInstance.password.set(password);
  fixture.detectChanges();
  host(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
  await settle(fixture);
}

async function click(
  fixture: ComponentFixture<ResetPasswordPage>,
  selector: string
) {
  (host(fixture).querySelector(selector) as HTMLButtonElement).click();
  await settle(fixture);
}

describe('ResetPasswordPage', () => {
  describe('the reset link', () => {
    it('spends nothing as it loads, and shows the form', async () => {
      // Mail scanners open links. Every action of this mode is a press.
      const { fixture, auth } = await render();

      expect(auth.calls).toEqual([]);
      expect(fixture.componentInstance.view()).toBe('form');
      expect(text(fixture)).toContain('auth.reset.title');
      expect(text(fixture)).toContain('auth.reset.keep');
    });

    it('takes the token out of the URL, so history and referrers never hold it', async () => {
      const { router } = await render();

      expect(router.navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: {}, replaceUrl: true })
      );
    });

    it('saves the password, says so once on home, and goes there', async () => {
      const { fixture, auth, router } = await render();

      await typeAndSave(fixture);

      expect(auth.calls).toEqual([
        {
          method: 'resetPassword',
          token: 'link-token',
          password: 'a new password',
        },
      ]);
      expect(TestBed.inject(AccountNotice).notice()?.kind).toBe(
        'passwordChanged'
      );
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('puts a refused password under the field', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({
          resetPassword: { state: 'password-rejected' },
        }),
      });

      await typeAndSave(fixture, 'short');

      expect(text(fixture)).toContain('auth.error.shortPassword');
      expect(fixture.componentInstance.view()).toBe('form');
    });

    it('shows the dead link screen for a used link', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ resetPassword: { state: 'link-dead' } }),
      });

      await typeAndSave(fixture);

      expect(text(fixture)).toContain('auth.reset.dead.title');
    });

    it('asks first when an account is signed in, and saves on the one button', async () => {
      // A reset replaces the session too, and nothing can tell yet whose link it is.
      const { fixture, auth } = await render({ identity: 'REGISTERED' });

      await typeAndSave(fixture);

      expect(auth.calls).toEqual([]);
      expect(fixture.componentInstance.confirmKind()).toBe('held');
      // Both names of the account on this phone, always (the owner's pick 5).
      expect(text(fixture)).toContain('luis_ortega');
      expect(text(fixture)).toContain('luis@example.com');

      await click(fixture, 'button.primary');

      expect(auth.calls.map((call) => call.method)).toEqual(['resetPassword']);
    });

    it('goes back from the confirm to the form, not off the page', async () => {
      const { fixture } = await render({ identity: 'REGISTERED' });
      await typeAndSave(fixture);

      fixture.componentInstance.back();
      await settle(fixture);

      expect(fixture.componentInstance.view()).toBe('form');
    });

    it('signs in with the password kept', async () => {
      const { fixture, auth, router } = await render();

      await click(fixture, 'button.secondary');

      expect(auth.calls).toEqual([
        { method: 'recoverySignIn', token: 'link-token', switchAccount: false },
      ]);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('sends another account home to the sheet, holding the token in memory', async () => {
      // The owner's requirement of 2026-10-14: a sheet over home asks, and the token
      // is never in its URL.
      const { fixture, auth, router } = await render({
        identity: 'REGISTERED',
        auth: fakeAuthService({
          recoverySignIn: () => ({ state: 'other-account' }),
        }),
      });

      await click(fixture, 'button.secondary');

      // One request without the switch (the owner's decision of 2026-10-14). A 409
      // for another account spends nothing.
      expect(auth.calls).toEqual([
        { method: 'recoverySignIn', token: 'link-token', switchAccount: false },
      ]);
      expect(TestBed.inject(PendingRecoveryLink).token()).toBe('link-token');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        '/en/home/sheet/recovery-link',
        { replaceUrl: true }
      );
    });

    it('asks a guest before a reset, says what is lost, and offers the upgrade page', async () => {
      const { fixture, auth, router } = await render({
        identity: 'TEMPORARY',
        zones: [zone('z1'), zone('z2')],
      });

      await typeAndSave(fixture);

      expect(auth.calls).toEqual([]);
      expect(fixture.componentInstance.confirmKind()).toBe('guest');
      expect(text(fixture)).toContain('auth.reset.guest.noEmail');
      expect(text(fixture)).toContain('auth.reset.guest.loss');
      expect(
        host(fixture).querySelector('button.primary')?.classList
      ).toContain('destructive');
      // Rule C2: never register, and exactly one button.
      expect(text(fixture)).not.toContain('auth.register');
      expect(host(fixture).querySelectorAll('button.primary')).toHaveLength(1);

      await click(fixture, 'button.inline-link');

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/auth/upgrade');
    });

    it('starts the document over when a reset replaced another account', async () => {
      // The stores still hold the account that left; home must not show its groups.
      const { fixture, reload } = await render({ identity: 'REGISTERED' });

      await typeAndSave(fixture);
      await click(fixture, 'button.primary');

      expect(reload).toHaveBeenCalled();
    });
  });

  describe('the sign in link', () => {
    it('spends the link once as it loads, and lands home', async () => {
      const { auth, router } = await render({ mode: 'sign-in' });

      expect(auth.calls).toEqual([
        { method: 'recoverySignIn', token: 'link-token', switchAccount: false },
      ]);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('lands its owner home with no error', async () => {
      const { fixture, router } = await render({
        mode: 'sign-in',
        identity: 'REGISTERED',
        auth: fakeAuthService({
          recoverySignIn: () => ({ state: 'already-signed-in' }),
        }),
      });

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
      expect(text(fixture)).not.toContain('auth.reset.dead.title');
    });

    it('sends a guest to the home sheet after the one request', async () => {
      const { auth, router } = await render({
        mode: 'sign-in',
        identity: 'TEMPORARY',
        auth: fakeAuthService({
          recoverySignIn: () => ({ state: 'other-account' }),
        }),
      });

      expect(auth.calls).toEqual([
        { method: 'recoverySignIn', token: 'link-token', switchAccount: false },
      ]);
      expect(TestBed.inject(PendingRecoveryLink).token()).toBe('link-token');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        '/en/home/sheet/recovery-link',
        { replaceUrl: true }
      );
    });

    it('shows a refusal inside a support session as the dead link screen', async () => {
      const { fixture } = await render({
        mode: 'sign-in',
        auth: fakeAuthService({
          recoverySignIn: () => ({ state: 'refused-in-support' }),
        }),
      });

      expect(text(fixture)).toContain('auth.reset.dead.title');
    });

    it('offers to try again when the request never got through', async () => {
      let answers = 0;
      const { fixture, auth } = await render({
        mode: 'sign-in',
        auth: fakeAuthService({
          recoverySignIn: () =>
            answers++ === 0
              ? { state: 'failed', error: new NetworkError('c1', 'x') }
              : SIGNED_IN,
        }),
      });

      expect(text(fixture)).toContain('auth.reset.failed.title');

      fixture.componentInstance.retry();
      await settle(fixture);

      expect(auth.calls).toHaveLength(2);
    });
  });

  describe('the dead link screen', () => {
    it('opens for a link with no token, and spends nothing', async () => {
      const { fixture, auth } = await render({ token: null });

      expect(auth.calls).toEqual([]);
      expect(text(fixture)).toContain('auth.reset.dead.title');
    });

    it('offers a new link and the password to somebody signed out', async () => {
      const { fixture, router } = await render({ token: null });

      expect(text(fixture)).toContain('auth.reset.dead.signIn');
      await click(fixture, 'lib-outcome-screen button.primary');

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        '/en/auth/forgot-password'
      );
    });

    it('sends somebody signed in back to their groups instead', async () => {
      const { fixture, router } = await render({
        token: null,
        identity: 'REGISTERED',
      });

      expect(text(fixture)).not.toContain('auth.reset.dead.signIn');
      await click(fixture, 'lib-outcome-screen button.primary');

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });
  });
});
