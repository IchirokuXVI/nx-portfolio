import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import { OsmPlacesClient } from '@portfolio/luna-shopper/osm-places';
import type { HarvesterConfig } from '../config/app-config';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against OpenStreetMap (plan 0038, section 6.1). Two
 * requests, and it is the cheapest of the three modes by three orders of
 * magnitude.
 *
 * **It was the only case and is now one of two** (plan 0089, section 9). A
 * chain that publishes its own shops is read from that chain, because the
 * chain also states the price region each shop belongs to and OpenStreetMap
 * has no such field. This case is what a run with no chain behind it takes,
 * which is every run the postal code queue starts.
 *
 * The shape rests on section 2.8, the finding that most changed the design:
 * **the postal code and the radius answer two different questions.** Asking
 * Nominatim for 14013 returns a point and a bounding box spanning most of
 * Córdoba, and the 12 Mercadonas inside that box are in four other postcodes. So
 * the postal code determines the **price scope** through Mercadona's own
 * resolver, and a radius around the postal code's centre determines the **store
 * list** through OpenStreetMap. Two questions, two sources, neither pretending to
 * answer the other.
 *
 * **The run creates nothing in catalog.** A radius over a city returns 75 places
 * of which half are independent corner shops; auto-creating those would fill the
 * catalog with rows nobody asked for. Import is a second, explicit step.
 */
@Injectable()
export class OsmStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(OsmStoreDiscoveryRunner.name);

  constructor(
    private readonly queue: PostalCodeDiscoveryStore,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput
  ): Promise<void> {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const client = new OsmPlacesClient({
      userAgent: settings.userAgent,
      nominatimUrl: settings.nominatimUrl,
      overpassUrl: settings.overpassUrl,
      acquire: context.acquire,
      signal: context.signal,
    });

    await context.setStage(
      'GEOCODE',
      `Locating postal code ${input.postalCode}`
    );
    const centre = await client.geocodePostalCode(
      input.postalCode,
      input.country
    );
    if (!centre) {
      throw new Error(
        `Nominatim found no point for postal code ${input.postalCode} in ` +
          `${input.country}, so there is nowhere to search around.`
      );
    }

    // The name Nominatim gave the code, kept rather than discarded (plan 0097,
    // section 4). Nothing else in this system stores a name for a postal code,
    // and an operator reading a list of bare numbers cannot tell Córdoba from
    // Cáceres. It costs no request, because the answer is already here.
    //
    // It matches no row when an admin spawned this run for a code nobody
    // queued, which is normal: the queue is demand driven and a run is not.
    if (centre.displayName) {
      await this.queue.recordPlaceName(
        input.country.trim().toLowerCase(),
        input.postalCode,
        centre.displayName
      );
    }

    await context.setStage(
      'OVERPASS',
      `Searching ${input.radiusMetres} m around ${centre.lat}, ${centre.lon}`
    );
    const found = await client.findSupermarkets(centre, input.radiusMetres);
    await context.setTotalPlanned(found.length);
    this.logger.log(
      `Run ${context.runId}: ${found.length} supermarket(s) within ` +
        `${input.radiusMetres} m of ${input.postalCode}`
    );

    await context.setStage('UPSERT', `Recording ${found.length} place(s)`);
    // The run's own country, recorded on every place it touches (plan 0061,
    // section 4). OSM does not tag one and the run has always known it; it is
    // what keys the centroid lookup that fills the postcode on import.
    const country = input.country.trim().toLowerCase();

    for (const place of found) {
      if (context.signal.aborted) {
        break;
      }
      // **The postal code is the source's or it is absent** (plan 0097, section
      // 3). About a third of places carry `addr:postcode`, and the rest are
      // derived by the orchestrator from the coordinates below, bounded, which
      // is the only thing this runner ever knew about them anyway.
      report.place({
        provider: place.provider,
        externalRef: place.externalRef,
        brandKey: place.brandKey,
        brandName: place.brandName,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        street: place.street,
        city: place.city,
        postalCode: place.postalCode,
        postalCodeSource: place.postalCode ? PostalCodeSource.SOURCE : null,
        // The run's own country, on every place it touches (plan 0061, section
        // 4). OSM does not tag one and the run has always known it.
        country,
        website: place.website,
        openingHours: place.openingHours,
        tags: place.tags,
      });
    }

    await context.flush();
  }
}
