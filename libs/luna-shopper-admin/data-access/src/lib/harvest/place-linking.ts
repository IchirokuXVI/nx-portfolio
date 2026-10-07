import type { Wire } from '@portfolio/luna-shopper-admin/models';

type Place = Wire.HarvestDiscoveredPlaceView;
type Candidate = Wire.HarvestPlaceLocationCandidate;
type Field = Wire.EnumsPlaceLinkField;

/**
 * The rules by which a place finds the shop it is, for the memory harvester
 * (backend plan 0193, targets 1 to 8; admin plan 0061, target 10).
 *
 * The harvester works these out against catalog. The memory harvester has no
 * catalog to ask, so it holds a few shops and chains of its own and applies the
 * same rules to them. They are pure functions in a file of their own, so that
 * each rule has a spec, and so that the class that serves the screens stays a
 * list of routes.
 *
 * Every rule here is the backend's. A rule that is changed there and not here
 * makes the screens look right with nothing listening and wrong against a
 * server, which is the one thing a twin must not do.
 */

/** A shop of the catalog, as far as a link reads or writes it. */
export interface LinkableShop {
  readonly id: string;
  readonly supermarketId: string;
  label: Readonly<Record<string, string>> | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  postalCodeSource: Wire.EnumsPostalCodeSource | null;
  latitude: number | null;
  longitude: number | null;
  externalRef: string | null;
  externalProvider: string | null;
  /** The floor area in square metres, or null for a shop with no size yet. */
  footprintM2: number | null;
}

/** A chain of the catalog, as far as a place can name one. */
export interface LinkableChain {
  readonly id: string;
  readonly name: Readonly<Record<string, string>>;
  readonly brandKey: string | null;
}

/** The strict distance: a shop of the chain this close is the same shop. */
export const SAME_SHOP_METRES = 50;
/** The distance of a hint: a shop of the chain this close is worth a look. */
export const NEAR_SHOP_METRES = 250;

/** The radius of the earth in metres, as the harvester takes it. */
const EARTH_RADIUS_METRES = 6_371_000;

/**
 * The chain a place names, or null.
 *
 * The brand key first, then the printed brand or the name as the name of a
 * chain in any language. Two names are the same name when they differ in case
 * and in white space only, which is the rule of the harvester
 * (`chainNameKey`). An accent or a hyphen is not folded: the name is the weak
 * identity, and a wider fold widens the one case it can get wrong.
 *
 * A place that names no chain is not a refusal: it links to the shop a person
 * names, and it still finds a shop by its reference.
 */
export function chainOfPlace(
  place: Place,
  chains: readonly LinkableChain[]
): LinkableChain | null {
  if (place.brandKey !== null && place.brandKey !== '') {
    const byKey = chains.find((chain) => chain.brandKey === place.brandKey);
    if (byKey !== undefined) {
      return byKey;
    }
  }

  const printed = chainNameKey(place.brandName ?? place.name ?? '');
  if (printed === '') {
    return null;
  }
  return (
    chains.find((chain) =>
      Object.values(chain.name).some((name) => chainNameKey(name) === printed)
    ) ?? null
  );
}

/**
 * The shops a place may be, best first.
 *
 * The three strict rungs come first, and the first of them that finds a shop
 * answers alone. Then the shops of the chain farther than fifty metres and
 * within two hundred and fifty, which are a hint and never a match. A shop is
 * named once. A place with no chain is asked about its reference only, against
 * the shops of every chain, because a reference is an identity.
 */
export function suggestShops(
  place: Place,
  shops: readonly LinkableShop[],
  chains: readonly LinkableChain[]
): Candidate[] {
  const chain = chainOfPlace(place, chains);
  const pool =
    chain === null
      ? shops
      : shops.filter((shop) => shop.supermarketId === chain.id);

  const strict = strictShops(place, pool, chain !== null);
  if (chain === null) {
    return strict;
  }

  const named = new Set(strict.map((found) => found.supermarketLocationId));
  const near = pool
    .filter((shop) => !named.has(shop.id))
    .map((shop) => ({ shop, metres: distanceTo(place, shop) }))
    .filter(
      (entry): entry is { shop: LinkableShop; metres: number } =>
        entry.metres !== null &&
        entry.metres > SAME_SHOP_METRES &&
        entry.metres <= NEAR_SHOP_METRES
    )
    .sort((a, b) => a.metres - b.metres)
    .map((entry) => candidate(place, entry.shop, 'SAME_CHAIN_NEAR'));

  return [...strict, ...near];
}

