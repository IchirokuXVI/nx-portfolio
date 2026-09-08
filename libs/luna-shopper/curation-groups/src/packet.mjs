/**
 * The packet the model is given (plan 0001).
 *
 * One ungrouped product, plus the groups a search for its name found. The
 * single file tool of backend plan 0099 put the whole group directory in the
 * prompt instead; that does not survive a catalog with thousands of groups, so
 * the directory is gone and these candidates replace it.
 *
 * A candidate carries an `origin`. `catalog` is a group the main catalog already
 * holds and `run` is one this run created in the rehearsal catalog. The model is
 * not told that two databases exist; it is told which candidates it may name by
 * id and which it must name by `ref`, because a run created group has no real id
 * until `apply`.
 */

/**
 * One candidate as the model sees it.
 *
 * A `run` candidate answers `ref` and no `groupId`, so the only thing the model
 * can write about it is the ref. That is not a courtesy: the rehearsal id is
 * meaningless against the main catalog and must never reach a decisions file.
 */
export function toCandidate(group, { origin = 'catalog', ref = null } = {}) {
  return {
    ...(origin === 'run' ? { ref } : { groupId: group.id }),
    origin,
    nameEs: group.name?.es ?? null,
    nameEn: group.name?.en ?? null,
    slug: group.slug ?? null,
    referenceUnit: group.referenceUnit ?? null,
    synonyms: {
      es: group.synonyms?.es ?? [],
      en: group.synonyms?.en ?? [],
    },
  };
}

/** What the model is asked about: the product, as the catalog holds it. */
export function buildItemPacket({ item, candidates }) {
  return {
    item: {
      id: item.id,
      nameEs: item.name?.es ?? null,
      nameEn: item.name?.en ?? null,
      brand: item.brand ?? null,
      unitSize: item.unitSize ?? null,
      defaultUnit: item.defaultUnit ?? null,
      category: item.category ?? null,
      ean: item.ean ?? null,
    },
    candidates,
  };
}
