import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One shop, with every string already chosen in the reader's language. */
export interface ShopRow {
  readonly id: string;
  /** The chain, always drawn: a location name alone does not identify a shop. */
  readonly chain: string;
  /** The shop's own name, which most shops of a chain do not have. */
  readonly name: string | null;
  /** Street and town, joined, or null when the catalog holds neither. */
  readonly where: string | null;
  readonly postalCode: string | null;
  readonly excluded: boolean;
  /** The brand is refused, which makes this row inert (backend plan 0064, section 2.1). */
  readonly excludedChain: boolean;
  readonly failed: boolean;
}

/** Shops that share a postal code, under the name the profile gave that code. */
export interface ShopGroup {
  readonly key: string;
  /** `ProfilePostalCode.label`, falling back to the code itself (section 3.3). */
  readonly heading: string;
  /** Drawn beside the heading when the heading is a label rather than the code. */
  readonly code: string | null;
  readonly shops: readonly ShopRow[];
}

/**
 * The shops of one franchise, grouped by postal code (plan 0059, section 3.3).
 *
 * ## Why grouped rather than sorted
 *
 * A profile can hold several codes and they are not near each other: home in Córdoba and
 * work in Madrid produce one franchise's shops from two cities, and a flat list
 * interleaves them with nothing to tell them apart. There is no single point to sort by
 * distance from, because there are two of them, so distance is not the axis and the
 * postal code is.
 *
 * ## The row is the target and the row is a checkbox
 *
 * `ChainPreferenceList`'s shape, for its reasons: a `<label>` wrapping a real checkbox,
 * so the whole 44px row toggles and the widget assistive technology already understands
 * is the one announcing. Checked means **included**, which is the question the row asks
 * out loud.
 *
 * A row whose brand is refused is disabled rather than hidden, and says so in words. The
 * finer axis never re-admits what the coarser one refused, so a tick here would be a
 * control that appears to work and changes nothing on any screen that reads prices.
 */
@Component({
  selector: 'lib-shop-list',
  imports: [RokuTranslatorPipe],
  templateUrl: './shop-list.html',
  styleUrl: './shop-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopList {
  readonly groups = input.required<readonly ShopGroup[]>();

  /**
   * Whether the headings are drawn.
   *
   * Off for a search, which crosses franchises and postal codes both: a result that
   * matched "Tejares" is answering a typed word, and filing it under the heading "home"
   * would be answering a question nobody asked.
   */
  readonly grouped = input(true);

  readonly toggle = output<string>();
}