/** The strict rungs only, which is what a refused import answers with. */
export function strictShops(
  place: Place,
  pool: readonly LinkableShop[],
  withChain: boolean
): Candidate[] {
  const byRef = pool.filter((shop) => carriesRefOf(place, shop));
  if (byRef.length > 0) {
    return ordered(place, byRef, 'EXTERNAL_REF');
  }
  if (!withChain) {
    return [];
  }

  // The distance is compared as it was measured, and rounded only to be
  // shown. A shop at 50.4 m is thus a hint, though it reads "50 m".
  const close = pool.filter((shop) => {
    const metres = distanceTo(place, shop);
    return metres !== null && metres <= SAME_SHOP_METRES;
  });
  if (close.length > 0) {
    return ordered(place, close, 'NEARBY');
  }

  const street = fold(place.street ?? '');
  const postalCode = (place.postalCode ?? '').trim();
  const sameAddress = pool.filter(
    (shop) =>
      distanceTo(place, shop) === null &&
      street !== '' &&
      postalCode !== '' &&
      (shop.postalCode ?? '').trim() === postalCode &&
      fold(shop.address ?? '') === street
  );
  return ordered(place, sameAddress, 'ADDRESS');
}

/**
 * What a link of this place writes to this shop, and the names of those
 * fields.
 *
 * A field with a value keeps it. The one exception is a postal code that
 * catalog guessed: a code that the source of the place stated replaces it. A
 * code that was itself derived is never sent. A blank field of the place fills
 * nothing.
 *
 * The provider is written only together with a reference that is being
 * filled, and never over a provider that the shop already names.
 *
 * `footprintM2` is the floor area of the place. The harvester holds it in a
 * column that the view of a place does not carry, so it is an argument here.
 */
export function linkFields(
  place: Place,
  shop: LinkableShop,
  footprintM2: number | null = null
): { readonly patch: Partial<LinkableShop>; readonly filled: Field[] } {
  const patch: Partial<LinkableShop> = {};
  const filled: Field[] = [];

  if (shop.latitude === null || shop.longitude === null) {
    patch.latitude = place.latitude;
    patch.longitude = place.longitude;
    filled.push('COORDINATES');
  }
  if (blank(shop.externalRef) && !blank(place.externalRef)) {
    patch.externalRef = place.externalRef;
    if (blank(shop.externalProvider)) {
      patch.externalProvider = place.provider;
    }
    filled.push('EXTERNAL_REF');
  }

  const stated =
    !blank(place.postalCode) && place.postalCodeSource !== 'DERIVED';
  if (
    stated &&
    (blank(shop.postalCode) || shop.postalCodeSource === 'DERIVED')
  ) {
    patch.postalCode = place.postalCode;
    patch.postalCodeSource = place.postalCodeSource ?? 'SOURCE';
    filled.push('POSTAL_CODE');
  }
  if (shop.footprintM2 === null && footprintM2 !== null && footprintM2 > 0) {
    patch.footprintM2 = footprintM2;
    filled.push('FOOTPRINT');
  }

  if (blank(shop.address) && !blank(place.street)) {
    patch.address = place.street;
    filled.push('ADDRESS');
  }
  if (blank(shop.city) && !blank(place.city)) {
    patch.city = place.city;
    filled.push('CITY');
  }
  if (blank(shop.country) && !blank(place.country)) {
    patch.country = place.country;
    filled.push('COUNTRY');
  }

  return { patch, filled };
}

/** What the bulk act does with one place, or null when it leaves it alone. */
export type RefDecision =
  | { readonly kind: 'link'; readonly shop: LinkableShop }
  | {
      readonly kind: 'skip';
      readonly reason: Wire.EnumsPlaceLinkSkipReason;
      readonly shops: readonly LinkableShop[];
    };

