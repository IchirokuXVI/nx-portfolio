import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
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
 * ## The two rules it carries
 *
 * - **The order is the server's** and is never re-sorted. A group ranks above an item
 *   for a bare word, and that ranking was made with prices, scopes and synonyms this
 *   component has never seen.
 * - **No empty state, ever.** An absent list is the ordinary case for two characters, a
 *   rare word, or a shop the catalog has not been taught, and "no matches" would be a
 *   screen telling somebody their shopping list is wrong.
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
   * What to offer, in the **server's** order.
   *
   * Handed down rather than fetched here, which is rule D1: this component knows what
   * a suggestion looks like and nothing about where it came from, the debounce, or the
   * scope. It is also what keeps the ordering honest, since a component that fetched
   * would eventually be tempted to re-rank.
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
   *
   * The ordering is untouched by either. The server's ranking is drawn top to bottom
   * in both placements, and only which end of it the panel is scrolled to differs.
   */
  readonly placement = input<'below' | 'above'>('below');

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

  /** What a group row says it will do, so choosing it is not a surprise. */
  groupSummaryArgs(suggestion: CatalogSuggestion): { count: number } {
    return {
      count:
        suggestion.kind === 'group'
          ? suggestion.itemIds.length || suggestion.group.itemCount
          : 0,
    };
  }
}
