import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  LineStore,
  ListStore,
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LINE_CONTENT_MAX_LENGTH,
  type LineEditScope,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  SheetNavigation,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  QuantityStepper,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';
import { editScopeFor, selectAbilities } from '../select-list-state';

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
 * ## Two modes, and the row chooses which
 *
 * Plan 0030, section 4; plan 0066, section 2. `full` makes every field live, `content`
 * shows the quantity and lets only the words move. Two modes of one sheet rather than
 * two sheets, because they are the same gesture from the same row and the only
 * difference is which fields answer.
 *
 * The mode comes from `editScopeFor`, the same expression the row's overflow used to
 * decide whether to offer this sheet at all, so the menu entry and the sheet behind it
 * cannot disagree. It is derived here rather than passed down because this is a routed
 * child (rule E1) reached by a URL, which means it is also reachable by a deep link on a
 * row whose menu nobody opened. A scope of null closes the sheet, for the same reason a
 * missing line does: an editor nobody may use is worse than no editor.
 *
 * ## It says what the save is about to do
 *
 * Plan 0066, section 3. A writer fixing an approved line puts it back in front of
 * whoever approves it (backend plan 0076, section 2), and a row that quietly went back
 * to awaiting approval under somebody who was fixing a typo is confusing exactly once
 * per person, which is once too many for a sentence this cheap. Before the save rather
 * than after it, for the same reason.
 *
 * The sheet used to warn about something else here, a second line holding the difference
 * when an approved line's quantity went down (backend plan 0037, section 4). Backend plan
 * 0047 deleted that behaviour along with the trip status it was written in, so the sheet
 * was warning about a row that is never created, on the exact edit this new sentence is
 * about.
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
  private readonly _lists = inject(ListStore);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _sheet = inject(SheetNavigation);
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

  /** Which fields answer. Null never renders: the constructor dismisses on it. */
  readonly scope = signal<LineEditScope | null>(null);

  /** Whether this list approves new lines by itself, which is what spares the line. */
  private readonly _autoApproves = signal(false);

  readonly canSubmit = computed(
    () => this.content().trim() !== '' && !this.submitting()
  );

  /**
   * Whether to say that the save will put the line back to awaiting approval (plan 0066,
   * section 3).
   *
   * The server's own condition (backend plan 0076, section 2): the line is `APPROVED`,
   * the caller holds neither `DECIDE` nor `MANAGE`, and the list does not auto approve.
   * The first two are exactly what `content` scope means, so they are asked once, of
   * `editScopeFor`, rather than restated here where they could drift from it. The third
   * is not in the scope, because who may edit which field does not depend on the option
   * and whether the edit reverts the line does.
   */
  readonly warnsAboutUnapproval = computed(
    () => this.scope() === 'content' && !this._autoApproves()
  );

  constructor() {
    const line = this._lines
      .linesIn(this.listId())
      .find((candidate) => candidate.id === this.lineId());

    if (line === undefined) {
      void this.dismiss();
      return;
    }

    const list = this._lists
      .listsIn(this.zoneId())
      .find((candidate) => candidate.id === this.listId());

    const scope = editScopeFor(
      line,
      selectAbilities(list?.myPermissions ?? [])
    );
    if (scope === null) {
      // Deep linked onto a row whose overflow would never have offered this. Dismissing
      // rather than drawing a sheet whose save the server refuses (rule G2).
      void this.dismiss();
      return;
    }

    this.scope.set(scope);
    this.content.set(line.content);
    this.quantity.set(line.quantity);
    this._autoApproves.set(list?.autoApproveLines ?? false);

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

    // In `content` mode the quantity is not sent at all, rather than sent unchanged. A
    // writer may not move that one field on an approved line (backend plan 0076, section
    // 3), and the server refuses a body naming it even when the value in it is the value
    // already stored.
    const outcome = await this._lines.updateLine(
      this.lineId(),
      this.scope() === 'content'
        ? { content: this.content().trim() }
        : { content: this.content().trim(), quantity: this.quantity() }
    );

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
    await this._sheet.dismiss(
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
