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
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import type { CatalogSuggestion } from '@portfolio/velista/models';
import {
  ProductRow,
  ProductRowSkeleton,
  type ProductRowAdd,
  type ProductRowAdded,
  type ProductRowExpanded,
  type ProductRowLineStep,
} from '../catalog/product-row';
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
   * The list the line is on, or null. The basket names it because the same product
   * reaches it from several lists; a list page does not, because the reader is
   * looking at the list and names it once through {@link SuggestionList.listName}.
   */
  readonly listName: string | null;
  readonly quantity: number;
  /** Whether the stepper may move. A caller who may not change it sees it disabled. */
  readonly editable: boolean;
  /**
   * A write to the line is in flight. The stepper is disabled until it lands, as
   * the page's own row is, so a second press cannot resend the same step from a
   * count the server has not answered yet. Absent is not busy.
   */
  readonly busy?: boolean;
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
 * What the catalog offers for the words in a page's search (velista plan 0043,
 * section 6, and `0117`), in the page's own results.
 *
 * ## Why it is its own component
 *
 * It was the composer's, inline, and velista plan `0047` section 2 needed a second
 * caller. A second copy is where the ranking rules drift, so it moved out here and
 * both pages that search use it.
 *
 * ## The four rules it carries
 *
 * - **The ranking is the server's** and is never re-sorted. A group ranks above an item
 *   for a bare word, and that ranking was made with prices, scopes and synonyms this
 *   component has never seen. The cards draw it straight down, best first.
 * - **A finished search that found nothing says so, in one row** (velista `0108`,
 *   target 1). The row names the words and, where the composer can still add them,
 *   says that. It is drawn only for the words still in the field ({@link emptyFor}),
 *   and two characters or a search still running draw nothing.
 * - **The skeleton waits {@link SKELETON_DELAY_MS}** before it is drawn, so a fast
 *   answer, empty or not, is never preceded by a flash of grey cards.
 * - **A card says how big the packet is**, because the catalog holds one record per
 *   size and two cartons of the same milk are otherwise the same card twice over. See
 *   `productSizeText`, which is where the rule and its one exception live.
 *
 * ## One card
 *
 * Each suggestion is drawn as `lib-product-row`, the card of the catalog (velista
 * `0162`): the picture, the name, `brand · size · pack`, the chains that sell it with
 * the cheapest named, the price with the price per unit when it differs, the plus at
 * the right edge, and the lines already holding it under it. A press on the card
 * opens the product; a press on a group opens its products. The mock is
 * `apps/velista/plans/mocks/product-card/`.
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
    ProductRow,
    ProductRowSkeleton,
    RokuTranslatorPipe,
    SuggestionNoMatch,
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
   * The catalog is being asked and nothing has come back yet. Three skeleton cards
   * shaped like the cards they become are drawn, so the results do not jump under
   * the thumb when the answer lands (`Edge`).
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
   * (velista `0101`, section 4).
   */
  readonly holdingsOf = input<
    (suggestion: CatalogSuggestion) => readonly SuggestionHolding[]
  >(() => NO_HOLDINGS);

  /**
   * The name of the list the page draws, for the heading of the lines that hold a
   * product ("On Compra semanal"), or null where the lines come from several lists
   * (the shopping list).
   */
  readonly listName = input<string | null>(null);

  /**
   * The URL a press on a card opens for one product, or null for none. A page that
   * cannot open a product, a guest's basket, passes null, and its cards open
   * nothing: no link, no button and no press area, only the card's words. Nothing
   * here listens to the card's `opened`, so a link is the only way a card opens.
   */
  readonly productLink = input<((itemId: string) => string) | null>(null);

  /** The id the composer's field names in `aria-controls`. */
  readonly panelId = input('suggestion-panel');

  /** The label above the list, for a screen reader. Each caller names its own. */
  readonly label = input('list.add.suggestions');

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

  /** What each card says, in the order it is drawn. */
  protected readonly cards = computed<readonly SuggestionCardView[]>(() => {
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

  /** The plus and the held lines of each card, by key. */
  protected readonly adds = computed(() => {
    const holdingsOf = this.holdingsOf();
    const listName = this.listName();
    const locale = this._locale();
    this._translator.loaded();
    const t = (key: string, args?: Record<string, unknown>): string =>
      this._translator.t(key, undefined, locale, args);
    return new Map(
      this.cards().map((card) => [
        card.key,
        addOf(card, holdingsOf(card.suggestion), listName, t),
      ])
    );
  });

  /** Three skeleton cards while the catalog is slow. */
  protected readonly skeleton = [0, 1, 2] as const;

  /**
   * Whether the catalog has been slow for {@link SKELETON_DELAY_MS}. Set by a timer
   * that starts when {@link loading} does and is cancelled when it ends.
   */
  private readonly _slow = signal(false);

  /** The skeleton is drawn only for a search that is still running and has been slow. */
  protected readonly skeletonShown = computed(
    () => this.loading() && this._slow()
  );

  /**
   * The one card opened under itself, by key, and what it shows: every chain's
   * price, or a group's products. One at a time, because an opened card is tall.
   */
  protected readonly opened = signal<{
    readonly key: string;
    readonly part: ProductRowExpanded;
  } | null>(null);

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

  /** The plus of a card was pressed, with the button that was pressed. */
  protected choose(card: SuggestionCardView, added: ProductRowAdded): void {
    this.chose.emit({ suggestion: card.suggestion, anchor: added.anchor });
  }

  /**
   * **Nothing in the list may close the keyboard** (rule 2 of `0101`).
   *
   * The browser moves focus on `mousedown`, and iOS Safari raises a synthetic one
   * before it does, so cancelling it here keeps the caret in the composer's field
   * and the keyboard up, whatever inside the list was pressed: the plus, the chain
   * line, the reveal, the stepper or the card itself. Not `pointerdown` and not
   * `touchstart`: those carry the page's own scroll, and cancelling them would take
   * it away.
   */
  protected holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  protected expandedOf(card: SuggestionCardView): ProductRowExpanded | null {
    const open = this.opened();
    return open !== null && open.key === card.key ? open.part : null;
  }

  /**
   * A chain line or a group was pressed: open that part under the card, or close
   * it. An opened card grows downward, past the bottom of the screen, so once it has
   * drawn, the page scrolls just far enough to show the whole card, or its top when
   * the card is taller than the screen. Nothing moves when a card closes.
   */
  protected toggle(card: SuggestionCardView, part: ProductRowExpanded): void {
    const open = this.opened();
    if (open !== null && open.key === card.key && open.part === part) {
      this.opened.set(null);
      return;
    }
    this.opened.set({ key: card.key, part });
    afterNextRender(
      () => {
        this._host.nativeElement
          .querySelector<HTMLElement>(`[data-card="${card.key}"]`)
          ?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this._injector }
    );
  }

  /** The URL a press on the card opens, or null for a group or a page with none. */
  protected linkFor(card: SuggestionCardView): string | null {
    const link = this.productLink();
    return link === null || card.productId === null
      ? null
      : link(card.productId);
  }

  /** A held line's stepper was pressed: one more or one fewer, from and to. */
  protected stepHolding(
    card: SuggestionCardView,
    step: ProductRowLineStep
  ): void {
    const holding = this.holdingsOf()(card.suggestion).find(
      (candidate) => candidate.lineId === step.lineId
    );
    if (holding === undefined || holding.busy === true) {
      return;
    }
    this.holdingChanged.emit({
      holding,
      from: holding.quantity,
      to: holding.quantity + step.by,
    });
  }
}

/**
 * The plus of a card and the lines under it: the page's holdings as the card's
 * held lines, headed by the list they are on, or by "On your lists" where they come
 * from several and each line names its own.
 */
function addOf(
  card: SuggestionCardView,
  holdings: readonly SuggestionHolding[],
  listName: string | null,
  t: (key: string, args?: Record<string, unknown>) => string
): ProductRowAdd {
  const lists = new Set(holdings.map((holding) => holding.listName));
  const only = lists.size === 1 ? [...lists][0] : null;
  const list = listName ?? only ?? null;
  return {
    list: list ?? '',
    label: card.pickLabel,
    title:
      list === null
        ? t('catalog.held.titleMany')
        : t('catalog.held.title', { list }),
    lines: holdings.map((holding) => ({
      lineId: holding.lineId,
      name: holding.text,
      quantity: holding.quantity,
      editable: holding.editable && holding.busy !== true,
      pending: false,
      list: list === null ? holding.listName : null,
      stepperLabel: t('list.add.card.alreadyQuantity', { line: holding.text }),
    })),
  };
}
