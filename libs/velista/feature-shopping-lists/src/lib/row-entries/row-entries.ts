import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketListRef,
  BasketRow,
  BasketRowEntry,
} from '@portfolio/velista/models';
import { QuantityReel } from '@portfolio/velista/ui';

/** One entry, with everything the pane draws about it already resolved. */
interface DrawnEntry {
  readonly lineId: string;
  /** The list and its group, or the one sentence for a list nobody may name. */
  readonly name: string;
  readonly asked: number;
  readonly bought: number;
  /**
   * Whether the "got" number is a reel rather than text.
   *
   * A served entry on an open basket, and nothing else. An entry this reader was
   * not served cannot be allocated to, because the server refuses an `allocations`
   * naming a list they may not write, and a control that is refused is not drawn
   * (`0030`).
   */
  readonly editable: boolean;
  /** The reel's accessible name, which names the list: two reels look alike. */
  readonly label: string;
}

/**
 * What each household asked for and got, on the settle sheet (velista `0090`,
 * section 9.2).
 *
 * It replaced `lib-line-lists-summary`, and the difference is not cosmetic. That
 * one took a line and its origins and worked out, in the component, what each list
 * had contributed and how much of it was bought. Backend `0136` serves both numbers
 * per entry, so there is no arithmetic here at all: every number this draws is one
 * the server sent, which is the rule velista `0060` section 4 states and the reason
 * `commitAsked` and `commitGot` went with the folder.
 *
 * ## Drawn when there is something to say
 *
 * More than one entry, or one entry whose list this reader was served. A row with
 * one unserved entry says nothing anybody can act on — "another list asks for 2" on
 * a row that asks for 2 — so the pane is not drawn at all rather than drawn empty.
 *
 * ## The two numbers are different kinds of thing
 *
 * "Got" is a **reel** for a served entry on an open basket: raising it settles those
 * units against that household alone and lowering it takes them back, which is the
 * per household half of the shopping somebody does at a shelf.
 *
 * "Asks for" is **text** here. Changing what a household asks for is a different act
 * with a different permission behind it — the rule of the basket's owner, which only
 * the server can answer (`BasketRowEntry.demandEditable`) — and velista `0092` draws
 * the control for it. Drawing two reels that look alike and mean opposite things is
 * what `0073` was careful to avoid, and this keeps that.
 */
@Component({
  selector: 'lib-row-entries',
  imports: [QuantityReel, RokuTranslatorPipe],
  templateUrl: './row-entries.html',
  styleUrl: './row-entries.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowEntries {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly row = input.required<BasketRow>();

  /** The lists this reader was served, for the name on each line. */
  readonly lists = input<ReadonlyMap<string, BasketListRef>>(new Map());

  /** Whether the trip is over, which takes every reel off the pane (`0057`). */
  readonly finished = input(false);

  /** Whether a write on this row is in flight, so the reels wait. */
  readonly busy = input(false);

  /**
   * One household's "got" number was moved.
   *
   * Absolute in both halves, and `from` is the number the reel was picked up at,
   * which is velista `0054`'s bargain: the page turns it into a settle with an
   * `allocations` naming this one line, or a revert of the difference.
   */
  readonly allocated = output<{
    readonly lineId: string;
    readonly from: number;
    readonly to: number;
  }>();

  /**
   * Whether the pane is drawn at all.
   *
   * More than one entry, or one whose list this reader was served. A row with a
   * single unserved entry has nothing to say that the row above it does not say
   * already.
   */
  readonly shows = computed(() => {
    const entries = this.row().entries;
    return entries.length > 1 || entries[0]?.listId !== null;
  });

  protected readonly entries = computed<readonly DrawnEntry[]>(() =>
    this.row().entries.map((entry) => this._draw(entry))
  );

  private _draw(entry: BasketRowEntry): DrawnEntry {
    const locale = this._locale();
    const ref = entry.listId === null ? undefined : this.lists().get(entry.listId);
    // A list this reader was not served, and a list id the basket served no ref
    // for, are the same nothing to name: the mapper already collapsed the second
    // onto the first, so there is one case here.
    const name =
      ref === undefined
        ? this._translator.t('basket.entries.otherList', undefined, locale)
        : // The group's name beside the list's, because a list alone is ambiguous
          // when two households both keep one called "Groceries".
          `${ref.name} · ${ref.zoneName}`;

    return {
      lineId: entry.lineId,
      name,
      asked: entry.asked,
      bought: entry.bought,
      editable: ref !== undefined && !this.finished(),
      label: this._translator.t(
        'basket.entries.gotLabel',
        undefined,
        locale,
        { name }
      ),
    };
  }

  protected onCommitted(
    lineId: string,
    change: { from: number; to: number }
  ): void {
    this.allocated.emit({ lineId, from: change.from, to: change.to });
  }
}
