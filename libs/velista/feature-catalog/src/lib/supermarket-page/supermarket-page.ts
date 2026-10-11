import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ShoppingProfileStore,
  ShopStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  OTHER_CHAINS,
  type FranchiseButton,
} from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import {
  ChainLogo,
  FranchiseButtons,
  offeredChains,
  PageHeader,
  SpinnerIcon,
  type ChainLogoView,
} from '@portfolio/velista/ui';
import {
  catalogChoiceOf,
  catalogQueryOf,
  type CatalogChoice,
} from '../supermarket-choice';

type ChainsState = 'ready' | 'loading' | 'failed';

/** The store glyph the All supermarkets row wears in place of a chain's logo. */
const EVERY_CHAIN: ChainLogoView = { logoUrl: null, name: '', store: true };

/**
 * The catalog's supermarket picker (velista `0124`, target 8): a page of its own at
 * `catalog/supermarket`.
 *
 * ## Why a page, when the basket's picker is a sheet
 *
 * The catalog is a tab, and a choice here changes the whole tab, so its picker is a
 * page with a URL that back leaves.
 *
 * ## A chain is the whole choice
 *
 * The catalog is narrowed by chain and never by shop, so this page asks one
 * question and one press answers it: All supermarkets, or a chain's button. There
 * is no chain screen, no shop row, no search and no Near me, which all exist to
 * find one shop. The basket's picker still asks for a shop, because a basket is
 * bought at one.
 *
 * ## Every answer replaces this entry
 *
 * An answer goes to the catalog with the choice in its URL and **replaces** the
 * picker's entry, so back from the catalog does not reopen the picker.
 *
 * ## Chains
 *
 * From `ShopStore` over the default profile, refused chains out and states forced
 * to none, as the get a list sheet offers them. OTHER is left out: it is several
 * independent shops rather than one chain, and the catalog narrows to one chain.
 */
@Component({
  selector: 'lib-catalog-supermarket-page',
  imports: [
    ChainLogo,
    FranchiseButtons,
    PageHeader,
    RokuTranslatorPipe,
    SpinnerIcon,
  ],
  providers: [ShopStore],
  templateUrl: './supermarket-page.html',
  styleUrl: './supermarket-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogSupermarketPage {
  private readonly _shops = inject(ShopStore);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _pages = inject(PageNavigation);

  /** The catalog's choice as the picker was handed it, for the tick and the way back. */
  private readonly _choice: CatalogChoice = catalogChoiceOf(
    this._route.snapshot.queryParamMap
  );

  /** Whether the profiles answered, with or without one to read chains from. */
  private readonly _asked = signal(false);
  private readonly _profileId = signal<string | null>(null);

  protected readonly everyChain = EVERY_CHAIN;

  /** The chain in the catalog's URL, whose button draws a tick. */
  protected readonly pickedChain = this._choice.chain;

  constructor() {
    // The default profile's chains. Without a profile there are none to offer, and
    // All supermarkets is the one answer.
    void this._profiles.load().then(async () => {
      const profile =
        this._profiles.profiles().find((row) => row.isDefault) ??
        this._profiles.profiles()[0];
      this._asked.set(true);
      if (profile === undefined) {
        return;
      }
      this._profileId.set(profile.id);
      await this._shops.open(profile.id);
    });
  }

  protected readonly chains = computed<readonly FranchiseButton[]>(() =>
    offeredChains(this._shops.chains()).filter(
      (chain) => chain.key !== OTHER_CHAINS
    )
  );

  protected readonly state = computed<ChainsState>(() => {
    const state = this._shops.state();
    if (state === 'failed') {
      return 'failed';
    }
    return state === 'loaded' || (this._asked() && this._profileId() === null)
      ? 'ready'
      : 'loading';
  });

  /** All supermarkets: the catalog with no chain. */
  protected chooseAll(): void {
    this._answer(null);
  }

  /** A chain's button: the catalog narrowed to that chain. */
  protected chooseChain(key: string): void {
    this._answer(key);
  }

  /** The chevron: back to the catalog, or the catalog on a cold load. */
  protected async back(): Promise<void> {
    await this._pages.back(
      this._router.serializeUrl(this._catalogUrl(this._choice))
    );
  }

  /**
   * Go to the catalog with this answer, replacing the picker's entry. Only the
   * supermarket is answered: the category, the text and the order go back as they
   * came.
   */
  private _answer(chain: string | null): void {
    void this._router.navigateByUrl(
      this._catalogUrl({ ...this._choice, chain }),
      { replaceUrl: true }
    );
  }

  private _catalogUrl(choice: CatalogChoice) {
    const url = this._router.parseUrl(
      appPath(this._locale(), this._basePath, 'catalog')
    );
    url.queryParams = catalogQueryOf(choice);
    return url;
  }
}
