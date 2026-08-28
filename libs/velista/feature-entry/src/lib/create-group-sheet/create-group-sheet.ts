import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import {
  AccountLostPanel,
  AlertIcon,
  InfoIcon,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { entryErrorKey } from '../entry-error-copy';
import { returnPath, type EntryReturnTo } from '../entry-urls';

/** The gateway's own limit on a zone name, so the field cannot overrun it. */
const NAME_MAX_LENGTH = 80;

/**
 * Name a group, and own it.
 *
 * One field and one button, and it asks who you are at no point: `CreateZoneDto`'s
 * `username` is optional and omitting it means "call me by my global username", which
 * the backend has already generated (plan 0008, section 5.2). For somebody with no
 * account at all this is where one is made, which is the single most surprising thing
 * the product does, so the sheet says it out loud while it happens rather than letting
 * it be discovered.
 *
 * The container, and the only thing here that touches a store (rule D1). Everything it
 * renders below the title is `SheetShell` and plain markup; everything it decides is in
 * this file.
 */
@Component({
  selector: 'lib-create-group-sheet',
  imports: [
    RokuTranslatorPipe,
    AccountLostPanel,
    AlertIcon,
    InfoIcon,
    SheetShell,
    SpinnerIcon,
  ],
  templateUrl: './create-group-sheet.html',
  styleUrl: './create-group-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateGroupSheet {
  private readonly _zones = inject(ZoneStore);
  private readonly _session = inject(SessionStore);
  private readonly _tokens = inject(TokenStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly maxLength = NAME_MAX_LENGTH;

  readonly name = signal('');
  readonly submitting = signal(false);

  /** The key of the message under the field, or null. Copy, never a server string. */
  readonly errorKey = signal<string | null>(null);

  /** Rule D3 refused to send. Covers the sheet entirely (section 3.4). */
  readonly accountLost = signal(false);

  /** Non empty is the whole rule. A name is a name; nothing here judges it. */
  readonly canSubmit = computed(
    () => this.name().trim() !== '' && !this.submitting()
  );

  /**
   * Whether creating this group also creates an account.
   *
   * True for anybody not signed in, which the gateway answers by minting a temporary
   * user to own the zone. Read before the request rather than after, because the
   * notice has to be on screen **while** it happens: told afterwards, it is news about
   * something that already went ahead without asking.
   */
  readonly mintingAccount = computed(() => !this._session.isAuthenticated());

  /** Where Cancel goes: the page this sheet was opened over. */
  private readonly _returnTo = (this._route.snapshot.data['returnTo'] ??
    'landing') as EntryReturnTo;

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const outcome = await this._zones.createZone(this.name().trim());

    if (outcome.state === 'created') {
      // Straight to the dashboard, where the group is already listed and the invite
      // card is above it. The sheet is a route, so navigating away is what closes it,
      // and it replaces its own entry rather than pushing, so the back button cannot
      // return to a filled in form whose group already exists (plan 0031).
      await this._sheet.leaveTo(
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
      this.errorKey.set(entryErrorKey(outcome.error, 'zones.create'));
    }
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      returnPath(this._returnTo, this._locale(), this._basePath)
    );
  }

  /**
   * Start again after `guest-account-lost`.
   *
   * Clearing the session is the point: the stored pair is the thing that is spent, and
   * leaving it in place would make the next attempt fail exactly the same way.
   */
  async restart(): Promise<void> {
    this._tokens.clear();
    await this._sheet.leaveTo(appPath(this._locale(), this._basePath));
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }
}
