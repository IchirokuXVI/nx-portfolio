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

/**
 * What a row's control does (velista `0078`, section 4).
 *
 * `exclude` is the screen this list was written for: a checkbox per shop, checked
 * meaning included, and the three exclusion states beside it. `pick` is the basket's
 * shop picker, where the same rows answer a different question, "which one am I in",
 * and the control is therefore a radio in one group.
 *
 * One component with a mode rather than two lists, because the row itself is the
 * same row: the chain leads, the shop's own name follows, the address is under both.
 * Two copies would drift the moment one of them learned something about a shop.
 */
export type ShopListMode = 'exclude' | 'pick';

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
 *
 * ## Two modes, and why it lives in `ui`
 *
 * Velista `0078` asks the same rows a second question, "which shop am I standing in",
 * and the basket's shop picker is where it asks it. So the row's control is the mode's
 * (see {@link ShopListMode}) and the component moved out of `feature-account`, which
 * `feature-shopping-lists` cannot import: a feature library is lazy loaded, and naming
 * one from another would pull its pages into the wrong bundle.
 *
 * The three exclusion states are drawn under `exclude` only. They are facts about a
 * **profile's** preferences, and the picker is not a screen about preferences: a row
 * dimmed there would say the shop is refused when what is being asked is where the
 * reader is.
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

  /** Which question the rows ask. See {@link ShopListMode}. */
  readonly mode = input<ShopListMode>('exclude');

  /** The picked shop under `pick`, so the group has one checked radio. */
  readonly pickedId = input<string | null>(null);

  /**
   * A row's checkbox was tapped under `exclude`.
   *
   * Named `toggled` and not `toggle`, which is a DOM event a `<details>` fires:
   * `@angular-eslint/no-output-native` refuses an output that shadows one, and it
   * is right to, because a host listener for the native event would be caught by
   * this one instead.
   */
  readonly toggled = output<string>();

  /**
   * A row's radio was chosen under `pick`.
   *
   * A second output rather than one that means two things, because the two acts are
   * not the same act: `toggled` says "include this or do not" and this says "prices
   * from here". A caller listening for the wrong one would compile.
   */
  readonly pick = output<string>();

  /** Whether this row's control is on, which is a different question per mode. */
  protected isChecked(shop: ShopRow): boolean {
    return this.mode() === 'pick'
      ? shop.id === this.pickedId()
      : !shop.excluded && !shop.excludedChain;
  }

  /** Report the tap as whichever act this mode's control performs. */
  protected choose(shopId: string): void {
    if (this.mode() === 'pick') {
      this.pick.emit(shopId);
      return;
    }
    this.toggled.emit(shopId);
  }
}
