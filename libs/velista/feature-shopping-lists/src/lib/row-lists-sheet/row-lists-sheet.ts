import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { lineProductOf } from '@portfolio/luna-shopper/basket-rules';
import {
  BasketStore,
  BasketViewStore,
  ItemNames,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketRowProduct,
  catalogName,
  isMeasured,
  priceWordsText,
  shownOffer,
  soldAs,
  type BasketRow,
  type BasketRowEntry,
  type LineUnit,
  type LocalizedName,
  type QuantityStep,
} from '@portfolio/velista/models';
import {
  exactAmount,
  formatAmount,
  formatMoney,
  quantityRuns,
  rowKeyOf,
  SheetNavigation,
  type QuantityRun,
} from '@portfolio/velista/platform';
import {
  AmountFigure,
  AnchoredPopover,
  ChevronLeftIcon,
  priceWords,
  productBrandSizeText,
  ProductPicture,
  productSizeText,
  QuantityStepper,
  SheetShell,
  type AnchoredPopoverClose,
} from '@portfolio/velista/ui';
import { basketErrorKey, correlationIdOf } from '../basket-error-copy';
import { basketLineStep } from '../basket-line-step';
import { settleSheetPath } from '../basket-paths';
import {
  changeableLineIds,
  changeSheetPath,
} from '../change-sheet/change-targets';
import { rowListsPath } from './row-lists-path';

/** What a picture and a product line need of a product, from any of its records. */
interface ProductFacts {
  readonly id: string;
  readonly name: LocalizedName;
  readonly brand: string | null;
  readonly imageUrl: string | null;
  readonly size: number | null;
  readonly unit: string | null;
  readonly approxWeight: number | null;
}

/** The row's product at the top, as it is drawn. */
interface DrawnProduct {
  readonly name: string;
  /** "Hacendado · 1 L", or null when the catalog knows neither. */
  readonly detail: string | null;
  readonly imageUrl: string | null;
  /** "0,92 €", or "2,49 € / kg", or null for none. */
  readonly price: string | null;
  /** The price per kilo under a kilo piece's piece price, or null. */
  readonly perKilo: string | null;
}

/** One list's product on its own line, as it is drawn. */
interface DrawnLineProduct {
  readonly name: string;
  /** " · Hacendado 1 L", or null when the catalog knows neither. */
  readonly brandSize: string | null;
  readonly imageUrl: string | null;
  /** It is not the row's product, so the line takes the quiet amber. */
  readonly differs: boolean;
}

/** One list of the row, as the detailed view draws it. */
interface DrawnList {
  readonly lineId: string;
  /** The list, or "Another list" for a list the reader was not served. */
  readonly list: string;
  /** "zone · line", or null for a list the reader was not served. */
  readonly where: string | null;
  /** "Bought 2 of 3", plain text, never cut. */
  readonly bought: string;
  /** What the stepper draws: the open run, else the write in flight, else the ask. */
  readonly shown: number;
  /** {@link shown} in words with its unit, for the number of a finished trip. */
  readonly shownSpoken: string;
  /** The trip is finished: the ask is a plain number, with no stepper. */
  readonly finished: boolean;
  /** The reader may change the ask. */
  readonly editable: boolean;
  /** Why the ask may not change, or null when it may or nothing says why. */
  readonly reason: string | null;
  /** The id of the hidden element that holds {@link reason}. */
  readonly reasonId: string;
  readonly step: number | null;
  /** The field's accessible name: "Compra semanal, pide". */
  readonly label: string;
  /** What the buttons and the settled amount name. */
  readonly name: string;
  /** "Change" is drawn on this list. */
  readonly changeable: boolean;
  /** Change's accessible name, which names the list and holds the word. */
  readonly changeLabel: string;
  /**
   * The list's product, or the line's own name with the default icon when the
   * client cannot name one and "Change" is drawn; null when neither.
   */
  readonly product: DrawnLineProduct | null;
}

