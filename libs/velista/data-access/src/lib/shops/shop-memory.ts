import { Injectable } from '@angular/core';
import type {
  LocationPreference,
  Page,
  Shop,
  ShopChainSummary,
} from '@portfolio/velista/models';
import type { ShopQuery, ShopServiceI } from './shop-service';

/** One shop as this fake stores it, before a profile has an opinion about it. */
interface FakeShop {
  readonly id: string;
  readonly supermarketId: string;
  readonly chainName: string;
  /** Null for the shops of a chain, which mostly have no name of their own. */
  readonly name: string | null;
  readonly address: string;
  readonly city: string;
  readonly postalCode: string;
  readonly postalCodeDerived: boolean;
}

/**
 * Chains keyed by their brand, plus two that are not.
 *
 * `null` is the whole point of the sample: backend plan 0068 section 4 is emphatic that
 * an independent shop is a chain of one with no `externalBrandKey`, and a fake with only
 * franchises would let a screen that never draws OTHER pass every spec.
 */
const BRAND_KEYS: Readonly<Record<string, string | null>> = {
  'sm-mercadona': 'Q377705',
  'sm-dia': 'Q925132',
  'sm-fruteria': null,
  'sm-panaderia': null,
};

/**
 * The shops this fake knows, across two postal codes.
 *
 * Two codes rather than one, because grouping by postal code is the thing the screen
 * does that a single code cannot show is happening, and because a profile holding home
 * and work is the case plan 0059 section 3.3 exists for.
 */
const SHOPS: readonly FakeShop[] = [
  {
    id: 'shop-mercadona-tejares',
    supermarketId: 'sm-mercadona',
    chainName: 'Mercadona',
    name: 'Ronda de los Tejares',
    address: 'Ronda de los Tejares 32',
    city: 'Córdoba',
    postalCode: '14001',
    postalCodeDerived: false,
  },
  {
    id: 'shop-mercadona-sierra',
    supermarketId: 'sm-mercadona',
    chainName: 'Mercadona',
    name: null,
    address: 'Avenida del Brillante 90',
    city: 'Córdoba',
    postalCode: '14012',
    // Derived, so a spec about the GeoNames credit has a row that owes it.
    postalCodeDerived: true,
  },
  {
    id: 'shop-dia-tejares',
    supermarketId: 'sm-dia',
    chainName: 'DIA',
    name: null,
    address: 'Calle Cruz Conde 4',
    city: 'Córdoba',
    postalCode: '14001',
    postalCodeDerived: false,
  },
  {
    id: 'shop-fruteria',
    supermarketId: 'sm-fruteria',
    chainName: 'Frutería Paco',
    name: 'Frutería Paco',
    address: 'Calle Alfaros 12',
    city: 'Córdoba',
    postalCode: '14001',
    postalCodeDerived: false,
  },
  {
    id: 'shop-panaderia',
    supermarketId: 'sm-panaderia',
    chainName: 'Panadería La Espiga',
    name: 'Panadería La Espiga',
    address: 'Calle Cardenal González 40',
    city: 'Córdoba',
    postalCode: '14012',
    postalCodeDerived: true,
  },
];

/**
 * The shops in a profile's postal codes, in memory. Asked for by name, never a default.
 *
 * It exists for `ShoppingProfileMemory`'s reasons, and it models the three server rules
 * the screen's behaviour actually rests on, because a fake that is kinder than the real
 * thing is a fake that lets a bug through:
 *
 * - **The refused come back flagged**, not filtered, because every read this service
 *   makes asks for them (backend plan 0068, section 6).
 * - **An excluded chain's shops are still listed here**, with the chain's own state on
 *   them, because this is the screen where somebody changes their mind about the brand.
 * - **A shop switched back on has its row deleted** rather than stored as included, which
 *   is what makes a shop imported later visible rather than silently missing.
 *
 * It does not model the postal codes: which codes a profile holds is
 * `ShoppingProfileMemory`'s business, and a second copy of them here would be a second
 * place for them to be wrong. Every shop it knows sits in a code that fake also uses.
 */
// Provided by the app layer, never root: it is listed beside every other fake in this
// library so they are installed in one place rather than two (rule D5).
@Injectable()
export class ShopMemory implements ShopServiceI {
  /** Refused shops, per profile. The value is the set of location ids. */
  private readonly _excluded = new Map<string, Set<string>>();

