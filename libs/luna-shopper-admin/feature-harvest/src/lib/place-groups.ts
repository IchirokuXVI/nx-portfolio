import type { Wire } from '@portfolio/luna-shopper-admin/models';

/** One group of discovered places, as the groups view draws it. */
export interface PlaceGroupRow {
  /** Unique within one answer, for tracking. */
  readonly key: string;
  /** The printed brand, or `''` for the places that carry none. */
  readonly name: string;
  /** The Wikidata identifier, or `''` for a group formed without one. */
  readonly brandKey: string;
  readonly count: number;
  /** The catalog chain the group resolves to, or `''` when none does yet. */
  readonly supermarketId: string;
  /** A few of its places, by name. */
  readonly sample: readonly string[];
}

/**
 * The groups, largest first, with the ones nobody can file last.
 *
 * Since backend plan 0154 a place with no brand key is grouped by its printed
 * brand and then its name, and only places with neither share the "no brand"
 * group. That group is the least actionable, so it sorts last whatever its
 * size; the rest sort by how many places they hold, which is how much a
 * decision about the chain settles.
 */
export function placeGroupRows(
  result: Wire.HarvestDiscoveredPlaceGroupsResult
): readonly PlaceGroupRow[] {
  const rows = result.groups.map(
    (group, index): PlaceGroupRow => ({
      key: `${group.brandKey ?? ''}|${group.brandName ?? ''}|${index}`,
      name: group.brandName ?? '',
      brandKey: group.brandKey ?? '',
      count: group.count,
      supermarketId: group.known ? (group.supermarketId ?? '') : '',
      sample: group.sample.map((place) => place.name ?? place.externalRef),
    })
  );

  return rows.sort((a, b) => {
    const unnamed = Number(a.name === '') - Number(b.name === '');
    return unnamed !== 0 ? unnamed : b.count - a.count;
  });
}
