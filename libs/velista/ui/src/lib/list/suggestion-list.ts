import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { catalogName, type CatalogSuggestion } from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import {
  BasketIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  InfoIcon,
  PlusIcon,
  ProductIcon,
} from '../icons/icons';
import { QuantityStepper } from './quantity-stepper';
import {
  suggestionCardView,
  type SuggestionCardView,
} from './suggestion-card-view';
import { SuggestionNoMatch } from './suggestion-no-match';

/**
 * A line that already holds the product a card offers (velista `0101`, section 4).
 *
 * Built by the page, because only the page holds its lines: the zone list page
 * joins its own lines, the basket its own rows, each already naming the list it
 * came from. So it is a join in the client and not a field anybody asks for.
 */
export interface SuggestionHolding {
  /** Unique within one card. The line id on a list, the row and line on a basket. */
  readonly key: string;
  readonly lineId: string;
  /** The line's own words, so a renamed line says what it was renamed to (rule T7). */
  readonly text: string;
  /**
   * The list the line is on, drawn above its words, or null. The basket names it
   * because the same product reaches it from several lists; a list page does not,
   * because the reader is looking at the list.
   */
  readonly listName: string | null;
  readonly quantity: number;
  /** Whether the stepper may move. A caller who may not change it sees it disabled. */
  readonly editable: boolean;
}

/** A holding's stepper moved, once per press. */
export interface SuggestionHoldingChange {
  readonly holding: SuggestionHolding;
  readonly from: number;
  readonly to: number;
}

/** A suggestion chosen, and the button it was chosen with. */
export interface SuggestionChoice {
  readonly suggestion: CatalogSuggestion;
  readonly anchor: HTMLElement;
}

const NO_HOLDINGS: readonly SuggestionHolding[] = [];

/**
 * How long the catalog may take before the skeleton is drawn (velista `0108`,
 * target 1). An answer faster than this lands with no skeleton before it, so a
 * search with no results does not flash three grey cards and then a sentence.
 */
export const SKELETON_DELAY_MS = 150;

/**
 * Where the group popover opens: above its badge, centred, since the panel sits
 * over the keyboard and the room is upward; below it when the badge is near the
 * top of the screen.
 */
const POPOVER_POSITIONS: ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetY: -9,
  },
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: 9,
  },
];

/**
 * What the catalog offers under a field somebody is typing into (velista plan 0043,
 * section 6).
 *
 * ## Why it is its own component
 *
 * It was the composer's, inline, and velista plan `0047` section 2 needed a second
 * caller: the line page draws an "Add a product" chip, which was decoration rather than
 * a control, and making it a control meant either reusing this list or writing a second
 * one. A second one is where the ranking rules drift, so it moved out here and the
 * composer now uses the extracted component like anybody else.
 *
 * ## The four rules it carries
 *
 * - **The ranking is the server's** and is never re-sorted. A group ranks above an item
 *   for a bare word, and that ranking was made with prices, scopes and synonyms this
 *   component has never seen. Both placements draw it straight down, best first.
 * - **A finished search that found nothing says so, in one row** (velista `0108`,
 *   target 1). It used to draw nothing at all, on the grounds that "no matches" reads
 *   as the shopping list being wrong; on a phone the empty answer read as a search that
 *   never ran. The row names the words and, where the composer can still add them,
 *   says that. It is the cards' placement only, it is drawn only for the words
 *   still in the field ({@link emptyFor}), and two characters or a search still
 *   running draw nothing, as before.
 * - **The skeleton waits {@link SKELETON_DELAY_MS}** before it is drawn, so a fast
 *   answer, empty or not, is never preceded by a flash of grey cards.
 * - **A row says how big the packet is**, because the catalog holds one record per
 *   size and two cartons of the same milk are otherwise the same row twice over. See
 *   {@link sizeOf}, which is where the rule and its one exception live.
 *
 * ## Two drawings, by placement
 *
 * A page's results (`'page'`) draw **product cards** since velista `0101`: a
 * photograph's place, the name, the pack, the price, the price per unit when it
 * differs, the chains that sell it with the cheapest named, a way through to the
 * product, the lines already holding it, and one button down the right edge that is
 * the only thing on the card that adds it. The mock is `apps/velista/plans/mocks/
 * typeahead/`, and the canvas is the specification. They were the composer's panel
 * above its field until velista `0117` made that field the page's search, and the
 * page draws them in its results now.
 *
 * The line page (`'below'`) keeps its one line rows.
 *
 * ## No free text row
 *
 * The composer used to end its panel with "add it as written". `0101` removed it: the
 * composer's own button already adds the typed words. A line is still free text
 * first; the button beside the field is how.
 */
