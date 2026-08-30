import {
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
  SessionStore,
  TokenStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, InstallStore } from '@portfolio/velista/platform';
import {
  AccountLostPanel,
  AlertIcon,
  AppVersion,
  BrandWordmark,
  InfoIcon,
  isCompleteJoinCode,
  MemberAddIcon,
  normalizeJoinCode,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { entryErrorKey } from '../entry-error-copy';

/**
 * Arriving on somebody else's invite link.
 *
 * **Deliberately not a sheet.** A sheet covers a page the person was already on, and
 * there is nothing underneath this one: they came from a message in another app. A
 * sheet over an empty backdrop is a modal pretending to have context it does not have
 * (plan 0008, section 4.1).
 *
 * Everything else is the join sheet: the same call, the same rule D3 gate, the same
 * message set, rendered under the code card because there is no field to put it under.
 * And the same silence about whose group it is, for the same reason: no endpoint turns
 * a code into a name.
 */
@Component({
  selector: 'lib-join-link-page',
  imports: [
    RokuTranslatorPipe,
    AccountLostPanel,
    AlertIcon,
    AppVersion,
    BrandWordmark,
    InfoIcon,
    MemberAddIcon,
    SpinnerIcon,
  ],
  templateUrl: './join-link-page.html',
  styleUrl: './join-link-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinLinkPage {
  private readonly _zones = inject(ZoneStore);
  private readonly _session = inject(SessionStore);
  private readonly _tokens = inject(TokenStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _install = inject(InstallStore);

  /**
   * The code out of the URL, put through the same filter the field uses.
   *
   * A link is typed out by hand often enough to be worth it, and a lower case or
   * spaced code in a URL should behave exactly as one typed into the sheet rather than
   * producing a 404 with no explanation.
   */
  readonly code = normalizeJoinCode(
    this._route.snapshot.paramMap.get('code') ?? ''
  );

  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly accountLost = signal(false);

  /** A link with no usable code in it. Nothing to send, so nothing is offered. */
  readonly usable = isCompleteJoinCode(this.code);

  readonly canSubmit = computed(() => this.usable && !this.submitting());

  /** Whether asking also makes an account, which the notice below says out loud. */
  readonly mintingAccount = computed(() => !this._session.isAuthenticated());

  /**
   * Whether to offer install and join as one press (plan 0033 D6).
   *
   * Two conditions, and both are necessary. A prompt has to be in hand, because there
   * is no way to summon one and a button that opens nothing is worse than no button.
   * And this has to be velista's **own** origin, because under the portfolio's shell an
   * install installs the portfolio, and somebody halfway through joining a group should
   * not be sent to another origin to find out (D5, rule I5).
   *
   * Anything else renders exactly what shipped before this plan: one primary, and no
   * tutorial. Somebody who wants the app finds it on the account page a minute later.
   */
  readonly canInstall = computed(
    () => this._basePath === '' && this._install.state() === 'ready'
  );

  /**
   * Install and join, in that order, without waiting between them.
   *
   * **The order is forced by the platform.** `prompt()` requires transient user
   * activation and awaiting a network round trip first spends it, so the call is the
   * first statement of this method with no `await` before it, and the join is started in
   * the same tick. The two then proceed together.
   *
   * `await prompting` before the navigation is the part worth keeping: navigating out
   * from under an open install dialog is at best untidy and at worst dismisses it, and
   * the join is in flight throughout, so the wait costs nothing.
   *
   * A dismissed install is not a failed join, and a failed join is not a failed install.
   * Neither outcome is reported here beyond what `_settle` already does with the join's
   * own message set, on a screen that is still there.
   */
  async installAndJoin(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const prompting = this._install.prompt();
    const joining = this._zones.joinZone(this.code);

    await prompting;
    await this._settle(await joining);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    await this._settle(await this._zones.joinZone(this.code));
  }

  /**
   * What to do with the join's answer, which is the same whether an install dialog was
   * open beside it or not. One copy, so the two entry points cannot drift.
   */
  private async _settle(
    outcome: Awaited<ReturnType<ZoneStore['joinZone']>>
  ): Promise<void> {
    if (outcome.state === 'joined') {
      await this._router.navigateByUrl(
        appPath(this._locale(), this._basePath, 'home')
      );
      return;
    }

    this.submitting.set(false);

    if (outcome.state === 'guest-account-lost') {
      this.accountLost.set(true);
      return;
    }

    if (outcome.state === 'failed') {
      this.errorKey.set(entryErrorKey(outcome.error, 'zones.join'));
    }
  }

  /** Not now. The front door, which is where somebody with no account belongs. */
  async decline(): Promise<void> {
    await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
  }

  async restart(): Promise<void> {
    this._tokens.clear();
    await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
  }
}
