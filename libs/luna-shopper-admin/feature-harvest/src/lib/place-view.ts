import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';

type Place = Wire.HarvestDiscoveredPlaceView;

/**
 * How close two places have to be to be worth showing together.
 *
 * Fifty metres is the harvester's own threshold: a place matching the same brand
 * within fifty metres is treated as already known and is never offered, so
 * anything that reached this queue is either further away than that or has a
 * different brand key. Showing a wider radius here than the matcher used is
 * deliberate, because the interesting case is the one that just missed.
 */
const NEAR_METRES = 250;

/** One metre of latitude, near enough, anywhere. */
const METRES_PER_DEGREE = 111_320;

/**
 * The lines the queue draws for one place.
 *
 * A fixed order, so the same fact is in the same position on every item.
 * Somebody working through a queue reads by position after the first few, and a
 * layout that reflows when a field is missing costs them that.
 */
export function placeLines(
  place: Place
): readonly { key: string; value: string }[] {
  return [
    { key: 'brand', value: place.brandName ?? '' },
    { key: 'brandKey', value: place.brandKey ?? '' },
    { key: 'street', value: place.street ?? '' },
    { key: 'city', value: place.city ?? '' },
    { key: 'postalCode', value: place.postalCode ?? '' },
    { key: 'country', value: place.country ?? '' },
    { key: 'openingHours', value: place.openingHours ?? '' },
    { key: 'website', value: place.website ?? '' },
    { key: 'provider', value: place.provider },
    { key: 'externalRef', value: place.externalRef },
    { key: 'coordinates', value: coordinates(place) },
  ];
}

/**
 * The places in the queue that this one might be the same shop as.
 *
 * Same brand key, and close. Both halves matter: distance alone would pair a
 * bakery with the supermarket next door, and brand alone would pair two branches
 * of the same chain in different cities, which is not a duplicate and is exactly
 * what the catalog is supposed to hold two of.
 *
 * A place with no brand key is compared to other places with no brand key. That
 * is the honest reading: an absent `brand:wikidata` is not a value two places
 * share, but it is the state that makes a duplicate hardest to spot
 * automatically, so those are the ones most worth putting side by side.
 */
export function nearby(
  place: Place,
  others: readonly Place[]
): readonly Place[] {
  return others.filter(
    (other) =>
      other.brandKey === place.brandKey &&
      metresBetween(place, other) <= NEAR_METRES
  );
}

/**
 * Distance in metres, on a flat approximation.
 *
 * Good to a fraction of a percent over a few hundred metres, which is the only
 * range this is asked about, and it needs no trigonometry beyond one cosine. The
 * longitude degree shrinks with latitude, and ignoring that would make two
 * places in Madrid look a third further apart than they are.
 */
export function metresBetween(
  a: Pick<Place, 'latitude' | 'longitude'>,
  b: Pick<Place, 'latitude' | 'longitude'>
): number {
  const latitudeMetres = (a.latitude - b.latitude) * METRES_PER_DEGREE;
  const longitudeMetres =
    (a.longitude - b.longitude) *
    METRES_PER_DEGREE *
    Math.cos((a.latitude * Math.PI) / 180);

  return Math.hypot(latitudeMetres, longitudeMetres);
}

