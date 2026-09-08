/**
 * The packet the model is given (plan 0001).
 *
 * Carried over from backend plan 0099 with the change that plan's own status
 * note names: the group directory is gone. There may be thousands of groups, so
 * the candidates arrive per product, found by search, and a candidate carries an
 * `origin`. `catalog` is a group the main catalog already holds and `run` is one
 * this run created in the rehearsal catalog. The model is not told that two
 * databases exist; it is told which candidates it may name by id and which it
 * must name by `ref`, because a run created group has no real id until `apply`.
 */

/**
 * One candidate group as the model sees it.
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
    synonyms: group.synonyms ?? null,
  };
}

/** What the model is asked about: the product, plus the groups it might join. */
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
