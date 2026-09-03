import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DiscoveredPlaceStatus } from '@portfolio/luna-shopper/contracts';
import { OsmPlacesClient } from '@portfolio/luna-shopper/osm-places';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { DiscoveredPlace } from '../entities';
import type { RunContext } from './run-context';

export interface StoreDiscoveryInput {
  postalCode: string;
  country: string;
  radiusMetres: number;
}

/**
 * `STORE_DISCOVERY` (plan 0038, section 6.1). Two requests, and it is the
 * cheapest of the three modes by three orders of magnitude.
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
export class StoreDiscoveryRunner {
  private readonly logger = new Logger(StoreDiscoveryRunner.name);

  constructor(
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
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
        existing.postalCode = place.postalCode;
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
          postalCode: place.postalCode,
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
}
