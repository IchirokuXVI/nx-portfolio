import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CloseIcon, FilterIcon, SearchIcon } from '../icons/icons';

/**
 * The row above a list of lines: a search, and a way into the filter sheet (velista
 * `0082`, section 2).
 *
 * It was the basket page's own markup until the zone list page needed the same row,
 * and it is one component now so the two screens cannot drift apart. Everything it
 * draws is what `0074`, `0075` and `0079` built on the basket, moved and not changed.
 *
 * ## Plain values in, events out
 *
 * Rule D1: only a page injects a store. The page hands down the query, the counts
 * and the badge, and hears back a query and a press on the filter. **Whether the
 * field is open is kept here**, because it is a gesture and not a fact about the
 * list: opening is not searching, and a field can be open and empty.
 *
 * ## What the page puts in it
 *
 * The default slot is the leading edge of the closed row, which on the basket is how
 * much of the trip is got. A projected element marked `listToolsBelow` is drawn
 * under the row, closed and open, which is where the basket's chips go. The zone list
 * page projects neither.
 *
 * ## Sticky on its own host
 *
 * The host carries `tools-bar` and the sticky position (velista `0079`, section 2).
 * A sticky box sticks within its parent, so it has to be the host that is the child
 * of the scrolling page, not a box inside the host that is only as tall as itself.
 */
@Component({
  selector: 'lib-list-tools',
  imports: [
    CloseIcon,
    FilterIcon,
    NgTemplateOutlet,
    RokuTranslatorPipe,
    SearchIcon,
  ],
  templateUrl: './list-tools.html',
  styleUrl: './list-tools.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tools-bar' },
})
export class ListTools {
  /** What is in the search field, exactly as it was typed. */
  readonly query = input('');

  /** How many lines are drawn, for the count a screen reader hears while searching. */
  readonly shown = input(0);

  /** How many lines there are in all, for the same count. */
  readonly total = input(0);

  /** How many filter settings are on, for the badge and the button's name. */
  readonly activeCount = input(0);

  /** The field's id, so the hidden label names it. One per page. */
  readonly fieldId = input('list-search');

  readonly queryChange = output<string>();
  readonly openFilter = output<void>();

  /**
   * Whether the field has replaced the row, which is not the same as searching.
   *
   * A field that is open and empty draws every line, and the count says so. Cancel
   * is what closes it.
   */
  private readonly _open = signal(false);

  protected readonly open = this._open.asReadonly();

  /**
   * Which control the keyboard should be on once the row has been redrawn.
   *
   * A signal and not a call, because neither control exists at the moment of the
   * gesture: opening destroys the button that was pressed, and cancelling destroys
   * the field. The effect below waits for whichever one arrives.
   */
  private readonly _focusWanted = signal<'field' | 'button' | null>(null);

  private readonly _field =
    viewChild<ElementRef<HTMLInputElement>>('searchField');

  private readonly _button =
    viewChild<ElementRef<HTMLButtonElement>>('searchButton');

  /**
   * Put the focus where the gesture said, as soon as there is something to put it on
   * (velista `0074`, section 6). Focus never lands on the page body.
   */
  private readonly _focusEffect = effect(() => {
    const wanted = this._focusWanted();
    const field = this._field();
    const button = this._button();

    const target =
      wanted === 'field' ? field : wanted === 'button' ? button : null;
    if (target === undefined || target === null) {
      return;
    }

    untracked(() => this._focusWanted.set(null));
    target.nativeElement.focus();
  });

  /** Replace the row with the field, and put the caret in it. */
  protected openSearch(): void {
    this._open.set(true);
    this._focusWanted.set('field');
  }

  protected onInput(event: Event): void {
    this.queryChange.emit((event.target as HTMLInputElement).value);
  }

  /** Empty the field without closing it, which is the control inside it. */
  protected clear(): void {
    this.queryChange.emit('');
    this._focusWanted.set('field');
  }

  /**
   * Cancel, and Escape does the same. It **clears the query as well as closing the
   * field**, because a search left running behind a closed field is a screen missing
   * lines for a reason nothing on it says.
   */
  protected close(): void {
    this.queryChange.emit('');
    this._open.set(false);
    this._focusWanted.set('button');
  }
}
