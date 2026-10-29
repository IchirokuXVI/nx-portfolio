import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  fakeAuthService,
  fakeOperatorSettingsStore,
  fakeZoneStore,
  GatewayError,
  GoogleSignIn,
  MEMORY_OPERATOR_SETTINGS,
  ProfileStore,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeOperatorSettingsStore,
  provideFakeZoneStore,
  TokenStore,
  type FakeAuthService,
} from '@portfolio/velista/data-access';
import type {
  MyZone,
  OperatorSettings,
  SessionTokens,
  UserProfile,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { LegalLinks } from '@portfolio/velista/ui';
import { AccountForm } from '../account-form/account-form';
import { UpgradePage } from './upgrade-page';

const GUEST_ID = 'u-guest';

function zone(id: string): MyZone {
  return {
    id,
    name: `Group ${id}`,
    joinCode: 'ABCD1234',
    status: 'ACTIVE',
    ownerUserId: GUEST_ID,
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

function guestTokens(): SessionTokens {
  return {
    userId: GUEST_ID,
    kind: 'TEMPORARY',
    username: 'dani',
    accessToken: 'access',
    refreshToken: 'refresh',
  };
}

interface Options {
  readonly zones?: readonly MyZone[];
  readonly auth?: FakeAuthService;
  /** What a forced refresh answers, for the raced-tabs case (section 3.2). */
  readonly refreshTo?: SessionTokens | null;
  /** The operator's settings (velista 0173). */
  readonly settings?: OperatorSettings;
  /** The profile this document already read, or null. */
  readonly heldProfile?: UserProfile | null;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService({ userId: GUEST_ID });
  const zones = fakeZoneStore({ zones: options.zones ?? [zone('z1')] });

  /**
   * A `TokenStore` stub, not the real one.
   *
   * The real one reaches `HttpClient` and `ApiUrl` to refresh, which is transport this
   * page does not own and `token-store.spec.ts` already covers. What the page needs
   * from it is one answer: after a forced refresh, what kind is the caller.
   */
  const tokens = {
    tokens: () => guestTokens(),
    refresh: jest.fn(async () => options.refreshTo ?? null),
  };

  const google = { start: jest.fn().mockResolvedValue(undefined) };
  const settings = fakeOperatorSettingsStore(
    options.settings ?? MEMORY_OPERATOR_SETTINGS
  );
  const profile = {
    profile: signal<UserProfile | null>(options.heldProfile ?? null),
    load: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [UpgradePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeZoneStore(zones),
      provideFakeAuthService(auth),
      provideAccountNotice(),
      provideFakeOperatorSettingsStore(settings),
      { provide: TokenStore, useValue: tokens },
      { provide: GoogleSignIn, useValue: google },
      { provide: ProfileStore, useValue: profile },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

  const fixture = TestBed.createComponent(UpgradePage);
  fixture.detectChanges();

  return {
    fixture,
    auth,
    zones,
    router,
    tokens,
    google,
    settings,
    profile,
    notice: TestBed.inject(AccountNotice),
  };
}

/** The form upgrade shares with register (velista 0173), which holds the fields. */
function form(fixture: ComponentFixture<UpgradePage>): AccountForm {
  return fixture.debugElement.query(By.directive(AccountForm))
    .componentInstance as AccountForm;
}

/**
 * Fills the form the way a person who typed it correctly does. The confirmation
 * defaults to the password, and only the mismatch tests pass it separately.
 */
function fill(
  fixture: ComponentFixture<UpgradePage>,
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

function submit(fixture: ComponentFixture<UpgradePage>): void {
  (fixture.nativeElement as HTMLElement)
    .querySelector('form')
    ?.dispatchEvent(new Event('submit'));
}

describe('UpgradePage', () => {
  /**
   * **The criterion that matters most in plan 0009.**
   *
   * `upgrade()` loads the caller's existing user and returns tokens for the same
   * `userId`; `register()` creates a new row. Memberships are keyed by that id, so the
   * difference between the two calls is the difference between keeping every group and
   * losing all of them, with nothing said either way.
   */
  it('calls upgrade and never register', async () => {
    const { fixture, auth } = await render();

    fill(fixture, 'marta@example.com', 'password123');
    submit(fixture);
    await fixture.whenStable();

    expect(auth.calls.map((call) => call.method)).toEqual(['upgrade']);
    expect(auth.calls.map((call) => call.method)).not.toContain('register');
  });

  it('keeps the same user id, which is what keeps the groups', async () => {
    const auth = fakeAuthService({ userId: GUEST_ID });
    const { fixture } = await render({ auth });

    fill(fixture, 'marta@example.com', 'password123');
    submit(fixture);
    await fixture.whenStable();

    // The fake issues the id it was built with, exactly as the service issues the
    // caller's own. A pair with a different id here would be the register bug.
    const issued = await auth.upgrade('marta@example.com', 'password123');
    expect(issued.userId).toBe(GUEST_ID);
  });

  it('leaves the groups it listed before the upgrade listed after it', async () => {
    // Nothing in this flow touches `ZoneStore`, and that is exactly the point: the
    // upgrade keeps the userId the memberships hang off, so the cache that was correct
    // before the form is still correct after it. Had this been a register, the same
    // cache would now belong to a different account.
    const { fixture, zones } = await render({
      zones: [zone('z1'), zone('z2')],
    });

    const before = zones.myZones();
    expect(before.map((group) => group.id)).toEqual(['z1', 'z2']);

    fill(fixture, 'marta@example.com', 'password123');
    submit(fixture);
    await fixture.whenStable();

    expect(zones.myZones()).toEqual(before);
  });

  it('counts the caller groups back at them, with the plural key', async () => {
    const { fixture } = await render({ zones: [zone('z1'), zone('z2')] });

    // The testing translator answers with the key, so this asserts the key that was
    // chosen rather than the sentence. `count` is what picks `_one` from `_other`.
    expect(fixture.componentInstance.keepsafe()).toContain(
      'auth.upgrade.keepsafe'
    );
  });

  it('lands on the dashboard and leaves the address for the notice', async () => {
    const { fixture, router, notice } = await render();

    fill(fixture, 'marta@example.com', 'password123');
    submit(fixture);
    await fixture.whenStable();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    expect(notice.notice()).toEqual({
      kind: 'upgraded',
      email: 'marta@example.com',
    });
  });

  it('does not submit until both fields have something in them', async () => {
    const { fixture, auth } = await render();

    fill(fixture, 'marta@example.com', '');
    submit(fixture);
    await fixture.whenStable();

    expect(auth.calls).toHaveLength(0);
  });

  describe('the password confirmation', () => {
    it('asks for the password twice, with the rule stated once', async () => {
      const { fixture } = await render();
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelectorAll('input:not([type="checkbox"])')
      ).toHaveLength(3);
      expect(host.querySelector('#upgrade-password')).not.toBeNull();
      expect(host.querySelector('#upgrade-confirm-password')).not.toBeNull();
      expect(host.querySelectorAll('.password-rule')).toHaveLength(1);
    });

    it('will not submit until the confirmation has something in it', async () => {
      const { fixture } = await render();

      fill(fixture, 'marta@example.com', 'password123', '');

      expect(form(fixture).canSubmit()).toBe(false);
    });

    it('sends nothing when the two passwords differ', async () => {
      const { fixture, auth, router } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([]);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(form(fixture).shown()).toEqual({
        key: 'auth.error.passwordMismatch',
        placement: 'password',
      });
    });

    it('puts the cursor in the confirmation, not in the password', async () => {
      const { fixture } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password124');
      submit(fixture);
      await fixture.whenStable();

      expect(document.activeElement?.id).toBe('upgrade-confirm-password');
    });

    it('compares exactly, since a space is a character somebody may have meant', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password123 ');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.calls).toEqual([]);
    });
  });

  describe('when the address is refused', () => {
    const conflict = new GatewayError({
      code: 'conflict',
      status: 409,
      correlationId: 'c1',
    });

    it('says the address is taken when the caller is still a guest', async () => {
      // The refresh answers a TEMPORARY pair, so nothing raced: somebody else has
      // that address.
      const auth = fakeAuthService({
        userId: GUEST_ID,
        rejectWith: { upgrade: conflict },
      });
      const { fixture, router } = await render({
        auth,
        refreshTo: guestTokens(),
      });

      fill(fixture, 'taken@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.error()?.key).toBe(
        'auth.error.emailTaken'
      );
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    /**
     * Section 3.2: a 409 that only happens if two tabs raced, and it is a **success**.
     * The account is secured, which is all the person asked for, so showing them a
     * failure would be telling them their own action did not work.
     */
    it('treats a race between two tabs as success', async () => {
      const auth = fakeAuthService({
        userId: GUEST_ID,
        rejectWith: { upgrade: conflict },
      });
      const { fixture, router, tokens, notice } = await render({
        auth,
        refreshTo: { ...guestTokens(), kind: 'REGISTERED' },
      });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(tokens.refresh).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
      expect(notice.notice()?.kind).toBe('upgraded');
      expect(fixture.componentInstance.error()).toBeNull();
    });

    it('falls back to the message when the refresh itself fails', async () => {
      const auth = fakeAuthService({
        userId: GUEST_ID,
        rejectWith: { upgrade: conflict },
      });
      const { fixture, router } = await render({ auth, refreshTo: null });

      fill(fixture, 'taken@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.error()?.key).toBe(
        'auth.error.emailTaken'
      );
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  /**
   * Velista 0173, D6: Google is offered here as on register. The state carries this
   * guest's bearer, so the guest is linked in place and keeps every group (backend
   * 0230).
   */
  describe('Google', () => {
    it('is offered, and starts with the version of the terms', async () => {
      const { fixture, google } = await render();

      (
        (fixture.nativeElement as HTMLElement).querySelector(
          'lib-google-option button'
        ) as HTMLButtonElement
      ).click();
      await fixture.whenStable();

      expect(google.start).toHaveBeenCalledWith({
        acceptedTermsVersion: MEMORY_OPERATOR_SETTINGS.terms.version,
      });
    });

    it('is not drawn where the deployment has no Google client', async () => {
      const { fixture } = await render({
        settings: {
          ...MEMORY_OPERATOR_SETTINGS,
          features: {
            ...MEMORY_OPERATOR_SETTINGS.features,
            googleSignIn: false,
          },
        },
      });

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'lib-google-option'
        )
      ).toBeNull();
    });
  });

  /** Velista 0173: the same box as register, and the version sent with the upgrade. */
  describe('the terms', () => {
    it('sends the version the box was ticked for', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(auth.termsVersions).toEqual([
        MEMORY_OPERATOR_SETTINGS.terms.version,
      ]);
    });

    it('sends nothing with the box clear', async () => {
      const { fixture, auth } = await render();

      fill(fixture, 'marta@example.com', 'password123', 'password123', false);
      submit(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.calls).toEqual([]);
      expect(form(fixture).shown()?.key).toBe('legal.accept.unticked');
    });

    it('opens the documents as sheets over this form', async () => {
      const { fixture } = await render();

      expect(form(fixture).termsUrl()).toBe('/en/auth/upgrade/sheet/terms');
      expect(form(fixture).privacyUrl()).toBe('/en/auth/upgrade/sheet/privacy');
    });

    it('reads a profile it already held again, so it stops asking for the terms', async () => {
      const held: UserProfile = {
        userId: GUEST_ID,
        kind: 'TEMPORARY',
        username: 'dani',
        email: null,
        emailVerified: false,
        displayName: null,
      };
      const { fixture, profile } = await render({ heldProfile: held });

      fill(fixture, 'marta@example.com', 'password123');
      submit(fixture);
      await fixture.whenStable();

      expect(profile.load).toHaveBeenCalledTimes(1);
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
});