/**
 * Whether the bulk act links this place, skips it, or leaves it alone.
 *
 * It links when exactly one shop carries the reference of the place and that
 * shop names the same provider. Two shops are a skip, and so is one shop that
 * names no provider. A shop that names another provider is not a shop of this
 * place at all.
 */
export function decideByRef(
  place: Place,
  shops: readonly LinkableShop[]
): RefDecision | null {
  const carrying = shops.filter((shop) => carriesRefOf(place, shop));
  if (carrying.length === 0) {
    return null;
  }
  if (carrying.length > 1) {
    return { kind: 'skip', reason: 'SEVERAL_SHOPS', shops: carrying };
  }
  return blank(carrying[0].externalProvider)
    ? { kind: 'skip', reason: 'PROVIDER_NOT_NAMED', shops: carrying }
    : { kind: 'link', shop: carrying[0] };
}

/**
 * The shop that holds a reference, or null when none does (backend plan
 * 0195).
 *
 * The catalog holds one shop for each reference. Its index reads the
 * reference alone: not the chain, and not the provider. `except` is the shop
 * that is being written, which is never its own holder.
 */
export function refHolder(
  externalRef: string | null,
  shops: readonly LinkableShop[],
  except: string | null = null
): LinkableShop | null {
  if (blank(externalRef)) {
    return null;
  }
  return (
    shops.find(
      (shop) => shop.id !== except && shop.externalRef === externalRef
    ) ?? null
  );
}

/** A shop as the holder of a reference, as catalog names it in a refusal. */
export function asRefHolder(
  shop: LinkableShop,
  chains: readonly LinkableChain[]
): Wire.HarvestLocationRefHolder {
  const chain = chains.find((held) => held.id === shop.supermarketId);
  return {
    supermarketLocationId: shop.id,
    supermarketId: shop.supermarketId,
    supermarketName: { ...(chain?.name ?? {}) },
    label: shop.label === null ? null : { ...shop.label },
    address: shop.address,
    city: shop.city,
    externalProvider: shop.externalProvider,
  };
}

/** A shop as a candidate of a place, with the distance when both have one. */
export function candidate(
  place: Place,
  shop: LinkableShop,
  rung: Wire.EnumsPlaceMatchRung
): Candidate {
  return {
    supermarketLocationId: shop.id,
    supermarketId: shop.supermarketId,
    label: shop.label === null ? null : { ...shop.label },
    address: shop.address,
    city: shop.city,
    postalCode: shop.postalCode,
    rung,
    metres: metresTo(place, shop),
  };
}

/** Whole metres between a place and a shop, which is what a person reads. */
function metresTo(place: Place, shop: LinkableShop): number | null {
  const metres = distanceTo(place, shop);
  return metres === null ? null : Math.round(metres);
}

/** The first rung: the same reference, from the same provider or from none. */
function carriesRefOf(place: Place, shop: LinkableShop): boolean {
  return (
    !blank(shop.externalRef) &&
    shop.externalRef === place.externalRef &&
    (blank(shop.externalProvider) || shop.externalProvider === place.provider)
  );
}

function ordered(
  place: Place,
  shops: readonly LinkableShop[],
  rung: Wire.EnumsPlaceMatchRung
): Candidate[] {
  return shops
    .map((shop) => candidate(place, shop, rung))
    .sort(
      (a, b) =>
        (a.metres ?? Number.POSITIVE_INFINITY) -
        (b.metres ?? Number.POSITIVE_INFINITY)
    );
}

/**
 * Metres between a place and a shop, not rounded, or null for a shop with no
 * position. The great circle distance, which is the one the harvester
 * measures (`distanceMetres` of `osm-places`).
 */
function distanceTo(place: Place, shop: LinkableShop): number | null {
  if (shop.latitude === null || shop.longitude === null) {
    return null;
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(shop.latitude - place.latitude);
  const longitude = radians(shop.longitude - place.longitude);
  const half =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(place.latitude)) *
      Math.cos(radians(shop.latitude)) *
      Math.sin(longitude / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(half)));
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/** A chain name with its case and its white space folded, and no more. */
function chainNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Case, accents and punctuation folded away, and no word changed. For an
 * address, which is what the harvester folds this way (`normalizeName`).
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
