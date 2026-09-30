import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { InfoIcon } from '../icons/icons';
import { ChainLogo, type ChainLogoView } from './chain-logo';
import { OutsideAreas } from './outside-areas';
import { SectionChips, type SectionChip } from './section-chips';

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
  /**
   * The shop is outside the basket owner's areas (velista `0102`), which draws
   * "Outside your areas" under it. Absent everywhere but the shop picker, and false
   * for every shop of the owner's own profile.
   */
  readonly outsideAreas?: boolean;
  /**
   * One short fact at the end of the row, under `pick` only (velista `0103`): how
   * far the shop is for a shop near the device, and when this person last bought
   * there for a recent one. Absent everywhere else.
   */
  readonly aside?: ShopRowAside;
  /**
   * The street and the town apart, which a pick row needs (velista `0124`): the
   * street is the title of a shop with no name of its own, and then only the town
   * is left for the line under it. Absent on the supermarkets page's rows.
   */
  readonly street?: string | null;
  readonly town?: string | null;
  /** The chain's logo, drawn on a pick row where the chains are mixed. */
  readonly logo?: ChainLogoView;
  /** The shop's sections in its own order, under a pick row. Empty draws no line. */
  readonly sections?: readonly SectionChip[];
}

/**
 * What a pick row says, worked out once (velista `0124`, target 3).
 *
 * The title is the shop's own name when it has one, else its street, else its
 * town. Under it the chain, where the chains are mixed, and then the address, or
 * only the town when the street is already the title.
 */
export function pickRowLines(
  shop: ShopRow,
  mixed: boolean
): { readonly title: string; readonly detail: string } {
  const street = shop.street ?? null;
  const town = shop.town ?? null;
  const title = shop.name ?? street ?? town ?? shop.chain;
  const place =
    shop.name !== null
      ? shop.where
      : street !== null && title === street
        ? town
        : null;
  const parts = [mixed ? shop.chain : null, place].filter(
    (part): part is string => part !== null && part.trim() !== ''
  );
  return { title, detail: parts.join(' · ') };
}

/**
 * The fact at the end of a pick row. A distance is the thing a candidate is chosen
 * by, so it is drawn as strongly as the name beside it; a day is context, drawn
 * quietly.
 */
export interface ShopRowAside {
  readonly text: string;
  readonly kind: 'distance' | 'when';
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
  imports: [
    ChainLogo,
    InfoIcon,
    OutsideAreas,
    RokuTranslatorPipe,
    SectionChips,
  ],
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
   * The radio group's name under `pick` (velista `0103`).
   *
   * One per section of the picker, so the recent shops, the shops near the device
   * and a chain's shops are three groups: the arrow keys stay inside the section
   * they started in, and a shop drawn in two sections is checked in both.
   */
  readonly groupName = input('shop-pick');

  /**
   * Whether the rows are of several chains (velista `0124`): the shops near the
   * device, the recent ones and a search. Each row then leads with its chain's
   * logo and names the chain under the title. Inside one chain the head carries
   * the logo and the rows do not, which gives the sections the width.
   */
  readonly mixed = input(false);

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

  /**
   * A pick row's round button was pressed, to open that shop's own page (velista
   * `0121`, target 1). Its own act, and never a pick: the button sits outside the
   * label for exactly that reason.
   */
  readonly about = output<string>();

  /** Whether this row's control is on, which is a different question per mode. */
  protected isChecked(shop: ShopRow): boolean {
    return this.mode() === 'pick'
      ? shop.id === this.pickedId()
      : !shop.excluded && !shop.excludedChain;
  }

  protected lines(shop: ShopRow) {
    return pickRowLines(shop, this.mixed());
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
