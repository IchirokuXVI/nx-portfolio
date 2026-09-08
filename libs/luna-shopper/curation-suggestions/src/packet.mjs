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

import { chainName } from './rules.mjs';

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

/** What the model is asked about: the entry as observed, plus the pre-pass. */
export function buildEntryPacket({ entry, supermarket, candidates, eanMatch }) {
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
      proposedItemId: entry.itemId ?? null,
      extra: trimExtra(entry.extra ?? null),
    },
    candidates,
    eanMatch: eanMatch ?? null,
  };
}
