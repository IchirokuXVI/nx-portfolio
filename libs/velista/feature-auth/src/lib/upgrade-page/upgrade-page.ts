import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  GoogleSignIn,
  ProfileStore,
  TokenStore,
  ZoneStore,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import { AuthScreen, LegalLinks, SuccessNote } from '@portfolio/velista/ui';
import {
  AccountForm,
  type AccountFormValue,
} from '../account-form/account-form';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';
import { authTerms } from '../auth-terms';

/**
 * Turning the guest account somebody already has into one they cannot lose.
 *
 * **This is the screen plan 0009 exists for**, and the one that is easiest to get
 * wrong: the obvious screen for this person is register, and picking it would silently
 * strand everything they have made.
 *
 * ## Rule C2, and what it costs to get wrong
 *
 * `upgrade()` loads the caller's existing user, refuses unless its kind is `TEMPORARY`,
 * attaches the email and password hash, flips the kind to `REGISTERED`, and returns
 * tokens for **the same userId**. Memberships are keyed by that id, so upgrade keeps
 * every group and register keeps none of them. `guestOnlyGuard` is what keeps everybody
 * else off this route, and `anonymousOnlyGuard` keeps a guest off register; both are
 * properties of the route table, where they can be tested (section 4.2).
 *
 * ## Why it counts the groups back at them
 *
 * "Your 2 groups stay exactly where they are" is the reason to spend thirty seconds on
 * a form, and the count is already in `ZoneStore`. The screen leans on the risk rather
 * than hiding it, because the alternative is a form with no visible reason to fill it
 * in.
 *
 * ## Google, and the terms
 *
 * Google is offered here as on register (velista `0173`, D6): the state is minted with
 * this guest's bearer, so `googleLogin` converts the guest in place and every group
 * stays (backend `0230`). The form, the checkbox and the Google option are
 * `AccountForm`, shared with register.
 */
@Component({
  selector: 'lib-upgrade-page',
  imports: [
    RokuTranslatorPipe,
    AccountForm,
    AuthScreen,
    LegalLinks,
    RouterOutlet,
    SuccessNote,
  ],
  templateUrl: './upgrade-page.html',
  styleUrl: './upgrade-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpgradePage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _zones = inject(ZoneStore);
  private readonly _tokens = inject(TokenStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _google = inject(GoogleSignIn);
  private readonly _notice = inject(AccountNotice);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Where the two legal links at the foot of the screen go (velista `0172`). */
  readonly legalUrls = computed(() => ({
    privacy: appPath(this._locale(), this._basePath, 'privacy'),
    terms: appPath(this._locale(), this._basePath, 'terms'),
  }));
  private readonly _t = inject(RokuTranslatorService);
  private readonly _form = viewChild(AccountForm);

  /** The terms over this form, Google, and the version a press accepts (velista `0173`). */
  readonly terms = authTerms(['auth', 'upgrade']);

  readonly submitting = signal(false);
  readonly error = signal<AuthErrorCopy | null>(null);

  /** See `SignInPage.googleStarting`. */
  readonly googleStarting = signal(false);

  /** See `SignInPage.googleError`. */
  readonly googleError = signal<AuthErrorCopy | null>(null);

  /**
   * The promise, with their own number in it.
   *
   * Translated from the `.ts` rather than the template because it is one string handed
   * to `SuccessNote` as an input, so `RokuTranslatorService.t()` is the tool. The
   * locale is read first as a dependency, not as a statement: without it the sentence
   * keeps the previous language after a switch.
   *
   * Plural through `count`, which the Angular wrapper only learned to pass after the
   * fix in rokutranslator `0004` (plan 0006). Spanish agreement is handled by writing
   * the whole phrase per form, per plan 0001.
   */
  readonly keepsafe = computed(() => {
    this._locale();
    // `t(key, ns, locale, values)`: the namespace and the locale are left to the
    // service's own defaults, which is what every other caller in the app relies on.
    return this._t.t('auth.upgrade.keepsafe', undefined, undefined, {
      count: this._zones.myZones().length,
    });
  });

  /**
   * The form passed its own checks: secure the account. The version sent is the one
   * the settings name at this press (velista `0173`).
   */
  async submit(value: AccountFormValue): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set(null);

    try {
      await this._auth.upgrade(
        value.email,
        value.password,
        this.terms.version()
      );
      await this._finish(value.email);
    } catch (error) {
      if (await this._alreadyRegistered(error)) {
        await this._finish(value.email);
        return;
      }

      this.submitting.set(false);
      const copy = authErrorCopy(error, 'auth.upgrade');
      this.error.set(copy);
      if (copy.placement === 'terms') {
        this.terms.reload();
      } else {
        this._form()?.focusFirst();
      }
    }
  }

  /**
   * Continue with Google, linking this guest in place (backend `0230`). The same as
   * `RegisterPage.continueWithGoogle`.
   */
  async continueWithGoogle(): Promise<void> {
    if (this.googleStarting()) {
      return;
    }

    this.googleStarting.set(true);
    this.googleError.set(null);

    try {
      await this._google.start({ acceptedTermsVersion: this.terms.version() });
    } catch (error) {
      this.googleStarting.set(false);
      const copy = authErrorCopy(error, 'auth.google');
      if (copy.placement === 'terms') {
        this.terms.reload();
      }
      this.googleError.set(copy);
    }
  }

  /**
   * Not now. Back to the screen that offered this, which is the dashboard or the
   * account page, and the banner asks again next session either way.
   */
  back(): void {
    void this._pages.back(appPath(this._locale(), this._basePath, 'home'));
  }

  /**
   * A `conflict` that turns out to be this same person, already upgraded.
   *
   * The gateway answers one code for two different things here: the address belongs to
   * somebody else, or the caller is already registered. The second only happens if two
   * tabs raced, and it is a **success** rather than a failure: the account is secured,
   * which is all the person asked for (section 3.2).
   *
   * The two cannot be told apart from the response, so they are told apart from the
   * session. Refreshing the pair is what reloads it, and a caller who comes back
   * `REGISTERED` is the race rather than a taken address. Anything else, including a
   * refresh that fails, falls through to the ordinary message.
   */
  private async _alreadyRegistered(error: unknown): Promise<boolean> {
    if (authErrorCopy(error, 'auth.upgrade').key !== 'auth.error.emailTaken') {
      return false;
    }

    const refreshed = await this._tokens.refresh();
    return refreshed?.kind === 'REGISTERED';
  }

  /**
   * The one way out of this screen, however it was reached.
   *
   * A profile this document already read is read again: the upgrade changed the
   * account's kind and its address, and the one held still names a guest with no
   * address. The read also brings the acceptance the upgrade recorded (velista `0173`).
   */
  private async _finish(email: string): Promise<void> {
    this._notice.set('upgraded', email);
    if (this._profile.profile() !== null) {
      void this._profile.load();
    }
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home')
    );
  }
}
