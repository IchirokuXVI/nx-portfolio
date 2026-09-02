/**
 * The GeoNames postal code dataset is CC BY 4.0 (plan 0060, section 3), which
 * is a second attribution obligation beside OpenStreetMap's ODbL. As with
 * `OSM_ATTRIBUTION`, the string is exported next to the data so the obligation
 * travels with the thing rather than living in a comment somebody later
 * deletes: wherever a postal code resolved or expanded through this data is
 * shown, this is shown beside it.
 */
export const GEONAMES_ATTRIBUTION = 'Postal code data © GeoNames, CC BY 4.0';

/** The credit link the licence asks for. */
export const GEONAMES_URL = 'https://www.geonames.org';

export const GEONAMES_LICENSE_URL =
  'https://creativecommons.org/licenses/by/4.0/';

/** Where the per country exports live; `<CC>.zip` holds `<CC>.txt`. */
export const GEONAMES_POSTAL_CODES_URL =
  'https://download.geonames.org/export/zip';
