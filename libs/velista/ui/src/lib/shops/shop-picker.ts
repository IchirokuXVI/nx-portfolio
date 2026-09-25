import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  formatDistance,
  NEARBY_RADIUS_METRES,
  type FranchiseButton,
  type NearbyNoPick,
} from '@portfolio/velista/models';
import { InfoIcon, SearchIcon, SpinnerIcon } from '../icons/icons';
import { FranchiseButtons } from './franchise-buttons';
import { ShopList, type ShopGroup, type ShopRow } from './shop-list';

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
 * What "Near me" has to show (velista `0103`), which the container works out from
 * the device and the server and this draws.
 *
 * - `idle`: nothing, because nobody has pressed.
 * - `locating`: the section's heading over two placeholder rows.
 * - `answered`: the candidates nearest first, each with its distance, under one
 *   line for the reason there was no pick. A pick closes the picker, so it is
 *   never drawn here.
 * - `denied`, `timed-out`, `failed`: one line, and the rest of the picker works
 *   as it did before.
 */
export type ShopPickerNear =
  | {
      readonly state: 'idle' | 'locating' | 'denied' | 'timed-out' | 'failed';
    }
  | {
      readonly state: 'answered';
      readonly reason: NearbyNoPick | null;
      /** Nearest first, as the server ordered them, each with its distance aside. */
      readonly candidates: readonly ShopRow[];
    };

/**
 * The body of "which shop am I buying at" (velista `0078`, section 4; `0102`).
 *
 * Top to bottom: the shops near the device once "Near me" was pressed, the shops
 * this person bought at recently (velista `0103`), and then the supermarkets
 * page's order (`0059`): a search across every chain, the chain buttons, and the
 * open chain's shops under their postal codes, or the flat matches while something
 * is typed. One radio per shop, one radio group per section.
 *
 * "Near me" itself is not here. It sits in the title row, which each sheet owns,
 * so it is `NearMeButton` and the sheet draws it.
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
    InfoIcon,
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

  /** What "Near me" has to show. See {@link ShopPickerNear}. */
  readonly near = input<ShopPickerNear>({ state: 'idle' });

  /**
   * The shops this person bought at recently, newest first, each with its day
   * aside. Empty draws no section, which is also what a guest gets: the container
   * never asks for a guest.
   */
  readonly recent = input<readonly ShopRow[]>([]);

  /** Something was typed. The container decides what it matches. */
  readonly queried = output<string>();

  /**
   * A chain button was pressed. Named `chosen` for `FranchiseButtons`' reason: an
   * output named like a DOM event would catch the native one too.
   */
  readonly chosen = output<string>();

  /** A shop's radio was chosen: its location id. */
  readonly picked = output<string>();

  private readonly _locale = inject(RokuLocaleStore).locale;

  /** How far the server looks, in the reader's language, for the heading. */
  protected readonly radius = computed(() =>
    formatDistance(NEARBY_RADIUS_METRES, this._locale())
  );

  /** The candidates as one ungrouped run, which is what the list draws. */
  protected readonly nearGroups = computed<readonly ShopGroup[]>(() => {
    const near = this.near();
    return near.state === 'answered' && near.candidates.length > 0
      ? [{ key: 'near', heading: '', code: null, shops: near.candidates }]
      : [];
  });

  /** The reason there was no pick, or null for none to say. */
  protected readonly reason = computed<NearbyNoPick | null>(() => {
    const near = this.near();
    return near.state === 'answered' ? near.reason : null;
  });

  /** The recent shops as one ungrouped run. */
  protected readonly recentGroups = computed<readonly ShopGroup[]>(() =>
    this.recent().length === 0
      ? []
      : [{ key: 'recent', heading: '', code: null, shops: this.recent() }]
  );

  /** Whether a word is being searched, which decides what the body draws. */
  protected searching(): boolean {
    return this.query().trim() !== '';
  }

  protected onQuery(event: Event): void {
    this.queried.emit((event.target as HTMLInputElement).value);
  }
}
