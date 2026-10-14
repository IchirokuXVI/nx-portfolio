import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AUTH_SERVICE,
  PendingRecoveryLink,
  ProfileStore,
  SessionStore,
  ZoneStore,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';

/** The subject of the sheet, under home's `sheet` segment. */
export const RECOVERY_LINK_SHEET = 'recovery-link';

/**
 * A sign in link opened while another account is on this phone (velista `0148`, the
 * owner's requirement of 2026-10-14).
 *
 * A sheet over home, because the person is already somewhere in the app: it explains
 * that the link is for another account and that using it means signing this one out.
 * The token is in `PendingRecoveryLink`, in memory, and never in this sheet's URL.
 *
 * **Nothing more is sent until the person decides.** The reset page asked once without
 * `switchAccount`, which spent nothing. The one button retries with it, which signs the
 * account of the link in on this phone. Escape, the scrim and back drop the token here
 * and send nothing, so the link in the mail still works later.
 *
 * A guest gets the guest words (rule C2): the loss said plainly, and a plain link to
 * the upgrade page, which keeps the groups. Never register.
 *
 * A reload of this URL finds no token, because memory does not survive one, and the
 * sheet leaves for home at once.
 */
@Component({
  selector: 'lib-recovery-link-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './recovery-link-sheet.html',
  styleUrl: './recovery-link-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecoveryLinkSheet {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _pending = inject(PendingRecoveryLink);
  private readonly _session = inject(SessionStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _browser = inject(BrowserFacade);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Read once. The sheet spends this one token or none. */
  private readonly _token = this._pending.token();

  readonly busy = signal(false);
  readonly dead = signal(false);
  readonly error = signal<AuthErrorCopy | null>(null);

  readonly guest = this._session.isGuest;
  readonly username = this._session.username;

  /** Its address, or null for a guest and until the profile has been read. */
  readonly email = computed(() => {
    const email = this._profile.profile()?.email;
    return email === undefined || email === null || email === '' ? null : email;
  });

  readonly groupCount = computed(() => this._zones.myZones().length);

  constructor() {
    if (this._token === null) {
      void this._sheet.leaveTo(this._home());
      return;
    }

    if (!this._session.isGuest() && this._profile.profile() === null) {
      void this._profile.load();
    }
  }

  /** The one button: sign this account out of the phone and use the link. */
  async proceed(): Promise<void> {
    const token = this._token;
    if (token === null || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    const outcome = await this._auth.recoverySignIn(token, {
      switchAccount: true,
    });
    this.busy.set(false);

    switch (outcome.state) {
      case 'signed-in':
        this._pending.clear();
        await this._sheet.leaveTo(this._home());
        // Every store of this document still holds the account that left, its groups
        // and its name. Starting over at home, where the new pair is in storage, is
        // the one way to be sure none of it shows for the account that arrived.
        this._browser.reload();
        return;

      case 'already-signed-in':
        this._pending.clear();
        await this._sheet.leaveTo(this._home());
        return;

      case 'link-dead':
      case 'refused-in-support':
        this._pending.clear();
        this.dead.set(true);
        return;

      case 'other-account':
      case 'password-rejected':
      case 'failed':
        this.error.set(
          authErrorCopy(
            outcome.state === 'failed' ? outcome.error : null,
            'auth.recoverySignIn'
          )
        );
        return;
    }
  }

  /** The guest's way to keep the groups (rule C2). The link waits in the mail. */
  async upgrade(): Promise<void> {
    this._pending.clear();
    await this._sheet.leaveTo(
      appPath(this._locale(), this._basePath, 'auth', 'upgrade')
    );
  }

  /** Escape, the scrim and back. Nothing is sent; the token is dropped. */
  async dismiss(): Promise<void> {
    this._pending.clear();
    await this._sheet.dismiss(this._home());
  }

  private _home(): string {
    return appPath(this._locale(), this._basePath, 'home');
  }
}
