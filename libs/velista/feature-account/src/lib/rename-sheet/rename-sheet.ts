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
import { ProfileStore, SessionStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_SCOPE_DEFAULT,
  type UsernameScope,
} from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { accountFailure, asClock } from '../account-error-copy';
import { RenameAnnouncement } from '../rename-announcement';

/**
 * Changing your own name, and deciding whether the change follows you into your groups.
 *
 * A sheet and not a route, under rule E1 (`0008`): it is one decision about a row that
 * is on screen, the screen underneath must not be lost, and Android's back button has
 * to dismiss it.
 *
 * ## Rule A3: two choices, never the three enum names
 *
 * `UsernamePropagation` has three values. Read as a question to a person this is not
 * "pick a propagation mode", it is *the name you picked in one group is not the name you
 * use everywhere, so should this change follow it?* So the sheet offers two answers, and
 * `ALL_ZONES` is not among them: it overwrites a name somebody deliberately chose, which
 * is the exact case the enum's own default exists to protect, and offering it honestly
 * would need a screen listing the per zone names it would overwrite — a screen with no
 * endpoint behind it (section 5.10).
 *
 * The client's default is **`MY_GROUPS_TOO`**, which differs from the wire's, and that
 * is why `AccountApi` always sends the field. `MATCHING_ZONES` can only ever change a
 * name that already equalled the old global one, so it cannot clobber a deliberate
 * choice; `GLOBAL_ONLY` leaves somebody renamed in one place and not another, which
 * reads as the rename half working.
 *
 * ## Rule A4: five per hour, and the countdown is the server's number
 *
 * `THROTTLE_LIMITS.usernameChange` is five per **hour**. A countdown that said "wait a
 * minute" would run out, invite the tap, and fail again — rule C3's failure mode on a
 * bucket an order of magnitude larger. So the refusal renders `retryAfterSeconds` from
 * the problem body, and there is no fallback duration anywhere in this file.
 *
 * ## The rules the field states, and the ones it does not
 *
 * The field states the length, which is the one a person can act on while typing.
 * Everything else — the character classes, the "at least one letter", the ban on
 * bidirectional formatting characters, the reserved `former member` prefix — is
 * enforced by `validateUsername` on the server and **not** re-implemented here. A second
 * copy of that regular expression in the browser is a second place for it to drift, and
 * a refusal has copy that states the rule rather than echoing the server.
 */
@Component({
  selector: 'lib-rename-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './rename-sheet.html',
  styleUrl: './rename-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameSheet {
  private readonly _profile = inject(ProfileStore);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _announcement = inject(RenameAnnouncement);

  readonly minLength = USERNAME_MIN_LENGTH;
  readonly maxLength = USERNAME_MAX_LENGTH;

  /**
   * The field, arriving with the current name in it.
   *
   * Seeded once at construction rather than from a `computed`, because this is what
   * somebody is typing into: a signal that followed the store would overwrite their
   * half typed name the moment a realtime event or a reload touched the profile.
   */
  readonly typed = signal(this._session.username() ?? '');

  readonly scope = signal<UsernameScope>(USERNAME_SCOPE_DEFAULT);

  readonly busy = signal(false);

  /** The failure's copy and the wait it interpolates, or null. */
  readonly failure = signal<{ key: string; wait: string } | null>(null);

  /** Code points, so an emoji counts once and the counter matches the server's rule. */
  readonly length = computed(() => Array.from(this.typed().trim()).length);

  /**
   * Whether the primary is enabled.
   *
   * Length only, and checked on the trimmed value, because that is what is sent. The
   * field is never refused **while typing** (section 3.3): a name is invalid for most
   * of the time it takes to write one.
   */
  readonly canSave = computed(() => {
    const length = this.length();
    return (
      !this.busy() && length >= this.minLength && length <= this.maxLength
    );
  });

  onTyped(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    // A refusal is about the value that was sent, so it stops being true the moment
    // that value changes. Rate limiting is the exception and is left standing: the
    // bucket does not care what is in the field.
    if (this.failure()?.key === 'account.error.badName') {
      this.failure.set(null);
    }
  }

  pick(scope: UsernameScope): void {
    this.scope.set(scope);
  }

  /** The keyboard's Go key and the primary both arrive here. */
  onSubmit(event: Event): void {
    event.preventDefault();
    void this.save();
  }

  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    const username = this.typed().trim();
    this.busy.set(true);
    this.failure.set(null);

    try {
      const outcome = await this._profile.rename(username, this.scope());
      if (outcome.state === 'failed') {
        const problem = accountFailure(outcome.error, 'account.rename');
        this.failure.set({
          key: problem.key,
          wait:
            problem.waitSeconds === null ? '' : asClock(problem.waitSeconds),
        });
        return;
      }

      // The sheet is about to close and the change it made is behind it, so the page's
      // live region is told before the navigation starts (section 7).
      this._announcement.record(this._session.username() ?? username);
      await this.dismiss();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Cancel, Escape, the scrim, and the back button all arrive here.
   *
   * Built through `appPath` rather than as a relative `['..']`, matching every other
   * sheet in the app: neither the locale nor the mount is written down, and a relative
   * navigation would have to know how many empty path routes sit between here and the
   * account screen, which is a fact about the route table that breaks silently the
   * first time one is added.
   */
  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'account')
    );
  }
}
