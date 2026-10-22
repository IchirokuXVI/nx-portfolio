import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import {
  BasketStore,
  BasketViewStore,
  ProductPickStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketRowProduct,
  productChoices,
  type BasketRow,
  type BasketRowEntry,
  type ProductChoice,
} from '@portfolio/velista/models';
import {
  AppHistory,
  productPickPath,
  rowKeyOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import {
  CheckField,
  ChevronRightIcon,
  ProductRow,
  ProductRowSkeleton,
  productRowView,
  SearchIcon,
  SheetShell,
  type ProductRowSource,
  type ProductRowView,
} from '@portfolio/velista/ui';
import { basketErrorKey } from '../basket-error-copy';
import { settleSheetPath } from '../basket-paths';
import { ChangeChoices } from './change-choices';
import {
  basketProductOf,
  chainOfShop,
  changeableLineIds,
  changePriceScopes,
} from './change-targets';

/** The cards drawn while the products are read, of the height of a real card. */
const SKELETON_ROWS = [0, 1, 2, 3];

/** What the sheet keeps across a visit to the catalog that chooses. */
interface ChangeSheetState {
  readonly keep: boolean;
}

/**
 * One choice, as the compact card draws it (velista `0163`, section 1): the photo,
 * the product's name alone, `brand · size` under it, the words under those
 * ("Chosen now", "cheaper option", "Not sold here"), and the price with its price
 * per litre or kilo. The radio sits in the card's control slot.
 */
type ChoiceRow = ProductRowView;

/** The words under a choice, by what the list says about it. */
const CAPTION_KEYS = {
  chosenNow: 'basket.change.chosenNow',
  notSold: 'basket.change.notSold',
  cheaper: 'basket.change.cheaper',
} as const;

/**
 * Take another product for one list of a row, or for every list the reader may
 * change (velista `0140`, section 2; artboards `Change` and `ChangeAll`).
 *
 * Addressed at `<basket>/sheet/rows/:rowKey/change/:lineId` for one line and
 * `<basket>/sheet/rows/:rowKey/change` for all of them, beside the settle sheet,
 * which opens it. The cheaper mark of a row opens the second.
 *
 * ## One list of products
 *
 * The product chosen now, the other products of the lines and the members of
 * their groups, each once and with no heading between them, then what the shop
 * does not sell (`productChoices`). Each is the compact product card with its
 * radio at the right edge (velista `0163`), and the whole card is its label.
 * They are read by `ChangeChoices`. Below them, "Look for another one in the
 * catalog" opens the catalog page in its mode that chooses, and the product
 * chosen there comes back chosen in this list.
 *
 * ## What "Use this product" does
 *
 * `BasketStore.changeProduct`: with the checkbox, the product is kept for next
 * time; without it, the lines with a buy today are rewritten, and the rest are
 * held on this device until their first buy (section 4). The page says nothing
 * about a buy made today taking the new product. The owner removed that message.
 */
@Component({
  selector: 'lib-change-sheet',
  imports: [
    CheckField,
    ChevronRightIcon,
    ProductRow,
    ProductRowSkeleton,
    RokuTranslatorPipe,
    SearchIcon,
    SheetShell,
  ],
  providers: [ChangeChoices],
  templateUrl: './change-sheet.html',
  styleUrl: './change-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeSheet {
  private readonly _store = inject(BasketStore);
  private readonly _view = inject(BasketViewStore);
  private readonly _choices = inject(ChangeChoices);
  private readonly _pick = inject(ProductPickStore);
  private readonly _history = inject(AppHistory);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _rowKey = rowKeyOf(this._route);

  /** The one line the sheet is for, or null for every line the reader may change. */
  private readonly _lineId: string | null =
    this._route.snapshot.paramMap.get('lineId');

  protected readonly skeletonRows = SKELETON_ROWS;

  /** "Keep it for next time", on when the sheet opens. */
  protected readonly keep = signal(true);

  /** The product chosen in the list, or null while it is the one chosen now. */
  private readonly _selected = signal<string | null>(null);

  /** A product chosen in the catalog, drawn second in the list. */
  private readonly _picked = signal<string | null>(null);

  private readonly _busy = signal(false);
  protected readonly busy = this._busy.asReadonly();

  /** A change that was refused, said until the next press. */
  private readonly _failed = signal(false);

  private _left = false;

  protected readonly row = computed<BasketRow | null>(() =>
    this._store.rowFor(this._rowKey())
  );

  /** The lines the change is for, in the order the row holds them. */
  protected readonly targets = computed<readonly BasketRowEntry[]>(() => {
    const row = this.row();
    if (row === null) {
      return [];
    }
    const allowed = new Set(
      changeableLineIds(row, {
        guest: this._store.me()?.kind === 'GUEST',
        finished: this._store.finished(),
        lists: this._store.lists(),
      })
    );
    return row.entries.filter(
      (entry) =>
        allowed.has(entry.lineId) &&
        (this._lineId === null || entry.lineId === this._lineId)
    );
  });

  /** Whether this is "Change for all lists". */
  protected readonly forAll = this._lineId === null;

  /** The line the catalog is opened for, and that answers to this sheet. */
  private readonly _anchor = computed(() => this.targets()[0] ?? null);

  /** The product the row draws now. */
  private readonly _chosenId = computed(() => this.row()?.productId ?? null);

  /** The product chosen in the list: the one chosen now until another is. */
  protected readonly selected = computed(
    () => this._selected() ?? this._chosenId()
  );

  /** Another product is chosen, which is what enables the button. */
  protected readonly changed = computed(() => {
    const selected = this.selected();
    return selected !== null && selected !== this._chosenId();
  });

  protected readonly title = computed(() =>
    this.forAll
      ? this._translator.t(
          'basket.change.titleAll',
          undefined,
          this._locale(),
          {
            count: this.targets().length,
          }
        )
      : this._translator.t('basket.change.title', undefined, this._locale())
  );

  /** "List · line" for one, the names of the lists for all of them. */
  protected readonly subtitle = computed(() => {
    const lists = this._store.lists();
    const names = this.targets().map(
      (entry) =>
        (entry.listId === null ? null : lists.get(entry.listId)?.name) ?? ''
    );
    if (!this.forAll) {
      const entry = this.targets()[0];
      return entry === undefined
        ? ''
        : [names[0], entry.content.trim()]
            .filter((part) => part !== '')
            .join(' · ');
    }
    return listOf(
      names.filter((name) => name !== ''),
      this._locale()
    );
  });

  protected readonly useLabel = computed(() =>
    this.forAll
      ? this._translator.t('basket.change.useAll', undefined, this._locale(), {
          count: this.targets().length,
        })
      : this._translator.t('basket.change.use', undefined, this._locale())
  );

  protected readonly state = this._choices.state;

  /** Whether the basket is read at a shop, which "Not sold here" is about. */
  private readonly _atShop = computed(() => this._view.pricedAtShop());

  private readonly _list = computed<readonly ProductChoice[]>(() => {
    if (this._choices.state() !== 'ready') {
      return [];
    }
    return productChoices({
      chosenId: this._chosenId(),
      lineItemIds: this.targets().map((entry) => entry.itemIds),
      memberIds: this._choices.memberIds(),
      pickedId: this._picked(),
      priceOf: this._choices.priceOf,
    });
  });

  protected readonly choices = computed<readonly ChoiceRow[]>(() => {
    const locale = this._locale();
    // Read so the rows are drawn again once the words arrive.
    this._translator.loaded();
    const translate = (key: string, args?: Record<string, unknown>): string =>
      this._translator.t(key, undefined, locale, args);
    return this._list()
      .map((choice): ChoiceRow | null => {
        const source = this._sourceOf(choice.itemId);
        if (source === null) {
          return null;
        }
        const caption = choice.chosenNow
          ? CAPTION_KEYS.chosenNow
          : choice.notSold
            ? CAPTION_KEYS.notSold
            : choice.cheaper
              ? CAPTION_KEYS.cheaper
              : null;
        // The price the list priced it at, which is not always the catalog's
        // own offer: it is kept to the scopes of the basket.
        const view = productRowView(
          { ...source, offer: choice.offer },
          {
            locale,
            translate,
            // The sheet names no chain: the basket is priced where it is read.
            chainOf: () => null,
            chainChosen: true,
          }
        );
        const captionText = caption === null ? null : translate(caption);
        return {
          ...view,
          caption: captionText,
          // The radio is named by the whole card, as the row was read before
          // the card: the brand and size, the price and what the list says.
          label: [
            view.name,
            view.detail,
            view.price ?? translate('catalog.row.noPrice'),
            captionText,
          ]
            .filter((part): part is string => part !== null && part !== '')
            .join(', '),
        };
      })
      .filter((row): row is ChoiceRow => row !== null);
  });

  protected readonly errorKey = computed(() =>
    this._failed() ? basketErrorKey(this._store.error(), 'basket.change') : null
  );

  constructor() {
    // Read the products once the row and its lines are known, and again when the
    // shop or a product picked in the catalog changes what is asked.
    effect(() => {
      const targets = this.targets();
      if (targets.length === 0) {
        return;
      }
      const chosen = this._chosenId();
      const picked = this._picked();
      const shopId = this._store.shopRead();
      const scopes = this._store.basket()?.scopes;
      const itemIds = [
        ...(chosen === null ? [] : [chosen]),
        ...(picked === null ? [] : [picked]),
        ...targets.flatMap((entry) => entry.itemIds),
      ];
      const atShop = this._atShop();
      untracked(
        () =>
          void this._choices.load({
            itemIds,
            priceScopeIds: changePriceScopes(scopes, shopId),
            atShop,
          })
      );
    });

    // Back from the catalog: its answer is taken once, for the line it was for,
    // with the checkbox as it was left.
    effect(() => {
      const anchor = this._anchor();
      if (anchor === null) {
        return;
      }
      untracked(() => {
        const answer = this._pick.takeAnswer(anchor.lineId);
        if (answer === null) {
          return;
        }
        const state = answer.callerState as ChangeSheetState | undefined;
        if (state !== undefined) {
          this.keep.set(state.keep);
        }
        if (answer.itemId !== null) {
          this._picked.set(answer.itemId);
          this._selected.set(answer.itemId);
        }
      });
    });

    // Nothing to change: a guest who reached the URL, a row with no product, a
    // row that left, a list that cannot be edited. Once the basket is read, the
    // sheet goes back to the row.
    effect(() => {
      if (
        this._left ||
        this._busy() ||
        this._store.state() !== 'ready' ||
        this.targets().length > 0
      ) {
        return;
      }
      this._left = true;
      untracked(() => this.close());
    });
  }

  protected choose(itemId: string): void {
    this._failed.set(false);
    this._selected.set(itemId);
  }

  protected retry(): void {
    void this._choices.retry();
  }

  /** "Use this product", or "Use it for the 3 lists". */
  protected async use(): Promise<void> {
    const row = this.row();
    const itemId = this.selected();
    if (row === null || itemId === null || !this.changed() || this._busy()) {
      return;
    }
    this._busy.set(true);
    this._failed.set(false);
    const item = this._choices.itemOf(itemId);
    const price = this._choices.priceOf(itemId);
    const done = await this._store.changeProduct(
      row.rowKey,
      {
        lineIds: this.targets().map((entry) => entry.lineId),
        itemId,
        keep: this.keep(),
      },
      item === null
        ? null
        : basketProductOf(
            item,
            price.kind === 'priced' ? price.offer : null,
            this._atShop()
          )
    );
    this._busy.set(false);
    if (!done) {
      this._failed.set(true);
      return;
    }
    this._left = true;
    this.close();
  }

  /**
   * "Look for another one in the catalog": the catalog page in its mode that
   * chooses, for the first line of the change. It opens on the line's own words
   * and on the chain of the shop the basket is read at, and comes back here.
   */
  protected openCatalog(): void {
    const anchor = this._anchor();
    const ref =
      anchor?.listId == null
        ? undefined
        : this._store.lists().get(anchor.listId);
    if (anchor === null || ref === undefined) {
      return;
    }
    const locale = this._locale();
    this._pick.open({
      kind: 'one',
      lineId: anchor.lineId,
      forLabel: this.forAll
        ? this._translator.t('basket.change.pickForAll', undefined, locale, {
            count: this.targets().length,
          })
        : this._translator.t('basket.change.pickFor', undefined, locale, {
            list: ref.name,
          }),
      forDetail: this.forAll ? this.subtitle() : anchor.content.trim(),
      chosenId: this.selected(),
      returnUrl: this._router.url,
      returnDepth: this._history.depth(),
      callerState: { keep: this.keep() } satisfies ChangeSheetState,
    });

    const url = this._router.parseUrl(
      productPickPath(
        locale,
        this._basePath,
        ref.zoneId,
        ref.listId,
        anchor.lineId
      )
    );
    const query = anchor.content.trim();
    const chain = chainOfShop(
      this._store.basket()?.scopes,
      this._store.shopRead()
    );
    url.queryParams = {
      ...(query === '' ? {} : { q: query }),
      ...(chain === null ? {} : { chain }),
    };
    void this._router.navigateByUrl(url);
  }

  /** Close, Escape and the scrim: back to the row's sheet. */
  protected close(): void {
    void this._sheet.dismiss(
      settleSheetPath(
        this._locale(),
        this._basePath,
        this._store.address(),
        this.row()?.rowKey ?? this._rowKey()
      )
    );
  }

  /**
   * What the card of one choice is drawn from: the catalog's record, whose name
   * the card prints alone and whose brand and size go on the detail line through
   * `productRowView`, the text function every product card uses.
   */
  private _sourceOf(itemId: string): ProductRowSource | null {
    const item = this._choices.itemOf(itemId);
    if (item !== null) {
      return item;
    }
    // The product the row draws, named as the row names it, should the catalog
    // no longer hold it.
    const row = this.row();
    const product =
      row === null || row.productId !== itemId
        ? null
        : basketRowProduct(row, this._store.products());
    return product === null
      ? null
      : {
          id: itemId,
          name: product.name,
          brand: product.brand,
          imageUrl: product.imageUrl,
          size: null,
          unit: 'UNIT',
          offer: null,
          unitBasis: null,
        };
  }
}

/** `Intl.ListFormat`, which the TypeScript library of this workspace does not declare. */
type ListFormatConstructor = new (
  locale: string,
  options: { readonly style: 'long'; readonly type: 'conjunction' }
) => { format(items: readonly string[]): string };

/** "Compra semanal, Básicos and Cocina", in the reader's language. */
function listOf(names: readonly string[], locale: string): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatConstructor })
    .ListFormat;
  try {
    return ListFormat === undefined
      ? names.join(', ')
      : new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
          names
        );
  } catch {
    return names.join(', ');
  }
}