  /** Refused chains, per profile. Written by nothing here: the profile service owns it. */
  private readonly _excludedChains = new Map<string, Set<string>>();

  /** Everything asked of this fake, in order, for a spec that cares. */
  readonly calls: {
    readonly method: string;
    readonly profileId: string;
  }[] = [];

  /**
   * State a chain refusal, which on the real system is a profile write rather than a
   * call on this service.
   *
   * A method on the fake and not on the interface, for the same reason
   * `ShoppingProfileMemory` has none of these: the two services genuinely disagree about
   * who owns a chain preference, and a spec setting one up has to say so somewhere.
   */
  excludeChain(
    profileId: string,
    supermarketId: string,
    excluded: boolean
  ): void {
    const chains = this._excludedChains.get(profileId) ?? new Set<string>();
    if (excluded) {
      chains.add(supermarketId);
    } else {
      chains.delete(supermarketId);
    }
    this._excludedChains.set(profileId, chains);
  }

  async summarizeChains(
    profileId: string
  ): Promise<readonly ShopChainSummary[]> {
    this.calls.push({ method: 'summarizeChains', profileId });

    const refusedShops = this._excluded.get(profileId) ?? new Set<string>();
    const refusedChains =
      this._excludedChains.get(profileId) ?? new Set<string>();

    const byChain = new Map<string, ShopChainSummary>();
    for (const shop of SHOPS) {
      const held = byChain.get(shop.supermarketId);
      const refused = refusedShops.has(shop.id) ? 1 : 0;

      byChain.set(shop.supermarketId, {
        supermarketId: shop.supermarketId,
        name: { en: shop.chainName, es: shop.chainName },
        externalBrandKey: BRAND_KEYS[shop.supermarketId] ?? null,
        locations: (held?.locations ?? 0) + 1,
        excluded: (held?.excluded ?? 0) + refused,
        excludedChain: refusedChains.has(shop.supermarketId),
      });
    }

    return [...byChain.values()];
  }

  async searchShops(query: ShopQuery): Promise<Page<Shop>> {
    this.calls.push({ method: 'searchShops', profileId: query.profileId });

    const refusedShops =
      this._excluded.get(query.profileId) ?? new Set<string>();
    const refusedChains =
      this._excludedChains.get(query.profileId) ?? new Set<string>();
    const typed = (query.query ?? '').trim().toLocaleLowerCase();

    const items = SHOPS.filter(
      (shop) =>
        (query.supermarketId === undefined ||
          shop.supermarketId === query.supermarketId) &&
        (typed === '' || matches(shop, typed))
    ).map<Shop>((shop) => ({
      id: shop.id,
      supermarketId: shop.supermarketId,
      chainName: { en: shop.chainName, es: shop.chainName },
      name: shop.name === null ? null : { en: shop.name, es: shop.name },
      address: shop.address,
      city: shop.city,
      postalCode: shop.postalCode,
      postalCodeDerived: shop.postalCodeDerived,
      provider: 'OSM',
      excluded: refusedShops.has(shop.id),
      excludedChain: refusedChains.has(shop.supermarketId),
    }));

    // One page. The sample is five shops, and a cursor a spec has to follow would be
    // testing this fake's arithmetic rather than the screen's behaviour.
    return { items, nextCursor: null };
  }

  async setLocationPreferences(
    profileId: string,
    locations: readonly LocationPreference[]
  ): Promise<void> {
    this.calls.push({ method: 'setLocationPreferences', profileId });

    const refused = this._excluded.get(profileId) ?? new Set<string>();
    for (const preference of locations) {
      if (preference.excluded) {
        refused.add(preference.supermarketLocationId);
      } else {
        // Deleted rather than stored as included, which is the server's rule and the
        // reason a shop imported later arrives switched on.
        refused.delete(preference.supermarketLocationId);
      }
    }
    this._excluded.set(profileId, refused);
  }
}

/** The five fields the server matches on (backend plan 0068, section 5). */
function matches(shop: FakeShop, typed: string): boolean {
  return [
    shop.name ?? '',
    shop.chainName,
    shop.address,
    shop.city,
    shop.postalCode,
  ].some((field) => field.toLocaleLowerCase().includes(typed));
}
