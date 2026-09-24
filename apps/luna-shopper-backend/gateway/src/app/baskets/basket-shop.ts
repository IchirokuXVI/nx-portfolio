import type {
  BasketPriceScopeView,
  BasketProductAtShopView,
  BasketScopeLocationView,
  BasketShopView,
  ItemView,
  ShopAvailabilityView,
  SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';

/**
 * A shop, as a basket read at it composes it (plan 0163).
 *
 * Pure functions over what catalog answered, so the rules are tested without a
 * broker and so plan 0164 names a shop near a point with the same view and the
 * same `inProfile`.
 */

/**
 * Whether a shop is in a pricing profile (plan 0163, section 3): its postal
 * code is one of the profile's postal codes.
 *
 * A fact for the client to warn about ("this shop is outside your areas"), and
 * nothing on the server changes with it. A shop with no postal code is in no
 * profile, because there is nothing to compare. The codes are compared as they
 * are stored, trimmed: a profile's codes are the national table's, and so are a
 * shop's.
 */
export function isInProfile(
  postalCode: string | null,
  profilePostalCodes: readonly string[]
): boolean {
  const code = postalCode?.trim();
  if (!code) {
    return false;
  }
  return profilePostalCodes.some((candidate) => candidate.trim() === code);
}

/**
 * A shop named for a person, with whether it is in the profile the basket is
 * priced against (plan 0163, section 1).
 */
export function toBasketShopView(
  shop: ShopAvailabilityView,
  profilePostalCodes: readonly string[]
): BasketShopView {
  return {
    id: shop.location.id,
    supermarketId: shop.supermarket.id,
    supermarketName: shop.supermarket.name,
    label: shop.location.label,
    address: shop.location.address,
    city: shop.location.city,
    postalCode: shop.location.postalCode,
    inProfile: isInProfile(shop.location.postalCode, profilePostalCodes),
  };
}

/**
 * What the read's shop says about one product (plan 0163, section 2).
 *
 * **The price is the shop's quoted scope, and nothing else is consulted.**
 * Catalog materializes every scope's price over its whole stack by the rule of
 * plan 0117, so the offer at the most specific scope of the shop's stack
 * already is "the narrowest scope with a valid price". Walking the stack here
 * would be a second copy of that rule, which the plan forbids.
 *
 * **Availability is read, never inferred**: the shop's own row, or null.
 */
export function atShopOf(
  product: ItemView,
  shop: ShopAvailabilityView
): BasketProductAtShopView {
  const quoted = quotedScopeOf(shop);
  const offer =
    quoted === null
      ? null
      : (product.offers?.find(
          (candidate) => candidate.priceScopeId === quoted
        ) ??
        (product.bestOffer?.priceScopeId === quoted
          ? product.bestOffer
          : null));
  const priced = offer && offer.price !== null ? offer : null;
  const row = shop.availability.find((entry) => entry.itemId === product.id);
  return {
    priceScopeId: priced ? quoted : null,
    price: priced ? priced.price : null,
    currency: priced ? priced.currency : null,
    available: row ? row.available : null,
  };
}

/**
 * The scope a shop is priced at: the most specific of its stack (plan 0105,
 * section 4), whose materialized rows answer for the whole stack. Null only for
 * a shop with no stack at all, which plan 0116 says cannot exist, and which is
 * then priced nowhere rather than somewhere guessed.
 */
export function quotedScopeOf(shop: ShopAvailabilityView): string | null {
  return shop.location.priceScopeIds[0] ?? null;
}

/** One shop, as much of it as the pick sheet draws. */
export function toScopeLocationView(
  location: SupermarketLocationView
): BasketScopeLocationView {
  return {
    supermarketLocationId: location.id,
    label: location.label,
    address: location.address,
    city: location.city,
    postalCode: location.postalCode,
  };
}

/**
 * The read's scopes, with the read's shop in them (plan 0163, section 2).
 *
 * A client draws the chosen shop's name from `scopes[].locations`, and a shop
 * outside the owner's profile is in no scope the profile listed. So every
 * scope of the shop's stack the read already describes gains the shop, and the
 * scope the shop is priced at is added when the read does not describe it.
 *
 * A scope added here lists **this shop alone** rather than every shop of the
 * scope: the rest of its shops are nobody's neighbourhood, and listing a
 * national scope's shops would list a country.
 */
export function withShopInScopes(
  scopes: BasketPriceScopeView[],
  shop: ShopAvailabilityView,
  servesLocations: boolean
): BasketPriceScopeView[] {
  const stack = new Set(shop.location.priceScopeIds);
  const here = toScopeLocationView(shop.location);
  const withShop = scopes.map((scope) => {
    if (
      !servesLocations ||
      !stack.has(scope.priceScopeId) ||
      scope.locations.some(
        (location) =>
          location.supermarketLocationId === here.supermarketLocationId
      )
    ) {
      return scope;
    }
    return { ...scope, locations: [...scope.locations, here] };
  });
  const quoted = quotedScopeOf(shop);
  if (
    quoted === null ||
    withShop.some((scope) => scope.priceScopeId === quoted)
  ) {
    return withShop;
  }
  return [
    ...withShop,
    {
      priceScopeId: quoted,
      supermarketId: shop.supermarket.id,
      supermarketName: shop.supermarket.name,
      locations: servesLocations ? [here] : [],
    },
  ];
}
