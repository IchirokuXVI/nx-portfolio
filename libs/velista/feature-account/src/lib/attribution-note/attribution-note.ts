import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  GEONAMES_ATTRIBUTION,
  GEONAMES_URL,
  OSM_ATTRIBUTION,
  OSM_URL,
} from '@portfolio/velista/models';

/**
 * The credit owed for the shops on screen (plan 0059, section 5).
 *
 * **Attribution is an obligation, not a nicety.** Every shop here came from
 * OpenStreetMap, whose data is ODbL, and this screen is where that obligation finally
 * lands, because it is the first place in velista a person sees the data.
 *
 * ## From the constants, never as a typed string
 *
 * Both sentences are the exported constants, re-exported through
 * `@portfolio/velista/models` so there is one place that decides this app may reach the
 * libraries they live beside. A string typed into this template would be a copy that
 * quietly stops matching the licence the day somebody edits the original, which is the
 * whole reason those constants exist rather than a comment.
 *
 * ## GeoNames only where GeoNames did something
 *
 * Two thirds of OpenStreetMap's shops carry no postcode, so catalog fills those from the
 * nearest GeoNames centroid, and that data is CC BY 4.0 (backend plan 0061, section 5).
 * The credit is due beside a code that was derived and is not due beside one somebody
 * observed, so {@link derived} decides it rather than the presence of shops: claiming a
 * contribution where there was none is its own kind of wrong.
 */
@Component({
  selector: 'lib-attribution-note',
  templateUrl: './attribution-note.html',
  styleUrl: './attribution-note.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttributionNote {
  /** Whether any postal code on screen was derived from a centroid rather than observed. */
  readonly derived = input(false);

  protected readonly osm = OSM_ATTRIBUTION;
  protected readonly osmUrl = OSM_URL;
  protected readonly geonames = GEONAMES_ATTRIBUTION;
  protected readonly geonamesUrl = GEONAMES_URL;
}
