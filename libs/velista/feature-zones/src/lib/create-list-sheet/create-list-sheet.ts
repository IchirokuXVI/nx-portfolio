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
import { ListStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, LIST_NAME_MAX_LENGTH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { zoneIdOf } from '@portfolio/velista/platform';
import { zoneErrorKey } from '../zone-error-copy';

/**
 * Name a list, and make it.
 *
 * One field, exactly like the create group sheet, and for the same reason: this is a
 * single decision over a page that must keep its context, so it is a child route
 * rather than a screen (rule E1, plan 0008). The back button closing it is the whole
 * argument.
 *
 * **Offered to a plain member too.** `ListService.create` requires only an approved
 * membership and gives the creator WRITER access to what they made, so the button on
 * the empty state is honest for everybody in the group (section 5.5).
 */
@Component({
  selector: 'lib-create-list-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './create-list-sheet.html',
  styleUrl: './create-list-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateListSheet {
  private readonly _lists = inject(ListStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly maxLength = LIST_NAME_MAX_LENGTH;

  readonly name = signal('');
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** Non empty is the whole rule. A name is a name; nothing here judges it. */
  readonly canSubmit = computed(
    () => this.name().trim() !== '' && !this.submitting()
  );

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const outcome = await this._lists.createList(
      this.zoneId(),
      this.name().trim()
    );

    if (outcome.state === 'created') {
      // Back to the group, where the list is already in the store and therefore
      // already on screen. The sheet is a route, so navigating away is what closes it.
      await this.dismiss();
      return;
    }

    this.submitting.set(false);
    this.errorKey.set(zoneErrorKey(outcome.error, 'list.create'));
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'zones', this.zoneId())
    );
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }
}
