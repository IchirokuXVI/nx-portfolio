import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DiscoveredPlaceStatus,
  PostalCodeSource,
} from '@portfolio/luna-shopper/contracts';
import { OsmPlacesClient } from '@portfolio/luna-shopper/osm-places';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { DiscoveredPlace } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';
import type { RunContext } from './run-context';
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
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
    private readonly queue: PostalCodeDiscoveryStore,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  async run(context: RunContext, input: StoreDiscoveryInput): Promise<void> {
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
    const seenAt = new Date();
    // The run's own country, recorded on every place it touches (plan 0061,
    // section 4). OSM does not tag one and the run has always known it; it is
    // what keys the centroid lookup that fills the postcode on import.
    const country = input.country.trim().toLowerCase();

    for (const place of found) {
      if (context.signal.aborted) {
        break;
      }
      const located = await this.locate(place, country, settings);
      const existing = await this.places.findOne({
        where: { provider: place.provider, externalRef: place.externalRef },
      });

      if (existing) {
        // Re-discovery refreshes the description but never resurrects a place
        // the owner already rejected or imported: `status` is the owner's, and a
        // run does not get to overwrite a decision.
        existing.brandKey = place.brandKey;
        existing.brandName = place.brandName;
        existing.name = place.name;
        existing.latitude = place.latitude;
        existing.longitude = place.longitude;
        existing.street = place.street;
        existing.city = place.city;
        existing.postalCode = located.postalCode;
        existing.postalCodeSource = located.postalCodeSource;
        existing.country = country;
        existing.website = place.website;
        existing.openingHours = place.openingHours;
        existing.tags = place.tags;
        existing.runId = context.runId;
        existing.lastSeenAt = seenAt;
        await this.places.save(existing);
        await context.report({ processed: 1, unchanged: 1 });
        continue;
      }

      await this.places.save(
        this.places.create({
          runId: context.runId,
          provider: place.provider,
          externalRef: place.externalRef,
          brandKey: place.brandKey,
          brandName: place.brandName,
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          street: place.street,
          city: place.city,
          postalCode: located.postalCode,
          postalCodeSource: located.postalCodeSource,
          country,
          website: place.website,
          openingHours: place.openingHours,
          tags: place.tags,
          status: DiscoveredPlaceStatus.NEW,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        })
      );
      await context.report({ processed: 1, created: 1 });
    }

    await context.flush();
  }

  /**
   * The place's postal code, and where it came from (plan 0097, section 3).
   *
   * `addr:postcode` wins whenever OpenStreetMap has one, because a source value
   * is never overridden by a guess. About a third of places have it, so the rest
   * ask catalog for the nearest centroid, bounded by the same
   * `POSTAL_CODE_DERIVE_MAX_METRES` plan 0061 bounds a location's own derivation
   * with.
   *
   * **A place beyond the bound keeps both columns null**, which is the honest
   * answer: a wrong postcode is worse than none, because it puts the shop in
   * somebody else's list.
   *
   * A failure asking catalog leaves the place with no code rather than failing
   * the run. One untagged address is not worth losing an eighteen minute walk
   * over, and the next run of this code fills it in.
   */
  private async locate(
    place: { postalCode: string | null; latitude: number; longitude: number },
    country: string,
    settings: HarvesterConfig
  ): Promise<{
    postalCode: string | null;
    postalCodeSource: PostalCodeSource | null;
  }> {
    if (place.postalCode) {
      return {
        postalCode: place.postalCode,
        postalCodeSource: PostalCodeSource.SOURCE,
      };
    }
    if (!country) {
      return { postalCode: null, postalCodeSource: null };
    }
    try {
      const { nearest } = await this.catalog.resolveNearestPostalCode(
        country,
        place.latitude,
        place.longitude,
        settings.postalCodeDeriveMaxMetres
      );
      return nearest
        ? {
            postalCode: nearest.postalCode,
            postalCodeSource: PostalCodeSource.DERIVED,
          }
        : { postalCode: null, postalCodeSource: null };
    } catch (error) {
      this.logger.warn(
        `Could not derive a postal code for a place in ${country}: ` +
          `${String(error)}`
      );
      return { postalCode: null, postalCodeSource: null };
    }
  }
}