/**
 * The detailed view of a basket row's lists (velista `0200`): what each list
 * asks for, what was bought for it, and the change of its product. A sheet at
 * `rows/:rowKey/lists`, pushed over the row's sheet, whose back pops onto it.
 *
 * ## The ask is the list's whole ask
 *
 * Each list's stepper shows `entry.asked`, and a run sends `setDemand` with the
 * run's `to` as `quantity`, the list's new whole ask, and as `from` the entry's
 * `left` the person saw when the run started, which is what backend `0274`
 * documents for the route. It never sends what is left. The timing is the row
 * sheet's: a typed amount at once, presses after the quiet beat, one write per
 * line at a time.
 *
 * A run that starts while a write of its line is in flight saw that write's
 * amount, so its `from` is the `left` that write answered, and nothing newer: a
 * change somebody else made while it waited is answered `stale_quantity`, never
 * overwritten.
 *
 * ## An ask the reader may not change
 *
 * Draws the stepper locked, showing the ask. A press opens a popover that
 * points at the stepper and says why, and the same words are linked to the
 * stepper with `aria-describedby`, so a screen reader hears them at the stepper.
 *
 * ## The product of a list
 *
 * Under each list, on one line, and the word "Change" at its end is the only
 * control that opens the change sheet for it. "Change for all lists" is under
 * the row's product at the top. The change sheets pop back onto this view.
 */
