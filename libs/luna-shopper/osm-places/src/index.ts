/**
 * OpenStreetMap as a store finder for every chain at once (plan 0038, section
 * 3.2), through Nominatim and Overpass.
 *
 * Named after the provider because its data model leaks into the result shape.
 * Framework free by the same hard constraint as the Mercadona library: no
 * TypeORM, no Nest, no database.
 *
 * **Attribution is an obligation, not a nicety.** OSM data is ODbL, so anywhere
 * discovered store data is shown must carry {@link OSM_ATTRIBUTION}.
 */

export {
  NOMINATIM_URL,
  OSM_ATTRIBUTION,
  OVERPASS_URL,
  OsmHttpError,
  OsmPlacesClient,
} from './lib/osm-places.client';
export {
  distanceMetres,
  groupByBrand,
  normalizeElement,
  normalizeGeocode,
  normalizeOverpassResponse,
} from './lib/normalize';
export type {
  DiscoveredPlace,
  LatLon,
  OsmPlacesClientOptions,
} from './lib/types';
