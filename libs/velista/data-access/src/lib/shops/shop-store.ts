import { computed, inject, Injectable, signal } from '@angular/core';
import {
  chainState,
  type ChainState,
  type LocalizedName,
  type Shop,
  type ShopChainSummary,
} from '@portfolio/velista/models';
import { ShoppingProfileStore } from '../profiles/shopping-profile-store';
import { SHOP_SERVICE, type ShopServiceI } from './shop-service';

/**
 * The key of the OTHER button, which is not a chain id and cannot collide with one:
 * every chain id is a UUID.
 *
 * OTHER is a client side bucket (backend plan 0068, section 4) and the server has never
 * heard the word. It is the chains with no `externalBrandKey`, which is what survives
 * the import of a shop that had no brand at all, and plan 0059 section 3.2 measured it
 * as the **largest** button on the screen for many people: 35 of the 75 places in one
 * city radius were independents.
 */
export const OTHER_CHAINS = 'other';

/** How a read of the shop rows has got on. `idle` is "no franchise chosen yet". */
export type ShopListState = 'idle' | 'loading' | 'loaded' | 'failed';

/** One franchise button, ready to draw (plan 0059, section 3.2). */
export interface FranchiseButton {
  /** A chain id, or {@link OTHER_CHAINS}. */
  readonly key: string;
  /** Null for OTHER, which is a bucket rather than a brand and is named by the screen. */
  readonly name: LocalizedName | null;
  readonly locations: number;
  readonly excluded: number;
  readonly state: ChainState;
}

/** A page of shops, capped so a server echoing its own cursor cannot spin a phone. */
const SHOP_PAGE_SIZE = 100;
const MAX_SHOP_PAGES = 10;

/**
 * The shops in one profile's postal codes, and what that profile thinks of them
 * (plan 0059).
 *
 * ## Provided by the page, not by the app
 *
 * Unlike `ShoppingProfileStore`, whose selection outlives its screen because the
 * generation sheet asks it which profile a basket is for, everything here is about the
 * screen that is open: a franchise somebody tapped, a word they typed, a page of rows.
 * None of it means anything once they have left, and holding it would mean holding a
 * franchise selection from a profile they are no longer editing.
 *
 * It is provided by the **component** rather than by the route, because a route's
 * providers are never destroyed: the injector a route creates outlives the component and
 * its `DestroyRef` never fires, so a store scoped there would quietly survive the page.
 *
 * ## What it does not own
 *
 * The **chain** axis. Excluding a brand is a preference on the profile, written through
 * `ShoppingProfileStore` with the profile's whole collection, and that store is where
 * every other writer of it already is. This one reaches for it rather than growing a
 * second way to write the same field, which is how the two would eventually disagree
 * about what an included chain looks like.
 */
// Provided by the page component, never root and never a route: see above.
@Injectable()
export class ShopStore {
  private readonly _service = inject<ShopServiceI>(SHOP_SERVICE);
  private readonly _profiles = inject(ShoppingProfileStore);

  private readonly _profileId = signal<string | null>(null);
  private readonly _summaries = signal<readonly ShopChainSummary[]>([]);
  private readonly _state = signal<ShopListState>('loading');
  private readonly _selection = signal<string | null>(null);
  private readonly _query = signal('');
  private readonly _shops = signal<readonly Shop[]>([]);
  private readonly _shopState = signal<ShopListState>('idle');

  /**
   * Shops whose last toggle did not save.
   *
   * A set rather than a flag on the row: the rows come from the server and are replaced
   * by the next read, so a failure written into one would be lost the moment anything
   * else refreshed. It is cleared when the shop is toggled again, which is the only
   * gesture that can answer it.
   */
  private readonly _failed = signal<ReadonlySet<string>>(new Set());

  /**
   * The read the rows came from, so an answer that arrives after somebody has moved on
   * is dropped rather than drawn.
   *
   * A sequence number and not a comparison against the query it was started for: the
   * same word can be typed, cleared and typed again, and the older request answering
   * second would then look like the newer one's answer.
   */
  private _seq = 0;

  /** How the franchise read has got on. */
  readonly state = this._state.asReadonly();

  /** How the shop read under it has got on. */
  readonly shopState = this._shopState.asReadonly();

  /** The franchise whose shops are drawn, {@link OTHER_CHAINS}, or null for none. */
  readonly selection = this._selection.asReadonly();

  /** What was typed into the search field, trimmed by the caller and held verbatim. */
  readonly query = this._query.asReadonly();

  /** The rows on screen: a franchise's shops, or what a typed word matched. */
  readonly shops = this._shops.asReadonly();

