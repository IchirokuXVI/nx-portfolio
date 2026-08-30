import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ApiUrl,
  fakeAuthService,
  fakeProfileStore,
  fakeZoneStore,
  profileFor,
  provideFakeAuthService,
  provideFakeProfileStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  TokenStore,
  type FakeAuthService,
  type FakeProfileStore,
  type FakeZoneStore,
} from '@portfolio/velista/data-access';
import type { MyZone, ProfileLoad, ZoneRole } from '@portfolio/velista/models';
import {
  InstallStore,
  provideFakeBrowserFacade,
  provideVelistaTesting,
  TEST_BRAND,
  type InstallState,
} from '@portfolio/velista/platform';
import { APP_STANDALONE_ORIGIN } from '@portfolio/velista/models';
import { of } from 'rxjs';
import { AccountPage } from './account-page';

const ME = 'u1';

function zone(id: string, myRole: ZoneRole): MyZone {
  return {
    id,
    name: `Group ${id}`,
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: myRole === 'OWNER' ? ME : 'u-other',
    myRole,
    myStatus: 'APPROVED',
    counts: {
      memberCount: 2,
      listCount: 1,
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

interface Options {
  readonly guest?: boolean;
  /** Which mount this copy is running under. `''` is velista's own origin. */
  readonly basePath?: string;
  /** What the browser has said about installing (plan 0033). */
  readonly install?: InstallState;
  /** The address of the standalone origin, or empty for none configured. */
  readonly standaloneOrigin?: string;
  readonly username?: string;
  readonly email?: string | null;
  readonly emailVerified?: boolean;
  readonly profileState?: ProfileLoad;
  readonly zones?: readonly MyZone[];
  readonly forgotPassword?: Parameters<typeof fakeAuthService>[0] extends infer O
    ? O extends { forgotPassword?: infer F }
      ? F
      : never
    : never;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<AccountPage>;
  profile: FakeProfileStore;
  auth: FakeAuthService;
  zones: FakeZoneStore;
  tokens: TokenStore;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
  install: { prompt: jest.Mock };
  opened: string[];
}> {
  TestBed.resetTestingModule();

  const guest = options.guest === true;
  const username = options.username ?? 'Marta';

  const profile = fakeProfileStore({
    profile: profileFor({
      userId: ME,
      kind: guest ? 'TEMPORARY' : 'REGISTERED',
      username,
      email: guest ? null : (options.email ?? 'marta@example.com'),
      emailVerified: !guest && options.emailVerified !== false,
    }),
    state: options.profileState ?? 'loaded',
  });
  const auth = fakeAuthService({ forgotPassword: options.forgotPassword });
  const zones = fakeZoneStore({ zones: options.zones ?? [] });
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  const map = convertToParamMap({});

  // The install store is faked rather than driven through window events, because what
  // this screen is about is the **row each state draws**, not how the state was
  // reached. `install-store.spec.ts` owns the second question (plan 0033, section 8).
  const install = {
    prompt: jest.fn().mockResolvedValue('accepted'),
  };
  const opened: string[] = [];

  await TestBed.configureTestingModule({
    imports: [AccountPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '/velista' }),
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
          ...install,
          state: signal<InstallState>(options.install ?? 'manual'),
          guide: signal('android-menu'),
          canPrompt: signal(options.install === 'ready'),
        },
      },
      // The **real** `TokenStore`, because sign out is a fact about it: this screen
      // clears the pair itself, there being no logout endpoint (section 5.5), and a
      // double would let that assertion pass against a method name. It needs an
      // `HttpClient` for the refresh it never performs here, and `ApiUrl` to build the
      // URL it never calls.
      provideHttpClient(),
      ApiUrl,
      TokenStore,
      provideFakeProfileStore(profile),
      provideFakeAuthService(auth),
      provideFakeZoneStore(zones),
      // The identity is what decides which of the two screens is drawn, so it is the
      // one thing every case here varies.
      provideFakeSessionStore(guest ? 'TEMPORARY' : 'REGISTERED', {
        userId: ME,
        username,
      }),
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    profile,
    auth,
    zones,
    tokens: TestBed.inject(TokenStore),
    router,
    install,
    opened,
  };
}

function text(fixture: ComponentFixture<AccountPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function rows(fixture: ComponentFixture<AccountPage>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('lib-account-row')
  );
}

/** The row whose visible text contains `needle`, or undefined. */
function rowWith(
  fixture: ComponentFixture<AccountPage>,
  needle: string
): HTMLElement | undefined {
  return rows(fixture).find((row) => (row.textContent ?? '').includes(needle));
}

describe('AccountPage', () => {
  describe('what renders without a request', () => {
    it('shows the name straight away, with no loading state over it', async () => {
      // Section 3.1. `SessionStore.username` comes off the token pair, which is already
      // in memory, so the heading is correct on the first frame.
      const { fixture } = await render({ profileState: 'loading' });

      expect(text(fixture)).toContain('Marta');
    });

    it('skeletons only the email while the profile is in flight', async () => {
      const { fixture } = await render({ profileState: 'loading' });

      expect(fixture.nativeElement.querySelector('.skeleton')).not.toBeNull();
      expect(text(fixture)).toContain('Marta');
    });

    it('asks for the profile once', async () => {
      const { profile } = await render();

      expect(
        profile.calls.filter((call) => call.method === 'load')
      ).toHaveLength(1);
    });
  });

  describe('a registered account', () => {
    it('shows the address and that it is confirmed', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain('marta@example.com');
      // Words rather than a colour, so the row survives a colourblind reader and a
      // screen reader alike (section 7).
      expect(text(fixture)).toContain('account.email.confirmed');
    });

    it('says an unconfirmed address is not confirmed, in words', async () => {
      const { fixture } = await render({ emailVerified: false });

      expect(text(fixture)).toContain('account.email.unconfirmed');
    });

    it('offers sign out', async () => {
      const { fixture } = await render();

      expect(rowWith(fixture, 'account.signOut.action')).toBeDefined();
    });

    it('claims nothing about other devices', async () => {
      // Section 5.5. There is no logout endpoint, so the refresh token stays live on
      // the server and the copy must not imply the session ended anywhere else.
      const { fixture } = await render();

      expect(text(fixture)).toContain('account.signOut.body');
    });
  });

  /**
   * **Rule A1.** For a registered user sign out drops a pair that can be minted again.
   * For a guest it is irreversible destruction of the account, and it is worse than
   * delete because it looks harmless.
   */
  describe('rule A1: the guest sees a different screen', () => {
    it('renders no sign out control at all', async () => {
      const { fixture } = await render({ guest: true });

      // Asserted by query and not by inspection, which is what the acceptance criterion
      // asks for: absent, not disabled.
      expect(rowWith(fixture, 'account.signOut.action')).toBeUndefined();
      expect(text(fixture)).not.toContain('account.signOut');
    });

    it('renders no email row and no password row', async () => {
      const { fixture } = await render({ guest: true });

      expect(text(fixture)).not.toContain('account.password.action');
      expect(rowWith(fixture, 'account.email.label')).toBeUndefined();
    });

    it('keeps the name row, which is why a guest is not redirected away', async () => {
      const { fixture } = await render({ guest: true });

      expect(rowWith(fixture, 'Marta')).toBeDefined();
    });

    it('offers the upgrade, with the group count that makes it concrete', async () => {
      const { fixture } = await render({
        guest: true,
        zones: [zone('z1', 'OWNER'), zone('z2', 'MEMBER')],
      });

      expect(text(fixture)).toContain('account.guest.secure');
      // The count itself, since the testing translator renders keys rather than
      // interpolating them. What matters is that the card is handed the number that
      // makes the stakes concrete.
      expect(fixture.componentInstance.state()).toMatchObject({
        kind: 'guest',
        zoneCount: 2,
      });
    });

    it('spends no request learning the profile it cannot render', async () => {
      // A guest's profile carries a null email and a name this screen already has.
      const { profile } = await render({ guest: true });

      expect(profile.calls.filter((call) => call.method === 'load')).toEqual([]);
    });

    it('goes to auth/upgrade and never to auth/register', async () => {
      // Rule C2 (`0009`) holding on a second screen: register creates a **new** user
      // row, so a guest who followed it would lose every group they have.
      const { fixture, router } = await render({ guest: true });

      (
        fixture.nativeElement.querySelector('.upgrade .primary') as HTMLElement
      ).click();

      expect(router.navigate).toHaveBeenCalledWith(
        ['..', 'auth', 'upgrade'],
        expect.anything()
      );
    });

    it('offers delete, named as the only other exit there is', async () => {
      const { fixture } = await render({ guest: true });

      expect(rowWith(fixture, 'account.delete.action')).toBeDefined();
      expect(text(fixture)).toContain('account.guest.deleteNote');
    });
  });

  describe('signing out', () => {
    it('clears the session and lands on the front door', async () => {
      const { fixture, tokens, router } = await render();
      tokens.set({
        userId: ME,
        kind: 'REGISTERED',
        username: 'Marta',
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      (rowWith(fixture, 'account.signOut.action') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();

      expect(tokens.tokens()).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en');
    });

    it('drops the held profile, so the next person sees no address of theirs', async () => {
      const { fixture, profile } = await render();

      (rowWith(fixture, 'account.signOut.action') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();

      expect(profile.calls).toContainEqual({ method: 'clear' });
    });
  });

  describe('the password row', () => {
    it('asks for a link with the profile’s own address', async () => {
      const { fixture, auth } = await render();

      (rowWith(fixture, 'account.password.action') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();

      expect(auth.calls).toContainEqual({
        method: 'forgotPassword',
        email: 'marta@example.com',
      });
    });

    it('never claims delivery', async () => {
      // Section 5.6. The endpoint answers the same for an address with a password, one
      // with none, and one that signs in with Google, so the copy has to match.
      const { fixture } = await render();

      (rowWith(fixture, 'account.password.action') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text(fixture)).toContain('account.password.sent');
    });

    it('says up front that spending the link signs the other devices out', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain('account.password.body');
    });

    it('renders the server’s own wait when it is refused', async () => {
      const { fixture } = await render({
        forgotPassword: { state: 'refused', waitSeconds: 47 },
      });

      (rowWith(fixture, 'account.password.action') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text(fixture)).toContain('account.error.tooManyResets');
      // The number itself is asserted through the formatter rather than through the
      // rendered string, because the testing translator answers keys and interpolates
      // nothing. What matters is that the wait handed to `{{wait}}` is the server's.
      expect(fixture.componentInstance.resetOutcome()).toMatchObject({
        state: 'refused',
        waitSeconds: 47,
      });
      expect(fixture.componentInstance.waitClock(47)).toBe('0:47');
    });

    it('is still offered for an account that may sign in with Google', async () => {
      // `UserProfileView` carries no provider list, so the screen cannot know. Offering
      // it is the safe side of that: the answer is incurious either way (section 5.6).
      const { fixture } = await render();

      expect(rowWith(fixture, 'account.password.action')).toBeDefined();
    });
  });

  describe('when the profile cannot be read', () => {
    it('still renders the screen, and still offers sign out', async () => {
      // Being unable to read an email must never be what traps somebody on a phone they
      // want off (section 3.1).
      const { fixture } = await render({ profileState: 'failed' });

      expect(rowWith(fixture, 'account.signOut.action')).toBeDefined();
    });

    it('offers one retry line rather than an error panel', async () => {
      const { fixture, profile } = await render({ profileState: 'failed' });

      const retry = fixture.nativeElement.querySelector(
        '.failed button'
      ) as HTMLButtonElement;
      retry.click();

      expect(
        profile.calls.filter((call) => call.method === 'load')
      ).toHaveLength(2);
    });
  });

  describe('the sheets', () => {
    it('opens the rename over this screen rather than navigating away', async () => {
      const { fixture, router } = await render();

      (rowWith(fixture, 'Marta') as HTMLElement).querySelector('button')?.click();

      expect(router.navigate).toHaveBeenCalledWith(
        ['name'],
        expect.anything()
      );
    });

    it('opens the delete confirm', async () => {
      const { fixture, router } = await render();

      (rowWith(fixture, 'account.delete.action') as HTMLElement)
        .querySelector('button')
        ?.click();

      expect(router.navigate).toHaveBeenCalledWith(
        ['confirm', 'delete'],
        expect.anything()
      );
    });

    it('has an outlet for them to render into', async () => {
      const { fixture } = await render();

      expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    });
  });

  describe('the app bar', () => {
    it('draws the initial from the name, with no request', async () => {
      const { fixture } = await render({ username: 'Ines' });

      expect(
        fixture.nativeElement.querySelector('lib-app-bar .avatar')?.textContent
      ).toContain('I');
    });
  });

  /**
   * The app row, in its four forms (plan 0033, section 4.2 and section 8).
   *
   * The label is the **answer** rather than an invitation, so each form is asserted by
   * the words it puts on the row, which is the whole of what differs between them.
   */
  describe('the app row', () => {
    const STANDALONE = { basePath: '' } as const;

    it('is drawn for everybody, in both modes and for a guest', async () => {
      // A portfolio visitor reading this page is precisely somebody who might want the
      // real thing, and installing has nothing to do with who you are.
      for (const options of [
        {},
        { guest: true },
        { ...STANDALONE },
        { ...STANDALONE, guest: true },
      ]) {
        const { fixture } = await render(options);
        expect(text(fixture)).toContain('account.app.section');
      }
    });

    it('offers the install directly when a prompt is in hand', async () => {
      const { fixture } = await render({ ...STANDALONE, install: 'ready' });

      expect(rowWith(fixture, 'account.app.install')).toBeDefined();
      expect(text(fixture)).not.toContain('account.app.add');
    });

    it('installs from the row itself rather than navigating', async () => {
      // The one row in this app that performs a browser action. A captured prompt's
      // whole value is that it removes the trip.
      const { fixture, install, router } = await render({
        ...STANDALONE,
        install: 'ready',
      });

      (rowWith(fixture, 'account.app.install') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();

      expect(install.prompt).toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('sends somebody with no prompt to the page that has the steps', async () => {
      const { fixture, install, router } = await render({
        ...STANDALONE,
        install: 'manual',
      });

      expect(rowWith(fixture, 'account.app.add')).toBeDefined();

      (rowWith(fixture, 'account.app.add') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();

      expect(install.prompt).not.toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/install');
    });

    it('states that it is installed, and does not draw a control (D7)', async () => {
      // A statement, not a disabled button: a disabled control invites a reader to
      // work out why, and a statement does not.
      const { fixture } = await render({ ...STANDALONE, install: 'installed' });

      const row = rowWith(fixture, 'account.app.installed');
      expect(row).toBeDefined();
      expect(row?.querySelector('button')).toBeNull();
      // The product's own name, from the brand provider, never a literal (rule N1).
      expect(row?.textContent).toContain(TEST_BRAND.name);
    });

    it('says it with a word rather than a colour', async () => {
      // The chip's text is what carries the message; the tone only agrees with it.
      // Same shape `0015` gave the confirmed email (section 7).
      const { fixture } = await render({ ...STANDALONE, install: 'installed' });

      const chip = rowWith(fixture, 'account.app.installed')?.querySelector(
        '.chip'
      );
      expect(chip?.textContent).toContain('account.app.installed');
      expect(chip?.classList).toContain('ok');
    });

    it('points at the app’s own origin when mounted, and never prompts', async () => {
      // Rule I5. Under the portfolio's shell an install installs the portfolio.
      const { fixture, install, opened } = await render({
        basePath: '/velista',
        install: 'ready',
      });

      expect(rowWith(fixture, 'account.app.elsewhere')).toBeDefined();
      expect(text(fixture)).not.toContain('account.app.install');

      (rowWith(fixture, 'account.app.elsewhere') as HTMLElement)
        .querySelector('button')
        ?.click();
      await fixture.whenStable();

      expect(install.prompt).not.toHaveBeenCalled();
      expect(opened).toEqual(['https://velista.app']);
    });

    it('does not offer a link to nowhere when no origin is configured', async () => {
      // The token's default is the empty string, meaning unknown, which is what a
      // server render and a spec get.
      const { fixture, opened } = await render({
        basePath: '/velista',
        standaloneOrigin: '',
      });

      const row = rowWith(fixture, 'account.app.elsewhere');
      expect(row).toBeDefined();
      expect(row?.querySelector('button')).toBeNull();
      expect(opened).toEqual([]);
    });
  });
});
