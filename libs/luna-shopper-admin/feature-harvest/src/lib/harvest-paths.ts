/**
 * Where the harvester screens live, under the app root.
 *
 * The addresses themselves are in `models` (admin plan 0044), because a
 * chain's page and a price row link into this section, and they are in a
 * library this one imports. This file passes the segment on under the name the
 * screens here have always imported it by.
 */
export { HARVEST_SEGMENT } from '@portfolio/luna-shopper-admin/models';
