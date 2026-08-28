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
import { appPath } from '@portfolio/velista/platform';
import {
  AccountLostPanel,
  AlertIcon,
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

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const outcome = await this._zones.joinZone(this.code);

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
