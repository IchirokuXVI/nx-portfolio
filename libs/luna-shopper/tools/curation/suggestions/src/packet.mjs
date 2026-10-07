/**
 * The packet the model is given (plan 0001).
 *
 * Carried over from backend plan 0098, with one addition: a candidate now
 * carries an `origin`. `catalog` is a row the main catalog already holds and
 * `run` is one this run created in the rehearsal catalog. The model is not told
 * that two databases exist; it is told which candidates it may name by id and
 * which it must name by `ref`, because a run created product has no real id
 * until `apply`.
 */

import {
  barcodesOf,
  chainName,
  chainNamesById,
  sourceBrands,
} from './rules.mjs';

/** An `extra` bag can hold a leaflet's whole page text; the model needs a taste. */
const MAX_EXTRA_CHARS = 2000;

function trimExtra(extra) {
  if (extra === null || extra === undefined) {
    return null;
  }
  const text = JSON.stringify(extra);
  if (text.length <= MAX_EXTRA_CHARS) {
    return extra;
  }
  return { truncated: true, preview: text.slice(0, MAX_EXTRA_CHARS) };
}

/**
 * One candidate as the model sees it.
 *
 * A `run` candidate answers `ref` and no `itemId`, so the only thing the model
 * can write about it is the ref. That is not a courtesy: the rehearsal id is
 * meaningless against the main catalog and must never reach a decisions file.
 */
export function toCandidate(
  item,
  { origin = 'catalog', ref = null, proposedByLadder = false } = {}
) {
  return {
    ...(origin === 'run' ? { ref } : { itemId: item.id }),
    origin,
    nameEs: item.name?.es ?? null,
    nameEn: item.name?.en ?? null,
    brand: item.brand ?? null,
    unitSize: item.unitSize ?? null,
    defaultUnit: item.defaultUnit ?? null,
    // How many the pack holds (backend plans 0162 and 0177). It is what lets a
    // box sized `16 ud` and the same box sized 160 g be read as one format.
    packCount: item.packCount ?? null,
    ean: item.ean ?? null,
    // Every barcode the product holds (backend plan 0185), `ean` first. A
    // maker prints a new barcode on the same product, so a candidate whose
    // `ean` differs from the entry's can still be the entry's product.
    eans: barcodesOf(item),
    // An item answers its categories as rows now (backend plan 0166), and the
    // slugs are the words the model names a category by.
    categorySlugs: (item.categories ?? [])
      .map((category) => category?.slug)
      .filter(Boolean),
    ...(proposedByLadder ? { proposedByLadder: true } : {}),
  };
}

/**
 * Every registered brand this entry's own printed brand names, the key's own
 * brand first. Empty when it names none.
 *
 * The registry is read by the library and never by the model: what the packet
 * carries is the brands this row resolved to, each with the chain that owns it
 * when it is a private label. An unregistered spelling answers the empty list,
 * which is the same answer a row with no brand at all gets, and the prompt says
 * what to do with either.
 *
 * Candidates are not annotated. A `LINK` takes the candidate's brand as it is,
 * because that brand is already a catalog product's brand and nothing here
 * would be deciding anything new about it.
 *
 * **A linked spelling resolves to the brand it spells** (plan 0005). `label` is
 * always the brand to write, so a chain printing `DEBORAH 48H` gets `Deborah`
 * on the first attempt, and `printedAs` names the spelling the chain printed so
 * the model knows what the name has to keep. It is null when the printed brand
 * is not a link.
 *
 * **A printed brand is a reading, not a verdict** (backend plan 0178). The list
 * used to be one brand, `brandMatch`, and a `CREATE` had to write it. Some
 * names belong to two businesses, so the list can now hold several and the
 * model chooses between them by what the product is. One brand is still the
 * ordinary case, and then there is nothing to choose.
 */
export function brandMatchesFor({ entry, brands, supermarkets }) {
  const chains = chainNamesById(supermarkets);
  return sourceBrands(brands, entry).map(({ brand, printedAs }) => ({
    label: brand.label,
    privateLabelOf: brand.privateLabelSupermarketId
      ? (chains.get(brand.privateLabelSupermarketId) ?? null)
      : null,
    printedAs,
  }));
}

/** What the model is asked about: the entry as observed, plus the pre-pass. */
export function buildEntryPacket({
  entry,
  supermarket,
  candidates,
  eanMatch,
  brands = new Map(),
  supermarkets = [],
  // The other queued entries of this chain printing the same EAN, as `start`
  // indexed them (plan 0006), or null when the barcode is this entry's alone.
  sharedEan = null,
}) {
  return {
    entry: {
      id: entry.id,
      name: entry.name,
      brand: entry.brand ?? null,
      ean: entry.ean ?? null,
      sharedEan:
        Array.isArray(sharedEan) && sharedEan.length > 0
          ? [...sharedEan]
          : null,
      unitSize: entry.unitSize ?? null,
      // The unit `unitSize` is in, as the source's own adapter stated it
      // (backend plan 0177), or null on a row no run has seen since.
      sizeUnit: entry.sizeUnit ?? null,
      // Whether the source sells it by weight (backend plan 0181). The row
      // then has no size, and its prices are the price of a kilo.
      soldByWeight: entry.soldByWeight === true,
      sizeFormat: entry.sizeFormat ?? null,
      packCount: entry.packCount ?? null,
      categoryPath: entry.categoryPath ?? [],
      url: entry.url ?? null,
      sourceKind: entry.sourceKind ?? null,
      status: entry.status ?? null,
      chainName: supermarket ? chainName(supermarket) : null,
      chainRegistered: Boolean(supermarket),
      brandMatches: brandMatchesFor({ entry, brands, supermarkets }),
      proposedItemId: entry.itemId ?? null,
      extra: trimExtra(entry.extra ?? null),
    },
    candidates,
    eanMatch: eanMatch ?? null,
  };
}
