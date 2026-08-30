import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AUTH_SERVICE,
  ProfileStore,
  SessionStore,
  TokenStore,
  VERIFY_RESEND_AVAILABLE,
  ZoneStore,
  type AuthServiceI,
  type ResendOutcome,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  APP_BRAND,
  APP_STANDALONE_ORIGIN,
  type AccountVm,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  InstallStore,
} from '@portfolio/velista/platform';
import {
  AccountRow,
  AppBar,
  AppVersion,
  ChevronLeftIcon,
  ResendSentence,
  SectionHeading,
  type ResendState,
} from '@portfolio/velista/ui';
import {
  accountCorrelationId,
  accountFailure,
  asClock,
} from '../account-error-copy';
import { RenameAnnouncement } from '../rename-announcement';

/**
 * Your name, your email, and the two ways out (plan 0015).
 *
 * The last screen in the route table that is about the person rather than about a
 * group, and the one that finally makes three things possible: signing out, changing
 * your own name, and leaving.
 *
 * ## The name never loads
 *
 * `SessionStore.username` is derived from the token pair, which is already in memory,
 * so the heading and the app bar's initial are correct on the first frame. The one
 * request this screen makes is for the **email**, which is the one fact the app
 * genuinely does not have, and it is the only thing here that skeletons (section 3.1).
 *
 * ## The guest gets a different screen, not this one with rows disabled
 *
 * **Rule A1: sign out is rendered only for a `REGISTERED` identity.** For a registered
 * user it drops a pair that can be minted again by signing in. For a guest it is
 * irreversible destruction of the account, and it is worse than delete because it looks
 * harmless: the refresh token is the only proof of their identity, no server call
 * recovers it, and the groups go on existing owned by somebody no screen can reach.
 *
 * So the app would be offering two controls with the same outcome, one of which reads
 * as routine. The fix is not a warning, it is not drawing it, and what the guest gets
 * instead is the upgrade, which is the actual way off this phone, and delete, which is
 * honest about being the other one.
 *
 * A template branch rather than a guard, which is a deliberate departure from rule C1
 * (`0009`). There, the wrong screen silently strands every group a person has, so it
 * had to be unreachable. Here the wrong branch is a screen with rows that do not apply,
 * and splitting the route would give two URLs for one thing somebody reaches by
 * pressing one button. Guards are for the ones that cost something.
 *
 * ## Sign out is client only
 *
 * There is no logout endpoint at all (section 5.5), so it is `TokenStore.clear()` plus a
 * navigation. The refresh token stays live on the server until it expires, which is
 * harmless on the device doing it and means the copy must not claim anything about
 * other devices. It does not.
 */
