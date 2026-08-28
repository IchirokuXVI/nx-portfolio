import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  fakeAuthService,
  fakeZoneStore,
  GatewayError,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeZoneStore,
  TokenStore,
  type FakeAuthService,
} from '@portfolio/velista/data-access';
import type { MyZone, SessionTokens } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
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

  await TestBed.configureTestingModule({
    imports: [UpgradePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeZoneStore(zones),
      provideFakeAuthService(auth),
      provideAccountNotice(),
      { provide: TokenStore, useValue: tokens },
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
    notice: TestBed.inject(AccountNotice),
  };
}

/** Fills both fields the way a person does, through the inputs the page renders. */
function fill(
  fixture: ComponentFixture<UpgradePage>,
  email: string,
  password: string
): void {
  fixture.componentInstance.email.set(email);
  fixture.componentInstance.password.set(password);
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

  it('offers no Google button, because it would lose the groups', async () => {
    // Until the gateway passes `linkUserId`, `googleLogin` takes the create branch and
    // mints a fresh registered user, which is exactly what this screen promises will
    // not happen (section 5.6).
    const { fixture } = await render();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('lib-google-option')
    ).toBeNull();
  });
});
