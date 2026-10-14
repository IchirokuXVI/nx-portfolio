import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  PendingRecoveryLink,
  ProfileStore,
  SessionStore,
  ZoneStore,
  type AuthServiceI,
  type RecoveryOutcome,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  PageNavigation,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  AuthScreen,
  FormError,
  OutcomeScreen,
  PasswordField,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';
import { RECOVERY_LINK_SHEET } from '../recovery-link-sheet/recovery-link-sheet';

/** The id the message carries, and the id the field is described by. */
const ERROR_ID = 'reset-password-error';

/** Which link of the mail opened the page. The token is the same in both. */
export type ResetMode = 'reset' | 'sign-in';

/**
 * What the page shows.
 *
 * - `working`: the spinner of the confirmation link page, while the sign in link is
 *   spent. Nothing else (the owner's pick 2).
 * - `form`: the new password, with the way to keep the old one (design C).
 * - `confirm`: somebody is signed in on this phone, and a reset asks first.
 * - `dead`: used, expired, unknown, or refused inside a support session.
 * - `failed`: the sign in link could not be sent at all. The link is not spent.
 */
export type ResetView = 'working' | 'form' | 'confirm' | 'dead' | 'failed';

/** Which confirm before a reset, by who is signed in on this phone. */
export type ConfirmKind = 'held' | 'guest';

/**
 * A reset link from the mail, in either of its two forms (velista `0148`, backend
 * `0210`).
 *
 * ## One page, two modes, one token
 *
 * The mail carries a reset link and a sign in link that share one token, and spending
 * either ends both. The reset link opens the form. The sign in link
 * (`&mode=sign-in`) has no screen: it is spent as the page loads and lands on home.
 *
 * ## The reset link spends nothing on load
 *
 * Mail scanners open links. Every action of the reset mode is a button press. The sign
 * in mode spends on load by the owner's pick of 2026-10-14, who accepted that a scanner
 * which runs scripts can spend it first. It does so once per page instance.
 *
 * ## The token leaves the URL
 *
 * Read once, kept in this component, and the URL is replaced without it, so it is not
 * left in the history or sent on as a referrer.
 *
 * ## Somebody else on this phone
 *
 * Both spends replace the session this phone holds.
 *
 * - **A sign in** (either link) that meets another account goes home, and a sheet
 *   there says the person must sign out to use the link (the owner's requirement of
 *   2026-10-14). The page asks the server once, without `switchAccount`: the owner
 *   lands home with no error, and `other-account`, which spends nothing, goes to the
 *   sheet. The token waits in `PendingRecoveryLink`, never in a URL, until the person
 *   presses the sheet's one button.
 * - **A reset** cannot ask the server without spending, so it opens the confirm on
 *   this page first whenever any account is signed in, with words that hold whoever
 *   the link turns out to belong to. A guest sees the guest confirm (rule C2): leaving
 *   a guest account strands its groups.
 */
