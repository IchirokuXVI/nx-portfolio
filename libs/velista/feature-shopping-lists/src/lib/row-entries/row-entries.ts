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
  QUANTITY_SNAP_POINTS,
  type BasketListRef,
  type BasketProductList,
  type BasketRow,
  type BasketRowEntry,
  type QuantityStep,
} from '@portfolio/velista/models';
import { exactAmount } from '@portfolio/velista/platform';
import {
  AmountFigure,
  ChevronDownIcon,
  QuantityStepper,
} from '@portfolio/velista/ui';

/** One list that asks for the row, as it is drawn. */
interface DrawnEntry {
  readonly lineId: string;
  /** The list, or "Another list" for a list the reader was not served. */
  readonly list: string;
  /**
   * What the list asks for after its name, " · 3" or " · 1,5 kg" (velista
   * `0201`, target state 5): the exact form with its unit, never cut.
   */
  readonly ask: string;
  /**
   * "zone · line name", or null for a list the reader was not served. An entry
   * somebody bought outside this shopping list starts with "Already bought".
   */
  readonly where: string | null;
  /** What the list asks for, the entry's `asked`, which the stepper measures against. */
  readonly asked: number;
  /** What this basket bought for the line in this trip, the entry's `bought`. */
  readonly bought: number;
  /** {@link bought} in words with its unit, for a number with no control. */
  readonly boughtSpoken: string;
  /** What the stepper draws: the sheet's open run on this line, else {@link bought}. */
  readonly shown: number;
  /** Whether the stepper is drawn: the sheet can still settle (target state 4). */
  readonly steppable: boolean;
  /** The step its stepper presses by: its line's, or null for the unit's default. */
  readonly step: number | null;
  /** The points a press lands on: 1000 and the list's ask (target state 2). */
  readonly snaps: readonly number[];
  /** The field's accessible name as given: "Compra semanal, bought". */
  readonly label: string;
  /** What the buttons and the settled amount name: the list, "Compra semanal". */
  readonly name: string;
  /** The sheet may change this entry's product (velista `0140`, section 1). */
  readonly changeable: boolean;
  /** The server allows this list's ask to change, in the detailed view. */
  readonly askEditable: boolean;
}

