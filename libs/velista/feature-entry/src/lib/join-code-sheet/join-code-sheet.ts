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
import { TokenStore, ZoneStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, BrowserFacade } from '@portfolio/velista/platform';
import {
  AccountLostPanel,
  AlertIcon,
  isCompleteJoinCode,
  JoinCodeField,
  normalizeJoinCode,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { entryErrorKey } from '../entry-error-copy';
import { returnPath, type EntryReturnTo } from '../entry-urls';

/**
 * Enter a code somebody sent you, and ask to be let in.
 *
 * It cannot say whose group it is, and does not try. There is no endpoint that turns a
 * join code into a zone: `POST /v1/zones/join` is the only route that accepts one and
 * it joins rather than looks up (plan 0008, section 5.7). So the sheet promises only
 * what it can deliver, and the group names itself on the dashboard the moment the ask
 * has gone through.
 *
 * **The primary stays enabled after a rejection.** A wrong code is one character out
 * far more often than it is nonsense, so the fix is one edit and one tap, and a button
 * that disabled itself would make the person retype the whole thing to re-enable it.
 */
@Component({
  selector: 'lib-join-code-sheet',
  imports: [
    RokuTranslatorPipe,
    AccountLostPanel,
    AlertIcon,
    JoinCodeField,
    SheetShell,
    SpinnerIcon,
  ],
  templateUrl: './join-code-sheet.html',
  styleUrl: './join-code-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinCodeSheet {
  private readonly _zones = inject(ZoneStore);
  private readonly _tokens = inject(TokenStore);
  private readonly _browser = inject(BrowserFacade);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly code = signal('');
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly accountLost = signal(false);

  /** Exactly eight characters, which the field has already made legal ones. */
  readonly canSubmit = computed(
    () => isCompleteJoinCode(this.code()) && !this.submitting()
  );

  private readonly _returnTo = (this._route.snapshot.data['returnTo'] ??
    'landing') as EntryReturnTo;

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const outcome = await this._zones.joinZone(this.code());

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

  /**
   * Paste, read here rather than in the field.
   *
   * `navigator.clipboard` is a browser global, so it goes through `BrowserFacade`
   * (rule D2), and `ui` may not inject that (rule D1), which is why the field asks
   * rather than reads. Best effort in every sense: the API needs a secure context and
   * a user gesture, it rejects rather than throwing where it is unavailable, and the
   * person can always type the code instead.
   */
  async paste(): Promise<void> {
    const clipboard = this._browser.window?.navigator.clipboard;
    if (clipboard?.readText === undefined) {
      return;
    }

    try {
      const text = await clipboard.readText();
      // Whatever was on the clipboard, reduced to a code. A whole share link becomes
      // the eight characters at the end of it, and the person sees the result.
      this.code.set(normalizeJoinCode(text));
    } catch {
      // Denied, or no permission. Nothing to report: the field is still typable.
    }
  }

  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      returnPath(this._returnTo, this._locale(), this._basePath)
    );
  }

  async restart(): Promise<void> {
    this._tokens.clear();
    await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
  }
}
