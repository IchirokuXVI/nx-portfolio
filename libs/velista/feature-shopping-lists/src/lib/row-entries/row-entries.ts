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
import {
  type BasketListRef,
  type BasketProductList,
  type BasketRow,
  type BasketRowEntry,
} from '@portfolio/velista/models';
import { ChevronDownIcon, QuantityReel } from '@portfolio/velista/ui';

/** One list that asks for the row, as it is drawn. */
interface DrawnEntry {
  readonly lineId: string;
  /** The list, or "Another list" for a list the reader was not served. */
  readonly list: string;
  /**
   * "zone · line name", or null for a list the reader was not served. An entry
   * somebody bought outside this shopping list starts with "Already bought".
   */
  readonly where: string | null;
  /** What the list asks for, which is the entry's `left`. */
  readonly asks: number;
  /** Whether the quantity is a control, by the server's `demandEditable`. */
  readonly editable: boolean;
  readonly label: string;
}

/** One list that does not ask yet, as it is drawn under the disclosure. */
interface DrawnOther {
  readonly list: BasketProductList;
  /** "zone · line name" for a list that holds the product at zero, else the zone. */
  readonly where: string;
  readonly label: string;
}

/**
 * The read of the lists that could take the row's product (backend `0201`,
 * section 5), as the sheet holds it.
 */
export type OtherListsState =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly lists: readonly BasketProductList[] };

/**
 * The lists that ask for a row, and the lists that could (velista `0139`,
 * section 3; artboards `RowSheet` and `RowLists`).
 *
 * ## Lists lead
 *
 * An entry is the name of its list, then "zone · line" under it, which is the
 * owner's choice: a row is one product, and the question on this sheet is which
 * households asked for it and how many. A list this reader was not served reads
 * "Another list", with its quantity and no control.
 *
 * ## The quantity is the reel the list page uses
 *
 * A tap opens it, and it commits on release. It is drawn only where the server's
 * `demandEditable` allows it, and for a list the reader may not name only when it
 * is the whole row (velista `0092`'s rule for a guest). Elsewhere it is the number.
 * Plan `0140` puts "Change" before it; until then the quantity stands alone.
 *
 * ## Add it to another list
 *
 * Last, closed, and drawn only when the sheet hands it a read: never for a guest,
 * never for a row with no product, and not once the read answered no list. Open,
 * it draws the read's loading row, its failed row with a retry, or one row per
 * list at a quantity of 0. Moving one above zero is the sheet's to send.
 */
@Component({
  selector: 'lib-row-entries',
  imports: [ChevronDownIcon, QuantityReel, RokuTranslatorPipe],
  templateUrl: './row-entries.html',
  styleUrl: './row-entries.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowEntries {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly row = input.required<BasketRow>();

  /** The covered lists this reader was served, by id, for the names. */
  readonly lists = input<ReadonlyMap<string, BasketListRef>>(new Map());

  /** The whole trip is over, which takes every control away (velista `0057`). */
  readonly finished = input(false);

  /** A write from the sheet is out. The reels are read only meanwhile. */
  readonly busy = input(false);

  /**
   * The lists that could take the product, or null when the disclosure is not
   * drawn at all: a guest, a row with no product, a finished trip.
   */
  readonly others = input<OtherListsState | null>(null);

  /** One list's ask was moved. */
  readonly demanded = output<{
    readonly lineId: string;
    readonly from: number;
    readonly to: number;
  }>();

  /** A list that did not ask was given a quantity above zero. */
  readonly raised = output<{
    readonly list: BasketProductList;
    readonly to: number;
  }>();

  /** The read failed and the reader asked again. */
  readonly retry = output<void>();

  /** Whether "Add it to another list" is open. Closed on every sheet. */
  protected readonly open = signal(false);

  protected readonly entries = computed<readonly DrawnEntry[]>(() =>
    this.row().entries.map((entry) => this._draw(entry))
  );

  /**
   * "Asked for on 3 lists": the heading, counted over the entries, which are the
   * lines that ask. Two lines of one list are two entries, and the heading counts
   * what it draws.
   */
  protected readonly heading = computed(() =>
    this._translator.t('basket.sheet.askedOn', undefined, this._locale(), {
      count: this.row().entries.length,
    })
  );

  /** Whether the disclosure is drawn: there is a read, and it did not answer none. */
  protected readonly showsOthers = computed(() => {
    const others = this.others();
    return (
      others !== null &&
      !this.finished() &&
      !(others.state === 'ready' && others.lists.length === 0)
    );
  });

  protected readonly otherRows = computed<readonly DrawnOther[]>(() => {
    const others = this.others();
    if (others?.state !== 'ready') {
      return [];
    }
    const locale = this._locale();
    return others.lists.map((list) => ({
      list,
      where:
        list.lineId === null || list.lineName === null || list.lineName === ''
          ? list.zoneName
          : `${list.zoneName} · ${list.lineName}`,
      label: this._translator.t('basket.demand.askLabel', undefined, locale, {
        name: list.listName,
      }),
    }));
  });

  protected readonly othersState = computed(
    () => this.others()?.state ?? 'loading'
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected onAsked(
    lineId: string,
    change: { from: number; to: number }
  ): void {
    if (change.to !== change.from) {
      this.demanded.emit({ lineId, from: change.from, to: change.to });
    }
  }

  protected onRaised(
    list: BasketProductList,
    change: { from: number; to: number }
  ): void {
    if (change.to > 0 && change.to !== change.from) {
      this.raised.emit({ list, to: change.to });
    }
  }

  private _mayDemand(entry: BasketRowEntry): boolean {
    // A row bought outside this shopping list keeps it (velista `0142`): asking
    // the list for the product again is the one thing left to do there.
    return (
      !this.finished() &&
      entry.demandEditable &&
      (entry.listId !== null || this.row().entries.length === 1)
    );
  }

  private _draw(entry: BasketRowEntry): DrawnEntry {
    const locale = this._locale();
    const ref =
      entry.listId === null ? undefined : this.lists().get(entry.listId);
    const list =
      ref === undefined
        ? this._translator.t('basket.entries.otherList', undefined, locale)
        : ref.name;
    const line = entry.content.trim();
    const place =
      ref === undefined
        ? null
        : line === ''
          ? ref.zoneName
          : `${ref.zoneName} · ${line}`;
    // Its quantity is 0, and the words say why (velista `0142`, section 1). The
    // entry carries no note, so it does not say where the buy was made. First,
    // because the line is cut at its end and a long line name must not take them.
    const bought =
      entry.state === 'BOUGHT_ELSEWHERE'
        ? this._translator.t('basket.line.alreadyBought', undefined, locale)
        : null;
    const where =
      place === null
        ? bought
        : bought === null
          ? place
          : `${bought} · ${place}`;

    return {
      lineId: entry.lineId,
      list,
      where,
      asks: entry.left,
      editable: this._mayDemand(entry),
      // The list's own name, so two reels on one sheet are told apart by somebody
      // who hears them. A single unserved entry takes the plain label: there is one
      // list in the row and nothing to tell apart.
      label:
        ref === undefined
          ? this._translator.t('basket.demand.label', undefined, locale)
          : this._translator.t('basket.demand.askLabel', undefined, locale, {
              name: list,
            }),
    };
  }
}