@Component({
  selector: 'lib-reset-password-page',
  imports: [
    RokuTranslatorPipe,
    AuthScreen,
    FormError,
    OutcomeScreen,
    PasswordField,
    SpinnerIcon,
  ],
  templateUrl: './reset-password-page.html',
  styleUrl: './reset-password-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _notice = inject(AccountNotice);
  private readonly _pending = inject(PendingRecoveryLink);
  private readonly _browser = inject(BrowserFacade);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** The token, held here and nowhere else once the URL has dropped it. */
  private readonly _token: string;

  /** Set once the page navigates away, so the URL clean up never undoes it. */
  private _left = false;

  readonly errorId = ERROR_ID;

  readonly mode: ResetMode;
  readonly view = signal<ResetView>('form');
  readonly password = signal('');

  /** Which button is waiting on the server, or null. */
  readonly busy = signal<'save' | 'keep' | 'continue' | null>(null);

  /** A key and a placement, never a string from the server. */
  readonly error = signal<AuthErrorCopy | null>(null);

  readonly canSave = computed(
    () => this.password() !== '' && this.busy() === null
  );

  readonly signedIn = this._session.isAuthenticated;

  readonly confirmKind = computed<ConfirmKind>(() =>
    this._session.isGuest() ? 'guest' : 'held'
  );

  /** The account on this phone, by both its names (the owner's pick 5). */
  readonly username = this._session.username;

  /** Its address, or null for a guest and until the profile has been read. */
  readonly email = computed(() => {
    const email = this._profile.profile()?.email;
    return email === undefined || email === null || email === '' ? null : email;
  });

  /** The guest's groups, from what the app holds. With none, that sentence goes. */
  readonly groupCount = computed(() => this._zones.myZones().length);

  constructor() {
    const params = this._route.snapshot.queryParamMap;
    this._token = params.get('token') ?? '';
    this.mode = params.get('mode') === 'sign-in' ? 'sign-in' : 'reset';

    if (this._token === '') {
      // To somebody holding a broken link, a missing token and a dead one are the
      // same event, as on the confirmation link page.
      this.view.set('dead');
    } else if (this.mode === 'sign-in') {
      this.view.set('working');
      void this._signIn();
    }

    afterNextRender(() => this._dropTokenFromUrl());
  }

  /** See `SignInPage.onSubmit` for why this is `(submit)` and not `(ngSubmit)`. */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.save();
  }

  /**
   * "Save new password". With an account on this phone, the confirm comes first,
   * because a reset replaces the session too.
   */
  save(): void {
    if (!this.canSave()) {
      return;
    }

    if (this._session.isAuthenticated()) {
      this._openConfirm();
      return;
    }

    void this._reset();
  }

  /** "Keep my password and sign in". Another account on this phone is asked at home. */
  keep(): void {
    if (this.busy() !== null) {
      return;
    }

    void this._signIn();
  }

  /** The confirm's one button: save, and replace the account on this phone. */
  proceed(): void {
    if (this.busy() !== null) {
      return;
    }

    void this._reset();
  }

  /** The failed screen's button. The link was not spent, so it is simply sent again. */
  retry(): void {
    this.view.set('working');
    void this._signIn();
  }

  /**
   * The back chevron. On the confirm of the reset link it returns to the form, which is
   * where the person came from. Everywhere else it is `PageNavigation.back`, with the
   * sign in page as the fallback.
   */
  back(): void {
    if (this.view() === 'confirm' && this.mode === 'reset') {
      this.error.set(null);
      this.view.set('form');
      return;
    }

    this._leave();
    void this._pages.back(this._path('auth', 'login'));
  }

  /** The guest confirm's last paragraph: secure the guest account first (rule C2). */
  upgrade(): void {
    this._leave();
    void this._router.navigateByUrl(this._path('auth', 'upgrade'));
  }

  /** The dead link screen's action, by who is looking. */
  deadAction(): void {
    this._leave();
    void this._router.navigateByUrl(
      this.signedIn()
        ? this._path('home')
        : this._path('auth', 'forgot-password')
    );
  }

  signInWithPassword(): void {
    this._leave();
    void this._router.navigateByUrl(this._path('auth', 'login'));
  }

  private async _signIn(): Promise<void> {
    const fromView = this.view();
    this.busy.set('keep');
    this.error.set(null);

    // One request, with the bearer of this phone when there is one (the owner's
    // decision of 2026-10-14). Never `switchAccount` from this page: the switch is the
    // home sheet's question, and a 409 for another account spends nothing.
    const outcome = await this._auth.recoverySignIn(this._token);
    this.busy.set(null);

    switch (outcome.state) {
      case 'signed-in':
        // Nobody was signed in, so nothing is left behind to forget.
        await this._home();
        return;

      case 'already-signed-in':
        // The owner of the link, already here. No error, even for an old link.
        await this._home();
        return;

      case 'other-account':
        // Nothing was spent. The home sheet asks.
        await this._askAtHome();
        return;

      case 'link-dead':
      case 'refused-in-support':
        // A support session is shown the dead link screen, with no copy of its own
        // (the owner's pick 6).
        this.view.set('dead');
        return;

      case 'password-rejected':
      case 'failed':
        if (fromView === 'working') {
          this.view.set('failed');
          return;
        }

        this.error.set(
          authErrorCopy(
            outcome.state === 'failed' ? outcome.error : null,
            'auth.recoverySignIn'
          )
        );
        return;
    }
  }

  private async _reset(): Promise<void> {
    this.busy.set(this.view() === 'confirm' ? 'continue' : 'save');
    this.error.set(null);

    const before = this._session.userId();
    const outcome = await this._auth.resetPassword(
      this._token,
      this.password()
    );
    this.busy.set(null);

    switch (outcome.state) {
      case 'signed-in':
        // "Password changed. Other devices are signed out", said once on home.
        this._notice.setPasswordChanged();
        await this._home();
        this._startOverIfReplaced(before, outcome);
        return;

      case 'link-dead':
        this.view.set('dead');
        return;

      case 'password-rejected':
        this.view.set('form');
        this.error.set({
          key: 'auth.error.shortPassword',
          placement: 'password',
        });
        return;

      case 'failed':
        this.error.set(authErrorCopy(outcome.error, 'auth.resetPassword'));
        return;
    }
  }

  private _openConfirm(): void {
    this.error.set(null);
    this.view.set('confirm');

    // Both names of the account on this phone are drawn from what the app holds. A
    // cold link opened before anything was read reads it now.
    if (this._session.isGuest()) {
      if (this._zones.myZones().length === 0) {
        void this._zones.load();
      }
    } else if (this._profile.profile() === null) {
      void this._profile.load();
    }
  }

  /**
   * A pair for somebody else replaced the session. The stores of this document still
   * hold the account that left (its groups, its name), so the document starts over at
   * home, where the new pair is already in storage. The notice does not survive that,
   * which is the price of never showing one account's groups to another.
   */
  private _startOverIfReplaced(
    before: string | null,
    outcome: Extract<RecoveryOutcome, { state: 'signed-in' }>
  ): void {
    if (before !== null && before !== outcome.tokens.userId) {
      this._browser.reload();
    }
  }

  /**
   * Another account is on this phone: hold the token in memory and go home, where the
   * sheet asks. A replace, so this page is not one back press away.
   */
  private async _askAtHome(): Promise<void> {
    this._pending.hold(this._token);
    this._leave();
    await this._router.navigateByUrl(
      this._path('home', ...sheetSegments(RECOVERY_LINK_SHEET)),
      { replaceUrl: true }
    );
  }

  private async _home(): Promise<void> {
    this._leave();
    await this._router.navigateByUrl(this._path('home'));
  }

  /**
   * Replace the URL with one that has no token and no mode.
   *
   * After the first render, never from the constructor: a navigation started while the
   * first one is still activating this page would race it. Skipped once the page has
   * already moved on, which a fast sign in can do first.
   */
  private _dropTokenFromUrl(): void {
    const params = this._route.snapshot.queryParamMap;
    if (this._left || (!params.has('token') && !params.has('mode'))) {
      return;
    }

    void this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  private _leave(): void {
    this._left = true;
  }

  private _path(...segments: string[]): string {
    return appPath(this._locale(), this._basePath, ...segments);
  }
}
