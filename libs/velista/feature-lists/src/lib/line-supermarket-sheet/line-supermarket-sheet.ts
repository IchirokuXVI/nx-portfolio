import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { LineStore, ListStore } from '@portfolio/velista/data-access';
import {
  catalogName,
  LINE_PRICED_PRODUCTS_MAX,
  lineSupermarketRows,
} from '@portfolio/velista/models';
import { formatMoney, SheetNavigation } from '@portfolio/velista/platform';
import {
  ChainLogo,
  SheetShell,
  type ChainLogoView,
} from '@portfolio/velista/ui';
import { LineGoneNotice, watchLineGone } from '../line-gone/line-gone';
import { watchLineName } from '../line-page/line-name';
import { LineProductPrices } from '../line-page/line-product-prices';
import { lineUrls } from '../line-page/line-urls';
import { listErrorKey } from '../list-error-copy';

/** One radio row of the sheet, with every word already chosen. */
export interface SupermarketChoiceVm {
  /** The chain, or null for "Any supermarket". */
  readonly supermarketId: string | null;
  readonly name: string;
  /** Null on "Any supermarket", which has no logo. */
  readonly logo: ChainLogoView | null;
  /** The small text under the name. */
  readonly detailKey: string | null;
  readonly detailArgs: Readonly<Record<string, number>>;
  /** "from 2,15 €", or null with no price. */
  readonly price: string | null;
  readonly selected: boolean;
}

/**
 * Where a line is bought: one supermarket, or any (velista `0135`, section 3.2).
 *
 * A chain and never a shop. The rows are the supermarkets near the reader, each
 * with how many of the line's products it sells and its lowest price for them, so
 * the choice is made on numbers and not from memory.
 *
 * **A press picks, writes and closes.** No Save button: there is one value, and a
 * radio that needs a second press to count is a radio people leave unsaved.
 *
 * The choice is on the line, so the sheet says that everyone on the list sees it.
 *
 * It reads the prices through the line page's own `LineProductPrices`, which the
 * page provides to the sheets in its outlet. What the cards already read is not
 * read again.
 */