/** One list that does not ask yet, as it is drawn under the disclosure. */
interface DrawnOther {
  readonly list: BasketProductList;
  /** "zone · line name" for a list that holds the product at zero, else the zone. */
  readonly where: string;
  /** The field's accessible name as given: "Compra semanal, bought". */
  readonly label: string;
  /** What the buttons and the settled amount name: the list. */
  readonly name: string;
  /** What the stepper draws: the sheet's open run on this list, else 0. */
  readonly shown: number;
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
 * What this basket bought for each list of a row, and for the lists that did not
 * ask (velista `0201`; artboards `RowSheet`, `OtherList`, `LongName`, `Guest`).
 *
 * ## Lists lead, and each name carries its ask
 *
 * An entry is the name of its list and what it asks for, "Compra semanal · 3",
 * then "zone · line" under it. The name gives way first and the ask is never cut.
 * A list this reader was not served reads "Another list".
 *
 * ## The stepper records buys
 *
 * One typed stepper per list (velista `0188`, `sheet-narrow`), which counts what
 * this basket bought for that list's line in this trip, from 0 the first time. It
 * never changes an ask: that is the detailed view's (velista `0200`). Its number is
 * green at the list's ask and amber above it (colours A, the `target` input), and
 * the ask is a snap point beside 1000, so a press lands on it even when the step
 * would skip it. Every step is emitted; the sheet gathers them into one settle or
 * one revert of that line once the presses stop. While the sheet cannot settle
 * (the row or the trip is finished) the number is drawn without a control.
 *
 * ## Lists and amounts
 *
 * At the right of the heading, opening the detailed view of the row's lists. It
 * is drawn when one entry or more is changeable or has an ask the reader may
 * change, so a guest who can change nothing does not see it.
 *
 * ## Bought for another list
 *
 * Last, closed, and drawn only when the sheet hands it a read: never for a guest,
 * never for a row with no product, and not once the read answered no list. Open,
 * it draws the read's loading row, its failed row with a retry, or one row per
 * list at 0, each with a stepper that has no ask and no snap point but the default
 * one. Stepping one above zero is a buy the sheet sends; after its answer the list
 * is one of the row's lists, at an ask of 0.
 */
@Component({
  selector: 'lib-row-entries',
  imports: [AmountFigure, ChevronDownIcon, QuantityStepper, RokuTranslatorPipe],
  templateUrl: './row-entries.html',
  styleUrl: './row-entries.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowEntries {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly row = input.required<BasketRow>();

  /** What the row counts, which every stepper here steps and draws by (velista `0182`). */
  protected readonly unit = computed(() => this.row().unit);

  /**
   * The step of each list's line, by line id (velista `0186`, decision A), so a
   * line steps here as it steps on its list. A line not in here presses by the
   * unit's default.
   */
  readonly steps = input<ReadonlyMap<string, number | null>>(new Map());

  /**
   * The row's product's step, which the steppers of the lists that do not ask
   * yet press by, since the line such a list gains holds that product. Null for
   * the unit's default.
   */
  readonly step = input<number | null>(null);

  /**
   * What each line's stepper draws while a run is open in the sheet, by line id:
   * the bought amount the presses got to before the write.
   */
  readonly pending = input<ReadonlyMap<string, number>>(new Map());

  /** The same for the lists that do not ask yet, by list id. */
  readonly pendingOthers = input<ReadonlyMap<string, number>>(new Map());

  /** The covered lists this reader was served, by id, for the names. */
  readonly lists = input<ReadonlyMap<string, BasketListRef>>(new Map());

  /** The whole trip is over, which takes every control away (velista `0057`). */
  readonly finished = input(false);

  /**
   * The sheet can still settle (velista `0201`, target state 4): neither the row
   * nor the trip is finished. Without it each list draws its number only.
   */
  readonly buying = input(true);

  /** A settle or a rename from the sheet is out. The steppers are off meanwhile. */
  readonly busy = input(false);

  /**
   * The lists that could take the product, or null when the disclosure is not
   * drawn at all: a guest, a row with no product, a finished trip.
   */
  readonly others = input<OtherListsState | null>(null);

  /**
   * The lines whose product the reader may change (velista `0140`, section 1),
   * in the detailed view. Here it only decides whether "Lists and amounts" is
   * drawn.
   */
  readonly changeable = input<ReadonlySet<string>>(new Set());

  /** "Lists and amounts" (velista `0200`). */
  readonly listsOpened = output<void>();

  /** One step of what was bought for one list's line, on every press, key and typed commit. */
  readonly bought = output<{
    readonly lineId: string;
    readonly step: QuantityStep;
  }>();

  /** One step of a buy for a list that does not ask yet. */
  readonly boughtOther = output<{
    readonly list: BasketProductList;
    readonly step: QuantityStep;
  }>();

  /** The read failed and the reader asked again. */
  readonly retry = output<void>();

  /** Whether "Bought for another list" is open. Closed on every sheet. */
  protected readonly open = signal(false);

  protected readonly entries = computed<readonly DrawnEntry[]>(() =>
    this.row().entries.map((entry) => this._draw(entry))
  );

  /**
   * "Lists and amounts" is drawn when one entry or more is changeable or has an
   * ask the reader may change (velista `0200`, target state 2).
   */
  protected readonly opensLists = computed(() =>
    this.entries().some((entry) => entry.askEditable || entry.changeable)
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
    const pending = this.pendingOthers();
    return others.lists.map((list) => ({
      list,
      // From 0: the list asks nothing yet, and nothing was bought for it here.
      shown: pending.get(list.listId) ?? 0,
      where:
        list.lineId === null || list.lineName === null || list.lineName === ''
          ? list.zoneName
          : `${list.zoneName} · ${list.lineName}`,
      label: this._translator.t(
        'basket.entries.boughtLabel',
        undefined,
        locale,
        {
          name: list.listName,
        }
      ),
      name: list.listName,
    }));
  });

  protected readonly othersState = computed(
    () => this.others()?.state ?? 'loading'
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected onBought(lineId: string, step: QuantityStep): void {
    this.bought.emit({ lineId, step });
  }

  protected onBoughtOther(list: BasketProductList, step: QuantityStep): void {
    this.boughtOther.emit({ list, step });
  }

  /** The server's `demandEditable`, as the detailed view reads it (velista `0200`). */
  private _mayDemand(entry: BasketRowEntry): boolean {
    return (
      !this.finished() &&
      entry.demandEditable &&
      (entry.listId !== null || this.row().entries.length === 1)
    );
  }

  private _draw(entry: BasketRowEntry): DrawnEntry {
    const locale = this._locale();
    const unit = this.unit();
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
    const elsewhere =
      entry.state === 'BOUGHT_ELSEWHERE'
        ? this._translator.t('basket.line.alreadyBought', undefined, locale)
        : null;
    const where =
      place === null
        ? elsewhere
        : elsewhere === null
          ? place
          : `${elsewhere} · ${place}`;
    const ask = exactAmount(entry.asked, unit, locale);

    return {
      lineId: entry.lineId,
      list,
      ask: ` · ${ask.symbol === '' ? ask.figure : `${ask.figure} ${ask.symbol}`}`,
      where,
      asked: entry.asked,
      bought: entry.bought,
      boughtSpoken: exactAmount(entry.bought, unit, locale).spoken,
      shown: this.pending().get(entry.lineId) ?? entry.bought,
      steppable: this.buying() && !this.finished(),
      step: this.steps().get(entry.lineId) ?? null,
      snaps: [...QUANTITY_SNAP_POINTS, entry.asked],
      // The list's own name, so two steppers on one sheet are told apart by somebody
      // who hears them. A single unserved entry takes the plain label: there is one
      // list in the row and nothing to tell apart.
      label:
        ref === undefined
          ? this._translator.t('basket.entries.boughtPlain', undefined, locale)
          : this._translator.t(
              'basket.entries.boughtLabel',
              undefined,
              locale,
              {
                name: list,
              }
            ),
      name: list,
      changeable: this.changeable().has(entry.lineId),
      askEditable: this._mayDemand(entry),
    };
  }
}
