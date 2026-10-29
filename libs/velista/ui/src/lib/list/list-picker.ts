import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { AddChoiceRow } from '@portfolio/velista/models';
import { AddChoice } from './add-choice';
import { AnchoredPopover, type AnchoredPopoverClose } from './anchored-popover';

/** One list a line can go to, as the picker draws it. */
export interface ListPickerRow {
  readonly listId: string;
  readonly name: string;
  /** The household the list belongs to, which tells two "Groceries" apart. */
  readonly zoneName: string;
  /** Lines on the list still to buy. */
  readonly pending: number;
}

/**
 * The second question, after a list was picked (velista `0170`, target 6): the typed
 * name is already on two or more of its lines, and which one takes it.
 */
export interface ListPickerChoice {
  /** The words as typed. */
  readonly name: string;
  /** The list that was picked, drawn as the way back to the first question. */
  readonly listName: string;
  readonly rows: readonly AddChoiceRow[];
  /** How many the add carries. */
  readonly added: number;
}

/** Numbers each picker's title, so two on a page never share an id. */
let pickerCount = 0;

/**
 * Which list is it for? Asked at the moment of adding, and every time (velista
 * `0116`).
 *
 * The basket covers several lists, and a line added there has to land on one of
 * them. It used to be a chip above the field that remembered a list, and a field
 * locked until one was chosen. Adding from the basket is rare, so the question is
 * now asked once, at the press that adds: the plus beside the field, or a card's add
 * button. **The pick is the add.** Nothing is remembered for the next line, and one
 * list still opens the picker, so the reader always sees where the line goes.
 *
 * ## A popover, not a sheet
 *
 * It has no URL and it must not bring the keyboard down: somebody adding in an aisle
 * picks a list and types the next thing. So every button cancels `mousedown` (rule
 * T2 of velista `0101`), focus stays in the field, and the overlay is held against
 * the button that was pressed, never inside the suggestion panel, which clips and
 * scrolls.
 *
 * ## Plain values in, one choice out
 *
 * The rows and the anchor come from the page, which joins them from the basket it
 * already holds. The picker knows nothing of baskets, stores or routes. It says
 * which list was chosen, or that it was waved away. On Escape it hands focus back to
 * the anchor, because that is where the person was.
 *
 * ## A second question in the same place
 *
 * A typed name already on two or more lines of the picked list is refused with the
 * lines (velista `0170`). The page hands them in as {@link choice}, and the popover's
 * content becomes that question **in place**, held against the same button, with the
 * picked list above its title as the way back. No mark is drawn on a list before it
 * is picked (the plan's D3).
 */
@Component({
  selector: 'lib-list-picker',
  imports: [AddChoice, AnchoredPopover, RokuTranslatorPipe],
  template: `
    @if (anchor(); as origin) {
      <lib-anchored-popover
        (closed)="close($event, origin)"
        [frame]="choice() === null ? 'note' : 'choice'"
        [labelledBy]="choice() === null ? titleId : choiceTitleId"
        [open]="true"
        [origin]="origin"
        align="end"
      >
        @if (choice(); as asked) {
          <lib-add-choice
            (chose)="choseLine.emit($event)"
            (dismissed)="close('escape', origin)"
            (newLine)="choseNewLine.emit()"
            (returned)="backToLists.emit()"
            [added]="asked.added"
            [back]="asked.listName"
            [name]="asked.name"
            [rows]="asked.rows"
            [titleId]="choiceTitleId"
            scope="basket"
          />
        } @else {
          <div class="picker">
            <h2 [id]="titleId" class="title">
              {{ 'basket.add.sheetTitle' | rokuT }}
            </h2>
            <ul class="lists">
              @for (row of rows(); track row.listId) {
                <li>
                  <button
                    (click)="chosen.emit(row.listId)"
                    (mousedown)="holdFocus($event)"
                    class="option"
                    type="button"
                  >
                    <span class="name">{{ row.name }}</span>
                    <span class="caption">
                      {{
                        'basket.add.listCaption'
                          | rokuT: { zone: row.zoneName, count: row.pending }
                      }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          </div>
        }
      </lib-anchored-popover>
    }
  `,
  styleUrl: './list-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListPicker {
  /** The lists a line can go to, in the order they are offered. */
  readonly rows = input<readonly ListPickerRow[]>([]);

  /** The button that was pressed. The picker is open while this is set. */
  readonly anchor = input<HTMLElement | null>(null);

  /** A list was picked, by id. The container adds the line to it. */
  readonly chosen = output<string>();

  /**
   * The second question, or null while the lists are asked (velista `0170`). Set,
   * it takes the popover's place.
   */
  readonly choice = input<ListPickerChoice | null>(null);

  /** A line of the second question was chosen, by id. */
  readonly choseLine = output<string>();

  /** "A new line" was chosen. */
  readonly choseNewLine = output<void>();

  /** The way back to the lists was pressed. */
  readonly backToLists = output<void>();

  /** Waved away without a pick: a press outside it, or Escape. */
  readonly dismissed = output<AnchoredPopoverClose>();

  protected readonly titleId = `list-picker-title-${++pickerCount}`;
  protected readonly choiceTitleId = `${this.titleId}-choice`;

  protected close(reason: AnchoredPopoverClose, origin: HTMLElement): void {
    if (reason === 'escape') {
      origin.focus();
    }
    this.dismissed.emit(reason);
  }

  /**
   * The browser moves focus on `mousedown`, and on a phone that takes the keyboard
   * down. Cancelling it keeps focus in the field while a list is picked.
   */
  protected holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
}
