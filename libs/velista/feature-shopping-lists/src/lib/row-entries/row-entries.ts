import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
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
  /** What this list still asks for, which is what the demand control moves. */
  readonly left: number;
  /**
   * Whether the "got" number is a reel rather than text.
   *
   * A served entry on an open basket, and nothing else. An entry this reader was
   * not served cannot be allocated to, because the server refuses an `allocations`
   * naming a list they may not write, and a control that is refused is not drawn
   * (`0030`).
   */
  readonly editable: boolean;
  /**
   * Whether "asks for" is a reel and a button rather than text (velista `0092`,
   * section 6.2).
   *
   * Three conditions, all of them the server's or the row's, and none of them a
   * rule this client could write:
   *
   * - the basket is open,
   * - `demandEditable`, which asks the rule of the basket's **owner** on this
   *   entry's list and is the one field no client can compute,
   * - the entry's list was served to this reader, **or** the row has exactly one
   *   entry. A reader who cannot tell two entries apart is never asked to choose
   *   between them, which is backend `0130`'s "single entry rows only".
   *
   * An entry that fails any of them keeps the plain number. **Nothing explains
   * why a control is absent** (`0030`): the person reading has no standing to
   * change it and no use for the reason.
   */
  readonly demandEditable: boolean;
  /** The reel's accessible name, which names the list: two reels look alike. */
  readonly label: string;
  /** The demand reel's own name, which has to differ from the one beside it. */
  readonly askLabel: string;
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
 * "Asks for" is a **reel and an explicit button** since velista `0092`, and only
 * where the server says it may be (`BasketRowEntry.demandEditable`). It is not the
 * same kind of control as the one beside it, and the difference is deliberate
 * rather than decorative:
 *
 * - "Got" **commits on release**, because a shopper at a shelf moves it a dozen
 *   times a trip and a confirmation on each would be the dialog `0043` took off
 *   the list page.
 * - "Asks for" **does not**. It rewrites a household's list for everybody, on
 *   every screen the list appears on. The gesture is rare, and a number that a
 *   thumb brushed is not a decision.
 *
 * That is what keeps `0073`'s rule alive in a pane that now has two reels on one
 * row: they no longer look alike, because one of them is followed by a button and
 * a sentence saying what pressing it does.
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
   * What one household asks for was changed (velista `0092`, section 6.2).
   *
   * Emitted by the **button** and never by the reel, which is the whole of the
   * difference from {@link allocated}: this rewrites a list for everybody, and a
   * number that a thumb brushed is not a decision.
   *
   * `from` is the `left` the person was looking at, which is velista `0054`'s
   * bargain: a write whose starting number has moved is refused rather than
   * applied to a number that moved underneath it.
   */
  readonly demanded = output<{
    readonly lineId: string;
    readonly from: number;
    readonly to: number;
  }>();

  /**
   * Whether the pane is drawn at all.
   *
   * More than one entry, or one whose list this reader was served, **or** one
   * the owner may change the demand on (velista `0092`, section 6.2). The third
   * is what the plan adds: a guest is served no list refs at all, so their every
   * entry is unplaceable, and on a single entry row they may still change what
   * the household asks for. A pane that stayed hidden would hide the only
   * control they have.
   *
   * A row with a single unserved entry nobody may change still says nothing that
   * the row above it does not say already — "another list asks for 2" on a row
   * that asks for 2 — so it stays hidden.
   */
  readonly shows = computed(() => {
    const entries = this.row().entries;
    if (entries.length > 1) {
      return true;
    }
    const only = entries[0];
    return (
      only !== undefined && (only.listId !== null || this._mayDemand(only))
    );
  });

  /**
   * Whether this entry's demand is a control, by the three conditions of
   * section 6.2.
   *
   * Here rather than inline in {@link _draw} because {@link shows} asks it too,
   * and the pane appearing for a control it then does not draw would be the two
   * answering differently.
   */
  private _mayDemand(entry: BasketRowEntry): boolean {
    return (
      !this.finished() &&
      entry.demandEditable &&
      (entry.listId !== null || this.row().entries.length === 1)
    );
  }

  protected readonly entries = computed<readonly DrawnEntry[]>(() =>
    this.row().entries.map((entry) => this._draw(entry))
  );

  private _draw(entry: BasketRowEntry): DrawnEntry {
    const locale = this._locale();
    const ref =
      entry.listId === null ? undefined : this.lists().get(entry.listId);
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
      left: entry.left,
      editable: ref !== undefined && !this.finished(),
      demandEditable: this._mayDemand(entry),
      label: this._translator.t('basket.entries.gotLabel', undefined, locale, {
        name,
      }),
      // The list's own name, so two reels on one row are told apart by somebody
      // who hears them rather than seeing which column they sit in. A single
      // unserved entry has no name to give, and takes the plain label instead:
      // there is one list in the row and no ambiguity to resolve.
      askLabel:
        ref === undefined
          ? this._translator.t('basket.demand.label', undefined, locale)
          : this._translator.t('basket.demand.askLabel', undefined, locale, {
              name,
            }),
    };
  }

  protected onCommitted(
    lineId: string,
    change: { from: number; to: number }
  ): void {
    this.allocated.emit({ lineId, from: change.from, to: change.to });
  }

  /**
   * Where each demand reel has been moved to, before anybody pressed the button.
   *
   * **The reel's value is held here and committed nowhere**, which is the whole
   * of section 6.2's second paragraph: this control rewrites a household's list
   * for everybody, and a number a thumb brushed on the way past is not a
   * decision. Cleared per line once the write has gone out, so the reel goes back
   * to reading the row.
   */
  private readonly _asking = signal<ReadonlyMap<string, number>>(new Map());

  /** What this entry's demand reel shows: the moved value, or the list's own. */
  protected asking(entry: DrawnEntry): number {
    return this._asking().get(entry.lineId) ?? entry.left;
  }

  /** Whether the button has anything to send, which is whether the reel moved. */
  protected moved(entry: DrawnEntry): boolean {
    const held = this._asking().get(entry.lineId);
    return held !== undefined && held !== entry.left;
  }

  protected onAsked(lineId: string, change: { to: number }): void {
    const next = new Map(this._asking());
    next.set(lineId, change.to);
    this._asking.set(next);
  }

  /** The button. The reel does not commit; this does. */
  protected applyDemand(entry: DrawnEntry): void {
    const to = this._asking().get(entry.lineId);
    if (to === undefined || to === entry.left) {
      return;
    }

    const next = new Map(this._asking());
    next.delete(entry.lineId);
    this._asking.set(next);
    this.demanded.emit({ lineId: entry.lineId, from: entry.left, to });
  }
}
