import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  ProfileStore,
  SessionStore,
  TokenStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon, WarningIcon } from '@portfolio/velista/ui';
import {
  accountCorrelationId,
  accountFailure,
  asClock,
} from '../account-error-copy';

/**
 * Leaving, with the typed confirmation in front of it.
 *
 * ## What deleting actually does, which is what the copy claims
 *
 * Taken from `identity.service.ts` and `account-deletion.service.ts` rather than
 * inferred, because every line of this sheet is a claim about somebody else's data:
 *
 * - In auth, deleting the `users` row cascades its credentials, OAuth identities, email
 *   verifications and refresh tokens.
 * - In core, a zone the person **owned** has its owner set to null and its status set to
 *   `MARKED_FOR_DELETION`, and an admin can still rescue it by claiming it, which `0010`
 *   built. Their membership everywhere else is retired: the per zone username is
 *   overwritten with the anonymized placeholder and the status set to `KICKED`.
 * - What they wrote **stays**. Lists, lines and comments reference an opaque `userId`
 *   and are retained; the tombstone is what keeps them resolving to the neutral former
 *   member label rather than to nothing.
 *
 * So the sheet says three specific things, and the first is countable from the cache:
 * `ZoneStore` holds `myRole` per zone, which is what rule G2 already gates governance
 * on, so the owned count needs no request. Somebody who owns none is **not shown that
 * sentence at all**, because for them it is not true.
 *
 * ## The second and last typed confirmation
 *
 * `0010` section 5.7 asked for this justification before anything grew one by
 * imitation. It is the same argument one level up: deleting a group destroys every list
 * in it for everyone in it, and deleting an account does that to every group the person
 * owns **at once**, plus their own access to every group they do not. If typing was
 * worth its friction there, it cannot be optional here.
 *
 * What is typed is the person's **own username**, not a fixed word. It is on the
 * screen, it is personal, and it is the same gesture in both languages, which a typed
 * `DELETE` is not. Compared trimmed and case folded, matching `0010`: it is deliberate
 * friction, not a spelling test.
 *
 * ## Why this is not `ConfirmSheet`
 *
 * `ConfirmSheet` has the typed mode already, and this sheet does not use it. It renders
 * one body sentence, and this one has three paragraphs of which the middle is
 * conditional and pluralized on a count. Passing that through as a pre-resolved `body`
 * would mean assembling copy out of fragments in a container, which is the thing rule N
 * exists to prevent.
 */
@Component({
  selector: 'lib-delete-account-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon, WarningIcon],
  templateUrl: './delete-account-sheet.html',
  styleUrl: './delete-account-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteAccountSheet {
  private readonly _profile = inject(ProfileStore);
  private readonly _session = inject(SessionStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _tokens = inject(TokenStore);
  private readonly _notice = inject(AccountNotice);
  private readonly _router = inject(Router);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly typed = signal('');
  readonly busy = signal(false);

  /** The failure's copy and its wait, or null. A failed delete stays on this sheet. */
  readonly failure = signal<{ key: string; wait: string } | null>(null);
  readonly correlationId = signal<string | null>(null);

  /** The name that has to be typed, and the one on screen the whole time. */
  readonly username = computed(() => this._session.username() ?? '');

  /**
   * How many groups this person owns, from the cache and with no request.
   *
   * `myRole` is the caller's own role, which core fills on every `MyZone`, so this is a
   * count of records already on the device (section 5.7).
   */
  readonly ownedCount = computed(
    () => this._zones.myZones().filter((zone) => zone.myRole === 'OWNER').length
  );

  /**
   * Whether the primary is enabled.
   *
   * Trimmed and case folded, matching `0010`. `toLocaleLowerCase` and not
   * `toLowerCase`, because somebody may well be named in Turkish, where the two
   * disagree about the letter I and the difference is a button that never enables.
   */
  readonly canDelete = computed(() => {
    const expected = this.username();
    return (
      !this.busy() && expected !== '' && fold(this.typed()) === fold(expected)
    );
  });

  onTyped(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.confirm();
  }

  /**
   * Delete, then end the session and go to the front door.
   *
   * **Not a redirect to sign in**, which is the screen for somebody who has an account.
   * The front door is the screen for somebody who does not, which is now true.
   *
   * A failure leaves the sheet open with the correlation id and does **not** clear the
   * session: a failed delete must never look like a successful one (section 3.4).
   */
  async confirm(): Promise<void> {
    if (!this.canDelete()) {
      return;
    }

    this.busy.set(true);
    this.failure.set(null);

    try {
      const outcome = await this._profile.remove();
      if (outcome.state === 'failed') {
        const problem = accountFailure(outcome.error, 'account.delete');
        this.correlationId.set(accountCorrelationId(outcome.error));
        this.failure.set({
          key: problem.key,
          wait:
            problem.waitSeconds === null ? '' : asClock(problem.waitSeconds),
        });
        return;
      }

      this._tokens.clear();
      this._profile.clear();
      // The front door says it once. Through `AccountNotice`, which is where every
      // other piece of news about an account already lives and which survives exactly
      // one navigation: router state would survive a reload too, and coming back to
      // this URL tomorrow is not the moment to be told an account was deleted.
      this._notice.setDeleted();
      await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
    } finally {
      this.busy.set(false);
    }
  }

  /** Cancel, Escape and the scrim. Blocked while the request is out. */
  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'account')
    );
  }
}

/** Trim and case fold, so the check is friction rather than a spelling test. */
function fold(value: string): string {
  return value.trim().toLocaleLowerCase();
}
