import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  LineStore,
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LINE_CONTENT_MAX_LENGTH,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  QuantityStepper,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';

/**
 * Change what a line says, and how many.
 *
 * A sheet and not an inline edit, because editing in place on a row that is also a
 * checkbox means a press has to mean two things, and this screen has already spent its
 * one long press. It is a child route (rule E1), so the list stays mounted underneath
 * with its scroll and the back button dismisses it.
 *
 * ## It seeds from the store and does not fetch
 *
 * There is no `GET /v1/lines/:id`, and there does not need to be: the page underneath
 * is holding this line, so opening the sheet costs nothing. A line that is not in the
 * store means the sheet was deep linked onto a list that has not loaded, and it closes
 * rather than showing empty fields somebody might type into and save over nothing.
 *
 * ## It announces the edit, and the sheet's life is the intent's life
 *
 * Plan 0022, section 2.2. The intent is taken when this sheet opens and dropped when it
 * closes, from this component's own lifecycle rather than from the row or from a focus
 * handler: an intent that outlives what caused it is how a line stays locked looking
 * after somebody backgrounded the app.
 *
 * The drop goes through `DestroyRef` and **only** through it, because saving,
 * cancelling, a back gesture and a navigation away are four exits and that is the one
 * hook all four reach. Explicit calls beside it would be three of the four, written
 * three times, and the fourth would be the one that leaves the line lit up.
 *
 * A socket that drops mid edit needs nothing here: presence is per connection on both
 * ends, and the server expires a member that stops heartbeating (plan 0017).
 */
@Component({
  selector: 'lib-edit-line-sheet',
  imports: [RokuTranslatorPipe, QuantityStepper, SheetShell, SpinnerIcon],
  templateUrl: './edit-line-sheet.html',
  styleUrl: './edit-line-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditLineSheet {
  private readonly _lines = inject(LineStore);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly maxLength = LINE_CONTENT_MAX_LENGTH;

  readonly content = signal('');
  readonly quantity = signal(1);
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  readonly canSubmit = computed(
    () => this.content().trim() !== '' && !this.submitting()
  );

  constructor() {
    const line = this._lines
      .linesIn(this.listId())
      .find((candidate) => candidate.id === this.lineId());

    if (line === undefined) {
      void this.dismiss();
      return;
    }

    this.content.set(line.content);
    this.quantity.set(line.quantity);

    // The list page underneath is what holds the room, so the intent lands. It is
    // recorded after the early return above and not before it, because a sheet that
    // found no line is about to dismiss and has nothing to announce.
    const listId = this.listId();
    this._realtime.setEditingLine(listId, this.lineId());
    inject(DestroyRef).onDestroy(() =>
      this._realtime.setEditingLine(listId, null)
    );
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const outcome = await this._lines.updateLine(this.lineId(), {
      content: this.content().trim(),
      quantity: this.quantity(),
    });

    if (outcome === 'failed') {
      this.submitting.set(false);
      this.errorKey.set(
        listErrorKey(this._lines.errorOf(this.listId()), 'lines.write')
      );
      return;
    }

    // `overwritten` closes too. The write landed and the server's value is on the row
    // underneath, with the note saying it was changed elsewhere: keeping the sheet open
    // over it would hide the thing the person needs to read (section 3.3).
    await this.dismiss();
  }

  onContentInput(event: Event): void {
    this.content.set((event.target as HTMLInputElement).value);
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId()
      )
    );
  }
}