@Component({
  selector: 'lib-line-supermarket-sheet',
  imports: [RokuTranslatorPipe, SheetShell, ChainLogo, LineGoneNotice],
  templateUrl: './line-supermarket-sheet.html',
  styleUrl: './line-supermarket-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineSupermarketSheet {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _prices = inject(LineProductPrices);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _urls = lineUrls();

  /** The row being written, so it can say so and the others can wait. */
  readonly saving = signal<string | null | undefined>(undefined);
  readonly errorKey = signal<string | null>(null);

  readonly gone = watchLineGone({
    listId: this._urls.listId,
    lineId: this._urls.lineId,
    close: () => this.dismiss(),
  });

  private readonly _line = computed(() =>
    this._lines
      .linesIn(this._urls.listId())
      .find((line) => line.id === this._urls.lineId())
  );

  private readonly _name = watchLineName(() => this._line());

  readonly lineName = computed(() => this._name()?.text ?? '');

  readonly listName = computed(
    () =>
      this._lists
        .listsIn(this._urls.zoneId())
        .find((list) => list.id === this._urls.listId())?.name ?? ''
  );

  /** The products the sheet counts over: the first twenty (section 3.2). */
  private readonly _counted = computed<readonly string[]>(
    () => (this._line()?.itemIds ?? []).slice(0, LINE_PRICED_PRODUCTS_MAX),
    {
      equal: (a, b) =>
        a.length === b.length && a.every((itemId, i) => itemId === b[i]),
    }
  );

  /** Whether the line holds more products than the sheet counted. */
  readonly cut = computed(
    () => (this._line()?.itemIds.length ?? 0) > LINE_PRICED_PRODUCTS_MAX
  );
  readonly countedMax = LINE_PRICED_PRODUCTS_MAX;

  /** Where the reader shops. Undefined before the read, null when it failed. */
  readonly loading = computed(() => this._prices.context() === undefined);
  readonly failed = computed(() => this._prices.context() === null);

  readonly choices = computed<readonly SupermarketChoiceVm[]>(() => {
    const line = this._line();
    const context = this._prices.context();
    const locale = this._locale();
    this._translator.loaded();
    if (line === undefined) {
      return [];
    }

    const chosen = line.preferredSupermarketId;
    const any: SupermarketChoiceVm = {
      supermarketId: null,
      name: this._translator.t('list.supermarket.any', undefined, locale),
      logo: null,
      detailKey: 'list.supermarket.anyHint',
      detailArgs: {},
      price: null,
      selected: chosen === null,
    };

    const rows =
      context === undefined || context === null
        ? []
        : lineSupermarketRows(
            this._counted(),
            this._prices.priceOf,
            context,
            chosen
          );

    return [
      any,
      ...rows.map((row): SupermarketChoiceVm => {
        const name =
          row.name === null
            ? this._translator.t('list.supermarket.other', undefined, locale)
            : catalogName(row.name, locale);
        return {
          supermarketId: row.supermarketId,
          name,
          logo: { logoUrl: row.logoUrl, name, store: false },
          ...sellsOf(row.sells, row.of),
          price:
            row.lowest !== null && row.lowest.price !== null
              ? this._translator.t('list.supermarket.from', undefined, locale, {
                  price: formatMoney(
                    row.lowest.price,
                    row.lowest.currency,
                    locale
                  ),
                })
              : null,
          selected: row.selected,
        };
      }),
    ];
  });

  constructor() {
    // The prices of the products the cards did not read yet, and the context.
    effect(() => {
      const counted = this._counted();
      untracked(() => void this._prices.ensure(counted));
    });
  }

  /**
   * A press on the row that is already the answer, which changes no radio and so
   * fires no `change`. It closes the sheet, as any other row does.
   *
   * It returns nothing on purpose: a listener that answers false cancels the
   * click, and a cancelled click on a radio never checks it.
   */
  pressed(choice: SupermarketChoiceVm): void {
    if (choice.selected) {
      void this.pick(choice.supermarketId);
    }
  }

  /** A row was picked: write it, and close on success. */
  async pick(supermarketId: string | null): Promise<void> {
    const line = this._line();
    if (line === undefined || this.saving() !== undefined) {
      return;
    }

    // The row that is already the answer: nothing to write.
    if (line.preferredSupermarketId === supermarketId) {
      await this.dismiss();
      return;
    }

    this.saving.set(supermarketId);
    this.errorKey.set(null);

    const outcome = await this._lines.updateLine(line.id, {
      preferredSupermarketId: supermarketId,
    });

    if (outcome.state === 'failed') {
      this.saving.set(undefined);
      this.errorKey.set(
        listErrorKey(outcome.error, 'lines.write') ?? 'list.supermarket.failed'
      );
      return;
    }

    await this.dismiss();
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._urls.line());
  }
}

/**
 * How many of the products a supermarket sells, as a sentence.
 *
 * A line with one product gets its own two sentences, because "1 of the 1
 * products" is a count of nothing. A supermarket that is not near the reader has
 * no count at all, and says that instead.
 */
function sellsOf(
  sells: number | null,
  of: number
): Pick<SupermarketChoiceVm, 'detailKey' | 'detailArgs'> {
  if (sells === null) {
    return { detailKey: 'list.supermarket.notNear', detailArgs: {} };
  }
  if (of === 0) {
    return { detailKey: null, detailArgs: {} };
  }
  if (of === 1) {
    return {
      detailKey:
        sells === 1 ? 'list.supermarket.sellsIt' : 'list.supermarket.sellsNot',
      detailArgs: {},
    };
  }
  if (sells === 0) {
    return { detailKey: 'list.supermarket.none', detailArgs: {} };
  }
  if (sells === of) {
    return { detailKey: 'list.supermarket.all', detailArgs: { count: of } };
  }
  return {
    detailKey: 'list.supermarket.some',
    detailArgs: { sells, count: of },
  };
}