@Component({
  selector: 'lib-account-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AccountRow,
    AppBar,
    AppVersion,
    ChevronLeftIcon,
    ResendSentence,
    SectionHeading,
  ],
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPage {
  private readonly _session = inject(SessionStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _tokens = inject(TokenStore);
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _announcement = inject(RenameAnnouncement);
  private readonly _install = inject(InstallStore);
  private readonly _browser = inject(BrowserFacade);
  private readonly _brand = inject(APP_BRAND);
  private readonly _standaloneOrigin = inject(APP_STANDALONE_ORIGIN);

  /** Whether the resend sentence may be drawn at all. See `VERIFY_RESEND_AVAILABLE`. */
  readonly resendAvailable = VERIFY_RESEND_AVAILABLE;

  /** How the last ask for another confirmation went, for the resend sentence. */
  readonly resendState = signal<ResendState>('ready');
  readonly resendWait = signal<number | null>(null);

  /**
   * How asking for a password reset link went, or null before anything was asked.
   *
   * Sent says a link is on its way **without claiming delivery**, because the endpoint
   * answers the same for an address with a password, one with none and one that signs
   * in with Google (section 5.6). Refused renders the server's own wait.
   *
   * `failed` is deliberately not part of this type. A transport failure is not something
   * this row has copy for; it goes to {@link failure} with the correlation id, where
   * every other failure on this screen goes.
   */
  readonly resetOutcome = signal<Exclude<
    ResendOutcome,
    { state: 'failed' }
  > | null>(null);

  /** A failure's copy, and the number it interpolates. Null when nothing failed. */
  readonly failure = signal<{ key: string; wait: string } | null>(null);

  /** The support reference beside a generic failure, when there is one. */
  readonly correlationId = signal<string | null>(null);

  /** True while the delete is out. The whole screen goes `aria-busy` (section 3.1). */
  readonly busy = signal(false);

  /**
   * What the screen is, in one object.
   *
   * The two members of the union are two screens, not one with flags: see the class
   * comment, and `AccountVm`'s own.
   */
  readonly state = computed<AccountVm>(() => {
    const name = this._session.username() ?? '';

    if (this._session.isGuest()) {
      return {
        kind: 'guest',
        name,
        // From the cache, and never a request: the same number `0009` put on the
        // upgrade screen, so the two agree about what is at stake.
        zoneCount: this._zones.myZones().length,
      };
    }

    const profile = this._profile.profile();
    const state = this._profile.state();

    return {
      kind: 'registered',
      name,
      profile: state,
      // Null while loading and after a failure alike. The row branches on `profile`
      // and never on this, so a null is never rendered as "no email".
      email: state === 'loaded' ? (profile?.email ?? null) : null,
      emailVerified: profile?.emailVerified === true,
    };
  });

  /** The product's own name, for the row that reports it is installed (rule N1). */
  readonly productName = this._brand.name;

  /** The app's own address without its scheme, which is how a person says it. */
  readonly originLabel = this._standaloneOrigin.replace(/^https?:\/\//, '');

  /**
   * Which of the four forms the app row takes (plan 0033, section 4.2).
   *
   * `elsewhere` is the mounted mode and beats everything, because under the portfolio's
   * shell installing installs the **portfolio** (D5, rule I5). The other three are the
   * store's own state, and the row is drawn for everybody in every mode: a portfolio
   * visitor reading velista's account page is precisely somebody who might want the
   * real thing.
   */
  readonly appRow = computed<'elsewhere' | 'ready' | 'manual' | 'installed'>(
    () => (this._basePath === '' ? this._install.state() : 'elsewhere')
  );

  /** The letter in the app bar, which changes the moment a rename lands (rule A2). */
  readonly accountInitial = computed(() => {
    const username = this._session.username();
    return username === null ? null : initialOf(username);
  });

  /** The name just saved, for the live region. Read once and cleared. */
  readonly announced = this._announcement.name;

  constructor() {
    // The screen's one request, and only for somebody who has an email to read.
    //
    // A guest's profile carries a null email and a name this screen already has, so
    // fetching it would spend a round trip on an answer nothing renders. Not an
    // `effect`: identity does not change under a mounted account screen, and a signing
    // out user leaves this route rather than watching it re-fetch.
    if (!this._session.isGuest()) {
      void this._profile.load();
    }

    // The group counts, for the guest's upgrade card and for the delete sheet's
    // consequence sentence. Only when nothing has been loaded yet, which is a cold
    // deep link: arriving from the dashboard the cache is already warm and this makes
    // no request, which is what "counted from the cache" means (section 5.7).
    if (this._zones.state() === 'idle') {
      void this._zones.load();
    }

    // The announcement outlives this component, because `RenameAnnouncement` is root
    // scoped, so leaving and coming back would announce a rename from the last visit.
    // Cleared here rather than by whatever reads it: a live region has no way to tell
    // its container that a screen reader got to it.
    inject(DestroyRef).onDestroy(() => this._announcement.clear());
  }

  /** Back to the dashboard, which is where this screen is opened from. */
  async back(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home')
    );
  }

  /** The assistant (plan 0032), which is the one app bar button that works from here. */
  async openAssistant(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'assistant')
    );
  }

  /**
   * The app row's action, which is one of three things depending on the form.
   *
   * `ready` is the one row in this app that performs a **browser action** instead of
   * navigating, and it is worth the exception: the whole value of a captured prompt is
   * that it removes the trip. Pressing it and dismissing the dialog leaves the row
   * exactly as it was, and the state falls back to `manual` if the event is not
   * re-fired, which changes the label to the one that navigates. Nothing is stuck.
   *
   * `prompt()` is called with nothing awaited before it, because it needs the transient
   * user activation this press just granted (D6).
   */
  async openApp(): Promise<void> {
    const form = this.appRow();

    if (form === 'ready') {
      await this._install.prompt();
      return;
    }

    if (form === 'elsewhere') {
      if (this._standaloneOrigin !== '') {
        this._browser.openExternal(this._standaloneOrigin);
      }
      return;
    }

    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'install')
    );
  }

  /** The two sheets, as children of this route (rule E1). */
  openRename(): void {
    void this._router.navigate(['name'], { relativeTo: this._route });
  }

  openDelete(): void {
    void this._router.navigate(['confirm', 'delete'], {
      relativeTo: this._route,
    });
  }

  /**
   * Securing a guest account.
   *
   * **`auth/upgrade` and never `auth/register`**, which is rule C2 (`0009`) holding on
   * a second screen: register creates a new user row, so a guest who followed it would
   * fill in a valid form and lose every group to an account whose only credential was
   * the token that call replaced.
   */
  secureAccount(): void {
    void this._router.navigate(['..', 'auth', 'upgrade'], {
      relativeTo: this._route,
    });
  }

  /**
   * Sign out. Rendered only for a `REGISTERED` identity (rule A1).
   *
   * `ProfileStore` is cleared alongside the pair, and it has to be: it holds an email
   * address and a name, and leaving them behind would let the next screen render the
   * previous person's details to whoever picks the phone up.
   */
  async signOut(): Promise<void> {
    this._tokens.clear();
    this._profile.clear();
    await this._toFrontDoor();
  }

  /**
   * Ask for a password reset link, with the profile's own address.
   *
   * There is no authenticated change password route in this product: no current
   * password field anywhere, because nothing consumes one (section 5.6). What exists is
   * `forgot-password` and `reset-password`, and this row drives the first.
   */
  async changePassword(): Promise<void> {
    const email = this._emailOrNull();
    if (email === null || this.busy()) {
      return;
    }

    this.failure.set(null);
    this.resetOutcome.set(null);

    const outcome = await this._auth.forgotPassword(email);
    if (outcome.state === 'failed') {
      this._reportFailure(outcome.error, 'auth.forgotPassword');
      return;
    }

    this.resetOutcome.set(outcome);
  }

  /** Another confirmation email. Only reachable while `resendAvailable` is true. */
  async resend(): Promise<void> {
    const outcome = await this._auth.resendVerification();
    if (outcome.state === 'failed') {
      this.resendState.set('ready');
      return;
    }

    this.resendState.set(outcome.state);
    this.resendWait.set(outcome.waitSeconds);
  }

  /** The retry on a failed profile read. The screen stays up either way. */
  retryProfile(): void {
    void this._profile.load();
  }

  /**
   * A wait in seconds as `m:ss`, or the empty string when the server named none.
   *
   * An empty string is deliberate rather than a fallback duration: rule C3 has no
   * invented number to reach for, and a countdown from one would run out, invite the
   * tap, and fail again.
   */
  waitClock(seconds: number | null): string {
    return seconds === null ? '' : asClock(seconds);
  }

  /** The address the password row acts on, or null when there is none to act on. */
  private _emailOrNull(): string | null {
    const current = this.state();
    return current.kind === 'registered' ? current.email : null;
  }

  /**
   * Report a failure, and end the session when the failure says the caller is gone.
   *
   * `not_found` here cannot mean "you asked for somebody who does not exist": every
   * route resolves the caller from their own token. It can only mean the caller
   * themselves is gone, so a retry would retry forever and the session is over
   * (section 5.9).
   */
  private _reportFailure(
    error: unknown,
    operation: 'auth.forgotPassword'
  ): void {
    const failure = accountFailure(error, operation);
    this.correlationId.set(accountCorrelationId(error));
    this.failure.set({
      key: failure.key,
      wait: failure.waitSeconds === null ? '' : asClock(failure.waitSeconds),
    });

    if (failure.endSession) {
      this._tokens.clear();
      this._profile.clear();
      void this._toFrontDoor();
    }
  }

  private async _toFrontDoor(): Promise<void> {
    await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
  }
}

/**
 * The letter in the account button.
 *
 * Code points rather than a slice, because slicing cuts a surrogate pair in half and a
 * name that starts with an emoji would render the replacement character.
 */
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed === ''
    ? ''
    : (Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
}