  /**
   * The franchise buttons, in the order the catalog counted them, with OTHER last.
   *
   * OTHER is last rather than first even though it is often the biggest, because it is
   * the one button whose name says nothing about what is inside it: somebody looking for
   * Mercadona finds it by reading brands, and somebody looking for the greengrocer on
   * their corner has to open OTHER either way.
   */
  readonly chains = computed<readonly FranchiseButton[]>(() => {
    const franchises = this._summaries()
      .filter((summary) => summary.externalBrandKey !== null)
      .map<FranchiseButton>((summary) => ({
        key: summary.supermarketId,
        name: summary.name,
        locations: summary.locations,
        excluded: summary.excluded,
        state: chainState(summary),
      }));

    const other = this._otherSummaries();
    if (other.length === 0) {
      return franchises;
    }

    const locations = other.reduce((sum, row) => sum + row.locations, 0);
    const excluded = other.reduce((sum, row) => sum + row.excluded, 0);

    return [
      ...franchises,
      {
        key: OTHER_CHAINS,
        name: null,
        locations,
        excluded,
        // The bucket is refused outright only when **every** independent in it is, which
        // is what its own exclude control writes. One greengrocer refused among five is
        // "some", exactly as it would be for a franchise.
        state: other.every((row) => row.excludedChain)
          ? 'chain'
          : excluded > 0 || other.some((row) => row.excludedChain)
            ? 'some'
            : 'none',
      },
    ];
  });

  /** Whether the profile's codes hold no shop at all, which is its own empty state. */
  readonly noShops = computed(
    () => this._state() === 'loaded' && this._summaries().length === 0
  );

  /** Whether one shop's last toggle failed. */
  failed(shopId: string): boolean {
    return this._failed().has(shopId);
  }

  /**
   * Read the franchises of one profile.
   *
   * The profile itself is **not** read here: the page holds it already, from the app
   * scoped store that every other screen shares, and asking again would be a second
   * answer about the same profile that could differ from the one on screen.
   */
  async open(profileId: string): Promise<void> {
    this._profileId.set(profileId);
    this._state.set('loading');

    try {
      this._summaries.set(await this._service.summarizeChains(profileId));
      this._state.set('loaded');
    } catch {
      this._state.set('failed');
    }
  }

  /** Read the franchises again, which is what the retry line does. */
  async retry(): Promise<void> {
    const profileId = this._profileId();
    if (profileId === null) {
      return;
    }

    await this.open(profileId);

    // The rows under the buttons were drawn from the same profile, so a retry that left
    // them alone would leave a franchise open over shops read before the failure.
    const selection = this._selection();
    if (selection !== null) {
      await this.select(selection);
    }
  }

  /**
   * Open a franchise, or close the one that is open by choosing it again.
   *
   * Choosing a franchise **clears the search**, because the two are answers to different
   * questions and a franchise's rows filtered by a word nobody has retyped is a shorter
   * list than the button promised.
   */
  async select(key: string): Promise<void> {
    const profileId = this._profileId();
    if (profileId === null) {
      return;
    }

    if (this._selection() === key && this._query() === '') {
      this._selection.set(null);
      this._shops.set([]);
      this._shopState.set('idle');
      return;
    }

    this._selection.set(key);
    this._query.set('');
    await this._read(profileId, { chain: key });
  }

  /**
   * Search across every franchise (plan 0059, section 3.1).
   *
   * **Across**, and not within whatever is open: somebody typing "Ronda de los Tejares"
   * is looking for a shop rather than for a shop of a particular brand. The open
   * franchise is remembered rather than closed, so clearing the field puts its rows back
   * instead of emptying the screen.
   *
   * The debounce is the page's. How often a request may be made is not a question a
   * store can answer for a field it cannot see.
   */
  async search(query: string): Promise<void> {
    const profileId = this._profileId();
    if (profileId === null) {
      return;
    }

    const typed = query.trim();
    this._query.set(typed);

    if (typed === '') {
      const selection = this._selection();
      if (selection === null) {
        this._shops.set([]);
        this._shopState.set('idle');
        // Still bumped, so an in flight search cannot land on the emptied screen.
        this._seq += 1;
        return;
      }

      await this._read(profileId, { chain: selection });
      return;
    }

    await this._read(profileId, { query: typed });
  }

  /**
   * Switch one shop off, or back on, optimistically.
   *
   * The row moves first and reverts if the write fails, which is section 3.4. The
   * franchise button's counts move with it, because the button is a summary of exactly
   * these rows and a count that lagged behind them would say "2 excluded" over three
   * struck through rows.
   *
   * A single toggle is a single request. The endpoint takes several because the screen's
   * natural gesture is several, but sending one shop as one write is what makes the
   * revert honest: a failure names the row it belongs to.
   */
  async toggleShop(shopId: string): Promise<void> {
    const profileId = this._profileId();
    const shop = this._shops().find((row) => row.id === shopId);
    if (profileId === null || shop === undefined) {
      return;
    }

    // An excluded chain hides every one of its shops whatever their own rows say
    // (backend plan 0064, section 2.1), so a row under one is inert: writing from here
    // would store a decision the resolver ignores and the screen cannot show.
    if (shop.excludedChain) {
      return;
    }

    const excluded = !shop.excluded;
    this._applyExclusion(shopId, shop.supermarketId, excluded);
    this._clearFailure(shopId);

    try {
      await this._service.setLocationPreferences(profileId, [
        { supermarketLocationId: shopId, excluded },
      ]);
    } catch {
      this._applyExclusion(shopId, shop.supermarketId, !excluded);
      this._failed.update((failed) => new Set(failed).add(shopId));
    }
  }

