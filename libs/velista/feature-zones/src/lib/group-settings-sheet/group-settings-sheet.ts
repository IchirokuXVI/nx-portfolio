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
import { ZoneStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, ZONE_NAME_MAX_LENGTH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { ConfirmSheet, SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { zoneIdOf } from '../route-params';
import { shouldRefetch, zoneErrorKey } from '../zone-error-copy';

/** Which confirm, if any, is covering the settings sheet. */
type Pending = 'regenerate' | 'delete' | null;

/**
 * Rename the group, mint a new code, or delete it.
 *
 * Three governance actions in one sheet rather than three entries on the group page,
 * because the header is about the group's identity and a toolbar of destructive
 * controls above the lists would be a permanent invitation to a mistake.
 *
 * ## Two of these get a confirm, and one of those gets the name typed in
 *
 * Renaming is reversible by doing it again, so it saves directly. Regenerating is not
 * destructive to data and **strands every invite already sent**, which is invisible
 * unless the copy says so. Deleting takes every list, line and comment for every member
 * with it, with no undo anywhere in the product, so it asks for the group's name to be
 * typed: an ordinary destructive confirm is a two tap gesture that a phone in a pocket
 * can complete (section 5.7).
 *
 * ## Delete is owner only and this sheet is staff
 *
 * An admin sees rename and regenerate and no delete, from `myRole` (rule G2). Core
 * refuses them anyway, which is the half that actually protects the group; hiding the
 * button is the half that stops somebody being offered something that cannot work.
 */
@Component({
  selector: 'lib-group-settings-sheet',
  imports: [RokuTranslatorPipe, ConfirmSheet, SheetShell, SpinnerIcon],
  templateUrl: './group-settings-sheet.html',
  styleUrl: './group-settings-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupSettingsSheet {
  private readonly _zones = inject(ZoneStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly maxLength = ZONE_NAME_MAX_LENGTH;

  readonly zone = computed(() => this._zones.zoneById(this.zoneId()));

  /** The group's current name, and the field's starting value. */
  readonly groupName = computed(() => this.zone()?.name ?? '');

  /** Delete is owner only (section 5.4), read from `myRole` and never from a count. */
  readonly isOwner = computed(() => this.zone()?.myRole === 'OWNER');

  /** Null until the field is touched, so the group's own name is what shows. */
  private readonly _typedName = signal<string | null>(null);

  readonly name = computed(() => this._typedName() ?? this.groupName());

  readonly pending = signal<Pending>(null);
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);

  readonly canSave = computed(() => {
    const next = this.name().trim();
    return next !== '' && next !== this.groupName() && !this.busy();
  });

  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    await this._run(() =>
      this._zones.renameZone(this.zoneId(), this.name().trim())
    );

    if (this.errorKey() === null) {
      // The store already holds the new name, so the header behind this sheet is
      // correct the instant it closes.
      await this.dismiss();
    }
  }

  /**
   * Mint a new join code.
   *
   * The group page and the dashboard both pick the new code up from the store, which
   * this write patches from the server's answer. Nothing refetches, and the
   * `zone.updated` broadcast that follows says the same thing to every other device.
   *
   * **Closes both sheets**, exactly as `save()` does after a rename, rather than
   * dropping the confirm and leaving the settings sheet showing the name field. The
   * write is the end of the task, not a step in one, and the card that holds the new
   * code is behind two layers until this closes. The store has already patched
   * `joinCode`, so the group page's invite card is drawing it before the panel has
   * finished falling.
   */
  async regenerate(): Promise<void> {
    await this._run(() => this._zones.regenerateJoinCode(this.zoneId()));

    if (this.errorKey() === null) {
      await this.dismiss();
    }
  }

  /** Delete the group, then leave for the dashboard: there is nothing behind this. */
  async remove(): Promise<void> {
    await this._run(() => this._zones.deleteZone(this.zoneId()));

    if (this.errorKey() === null) {
      await this._router.navigateByUrl(
        appPath(this._locale(), this._basePath, 'home')
      );
    }
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'zones', this.zoneId())
    );
  }

  /** Closing a confirm without going ahead leaves the settings sheet where it was. */
  cancelPending(): void {
    if (!this.busy()) {
      this.pending.set(null);
      this.errorKey.set(null);
    }
  }

  onNameInput(event: Event): void {
    this._typedName.set((event.target as HTMLInputElement).value);
  }

  /** The shared shape of all three writes: busy, run, translate the failure. */
  private async _run(
    send: () => Promise<{ state: 'succeeded' | 'failed'; error?: unknown }>
  ): Promise<void> {
    this.busy.set(true);
    this.errorKey.set(null);

    const outcome = await send();
    this.busy.set(false);

    if (outcome.state === 'failed') {
      this.errorKey.set(zoneErrorKey(outcome.error, 'zone.governance'));

      if (shouldRefetch(outcome.error, 'zone.governance')) {
        // The caller's role changed underneath the control they pressed, so every
        // affordance drawn from `myRole` is now wrong. Re-reading is what puts them
        // back in step, and the sentence above says so while it happens.
        void this._zones.loadZone(this.zoneId());
      }
    }
  }
}
