import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { MapMark } from '@portfolio/luna-shopper/shop-map/model';
import { markIdOf, SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { MARK_TEXT_MAX_LENGTH } from '../record/mark-sheet';
import { MAP_EDIT_SESSION, markKindKey, retextedMark } from './map-edits';

/**
 * One mark of the map (velista `0129`, target 3): its kind, its text in a
 * field, Save, and Delete with a confirmation. It opens from a tap on the
 * mark's pin, on the edit page and on the recording page.
 *
 * `…/edit/sheet/marks/:markId` and `…/record/sheet/marks/:markId`. Like the
 * area sheet it reads and writes the map only through `MAP_EDIT_SESSION`.
 *
 * Save sends a `mark-put` with the same id, position, heading and log time, so
 * the mark stays where it was made and only its words change. It sends nothing
 * when the text did not change, and refuses an empty text: a section or counter
 * mark with no name breaks the map (`MARK_UNNAMED`), and a note with no words
 * says nothing. The sheet does not move the mark or turn its arrow.
 */
@Component({
  selector: 'lib-mark-edit-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './mark-edit-sheet.html',
  // The area sheet's title, field and buttons, which this sheet draws the same.
  styleUrl: './area-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkEditSheet {
  private readonly _session = inject(MAP_EDIT_SESSION);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);

  protected readonly markId = markIdOf(this._route);
  protected readonly maxLength = MARK_TEXT_MAX_LENGTH;

  protected readonly mark = computed<MapMark | null>(
    () =>
      this._session
        .document()
        ?.marks.find((mark) => mark.id === this.markId()) ?? null
  );

  protected readonly kindKey = computed(() => {
    const mark = this.mark();
    return mark === null ? '' : markKindKey(mark);
  });

  /** The label of the field: "Section name", "Counter name" or "Note". */
  protected readonly labelKey = computed(
    () => `shopWalkRecord.mark.name.${this.mark()?.kind ?? 'note'}`
  );

  /** What is in the field. Null until somebody types, so it follows the mark. */
  private readonly _typed = signal<string | null>(null);
  protected readonly text = computed(
    () => this._typed() ?? this.mark()?.text ?? ''
  );

  /** True after Save was pressed on an empty field. */
  protected readonly unnamed = signal(false);
  protected readonly confirming = signal(false);

  protected typed(event: Event): void {
    this._typed.set((event.target as HTMLInputElement).value);
    this.unnamed.set(false);
  }

  async save(event?: Event): Promise<void> {
    event?.preventDefault();
    const mark = this.mark();
    if (mark === null) {
      return;
    }
    const next = retextedMark(mark, this.text());
    if (next.text === '') {
      this.unnamed.set(true);
      return;
    }
    if (next.text !== mark.text) {
      this._session.apply([{ type: 'mark-put', mark: next }]);
    }
    await this.dismiss();
  }

  protected askDelete(): void {
    this.confirming.set(true);
  }

  protected keep(): void {
    this.confirming.set(false);
  }

  async remove(): Promise<void> {
    const mark = this.mark();
    if (mark === null) {
      return;
    }
    this._session.apply([{ type: 'mark-removed', id: mark.id }]);
    await this.dismiss();
  }

  dismiss(): Promise<void> {
    return this._sheet.dismiss(this._session.pageUrl());
  }
}