  /**
   * Refuse a whole brand, or take the refusal back (backend plan 0064, section 2.2).
   *
   * **Not the same as switching off every row**, and the difference is the entire reason
   * the chain axis still exists: a DIA that opens next month is included by a blacklist
   * that has never heard of it, and excluded by this. Individual rows underneath are left
   * exactly as they were, so taking the refusal back restores the selection somebody last
   * had rather than a cleared one.
   *
   * OTHER writes every independent in the bucket at once, which is one profile write
   * because the profile's chain collection is a full replacement anyway. That is the
   * honest reading of the button: those chains are one shop each, so refusing the bucket
   * is refusing each of the brands in it, future shops of theirs included.
   */
  async setChainExcluded(key: string, excluded: boolean): Promise<void> {
    const profileId = this._profileId();
    if (profileId === null) {
      return;
    }

    const ids =
      key === OTHER_CHAINS
        ? this._otherSummaries().map((row) => row.supermarketId)
        : [key];
    if (ids.length === 0) {
      return;
    }

    const outcome = await this._profiles.setChainsExcluded(
      profileId,
      ids,
      excluded
    );
    if (outcome === 'failed') {
      return;
    }

    const refused = new Set(ids);
    this._summaries.update((summaries) =>
      summaries.map((summary) =>
        refused.has(summary.supermarketId)
          ? { ...summary, excludedChain: excluded }
          : summary
      )
    );
    this._shops.update((shops) =>
      shops.map((shop) =>
        refused.has(shop.supermarketId)
          ? { ...shop, excludedChain: excluded }
          : shop
      )
    );
  }

  /** The keyless chains, which are what OTHER is made of. */
  private _otherSummaries(): readonly ShopChainSummary[] {
    return this._summaries().filter((row) => row.externalBrandKey === null);
  }

  /**
   * One read of the shop rows, paged to the end and guarded by its sequence number.
   *
   * OTHER is the one selection the server cannot answer, because it is not a chain: the
   * read goes out unfiltered and the keyless chains are kept here. That costs the pages
   * of a dense city rather than one franchise's, and the alternative is one request per
   * independent shop, which in the city plan 0038 measured would have been thirty five.
   */
  private async _read(
    profileId: string,
    what: { chain?: string; query?: string }
  ): Promise<void> {
    const seq = (this._seq += 1);
    this._shopState.set('loading');

    const bucket =
      what.chain === OTHER_CHAINS
        ? new Set(this._otherSummaries().map((row) => row.supermarketId))
        : null;

    const supermarketId =
      what.chain === undefined || what.chain === OTHER_CHAINS
        ? undefined
        : what.chain;

    const found: Shop[] = [];
    let cursor: string | undefined = undefined;

    try {
      for (let page = 0; page < MAX_SHOP_PAGES; page++) {
        const answered = await this._service.searchShops({
          profileId,
          supermarketId,
          query: what.query,
          cursor,
          limit: SHOP_PAGE_SIZE,
        });

        found.push(
          ...(bucket === null
            ? answered.items
            : answered.items.filter((shop) => bucket.has(shop.supermarketId)))
        );

        if (answered.nextCursor === null) {
          break;
        }
        cursor = answered.nextCursor;
      }
    } catch {
      if (seq === this._seq) {
        this._shopState.set('failed');
      }
      return;
    }

    if (seq !== this._seq) {
      return;
    }

    this._shops.set(found);
    this._shopState.set('loaded');
  }

  /** Move one row, and the franchise count that summarizes it, together. */
  private _applyExclusion(
    shopId: string,
    supermarketId: string,
    excluded: boolean
  ): void {
    this._shops.update((shops) =>
      shops.map((shop) => (shop.id === shopId ? { ...shop, excluded } : shop))
    );

    this._summaries.update((summaries) =>
      summaries.map((summary) =>
        summary.supermarketId === supermarketId
          ? {
              ...summary,
              excluded: Math.max(0, summary.excluded + (excluded ? 1 : -1)),
            }
          : summary
      )
    );
  }

  private _clearFailure(shopId: string): void {
    this._failed.update((failed) => {
      if (!failed.has(shopId)) {
        return failed;
      }
      const next = new Set(failed);
      next.delete(shopId);
      return next;
    });
  }
}