@Component({
  selector: 'lib-row-lists-sheet',
  imports: [
    AmountFigure,
    AnchoredPopover,
    ChevronLeftIcon,
    ProductPicture,
    QuantityStepper,
    RokuTranslatorPipe,
    SheetShell,
  ],
  templateUrl: './row-lists-sheet.html',
  styleUrl: './row-lists-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowListsSheet {
  private readonly _store = inject(BasketStore);
  private readonly _view = inject(BasketViewStore);
  private readonly _itemNames = inject(ItemNames);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _router = inject(Router);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _rowKey = rowKeyOf(inject(ActivatedRoute));

  /** The row, read live, by its key and then by any entry's line id. */
  protected readonly row = computed<BasketRow | null>(() =>
    this._store.rowFor(this._rowKey())
  );

  protected readonly unit = computed<LineUnit>(
    () => this.row()?.unit ?? 'UNIT'
  );

  /** The list whose disabled stepper was pressed, by line id, while its popover shows. */
  protected readonly explained = signal<string | null>(null);

  /** The popover a press outside just closed, until that press is over. */
  private _closedByPress: string | null = null;

  /** The sentence of the last refused write, decided when it was refused. */
  protected readonly failure = signal<{
    readonly key: string;
    readonly count: number;
    readonly correlationId: string | null;
  } | null>(null);

  private _left = false;
  private readonly _following = signal(false);

  /** The waiting saves of each list's ask, by line id. */
  private readonly _demandRuns = quantityRuns<string>((lineId, run) => {
    const seen = this._seen.get(lineId);
    this._seen.delete(lineId);
    void this._write(lineId, run.to, () => this._demand(lineId, run, seen));
  });

  /**
   * The `left` each open run started from, by line id: the entry's, or `'answer'`
   * when a write of the line was in flight, which is then the `left` that write
   * answered ({@link _answered}).
   */
  private readonly _seen = new Map<string, number | 'answer'>();

  /**
   * The `left` the last write of each line ended on, by line id: what its answer
   * says, or the `from` it sent when it was refused, so the server judges again.
   */
  private readonly _answered = new Map<string, number>();

  /** The write in flight for each line, so a run sent while one is out waits. */
  private readonly _writes = new Map<string, Promise<boolean>>();

  /** The amount the last write of each line sent, until its answer is back. */
  private readonly _sent = signal<ReadonlyMap<string, number>>(new Map());

  private readonly _changeable = computed<ReadonlySet<string>>(() => {
    const row = this.row();
    return new Set(
      row === null
        ? []
        : changeableLineIds(row, {
            guest: this._store.me()?.kind === 'GUEST',
            finished: this._store.finished(),
            lists: this._store.lists(),
          })
    );
  });

  /** "Change for all lists" is drawn with two changeable entries or more. */
  protected readonly changesAll = computed(() => this._changeable().size >= 2);

  /** The row's product, drawn at the top. */
  protected readonly product = computed<DrawnProduct | null>(() => {
    const row = this.row();
    if (row === null) {
      return null;
    }
    const locale = this._locale();
    const product = basketRowProduct(row, this._store.products());
    if (product === null) {
      return {
        name: row.content,
        detail: null,
        imageUrl: null,
        price: null,
        perKilo: null,
      };
    }
    const offer = shownOffer(product, this._view.readAtShop());
    const translate = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);
    const price =
      offer === null ? null : priceWords(offer, product, locale, translate);
    const kiloPiece =
      offer !== null &&
      offer.piecePrice !== null &&
      soldAs(product.unit, product.size, product.approxWeight) === 'KILO_PIECE';
    return {
      name: catalogName(product.name, locale),
      detail: productBrandSizeText(product, locale, translate),
      imageUrl: product.imageUrl,
      price: price === null ? null : priceWordsText(price),
      perKilo:
        kiloPiece && offer !== null
          ? priceWordsText({
              amount: formatMoney(offer.price, offer.currency, locale),
              per: translate('catalog.per.KILOGRAM'),
            })
          : null,
    };
  });

  protected readonly lists = computed<readonly DrawnList[]>(() => {
    const row = this.row();
    if (row === null) {
      return [];
    }
    const sent = this._sent();
    const pending = this._demandRuns.pending();
    return row.entries.map((entry) =>
      this._draw(
        row,
        entry,
        pending.get(entry.lineId) ?? sent.get(entry.lineId)
      )
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._left = true;
    });

    // A row whose key moved is followed in place, as the settle sheet follows it.
    effect(() => {
      const row = this.row();
      if (row === null || this._left || this._following()) {
        return;
      }
      if (row.rowKey === this._rowKey()) {
        return;
      }
      untracked(() => void this._follow(row.rowKey));
    });

    // A row that is gone closes this view, once the basket has been read.
    effect(() => {
      if (
        this._left ||
        this._following() ||
        this._store.state() !== 'ready' ||
        this.row() !== null
      ) {
        return;
      }
      untracked(() => this.close());
    });
  }

  /** The back control, Escape and the scrim: back to the row's sheet. */
  protected close(): void {
    if (this._left) {
      return;
    }
    this._left = true;
    const key = this.row()?.rowKey ?? this._rowKey();
    void this._sheet.dismiss(
      settleSheetPath(
        this._locale(),
        this._basePath,
        this._store.address(),
        key
      )
    );
  }

  /** "Change" on one list, or "Change for all lists" with null. */
  protected change(lineId: string | null): void {
    const row = this.row();
    if (row === null) {
      return;
    }
    void this._router.navigateByUrl(
      changeSheetPath(
        this._locale(),
        this._basePath,
        this._store.address(),
        row.rowKey,
        lineId
      )
    );
  }

  /** One step of one list's ask: a typed amount is sent at once. */
  protected stepAsk(lineId: string, step: QuantityStep): void {
    if (!this._demandRuns.pending().has(lineId)) {
      // The first step of a run: what the person was looking at.
      const entry = this._entry(lineId);
      if (this._writes.has(lineId)) {
        this._seen.set(lineId, 'answer');
      } else if (entry !== undefined) {
        this._seen.set(lineId, entry.left);
      }
    }
    this._demandRuns.step(lineId, step);
    if (step.typed === true) {
      this._demandRuns.flush(lineId);
    }
  }

  /** A press on a locked stepper opens its popover, or closes it again. */
  protected explain(list: DrawnList): void {
    if (list.reason === null) {
      return;
    }
    if (this._closedByPress === list.lineId) {
      // This press already closed the popover, as a press outside it.
      this._closedByPress = null;
      return;
    }
    this.explained.update((open) =>
      open === list.lineId ? null : list.lineId
    );
  }

  /**
   * The popover closes itself: Escape, or a press outside it. A press on its own
   * stepper is outside it too, and it reaches the overlay before the stepper, so
   * its own press must not open the popover again at once.
   */
  protected unexplain(lineId: string, why?: AnchoredPopoverClose): void {
    if (this.explained() !== lineId) {
      return;
    }
    this.explained.set(null);
    if (why === 'outside') {
      this._closedByPress = lineId;
      // The stepper's click lands in the same task, so a later press opens again.
      setTimeout(() => {
        if (this._closedByPress === lineId) {
          this._closedByPress = null;
        }
      });
    }
  }

  private async _follow(rowKey: string): Promise<void> {
    this._following.set(true);
    await this._sheet.leaveTo(
      rowListsPath(
        this._locale(),
        this._basePath,
        this._store.address(),
        rowKey
      )
    );
    this._following.set(false);
  }

  private _entry(lineId: string): BasketRowEntry | undefined {
    return this.row()?.entries.find((held) => held.lineId === lineId);
  }

  /**
   * One run as one write: `quantity` is the list's new whole ask, and `from` the
   * entry's `left` the person was looking at when the run started (backend
   * `0274`). A run that started while a write of its line was in flight takes
   * that write's answer, never the entry as it is now: a change by somebody else
   * in between makes the server answer `stale_quantity`.
   */
  private async _demand(
    lineId: string,
    run: QuantityRun,
    seen: number | 'answer' | undefined
  ): Promise<boolean> {
    const entry = this._entry(lineId);
    if (entry === undefined) {
      this._answered.delete(lineId);
      return true;
    }
    // Without a recorded start (none is expected), what this basket's buys met of
    // the ask, which a change of the ask leaves, gives the left the run started at.
    const from =
      seen === 'answer'
        ? (this._answered.get(lineId) ?? entry.left)
        : (seen ?? Math.max(0, run.from - (entry.asked - entry.left)));
    this.failure.set(null);
    const result = await this._store.setDemand({
      lineId,
      quantity: run.to,
      from,
    });
    if (result === null) {
      this._answered.set(lineId, from);
      const error = this._store.error();
      this.failure.set({
        key: basketErrorKey(error, 'basket.demand'),
        count: this._entry(lineId)?.asked ?? run.to,
        correlationId: correlationIdOf(error),
      });
      return false;
    }
    const answered = this._entry(lineId);
    if (answered === undefined) {
      this._answered.delete(lineId);
    } else {
      this._answered.set(lineId, answered.left);
    }
    if (
      this._store.lineLeft(result, lineId) &&
      this._store.rowFor(this._rowKey()) === null
    ) {
      // The row left the basket, so the page says so: this view is about to go.
      this._store.handOver(
        this._translator.t(
          'basket.demand.nothingLeft',
          undefined,
          this._locale(),
          { name: this.product()?.name ?? entry.content }
        )
      );
    }
    return true;
  }

  /** One write per line at a time: a write queued behind one waits for it. */
  private _write(
    lineId: string,
    to: number,
    send: () => Promise<boolean>
  ): Promise<boolean> {
    const before = this._writes.get(lineId);
    const next = (before ?? Promise.resolve(true)).then(send, send);
    this._writes.set(lineId, next);
    this._sent.update((sent) => new Map(sent).set(lineId, to));
    void next.finally(() => {
      if (this._writes.get(lineId) === next) {
        this._writes.delete(lineId);
        this._sent.update((sent) => {
          const left = new Map(sent);
          left.delete(lineId);
          return left;
        });
      }
    });
    return next;
  }

  private _draw(
    row: BasketRow,
    entry: BasketRowEntry,
    open: number | undefined
  ): DrawnList {
    const locale = this._locale();
    const ref =
      entry.listId === null ? undefined : this._store.lists().get(entry.listId);
    const list =
      ref === undefined
        ? this._translator.t('basket.entries.otherList', undefined, locale)
        : ref.name;
    const line = entry.content.trim();
    const where =
      ref === undefined
        ? null
        : line === ''
          ? ref.zoneName
          : `${ref.zoneName} · ${line}`;
    const finished = this._store.finished();
    // The row sheet's rule (velista `0092`): an unserved list asks through its
    // stepper only when it is the whole row.
    const editable =
      !finished &&
      entry.demandEditable &&
      (entry.listId !== null || row.entries.length === 1);
    // Why the ask is locked (the owner, 2026-11-23). A served list is one the reader
    // writes, and only an approved member of its group can write a list, so the
    // reader is a member and a right on the list is missing (to manage it, or to
    // decide on an approved line), not the membership. Any other list is one this
    // reader was not served.
    const reason =
      editable || finished
        ? null
        : ref === undefined
          ? this._translator.t('basket.lists.notInGroup', undefined, locale)
          : this._translator.t('basket.lists.ownGroup', undefined, locale);
    const shown = open ?? entry.asked;
    return {
      lineId: entry.lineId,
      list,
      where,
      bought: this._translator.t('basket.lists.bought', undefined, locale, {
        ...boughtOf(entry.bought, entry.asked, entry.unit, locale),
      }),
      shown,
      shownSpoken: exactAmount(shown, entry.unit, locale).spoken,
      finished,
      editable,
      reason,
      reasonId: `row-lists-why-${entry.lineId}`,
      step: basketLineStep(entry, this._store.products(), (itemId) =>
        this._itemNames.nameOf(itemId)
      ),
      label:
        ref === undefined
          ? this._translator.t('basket.demand.label', undefined, locale)
          : this._translator.t('basket.demand.askLabel', undefined, locale, {
              name: list,
            }),
      name: list,
      changeable: this._changeable().has(entry.lineId),
      changeLabel: this._translator.t(
        'basket.change.oneLabel',
        undefined,
        locale,
        { name: list }
      ),
      product: this._lineProduct(
        row,
        entry,
        this._changeable().has(entry.lineId)
      ),
    };
  }

  /**
   * The product a list's line counts as (backend `0201`, section 1, the shared
   * rule), with the row's product as the pick. When the client cannot name it, a
   * changeable entry still draws its line, with the default icon and the line's
   * own name, so its "Change" stays; any other entry draws none.
   */
  private _lineProduct(
    row: BasketRow,
    entry: BasketRowEntry,
    changeable: boolean
  ): DrawnLineProduct | null {
    const id = lineProductOf(entry, row.productId) ?? row.productId;
    const facts: ProductFacts | null =
      id === null
        ? null
        : (this._store.products().get(id) ?? this._itemNames.nameOf(id));
    if (facts === null) {
      if (!changeable) {
        return null;
      }
      const line = entry.content.trim();
      return {
        name: line === '' ? row.content : line,
        brandSize: null,
        imageUrl: null,
        differs: id !== row.productId,
      };
    }
    const locale = this._locale();
    const translate = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);
    const size = productSizeText(
      facts.size,
      facts.unit,
      locale,
      translate,
      facts.approxWeight
    );
    const brandSize = [facts.brand?.trim() ?? '', size ?? '']
      .filter((part) => part !== '')
      .join(' ');
    return {
      name: catalogName(facts.name, locale),
      brandSize: brandSize === '' ? null : ` · ${brandSize}`,
      imageUrl: facts.imageUrl,
      differs: id !== row.productId,
    };
  }
}

/**
 * The two numbers of "Bought 0,5 of 1,5 kg": the ask in its words, and what was
 * bought as a figure in the ask's own name, so the two read in one unit. A count
 * is two plain numbers.
 */
function boughtOf(
  bought: number,
  asked: number,
  unit: LineUnit,
  locale: string
): { readonly bought: string; readonly asked: string } {
  const askedWords = formatAmount(asked, unit, locale);
  if (!isMeasured(unit)) {
    return { bought: formatAmount(bought, unit, locale), asked: askedWords };
  }
  const coarse = asked >= 1000;
  const value = coarse ? bought / 1000 : bought;
  let figure: string;
  try {
    figure = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 3,
    }).format(value);
  } catch {
    figure = String(Number(value.toFixed(3)));
  }
  return { bought: figure, asked: askedWords };
}
