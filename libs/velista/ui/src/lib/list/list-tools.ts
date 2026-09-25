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
 * and the badge, and hears back a query and a press on the filter. Opening is not
 * searching, and a field can be open and empty.
 *
 * **Whether the field is open is the page's**, since velista `0109`. It used to be
 * kept here, and then the phone's back button had nothing to pop and left the page
 * instead of closing the search. The page keeps it in the URL now, so this takes
 * `open` and asks for a change with `openChange`, and it keeps only the focus that
 * follows: the field on opening, the search button on closing.
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

  /**
   * Whether the row offers its own search at all. The zone list's composer is its
   * search now (velista `0117`), so that page draws the count and the filter only.
   */
  readonly searchable = input(true);

  /**
   * Whether the field has replaced the row, which is not the same as searching.
   *
   * A field that is open and empty draws every line, and the count says so. The page
   * decides it; this only asks through `openChange`.
   */
  readonly open = input(false);

  readonly queryChange = output<string>();
  readonly openFilter = output<void>();

  /**
   * The search button asks for `true`, and Cancel and Escape ask for `false`. The page
   * clears the query when the field closes, whichever way it closed, so Cancel does
   * not clear it here.
   */
  readonly openChange = output<boolean>();

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
   * Which way the field went last, so that a change of `open` moves the focus and the
   * first value does not. A page drawn with the search already open (a reload of a URL
   * with `search=1`) puts no caret anywhere, and a closed row that is merely drawn
   * does not pull the focus onto its button.
   */
  private _wasOpen: boolean | null = null;

  private readonly _followOpen = effect(() => {
    const open = this.open();
    const was = this._wasOpen;
    this._wasOpen = open;
    if (was !== null && was !== open) {
      untracked(() => this._focusWanted.set(open ? 'field' : 'button'));
    }
  });

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

  /** Ask for the field in place of the row. The caret follows once it is open. */
  protected openSearch(): void {
    this.openChange.emit(true);
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
   * Cancel, and Escape does the same. The page closes the field and **clears the
   * query as well**, because a search left running behind a closed field is a screen
   * missing lines for a reason nothing on it says.
   */
  protected close(): void {
    this.openChange.emit(false);
  }
}
