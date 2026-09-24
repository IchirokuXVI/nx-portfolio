import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { FranchiseButton } from '@portfolio/velista/models';
import { SearchIcon, SpinnerIcon } from '../icons/icons';
import { FranchiseButtons } from './franchise-buttons';
import { ShopList, type ShopGroup } from './shop-list';

/**
 * Where the list body stands, for a caller that asks a server for it.
 *
 * `ready` for one that already holds its shops, which is the basket's picker: its
 * shops arrived with the basket read. The get a list sheet asks the catalog, and
 * a list that is loading or failed says so in one line rather than drawing an
 * empty picker that looks like a place with no shops.
 */
export type ShopPickerState = 'ready' | 'loading' | 'failed';

/**
 * The body of "which shop am I buying at" (velista `0078`, section 4; `0102`).
 *
 * Top to bottom in the supermarkets page's order (`0059`): a search across every
 * chain, the chain buttons, and then the open chain's shops under their postal
 * codes, or the flat matches while something is typed. One radio per shop.
 *
 * ## Why it is here, and why it holds nothing
 *
 * Two sheets ask the question: the basket's filter sheet, over the shops the basket
 * read carried, and the get a list sheet, over the profile's shops before any basket
 * exists. `feature-home` cannot import `feature-shopping-lists`, so the body lives in
 * `ui` and each sheet is a container around it (rule D1): the container decides what
 * the shops are, which chain is open and what the search matched, and this draws it
 * and reports taps. It stays in velista's `ui` and not in `@portfolio/shared/ui`,
 * because it speaks velista's vocabulary.
 *
 * Everything is an input and every tap is an output, so a later plan can put more
 * above the search (the shops somebody bought at recently, a shop near them) without
 * this body knowing how the container found them.
 */
@Component({
  selector: 'lib-shop-picker',
  imports: [
    FranchiseButtons,
    RokuTranslatorPipe,
    SearchIcon,
    ShopList,
    SpinnerIcon,
  ],
  templateUrl: './shop-picker.html',
  styleUrl: './shop-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPicker {
  /** One button per chain, with the count of its shops under the name. */
  readonly chains = input.required<readonly FranchiseButton[]>();

  /** The chain whose shops are open, or null when none is. */
  readonly openKey = input<string | null>(null);

  /** The open chain's name, for the heading over its shops. */
  readonly openName = input<string | null>(null);

  /** The open chain's shops, under their postal codes. */
  readonly groups = input<readonly ShopGroup[]>([]);

  /** What is in the search field, exactly as typed. */
  readonly query = input('');

  /**
   * What the search matched, as one ungrouped run. Read only while {@link query}
   * holds something other than blanks.
   */
  readonly matches = input<readonly ShopGroup[]>([]);

  /** How many shops the search matched, for the announced count. */
  readonly matchCount = input(0);

  /** The shop the radio group checks, or null for none. */
  readonly pickedId = input<string | null>(null);

  /** Whether the shops are there to draw yet. See {@link ShopPickerState}. */
  readonly state = input<ShopPickerState>('ready');

  /**
   * The field's id, so two pickers on one page would not share a label target.
   * One is ever open at a time today, and the id costs nothing to keep unique.
   */
  readonly fieldId = input('shop-picker-search');

  /** Something was typed. The container decides what it matches. */
  readonly queried = output<string>();

  /**
   * A chain button was pressed. Named `chosen` for `FranchiseButtons`' reason: an
   * output named like a DOM event would catch the native one too.
   */
  readonly chosen = output<string>();

  /** A shop's radio was chosen: its location id. */
  readonly picked = output<string>();

  /** Whether a word is being searched, which decides what the body draws. */
  protected searching(): boolean {
    return this.query().trim() !== '';
  }

  protected onQuery(event: Event): void {
    this.queried.emit((event.target as HTMLInputElement).value);
  }
}