@Component({
  selector: 'lib-suggestion-list',
  imports: [
    RokuTranslatorPipe,
    BasketIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ClockIcon,
    InfoIcon,
    PlusIcon,
    ProductIcon,
    QuantityStepper,
    SuggestionNoMatch,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    RouterLink,
  ],
  templateUrl: './suggestion-list.html',
  styleUrl: './suggestion-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionList {
  /**
   * What to offer, in the **server's** ranking, best first.
   *
   * Handed down rather than fetched here, which is rule D1: this component knows what
   * a suggestion looks like and nothing about where it came from, the debounce, or the
   * scope. It is also what keeps the ordering honest, since a component that fetched
   * would eventually be tempted to re-rank.
   */
  readonly suggestions = input<readonly CatalogSuggestion[]>([]);

  /**
   * The catalog is being asked and nothing has come back yet. The cards'
   * placement draws three skeleton cards shaped like the cards they become, so the
   * results do not jump under the thumb when the answer lands (`Edge`).
   */
  readonly loading = input(false);

  /**
   * The words these suggestions answer, or null when nothing has been asked. Read
   * for one thing: a group card that matched through a synonym names it (velista
   * `0108`, target 4).
   */
  readonly query = input<string | null>(null);

  /**
   * The words a **finished** search answered with nothing, while they are still the
   * words in the field, or null (velista `0108`, target 1). The composer decides it,
   * because only the composer knows what is in the field now; this draws the row.
   */
  readonly emptyFor = input<string | null>(null);

  /**
   * Whether the composer can still add the typed words as a line of their own, which
   * the no results row then says. The composer's own button is how.
   */
  readonly freeText = input(false);

  /**
   * The lines already holding what a card offers, by the page that holds them
   * (velista `0101`, section 4). The composer's cards only.
   */
  readonly holdingsOf = input<
    (suggestion: CatalogSuggestion) => readonly SuggestionHolding[]
  >(() => NO_HOLDINGS);

  /**
   * The URL a card's "Details" opens for one product, or null for no link. A
   * page that cannot open a product, a guest's basket, passes null.
   */
  readonly productLink = input<((itemId: string) => string) | null>(null);

  /** The id the composer's field names in `aria-controls`. */
  readonly panelId = input('suggestion-panel');

  /** The label above the list, for a screen reader. Each caller names its own. */
  readonly label = input('list.add.suggestions');

  /**
   * Where this list is drawn.
   *
   * `'below'`, the default, is the line page's: one line rows inline under a search
   * field with nothing in the way, growing downward on the page's own ground.
   *
   * `'page'` is the product cards in a page's own results (velista `0117`), under the
   * lines of the list that matched. The page scrolls them with everything else, so
   * there is no cap and no surface of their own. They were the composer's panel above
   * its field until the composer's field became the page's search.
   *
   * Both draw the server's ranking straight down, best first.
   */
  readonly placement = input<'below' | 'page'>('below');

  /**
   * A suggestion was chosen, with the button that chose it. The basket holds its
   * list picker against that button (velista `0116`), and the list page ignores it.
   */
  readonly chose = output<SuggestionChoice>();

  /** A line holding the product was stepped up or down from a card. */
  readonly holdingChanged = output<SuggestionHoldingChange>();

  /**
   * The reader's language, for the catalog's two-language product names.
   *
   * Read rather than flattened in the mapper, which is the convention every other
   * catalog name in this app follows: a response parsed once must not carry the
   * language it happened to be parsed in, or switching language leaves the old words on
   * screen until something evicts the cache.
   */
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly _translator = inject(RokuTranslatorService);

  private readonly _injector = inject(Injector);

  /**
   * What each card says, in the order it is drawn. The composer's and a page's
   * results; the line page keeps its one line rows.
   */
  protected readonly cards = computed<readonly SuggestionCardView[]>(() => {
    if (this.placement() === 'below') {
      return [];
    }
    const locale = this._locale();
    // Read so the cards are drawn again once the words arrive.
    this._translator.loaded();
    const now = new Date();
    const query = this.query();
    return this.suggestions().map((suggestion) =>
      suggestionCardView(suggestion, {
        locale,
        now,
        query,
        translate: (key, args) =>
          this._translator.t(key, undefined, locale, args),
      })
    );
  });

  /** The three skeleton cards' bar widths, in percent, so each reads differently. */
  protected readonly skeleton: readonly (readonly number[])[] = [
    [62, 41, 33],
    [48, 56, 29],
    [70, 37, 33],
  ];

  /**
   * Whether the catalog has been slow for {@link SKELETON_DELAY_MS}. Set by a timer
   * that starts when {@link loading} does and is cancelled when it ends.
   */
  private readonly _slow = signal(false);

  /** The skeleton is drawn only for a search that is still running and has been slow. */
  protected readonly skeletonShown = computed(
    () => this.loading() && this._slow()
  );

  protected readonly popoverPositions = POPOVER_POSITIONS;

  /** The one card whose chain row is open, by key. One at a time: an opened card is tall. */
  protected readonly openChains = signal<string | null>(null);

  /** The one group whose products are revealed, by key. */
  protected readonly openGroup = signal<string | null>(null);

  /** The one group whose popover is open, by key. */
  protected readonly infoFor = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      if (!this.loading()) {
        this._slow.set(false);
        return;
      }
      const timer = setTimeout(() => this._slow.set(true), SKELETON_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** A card or a row was chosen, with the button it was chosen by. */
  protected choose(suggestion: CatalogSuggestion, event: Event): void {
    this.chose.emit({
      suggestion,
      anchor: event.currentTarget as HTMLElement,
    });
  }

  /**
   * **Nothing in the list may close the keyboard** (rule 2 of `0101`).
   *
   * The browser moves focus on `mousedown`, and iOS Safari raises a synthetic one
   * before it does, so cancelling it here keeps the caret in the composer's field
   * and the keyboard up, whatever inside the list was pressed: the add button,
   * the chain row, the reveal, the badge, the stepper, the popover (a native
   * popover inserted beside its badge, so its events bubble through here too) or
   * the card itself. Not `pointerdown` and not `touchstart`: those carry the
   * page's own scroll, and cancelling them would take it away.
   */
  protected holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  protected toggleChains(card: SuggestionCardView): void {
    this.openChains.update((open) => (open === card.key ? null : card.key));
    this._showOpened(card, this.openChains);
  }

  protected toggleGroup(card: SuggestionCardView): void {
    this.openGroup.update((open) => (open === card.key ? null : card.key));
    this._showOpened(card, this.openGroup);
  }

  /**
   * An opened card grows downward, past the bottom of the screen. So once it has
   * drawn, the page scrolls just far enough to show the whole card, or its top when
   * the card is taller than the screen. Nothing moves when a card closes.
   */
  private _showOpened(
    card: SuggestionCardView,
    open: () => string | null
  ): void {
    if (open() !== card.key) {
      return;
    }
    afterNextRender(
      () => {
        this._host.nativeElement.parentElement
          ?.querySelector<HTMLElement>(`[data-card="${card.key}"]`)
          ?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this._injector }
    );
  }

  protected toggleInfo(card: SuggestionCardView): void {
    this.infoFor.update((open) => (open === card.key ? null : card.key));
  }

  protected closeInfo(): void {
    this.infoFor.set(null);
  }

  /** The popover closes on Escape, and the keypress goes no further. */
  protected onPopoverKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeInfo();
    }
  }

  protected holdingsFor(
    card: SuggestionCardView
  ): readonly SuggestionHolding[] {
    return this.holdingsOf()(card.suggestion);
  }

  protected linkFor(card: SuggestionCardView): string | null {
    const link = this.productLink();
    return link === null || card.productId === null
      ? null
      : link(card.productId);
  }

  protected stepHolding(holding: SuggestionHolding, to: number): void {
    if (to === holding.quantity) {
      return;
    }
    this.holdingChanged.emit({ holding, from: holding.quantity, to });
  }

  /** The words the stepper is announced with, naming the line it moves. */
  protected holdingLabel(holding: SuggestionHolding): string {
    return this._translator.t(
      'list.add.card.alreadyQuantity',
      undefined,
      this._locale(),
      { line: holding.text }
    );
  }

  /** One suggestion's name, in the reader's language. */
  nameOf(suggestion: CatalogSuggestion): string {
    return suggestion.kind === 'group'
      ? catalogName(suggestion.group.name, this._locale())
      : catalogName(suggestion.item.name, this._locale());
  }

  /**
   * An item row's note line: the brand, the price after it, or one of them, or
   * nothing at all (velista `0063`, section 6.1).
   *
   * One string and not two fields, so a row with a price and a row without are
   * the same shape. The price is a suffix joined by the separator the app
   * already uses, which is what `basket-line-row` does with the same figure, so
   * two screens quoting a product say it the same way.
   *
   * **A product with no price says nothing about price**: no dash, no label, no
   * reserved blank. The pick sheet's "No price" exception does not reach here,
   * because that list is the comparable options of one line and this one is
   * whatever matched three characters (section 6.3). Null when there is neither
   * a brand nor a price, and the template then draws no note element at all.
   *
   * An offer whose `price` is null returns the brand alone, so the unpriced case
   * is one branch rather than a scattering of them.
   *
   * The price is the price of **this packet** and is never divided by anything:
   * the catalog holds one record per size, so the six pack row is a different
   * row from the 1 L row and quotes its own price. `unitPrice` is on the model
   * and deliberately not drawn (section 6.4): a second number in a place with
   * room for one, whose whole value is a comparison this list cannot make.
   */
  noteOf(suggestion: CatalogSuggestion): string | null {
    if (suggestion.kind !== 'item') {
      return null;
    }

    const { brand, offer } = suggestion.item;
    if (offer === null || offer.price === null) {
      return brand;
    }

    const price = formatMoney(offer.price, offer.currency, this._locale());
    return brand === null ? price : `${brand} · ${price}`;
  }

  /**
   * A group row's price, as a key and the money to put in it, or null when the
   * group has none (velista `0063`, section 6.6).
   *
   * **Labelled, and an item's is not.** An item row's number is the price of the
   * thing that row adds; a group adds several products and no single price among
   * them is what the row costs, so a bare number under a group would read like an
   * item's and mean something else. "Best price" says the number is the floor
   * rather than the total.
   *
   * What the number is: the price of the group's most economical member, which
   * the server picks per litre or per kilo, so it is **not always the smallest
   * number** among the products under it. That is right for a group, which is a
   * kind of thing rather than a packet: the best price for milk is the most
   * economical way to buy milk. The row does not name the member.
   *
   * The shape is `sizeOf`'s, and for the same reason: **the component never
   * translates.** The key reaches the template and the pipe renders it. What
   * this does is format the money, in the reader's language, and decide whether
   * there is anything to say.
   */
  bestPriceOf(
    suggestion: CatalogSuggestion
  ): { key: string; args: { price: string } } | null {
    if (suggestion.kind !== 'group') {
      return null;
    }

    const offer = suggestion.offer;
    if (offer === null || offer.price === null) {
      return null;
    }

    return {
      key: 'list.add.bestPrice',
      args: {
        price: formatMoney(offer.price, offer.currency, this._locale()),
      },
    };
  }

  /** What a group row says it will do, so choosing it is not a surprise. */
  groupSummaryArgs(suggestion: CatalogSuggestion): { count: number } {
    return {
      count: suggestion.kind === 'group' ? suggestion.itemIds.length : 0,
    };
  }

  /**
   * How big the packet is, as a key and the number to put in it, or null when
   * there is nothing worth saying.
   *
   * **This is what stops the list drawing the same row three times.** The catalog
   * holds one record per size, so "Leche entera Hacendado" at 1 L, at 1.5 L and
   * at 6 L are three products carrying the same name and the same brand. Every
   * field the row drew was identical, and the answer looked like a bug in the
   * search rather than three genuinely different cartons.
   *
   * ## Suppressed below two, for counts only
   *
   * A mass or a volume is always drawn when the catalog has one: most sizes are
   * **below** one (0.35 kg, 0.75 L), which is exactly where two records differ,
   * so a rule that only spoke above one would stay silent on the case it exists
   * for.
   *
   * `UNIT` and `PACK` are the exception, and it is a real one rather than a
   * tidy-up: they are counts, and "1 unit" is what every single product is. It
   * says nothing, it says it on every row at once, and a size that appears
   * everywhere distinguishes nothing. Twelve eggs beside one lettuce is worth a
   * row's width; one lettuce beside one cucumber is not.
   *
   * A count is also where {@link UNIT_OF_MEASURE_FALLBACK} lands, so a unit this
   * build has never heard of is suppressed by the same rule rather than
   * announcing a number in a unit nobody here can name.
   */
  sizeOf(
    suggestion: CatalogSuggestion
  ): { key: string; args: { size: string } } | null {
    if (suggestion.kind !== 'item') {
      return null;
    }

    const { size, unit } = suggestion.item;
    // Zero and below are not sizes. They reach here only from a catalog row that
    // is wrong about itself, and drawing "0 kg" beside a product is worse than
    // drawing nothing.
    if (size === null || size <= 0) {
      return null;
    }
    if ((unit === 'UNIT' || unit === 'PACK') && size < 2) {
      return null;
    }

    return {
      key: `list.add.size.${unit}`,
      args: { size: this._sizeFormat().format(size) },
    };
  }

  /**
   * The number, in the reader's language: `0,35` for a Spanish reader and `0.35`
   * for an English one, which is the same rule every other number in velista
   * follows.
   *
   * Three fraction digits because that is what the catalog's own precision comes
   * to once trailing zeroes are dropped: `1.0` reads as "1" rather than "1.000",
   * and `0.075` survives.
   *
   * Held in a `computed` rather than built per row: `Intl.NumberFormat` is the
   * expensive part of formatting a number, and this method runs once per row on
   * every change detection pass over a list that a keystroke replaces whole.
   */
  private readonly _sizeFormat = computed(
    () =>
      new Intl.NumberFormat(this._locale(), {
        maximumFractionDigits: 3,
      })
  );
}
