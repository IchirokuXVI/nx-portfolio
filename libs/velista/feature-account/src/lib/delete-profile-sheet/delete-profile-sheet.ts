import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ShoppingProfileStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import { ConfirmSheet } from '@portfolio/velista/ui';

/**
 * Deleting the profile on screen (plan 0046, section 3.2).
 *
 * ## One tap never destroys anything
 *
 * A sheet rather than an immediate delete, and a child route rather than a signal, which
 * is rule E1: nothing is pushed onto the history stack by a signal, so Android's back
 * button would close the **app** rather than the sheet.
 *
 * ## No typed confirmation, and that is the rule rather than an omission
 *
 * `0010` section 5.7 decides a confirm's friction by what cannot be got back. A group
 * takes every list in it away from everybody in it, so it asks for its name to be typed.
 * A profile is a set of postal codes and chain choices belonging to one person, worth a
 * minute to redo, and it touches nobody else's data and no list. One tap of a
 * destructive primary is the right amount of friction for that.
 *
 * ## Deleting the default names its successor
 *
 * The server promotes the oldest remaining profile, so there is always exactly one
 * default. The copy says **which**, because "one of your others will become the default"
 * is a sentence that leaves somebody to find out afterwards which prices they are now
 * being shown.
 */
@Component({
  selector: 'lib-delete-profile-sheet',
  imports: [ConfirmSheet],
  templateUrl: './delete-profile-sheet.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteProfileSheet {
  private readonly _store = inject(ShoppingProfileStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);

  protected readonly busy = signal(false);

  /** The key of a failure's copy, or null. A failed delete stays on this sheet. */
  protected readonly errorKey = signal<string | null>(null);

  /** The profile the page is editing, which is the one this sheet is about. */
  private readonly _profile = this._store.selected;

  private readonly _defaultName = computed(() => {
    const locale = this._locale();
    return this._translator.t('profiles.defaultName', undefined, locale);
  });

  protected readonly title = computed(() => {
    const locale = this._locale();
    return this._translator.t('profiles.delete.title', undefined, locale);
  });

  protected readonly confirmLabel = computed(() => {
    const locale = this._locale();
    return this._translator.t('profiles.delete.confirm', undefined, locale);
  });

  /**
   * The consequence sentence.
   *
   * Two sentences and not one with a conditional clause: which profile becomes the
   * default is the whole message when there is one, and there is nothing to say about it
   * when there is not.
   */
  protected readonly body = computed(() => {
    const profile = this._profile();
    const locale = this._locale();

    if (profile === null) {
      return '';
    }

    const successor = this._store.successorOf(profile.id);
    if (successor === null) {
      return this._translator.t('profiles.delete.body', undefined, locale);
    }

    return this._translator.t('profiles.delete.default', undefined, locale, {
      name: successor.name ?? this._defaultName(),
    });
  });

  /**
   * Delete, then go back to the page.
   *
   * The store has already promoted the successor by the server's own rule, so the page
   * behind this sheet is drawing the new default by the time it closes.
   */
  protected async confirm(): Promise<void> {
    const profile = this._profile();
    if (profile === null || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.errorKey.set(null);

    try {
      const outcome = await this._store.remove(profile.id);
      if (outcome === 'failed') {
        this.errorKey.set('profiles.error.delete');
        return;
      }

      await this._sheet.leaveTo(this._pagePath());
    } finally {
      this.busy.set(false);
    }
  }

  /** Cancel, Escape and the scrim. */
  protected async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._pagePath());
  }

  private _pagePath(): string {
    return appPath(this._locale(), this._basePath, 'account/profiles');
  }
}
