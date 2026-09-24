import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ShopStore } from '@portfolio/velista/data-access';
import {
  inLocale,
  OTHER_CHAINS,
  type FranchiseButton,
  type Shop,
} from '@portfolio/velista/models';
import {
  ChevronLeftIcon,
  ShopPicker,
  type ShopGroup,
  type ShopPickerState,
  type ShopRow,
} from '@portfolio/velista/ui';

/**
 * How long typing waits before it asks, so a word costs one request and not one
 * per letter. The supermarkets page waits the same way for the same field.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The get a list sheet's "Buying at" pane: which shop the new list is bought at
 * (velista `0102`).
 *
 * **The same body the basket's filter sheet opens**, `ShopPicker` from `ui`, over a
 * different source. There is no basket yet, so there are no basket scopes to list:
 * the shops are the chosen profile's, read from the catalog the way the supermarkets
 * page reads them, through a `ShopStore` of this pane's own. A pane inside the sheet
 * rather than a sheet of its own, because a second sheet would destroy this one and
 * everything typed and ticked in it before Generate.
 *
 * **Refused shops are not offered.** A shop or a whole chain the profile refuses is
 * a place the person said they do not go, and the basket's own picker leaves it out
 * too, because its scopes are trimmed of the refusals.
 *
 * It holds no choice of its own. A pick is handed to the sheet, which keeps it until
 * Generate and can change it as often as the person likes.
 */
@Component({
  selector: 'lib-get-list-shop-pane',
  imports: [ChevronLeftIcon, RokuTranslatorPipe, ShopPicker],
  providers: [ShopStore],
  templateUrl: './get-list-shop-pane.html',
  styleUrl: './get-list-shop-pane.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetListShopPane {
  private readonly _shops = inject(ShopStore);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);

  /** The profile the list will be priced against, whose shops are offered. */
  readonly profileId = input.required<string>();

  /** The shop already chosen, so its radio is checked. */
  readonly pickedId = input<string | null>(null);

  /** A shop was chosen. The whole row, because the sheet names it afterwards. */
  readonly picked = output<Shop>();

  /** The chevron: back to the form, with nothing chosen. */
  readonly back = output<void>();

  private _debounce: ReturnType<typeof setTimeout> | null = null;

  private readonly _backButton =
    viewChild<ElementRef<HTMLButtonElement>>('backButton');

  constructor() {
    // Focus lands on the way back, the first thing in the pane, rather than on the
    // search: a focused field raises the phone's keyboard over the chain buttons,
    // which are what most people tap.
    afterNextRender(() => this._backButton()?.nativeElement.focus());

    // The profile's chains, read again when the sheet's profile changes under an
    // open pane. By hand rather than through a resolver, because the profile is an
    // input and the pane is drawn inside a sheet that already exists.
    effect(() => {
      const profileId = this.profileId();
      untracked(() => void this._shops.open(profileId));
    });

    inject(DestroyRef).onDestroy(() => {
      if (this._debounce !== null) {
        clearTimeout(this._debounce);
      }
    });
  }

  /**
   * What is in the search field, exactly as typed, which the field draws at once.
   * The store holds what was last **asked**, trimmed, after the debounce.
   */
  protected readonly query = signal('');

  /**
   * One button per chain the profile does not refuse, counting the shops it does
   * not refuse. OTHER stays: an independent is a place to buy like any other.
   */
  protected readonly chains = computed<readonly FranchiseButton[]>(() =>
    this._shops
      .chains()
      .filter((chain) => chain.state !== 'chain')
      .map((chain) => ({
        ...chain,
        locations: chain.locations - chain.excluded,
        excluded: 0,
        state: 'none' as const,
      }))
      .filter((chain) => chain.locations > 0)
  );

  /** Whether the chains are there to draw. */
  protected readonly state = computed<ShopPickerState>(() => {
    const state = this._shops.state();
    return state === 'failed'
      ? 'failed'
      : state === 'loaded'
        ? 'ready'
        : 'loading';
  });

  /** The chain whose shops are open, while nothing is typed. */
  protected readonly openKey = computed(() =>
    this._shops.query() === '' ? this._shops.selection() : null
  );

  /**
   * The open chain's name, for the heading over its shops. OTHER has no name of
   * its own, so the screen names it, as the supermarkets page does.
   */
  protected readonly openName = computed<string | null>(() => {
    const key = this._shops.selection();
    const chain = this.chains().find((row) => row.key === key);
    if (chain === undefined) {
      return null;
    }
    const locale = this._locale();
    return chain.name !== null
      ? inLocale(chain.name, locale)
      : key === OTHER_CHAINS
        ? this._translator.t('shops.other', undefined, locale)
        : null;
  });

  /** The shops on screen that the profile does not refuse. */
  private readonly _offered = computed<readonly Shop[]>(() =>
    this._shops.shops().filter((shop) => !shop.excluded && !shop.excludedChain)
  );

  /** The open chain's shops under their postal codes, as the basket's picker draws them. */
  protected readonly groups = computed<readonly ShopGroup[]>(() => {
    if (this._shops.query() !== '' || this._shops.selection() === null) {
      return [];
    }

    const locale = this._locale();
    const byCode = new Map<string, ShopRow[]>();
    for (const shop of this._offered()) {
      const code = shop.postalCode ?? '';
      const held = byCode.get(code);
      const row = toRow(shop, locale);
      if (held === undefined) {
        byCode.set(code, [row]);
      } else {
        held.push(row);
      }
    }

    return [...byCode.entries()].map(([code, shops]) => ({
      key: code,
      heading: code,
      code: null,
      shops,
    }));
  });

  /** What a search matched, as one run, while something is typed. */
  protected readonly matches = computed<readonly ShopGroup[]>(() => {
    if (this._shops.query() === '' || this._offered().length === 0) {
      return [];
    }
    const locale = this._locale();
    return [
      {
        key: 'search',
        heading: '',
        code: null,
        shops: this._offered().map((shop) => toRow(shop, locale)),
      },
    ];
  });

  protected readonly matchCount = computed(() =>
    this._shops.query() === '' ? 0 : this._offered().length
  );

  /**
   * Something was typed. The field shows it at once and the catalog is asked once
   * the typing stops, across every chain (`0059`, section 3.1).
   */
  protected onQuery(query: string): void {
    this.query.set(query);
    if (this._debounce !== null) {
      clearTimeout(this._debounce);
    }
    this._debounce = setTimeout(() => {
      this._debounce = null;
      void this._shops.search(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * A chain button: open it, or close it when it is open. The search is cleared,
   * which is `ShopStore.select`'s own rule, and a search still waiting to be asked
   * is dropped with it.
   */
  protected select(key: string): void {
    if (this._debounce !== null) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
    this.query.set('');
    void this._shops.select(key);
  }

  /** A shop's radio: hand the whole row to the sheet. */
  protected pick(locationId: string): void {
    const shop = this._offered().find((row) => row.id === locationId);
    if (shop !== undefined) {
      this.picked.emit(shop);
    }
  }
}

/** One catalog shop as the list draws it, in the reader's language. */
function toRow(shop: Shop, locale: string): ShopRow {
  const where = [shop.address, shop.city]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
  return {
    id: shop.id,
    chain: inLocale(shop.chainName, locale),
    name: shop.name === null ? null : inLocale(shop.name, locale),
    where: where === '' ? null : where,
    postalCode: shop.postalCode,
    excluded: false,
    excludedChain: false,
    failed: false,
  };
}
