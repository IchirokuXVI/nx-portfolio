import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { inLocale, type CatalogSuggestion } from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import { BasketIcon, PlusIcon, ProductIcon } from '../icons/icons';

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
 * ## The three rules it carries
 *
 * - **The ranking is the server's** and is never re-sorted. A group ranks above an item
 *   for a bare word, and that ranking was made with prices, scopes and synonyms this
 *   component has never seen. Which end of it sits nearest the field is a different
 *   question, and it is {@link placement} that answers it. See {@link rows}.
 * - **No empty state, ever.** An absent list is the ordinary case for two characters, a
 *   rare word, or a shop the catalog has not been taught, and "no matches" would be a
 *   screen telling somebody their shopping list is wrong.
 * - **A row says how big the packet is**, because the catalog holds one record per
 *   size and two cartons of the same milk are otherwise the same row twice over. See
 *   {@link sizeOf}, which is where the rule and its one exception live.
 *
 * ## Free text belongs to the caller
 *
 * The last row, "add it as written", is drawn only when {@link asWritten} is given, and
 * that is the one thing that genuinely differs between the two callers. The composer
 * adds a line, and a line is free text first: "Something for dinner" is legitimate and
 * the moment the composer insists on a match, adding things becomes a fight. The line
 * page is **attaching a catalog product** to a line that already exists, and there is
 * no such thing as attaching a product that is not in the catalog, so it passes null
 * and the row is absent rather than present and refusing.
 *
 * ## Where it goes is the caller's, and {@link placement} is how it says so
 *
 * The rows are identical on both screens. What differs is the direction the list
 * grows in, and two things follow from that direction which are not decoration. See
 * {@link placement}.
 */
@Component({
  selector: 'lib-suggestion-list',
  imports: [RokuTranslatorPipe, BasketIcon, PlusIcon, ProductIcon],
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
   *
   * Read through {@link rows} rather than drawn directly, because which end of the
   * ranking sits nearest the field depends on which side of it the panel opens.
   */
  readonly suggestions = input<readonly CatalogSuggestion[]>([]);

  /** What has been typed, for the free text row, or null to omit that row entirely. */
  readonly asWritten = input<string | null>(null);

  /** The label above the list, for a screen reader. Each caller names its own. */
  readonly label = input('list.add.suggestions');

  /**
   * Where this list sits relative to the field it belongs to.
   *
   * `'below'`, the default, is the line page's: inline under a search field with
   * nothing in the way, growing downward on the page's own ground.
   *
   * `'above'` is the composer's: pinned to the bottom of the screen with the
   * keyboard under it, so the list grows **upward over the lines**. Two things
   * follow from that and neither is a style anybody may tune away:
   *
   * - **It is opaque.** It covers rows of somebody's shopping list, and a
   *   transparent panel over them is two lists of words in the same place. It was
   *   exactly that until this input existed.
   * - **It opens at its last row.** The rows nearest the field are the ones under
   *   the thumb, and the last of them is the free text row, which is the one that is
   *   always there and always works. A panel that opened at the top of a scrolling
   *   list hid it behind rows the catalog merely offered.
   * - **It is read bottom to top**, so the ranking is drawn that way round. See
   *   {@link rows}.
   */
  readonly placement = input<'below' | 'above'>('below');

  /**
   * The suggestions in the order they are **drawn** in, which is not always the order
   * they arrived in.
   *
   * `'below'` draws the ranking straight down. The field is above the list, reading
   * starts at the top, and the first row met is the best answer.
   *
   * `'above'` is read the other way round, and this is the whole of why it exists. The
   * panel is pinned to the bottom of the screen with the field and the thumb under it,
   * and it opens at its last row, so the row nearest the field is the one everybody
   * sees first and the list climbs away from there. Drawn top to bottom, that put the
   * server's best answer furthest from the thumb, at the far end of a list that
   * usually needs scrolling to reach. Reversed, the panel reads outward from the
   * field: the free text row at the bottom where it already was, the server's first
   * suggestion directly above it, and the rest of the ranking climbing away in order.
   *
   * The ranking is still the server's and is still never re-sorted. Reversing it is
   * not a second opinion about which answer is best; it is where the bottom of the
   * panel is, and a panel that opens at its bottom has to be filled from there.
   *
   * The free text row is not in here. It is drawn after these, so it stays the last
   * row in both placements: at the far end of an inline list, and under the thumb in
   * the composer's.
   */
  readonly rows = computed<readonly CatalogSuggestion[]>(() => {
    const offered = this.suggestions();
    return this.placement() === 'above' ? [...offered].reverse() : offered;
  });

  readonly chose = output<CatalogSuggestion>();

  /** The free text row was pressed. Only reachable when {@link asWritten} is set. */
  readonly choseAsWritten = output<void>();

  /**
   * The reader's language, for the catalog's two-language product names.
   *
   * Read rather than flattened in the mapper, which is the convention every other
   * catalog name in this app follows: a response parsed once must not carry the
   * language it happened to be parsed in, or switching language leaves the old words on
   * screen until something evicts the cache.
   */
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The scrolling panel, absent while there is nothing to offer. */
  private readonly _panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    // Opened at its last row, for `'above'` only, and re-opened there on every new
    // set of results: a panel that grows upward is read from the bottom, and the row
    // at the bottom is the one that always works.
    //
    // `afterRenderEffect` because the rows have to be in the DOM before the panel can
    // be measured, and because it runs in the browser and never on the server (plan
    // 0001, D2). It is the shape the assistant column and the comments sheet already
    // use to follow their own newest entry.
    //
    // Both inputs are read, so a set of results that arrives one keystroke after the
    // last one re-anchors rather than leaving the panel wherever the previous list
    // happened to be scrolled to. There is no "unless they scrolled up" exception
    // here, unlike the comments sheet: this list is replaced wholesale by every
    // keystroke, so a scroll position from a query nobody is typing any more is not a
    // place anybody chose to be.
    afterRenderEffect(() => {
      if (this.placement() !== 'above') {
        return;
      }

      this.suggestions();
      this.asWritten();

      const panel = this._panel()?.nativeElement;
      if (panel === undefined) {
        return;
      }

      panel.scrollTop = panel.scrollHeight;
    });
  }

  /** One suggestion's name, in the reader's language. */
  nameOf(suggestion: CatalogSuggestion): string {
    return suggestion.kind === 'group'
      ? inLocale(suggestion.group.name, this._locale())
      : inLocale(suggestion.item.name, this._locale());
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