function coordinates(place: Place): string {
  return `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
}

/**
 * Which rule found a catalog shop a place may be (backend plan 0152, section
 * 2), in the order the harvester tries them.
 *
 * The first three are strict: the harvester refuses an import on them. The
 * fourth, `SAME_CHAIN_NEAR`, is a hint (backend plan 0193, target 6): a shop
 * of the chain farther than fifty metres and within two hundred and fifty.
 *
 * `UNKNOWN` is this app's own member, for a rung a later backend adds: the
 * candidate is still drawn and still linkable, and only the sentence saying why
 * it was offered is the generic one.
 */
export type PlaceMatchRung =
  | 'EXTERNAL_REF'
  | 'NEARBY'
  | 'ADDRESS'
  | 'SAME_CHAIN_NEAR'
  | 'UNKNOWN';

const RUNGS: readonly PlaceMatchRung[] = [
  'EXTERNAL_REF',
  'NEARBY',
  'ADDRESS',
  'SAME_CHAIN_NEAR',
];

/**
 * One shop the catalog already holds that a place may be.
 *
 * This app's own shape, and one shape for both ways a candidate arrives: on
 * the list read, where the document describes it, and in the details of a
 * 409, an error body that the document describes as an open object. The
 * second has no generated type to borrow, so rule D4 applies with most force,
 * and the first is read by the same mapper so that the panel draws one thing.
 */
export interface PlaceCandidate {
  readonly supermarketLocationId: string;
  /** The chain of the shop, or `''` when the answer did not say. */
  readonly supermarketId: string;
  /** The shop's label, or its address, or its id: never blank. */
  readonly title: string;
  readonly address: string;
  readonly city: string;
  readonly postalCode: string;
  /** Whole metres from the place, or null for a shop with no position. */
  readonly metres: number | null;
  readonly rung: PlaceMatchRung;
  /**
   * Whether this is a hint and not a match: a shop of the chain that is only
   * near. Its button is the quiet kind (admin plan 0061, target 3).
   */
  readonly hint: boolean;
}

/**
 * The candidates a `place_matches_location` refusal named, read from its
 * `details`.
 */
export function placeCandidates(
  details: Readonly<Record<string, unknown>>,
  locales: readonly string[]
): readonly PlaceCandidate[] {
  return candidatesOf(details['candidates'], locales);
}

/**
 * A list of candidates, as this app draws them.
 *
 * Takes `unknown` and drops anything without a shop id, because a candidate
 * that cannot be linked is not an answer the panel can offer. Never throws.
 */
export function candidatesOf(
  listed: unknown,
  locales: readonly string[]
): readonly PlaceCandidate[] {
  if (!Array.isArray(listed)) {
    return [];
  }

  const candidates: PlaceCandidate[] = [];
  for (const entry of listed as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = row['supermarketLocationId'];
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    const address = textOf(row['address']);
    const metres = row['metres'];
    const distance =
      typeof metres === 'number' && Number.isFinite(metres)
        ? Math.round(metres)
        : null;
    const hint = row['rung'] === 'SAME_CHAIN_NEAR';
    // The sentence of a hint names the distance. A hint that came with none
    // keeps its quiet button and takes the generic sentence.
    const rung =
      hint && distance === null
        ? 'UNKNOWN'
        : (RUNGS.find((known) => known === row['rung']) ?? 'UNKNOWN');
    candidates.push({
      supermarketLocationId: id,
      supermarketId: textOf(row['supermarketId']),
      title: localizedTextValue(row['label'], locales) || address || id,
      address,
      city: textOf(row['city']),
      postalCode: textOf(row['postalCode']),
      metres: distance,
      rung,
      hint,
    });
  }
  return candidates;
}

/**
 * What the mark on a line of the column says, or null for a place with no
 * candidate (admin plan 0061, target 1).
 *
 * Two sentences, because a hint must read as a hint on the line as well. A
 * place that a strict rule found a shop for is probably that shop. A place
 * with only a shop of its chain nearby is not: two shops of one chain two
 * hundred metres apart exist.
 */
export function candidateMarkKey(listed: unknown): string | null {
  if (!Array.isArray(listed) || listed.length === 0) {
    return null;
  }
  const strict = (listed as unknown[]).some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>)['rung'] !== 'SAME_CHAIN_NEAR'
  );
  return strict ? 'harvest.places.mark.probable' : 'harvest.places.mark.near';
}

/** The fields a link can fill, in the order the sentence names them. */
const LINK_FIELDS: readonly string[] = [
  'ADDRESS',
  'CITY',
  'POSTAL_CODE',
  'COUNTRY',
  'COORDINATES',
  'EXTERNAL_REF',
  'FOOTPRINT',
];

/**
 * The translation keys of what a link filled, in a fixed order (admin plan
 * 0061, target 7).
 *
 * The order is this app's and not the answer's, so the sentence reads the
 * same way every time: the address, the city, the postal code, and then the
 * rest. A field a later backend adds is named "another field" once.
 */
export function filledFieldKeys(filled: unknown): readonly string[] {
  if (!Array.isArray(filled)) {
    return [];
  }
  const named = (filled as unknown[]).filter(
    (field): field is string => typeof field === 'string'
  );
  const keys = LINK_FIELDS.filter((field) => named.includes(field)).map(
    (field) => `harvest.places.linked.field.${field}`
  );
  return named.some((field) => !LINK_FIELDS.includes(field))
    ? [...keys, 'harvest.places.linked.field.OTHER']
    : keys;
}

/**
 * The chain a `place_names_another_chain` refusal named, read from its
 * `details`, or `''` when it named none this app can read.
 */
export function refusedChainName(
  details: Readonly<Record<string, unknown>>,
  locales: readonly string[]
): string {
  const chain = details['chain'];
  if (typeof chain !== 'object' || chain === null) {
    return '';
  }
  const name = (chain as Record<string, unknown>)['name'];
  return typeof name === 'string' ? name : localizedTextValue(name, locales);
}

/** A catalog shop near the place, for the duplicates panel. */
export interface NearbyShop {
  readonly id: string;
  readonly title: string;
  readonly address: string;
  readonly city: string;
  readonly postalCode: string;
  /** Rounded metres, or null for a shop the catalog holds no position for. */
  readonly metres: number | null;
}

/**
 * The catalog shops of the place's chain that might be the same shop
 * (admin plan 0034, section 1).
 *
 * Within {@link NEAR_METRES} when the shop has a position, and at the same
 * postal code when it has none. The second half is the case that matters:
 * seeded shops carry no coordinates, and those are the duplicates backend plan
 * 0150 found. Nearest first, the unplaced ones last.
 */
export function nearbyShops(
  place: Place,
  rows: readonly unknown[],
  locales: readonly string[]
): readonly NearbyShop[] {
  const shops: NearbyShop[] = [];
  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = row['id'];
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    const latitude = row['latitude'];
    const longitude = row['longitude'];
    const placed =
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude);
    const postalCode = textOf(row['postalCode']);

    let metres: number | null = null;
    if (placed) {
      metres = Math.round(metresBetween(place, { latitude, longitude }));
      if (metres > NEAR_METRES) {
        continue;
      }
    } else if (postalCode === '' || postalCode !== (place.postalCode ?? '')) {
      continue;
    }

    const address = textOf(row['address']);
    shops.push({
      id,
      title: localizedTextValue(row['label'], locales) || address || id,
      address,
      city: textOf(row['city']),
      postalCode,
      metres,
    });
  }

  return shops.sort(
    (a, b) =>
      (a.metres ?? Number.POSITIVE_INFINITY) -
      (b.metres ?? Number.POSITIVE_INFINITY)
  );
}

/** One place the bulk act links, and the shop it links it to. */
export interface RefLinkLine {
  readonly placeId: string;
  /** The name of the place, or its reference: never blank. */
  readonly place: string;
  /** Its street and city, as far as it has them. */
  readonly where: string;
  readonly shop: string;
  /** The translation keys of what the link fills, in the fixed order. */
  readonly filledKeys: readonly string[];
}

/** One place the bulk act leaves as it is, and why. */
export interface RefSkipLine {
  readonly placeId: string;
  readonly place: string;
  readonly where: string;
  readonly reasonKey: string;
}

/** What the bulk act does, or would do, as the preview draws it. */
export interface RefLinkPreview {
  readonly linked: readonly RefLinkLine[];
  readonly skipped: readonly RefSkipLine[];
}

const SKIP_REASONS: readonly string[] = ['SEVERAL_SHOPS', 'PROVIDER_NOT_NAMED'];

/**
 * The answer of the bulk link, dry or applied, as lines to draw (admin plan
 * 0061, target 8).
 *
 * The shop of a line goes through the same mapper as every other candidate,
 * so it is called by its label, then its address, then its id. A reason a
 * later backend adds reads "Not linked".
 */
export function refLinkPreview(
  answer: Wire.HarvestLinkPlacesByRefResult,
  locales: readonly string[]
): RefLinkPreview {
  return {
    linked: answer.linked.map((row) => ({
      placeId: row.place.id,
      place: row.place.name ?? row.place.externalRef,
      where: whereOf(row.place),
      shop:
        candidatesOf([row.shop], locales)[0]?.title ??
        row.shop.supermarketLocationId,
      filledKeys: filledFieldKeys(row.filled),
    })),
    skipped: answer.skipped.map((row) => ({
      placeId: row.place.id,
      place: row.place.name ?? row.place.externalRef,
      where: whereOf(row.place),
      reasonKey: `harvest.places.byRef.reason.${
        SKIP_REASONS.includes(row.reason) ? row.reason : 'UNKNOWN'
      }`,
    })),
  };
}

/**
 * What a sentence calls one place: its name, and its street after it.
 *
 * The name alone does not say which place. Every place of a chain that prints
 * its banner on each record has the same name, and the street is what tells
 * two of them apart.
 */
export function placeLabel(place: Place): string {
  const name = place.name ?? place.externalRef;
  const street = (place.street ?? '').trim();
  return street === '' ? name : `${name} (${street})`;
}

function whereOf(place: Place): string {
  return [place.street, place.city]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
}

/** The shop a person picked, as the line above the link button draws it. */
export interface PickedShop {
  readonly id: string;
  readonly title: string;
  readonly address: string;
  readonly city: string;
  readonly postalCode: string;
}

/**
 * One catalog row as the shop a person picked to link to, or null for a row
 * with no id (admin plan 0061, target 4).
 */
export function pickedShop(
  row: unknown,
  locales: readonly string[]
): PickedShop | null {
  if (typeof row !== 'object' || row === null) {
    return null;
  }
  const fields = row as Record<string, unknown>;
  const id = fields['id'];
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  const address = textOf(fields['address']);
  return {
    id,
    title: localizedTextValue(fields['label'], locales) || address || id,
    address,
    city: textOf(fields['city']),
    postalCode: textOf(fields['postalCode']),
  };
}

/**
 * Whether the place came from OpenStreetMap, which names things in no stated
 * language and so cannot name a chain by itself (backend plan 0153).
 *
 * Compared without case: the harvester writes `OSM`, and older rows and the
 * memory seed write `osm`.
 */
export function fromOpenStreetMap(place: Place): boolean {
  return place.provider.toLowerCase() === 'osm';
}

/**
 * The sentence for a refusal of a place decision, where the places queue has
 * one of its own, and `null` where the generic sentence is the right one.
 *
 * The three codes backend plan 0152 added, and the one of backend plan 0193.
 * `place_matches_location` and `place_names_another_chain` each have a panel
 * of their own on the open place, so their sentences are for the case in which
 * that panel could not be drawn.
 */
export function placeRefusalKey(error: GatewayError | null): string | null {
  switch (error?.code) {
    case 'place_matches_location':
      return 'harvest.places.error.matchesLocation';
    case 'place_already_imported':
      return 'harvest.places.error.alreadyImported';
    case 'scope_not_found':
      return 'harvest.places.error.scopeNotFound';
    case 'place_names_another_chain':
      return 'harvest.places.error.namesAnotherChain';
    default:
      return null;
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
