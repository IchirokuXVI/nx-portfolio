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
  canonicalBrand,
  chainName,
  chainNamesById,
  findBrand,
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
    ean: item.ean ?? null,
    category: item.category ?? null,
    ...(proposedByLadder ? { proposedByLadder: true } : {}),
  };
}

/**
 * The registered brand this entry's own printed brand names, or null.
 *
 * The registry is read by the library and never by the model: what the packet
 * carries is the one brand this row resolved to, with the chain that owns it
 * when it is a private label. An unregistered spelling answers null, which is
 * the same answer a row with no brand at all gets, and the prompt says what to
 * do with either.
 *
 * Candidates are not annotated. A `LINK` takes the candidate's brand as it is,
 * because that brand is already a catalog product's brand and nothing here
 * would be deciding anything new about it.
 *
 * **A linked spelling resolves to the brand it spells** (plan 0005). `label` is
 * always the brand to write, so the existing rule "write `brandMatch.label`"
 * gets `Deborah` out of a chain printing `DEBORAH 48H` on the first attempt,
 * and `printedAs` names the spelling the chain printed so the model knows what
 * the name has to keep. It is null when the printed brand is not a link.
 */
export function brandMatchFor({ entry, brands, supermarkets }) {
  const registered = findBrand(brands, entry?.brand);
  if (!registered) {
    return null;
  }
  const canonical = canonicalBrand(brands, registered);
  const owner = canonical.privateLabelSupermarketId;
  return {
    label: canonical.label,
    privateLabelOf: owner
      ? (chainNamesById(supermarkets).get(owner) ?? null)
      : null,
    printedAs: canonical === registered ? null : registered.label,
  };
}

/** What the model is asked about: the entry as observed, plus the pre-pass. */
export function buildEntryPacket({
  entry,
  supermarket,
  candidates,
  eanMatch,
  brands = new Map(),
  supermarkets = [],
}) {
  return {
    entry: {
      id: entry.id,
      name: entry.name,
      brand: entry.brand ?? null,
      ean: entry.ean ?? null,
      unitSize: entry.unitSize ?? null,
      sizeFormat: entry.sizeFormat ?? null,
      categoryPath: entry.categoryPath ?? [],
      url: entry.url ?? null,
      sourceKind: entry.sourceKind ?? null,
      status: entry.status ?? null,
      chainName: supermarket ? chainName(supermarket) : null,
      chainRegistered: Boolean(supermarket),
      brandMatch: brandMatchFor({ entry, brands, supermarkets }),
      proposedItemId: entry.itemId ?? null,
      extra: trimExtra(entry.extra ?? null),
    },
    candidates,
    eanMatch: eanMatch ?? null,
  };
}
