import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DiscoveredPlaceStatus,
  PostalCodeSource,
  PriceScopeKind,
  type DiscoveredPlaceGroup,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlaceIdRequest,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type GroupDiscoveredPlacesRequest,
  type ImportDiscoveredPlaceRequest,
  type ListDiscoveredPlacesRequest,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import { OSM_ATTRIBUTION } from '@portfolio/luna-shopper/osm-places';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { DiscoveredPlace } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toDiscoveredPlaceView } from './harvest.mappers';
import {
  placeImportBlockers,
  type PlaceImportBlocker,
} from './place-import-check';
import { PlatformAdminService } from './platform-admin.service';
import type { ObservedPlace } from './run-report';
import { printedName, printedNameOrNull } from './source-entry-name';

interface PlaceCursor {
  value: string;
  id: string;
}

/**
 * The adapter that reported a place, by the provider stamped on it.
 *
 * A store discovery writes its own provider string and the adapter it ran is
 * not on the row, so the two are matched here. It is needed only for the
 * language question (plan 0111, section 8), and only before a chain exists: a
 * chain that catalog already holds has a source row, and a chain being created
 * from a place has nothing but the place.
 *
 * A provider nothing here names answers null, which `adapterCapabilities` then
 * reads as "I know nothing" and the chain create turns into a refusal rather
 * than a guessed language.
 */
const PROVIDER_ADAPTERS: Readonly<Record<string, string>> = {
  OSM: 'osm-places',
  LIDL: 'lidl-api',
  MERCADONA: 'mercadona-api',
};

function adapterKeyFor(provider: string): string | null {
  return PROVIDER_ADAPTERS[provider] ?? null;
}

/** What a run hands {@link DiscoveredPlaceService.observe}. */
export interface ObserveOptions {
  runId: string;
  /** How far a place with no postal code may reach for the nearest one. */
  deriveMaxMetres: number;
  /**
   * Whether this run's source is trusted to write its shops into the catalog
   * (plan 0107, section 3.1). False for every radius search: OpenStreetMap has
   * no row to carry the flag.
   */
  autoImport: boolean;
  /** The run's scope resolver, for the group of shops a place is priced with. */
  scopeIdFor?: (key: string) => string | null;
}

/** One trusted place the completeness check sent to the queue instead. */
export interface BlockedPlace {
  externalRef: string;
  missing: PlaceImportBlocker[];
}

export interface ObserveResult {
  created: number;
  refreshed: number;
  /** Locations this run wrote into the catalog with nobody in the way. */
  imported: number;
  /**
   * Trusted places the check refused, with the fields they were missing.
   *
   * Named rather than counted, and on the run's report rather than on the row:
   * an operator draining the queue wants to know which shop they are looking at
   * and why it is there.
   */
  blocked: BlockedPlace[];
}

/** The chains catalog knows, read once and asked twice. */
interface KnownChains {
  readonly byKey: ReadonlyMap<string, SupermarketView>;
  readonly byName: ReadonlyMap<string, SupermarketView>;
}

/**
 * A chain name reduced to what two spellings of the same chain share.
 *
 * Case and surrounding space only. Nothing else is folded, because a name is
 * the weak identity here and widening it widens the only case it can get wrong.
 */
function chainNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The chain a place belongs to, by key first and by name second. */
function matchChain(
  known: KnownChains,
  place: Pick<DiscoveredPlace, 'brandKey'>,
  name: string | null
): SupermarketView | undefined {
  const keyed = place.brandKey ? known.byKey.get(place.brandKey) : undefined;
  if (keyed) {
    return keyed;
  }
  return name ? known.byName.get(chainNameKey(name)) : undefined;
}

/**
 * The review queue a store discovery run fills (plan 0038, section 6.1).
 *
 * **A run creates nothing in catalog**, so this is where a place becomes a real
 * `Supermarket` and `SupermarketLocation`, one at a time and by the owner's
 * choice. That is also where hand entered supermarkets already fit, with no new
 * mechanism.
 *
 * The data is ODbL, so anything derived from it that reaches a user must carry
 * {@link OSM_ATTRIBUTION}. Imported locations record `externalProvider: 'OSM'`
 * precisely so that obligation travels with the row rather than living in a
 * comment here.
 */
@Injectable()
export class DiscoveredPlaceService {
  private readonly logger = new Logger(DiscoveredPlaceService.name);

  /**
   * The chain resolutions in flight, by identity, so a bulk import that decides
   * four places at a time creates one chain rather than four.
   */
  private readonly _resolving = new Map<string, Promise<SupermarketView>>();

  constructor(
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
    private readonly catalog: CatalogClient,
    private readonly admin: PlatformAdminService
  ) {}

  /**
   * What a run does with the shops it found (plan 0103, section 6.4; plan 0107,
   * section 3).
   *
   * Both store discovery runners held a `Repository<DiscoveredPlace>` and wrote
   * this themselves, twice, with the postal code derivation in one of them only.
   * A runner reports places now and holds nothing that could write them, so the
   * upsert is here, once, for every source that finds a shop.
   *
   * **Re-discovery refreshes the description and never resurrects a decision.**
   * `status` is the owner's: a place already imported or rejected keeps that
   * answer however many runs meet it again.
   *
   * **A postal code the source stated is never overridden by a guess.** A place
   * that arrives without one is derived from its coordinates, bounded by the
   * same limit plan 0061 bounds a location's own derivation with, and a place
   * beyond that bound keeps both columns null. A wrong postcode puts the shop in
   * somebody else's list, which is worse than no postcode at all.
   *
   * **A trusted source's shops are imported here, by the run** (plan 0107,
   * section 3.3). `autoImport` is the chain's own `autoImportPlaces` column and
   * is false for every radius search, which has no row to carry it. What it
   * does is exactly what an admin pressing import does, for a place that passes
   * {@link placeImportBlockers}; a place that fails it is left `NEW` with its
   * missing fields named on the run's report.
   *
   * No admin gate, unlike every other method here: the caller is a run, not a
   * person, and the run was already gated at the spawn.
   */
  async observe(
    places: readonly ObservedPlace[],
    options: ObserveOptions
  ): Promise<ObserveResult> {
    const seenAt = new Date();
    let created = 0;
    let refreshed = 0;
    let imported = 0;
    const blocked: BlockedPlace[] = [];

    for (const place of places) {
      const located = await this.locate(place, options.deriveMaxMetres);
      const fields = {
        brandKey: place.brandKey,
        brandName: place.brandName,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        street: place.street,
        city: place.city,
        postalCode: located.postalCode,
        postalCodeSource: located.postalCodeSource,
        country: place.country,
        website: place.website,
        openingHours: place.openingHours,
        tags: place.tags,
        runId: options.runId,
        lastSeenAt: seenAt,
      };

      const existing = await this.places.findOne({
        where: { provider: place.provider, externalRef: place.externalRef },
      });
      let row: DiscoveredPlace;
      if (existing) {
        Object.assign(existing, fields);
        row = await this.places.save(existing);
        refreshed += 1;
      } else {
        row = await this.places.save(
          this.places.create({
            provider: place.provider,
            externalRef: place.externalRef,
            status: DiscoveredPlaceStatus.NEW,
            firstSeenAt: seenAt,
            ...fields,
          })
        );
        created += 1;
      }

      if (!options.autoImport) {
        continue;
      }
      // **A decision already taken is never reopened**, which is the same rule
      // the upsert above follows for `status`: a place an operator imported or
      // rejected keeps that answer however many runs meet it again (D6).
      if (row.status !== DiscoveredPlaceStatus.NEW) {
        continue;
      }
      const missing = placeImportBlockers(row);
      if (missing.length > 0) {
        blocked.push({ externalRef: row.externalRef, missing });
        continue;
      }
      if (await this.autoImport(row, place.scopeKey ?? null, options)) {
        imported += 1;
      }
    }

    return { created, refreshed, imported, blocked };
  }

  /**
   * Promote one trusted place, and never fail the run over it.
   *
   * A shop catalog refused is one shop. The run found the rest and the row is
   * still in the queue for a person, so the failure is logged and counted as
   * blocked rather than thrown: losing a store discovery over one address would
   * throw away every other shop it read.
   */
  private async autoImport(
    row: DiscoveredPlace,
    scopeKey: string | null,
    options: ObserveOptions
  ): Promise<boolean> {
    try {
      // The scope the source declared for this shop, resolved through the run's
      // own resolver. Undefined when the source declared none, and catalog then
      // gives the location the `STORE` scope it gives any location that names
      // none (plan 0107, section 3.3).
      const priceScopeId =
        (scopeKey ? options.scopeIdFor?.(scopeKey) : null) ?? undefined;
      await this.promote(row, { priceScopeId });
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not import ${row.provider}/${row.externalRef} automatically, ` +
          `so it stays in the queue: ${String(error)}`
      );
      return false;
    }
  }

  /**
   * The place's postal code, and where it came from (plan 0097, section 3).
   *
   * A failure asking catalog leaves the place with no code rather than failing
   * the run. One untagged address is not worth losing an eighteen minute walk
   * over, and the next run of this code fills it in.
   */
  private async locate(
    place: ObservedPlace,
    deriveMaxMetres: number
  ): Promise<{
    postalCode: string | null;
    postalCodeSource: PostalCodeSource | null;
  }> {
    if (place.postalCode) {
      return {
        postalCode: place.postalCode,
        postalCodeSource: place.postalCodeSource ?? PostalCodeSource.SOURCE,
      };
    }
    const country = place.country.trim().toLowerCase();
    if (!country) {
      return { postalCode: null, postalCodeSource: null };
    }
    try {
      const { nearest } = await this.catalog.resolveNearestPostalCode(
        country,
        place.latitude,
        place.longitude,
        deriveMaxMetres
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

  async list(req: ListDiscoveredPlacesRequest): Promise<DiscoveredPlacePage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as PlaceCursor | undefined;

    const qb = this.places
      .createQueryBuilder('p')
      .orderBy('p."lastSeenAt"', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(limit + 1);
    if (req.runId) {
      qb.andWhere('p."runId" = :runId', { runId: req.runId });
    }
    if (req.brandKey) {
      qb.andWhere('p."brandKey" = :brandKey', { brandKey: req.brandKey });
    }
    if (req.status) {
      qb.andWhere('p.status = :status', { status: req.status });
    }
    // The places **located in** a code, which is what the postal code detail
    // screen's panel asks for (plan 0097, section 9). It reads the place's own
    // postal code and never the run's: a run centred on 14013 writes places in
    // four other codes, and those belong to those codes.
    if (req.country) {
      qb.andWhere('lower(p.country) = :country', {
        country: req.country.trim().toLowerCase(),
      });
    }
    if (req.postalCode) {
      qb.andWhere('p."postalCode" = :postalCode', {
        postalCode: req.postalCode.trim(),
      });
    }
    if (cursor) {
      qb.andWhere('(p."lastSeenAt", p.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDiscoveredPlaceView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.lastSeenAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Section 6.1 step 4's report: the run's places grouped by chain, with a count,
   * a sample, and whether catalog already knows that chain.
   *
   * Grouping is on `brandKey` and never on the name (section 2.7): `Dia` and
   * `Maxi Dia` share one QID, and matching on the name would split one chain into
   * several. Places with no brand tag group under `null`, which is a real answer:
   * they are independent shops, and 35 of the 75 elements in the wider search
   * looked like that.
   */
  async groups(
    req: GroupDiscoveredPlacesRequest
  ): Promise<DiscoveredPlaceGroupsResult> {
    await this.admin.requireAdmin(req);
    const sampleSize = Math.max(1, Math.min(req.sampleSize ?? 3, 20));

    const qb = this.places.createQueryBuilder('p').orderBy('p.name', 'ASC');
    if (req.runId) {
      qb.andWhere('p."runId" = :runId', { runId: req.runId });
    }
    const rows = await qb.getMany();

    const { byKey: known } = await this.knownChains();
    const buckets = new Map<string | null, DiscoveredPlace[]>();
    for (const row of rows) {
      const bucket = buckets.get(row.brandKey);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(row.brandKey, [row]);
      }
    }

    const groups: DiscoveredPlaceGroup[] = [...buckets.entries()].map(
      ([brandKey, places]) => {
        const match = brandKey ? known.get(brandKey) : undefined;
        return {
          brandKey,
          brandName: places.find((p) => p.brandName)?.brandName ?? null,
          count: places.length,
          known: Boolean(match),
          supermarketId: match?.id ?? null,
          sample: places.slice(0, sampleSize).map(toDiscoveredPlaceView),
        };
      }
    );
    groups.sort((a, b) => b.count - a.count);
    return { groups };
  }

  /**
   * Promote one place into catalog.
   *
   * **Import is per place and creates the chain on demand** (section 11): one run
   * returns 17 brands, and creating a `Supermarket` row for every one of them
   * would clutter the catalog with chains the owner will never shop at.
   *
   * The scope: a named one wins; otherwise the location gets a STORE scope of its
   * own, which catalog creates for any location that names none. Resolving a
   * warehouse from the store's postal code is a Mercadona specific step that
   * belongs to the chain's own source configuration, not to a generic import.
   */
  async import(
    req: ImportDiscoveredPlaceRequest
  ): Promise<DiscoveredPlaceView> {
    await this.admin.requireAdmin(req);
    const place = await this.load(req.placeId);
    if (place.status === DiscoveredPlaceStatus.IMPORTED) {
      throw new ConflictException(
        'That place has already been imported into the catalog'
      );
    }

    return toDiscoveredPlaceView(
      await this.promote(place, {
        supermarketId: req.supermarketId,
        priceScopeId: req.priceScopeId,
      })
    );
  }

  /**
   * Create the location and mark the place ours.
   *
   * The whole of what an import does, in one place, because a run does it too
   * now (plan 0107, section 3.3). The admin gate and the "already imported"
   * refusal stay with the callers: a run skips such a row rather than reporting
   * a conflict about it.
   *
   * The actor on the write is the harvester's provisioned `HARVESTER_ACTOR_ID`,
   * which `CatalogClient` stamps on every call, so the catalog audit says a run
   * did this and not a person.
   */
  private async promote(
    place: DiscoveredPlace,
    options: { supermarketId?: string; priceScopeId?: string }
  ): Promise<DiscoveredPlace> {
    const supermarketId =
      options.supermarketId ?? (await this.resolveSupermarket(place)).id;

    const location = await this.catalog.createLocation({
      supermarketId,
      priceScopeId: options.priceScopeId,
      // The shop's own name, written once under the language its provider
      // prints in (plan 0111, section 8). "Mercadona Alicante" is not English
      // and not Spanish, and a reader of either sees it through the fallback,
      // which is what the copy was giving them anyway. The difference is that
      // the row now says truthfully which language it holds.
      //
      // The plan names the chain name and the scope name. This is the third of
      // the same copy, in the same file, and it is the one its example is
      // about. A label is already nullable, so a provider that states no
      // language leaves the shop unlabelled rather than refusing the import:
      // the label is a convenience over the address, and unlike a chain name
      // nothing downstream needs it to exist.
      label: printedNameOrNull(place.name, adapterKeyFor(place.provider)),
      address: place.street,
      city: place.city,
      // The run's own country, which used to be discarded and hardcoded null
      // here (plan 0061, section 4). Catalog needs it to key the centroid
      // lookup that fills the postcode two thirds of these places lack.
      country: place.country,
      postalCode: place.postalCode,
      // A tag OSM gave us, so it is the source's and never overridden. A place
      // with no tag sends nothing and catalog derives one, or does not.
      postalCodeSource: place.postalCode ? PostalCodeSource.SOURCE : undefined,
      latitude: place.latitude,
      longitude: place.longitude,
      externalRef: place.externalRef,
      // Recorded so the ODbL attribution obligation travels with the row.
      externalProvider: place.provider,
    });

    place.status = DiscoveredPlaceStatus.IMPORTED;
    // Written back so a re-run recognizes the place as already ours rather than
    // offering it again.
    place.supermarketLocationId = location.id;
    return this.places.save(place);
  }

  async reject(req: DiscoveredPlaceIdRequest): Promise<DiscoveredPlaceView> {
    await this.admin.requireAdmin(req);
    const place = await this.load(req.placeId);
    place.status = DiscoveredPlaceStatus.REJECTED;
    return toDiscoveredPlaceView(await this.places.save(place));
  }

  /**
   * Find the chain the place belongs to, or create it once.
   *
   * The QID is the identity where the place carries one, because the brand name
   * splits `Dia` from `Maxi Dia`; it is a good default the owner can override
   * afterwards, not an oracle.
   *
   * **A place with no QID is matched on the chain's name**, and that is not a
   * refinement. `brand:wikidata` is the tag most shops lack, and every place a
   * chain's own store list reports carries whatever key the owner put on the
   * chain, which is nothing until somebody types one. Matching on the key alone
   * meant none of those places ever found a chain, so importing twelve LIDL
   * shops wrote twelve chains called LIDL, one per place. The name is the weaker
   * identity and it is used as the weaker one: only after the key has answered
   * nothing, and only for an exact name, so the worst it can do is file two
   * independent shops that chose the same name under one chain, which the owner
   * can split. Twelve rows for one chain is not something the owner can undo as
   * easily.
   */
  private async resolveSupermarket(
    place: DiscoveredPlace
  ): Promise<SupermarketView> {
    const name = place.brandName ?? place.name;
    if (!place.brandKey && !name) {
      throw new ConflictException(
        'That place carries neither a brand nor a name, so there is nothing to ' +
          'call the chain. Pass an explicit supermarketId to attach it to one.'
      );
    }

    const identity = place.brandKey
      ? `key:${place.brandKey}`
      : `name:${chainNameKey(name ?? '')}`;
    const inflight = this._resolving.get(identity);
    if (inflight) {
      return inflight;
    }
    const resolving = this.findOrCreateChain(place, name).finally(() => {
      this._resolving.delete(identity);
    });
    this._resolving.set(identity, resolving);
    return resolving;
  }

  /**
   * The chain itself, created at most once for one identity.
   *
   * A bulk import decides four places at a time, so four calls asking for the
   * same new chain overlap. Every one of them read "catalog does not know it"
   * and every one of them created it: with a key three of the four then died on
   * the unique index and the operator read three failures for a run that worked,
   * and with no key all four landed. `_resolving` holds the first call's promise
   * so the other three wait for its answer instead of racing it. One replica is
   * all this needs to be exact, and the harvester runs exactly one (plan 0038:
   * a run holds an in memory queue), but a create that loses a race anyway is
   * caught below rather than reported as a failure.
   */
  private async findOrCreateChain(
    place: DiscoveredPlace,
    name: string | null
  ): Promise<SupermarketView> {
    const existing = matchChain(await this.knownChains(), place, name);
    if (existing) {
      return existing;
    }
    if (!name) {
      throw new ConflictException(
        'That place carries no name for the chain its brand key belongs to. ' +
          'Pass an explicit supermarketId to attach it to one.'
      );
    }
    // The chain's name is written once, under the language the source that
    // reported it prints in (plan 0111, section 8). It used to be written into
    // both keys, and a copy is indistinguishable from a translation in the row:
    // nothing could list the chains still waiting for one, and the back office
    // badge reported a coverage that was a duplicate.
    //
    // A provider that prints no language this build can name has nothing to
    // file the string under, and guessing is the thing this plan removes. That
    // is OpenStreetMap, whose `name` tag is written by mappers in the local
    // language of wherever the shop is. It joins the refusal above rather than
    // inventing a key: the operator names the chain by passing its id, which is
    // the same escape hatch an unnamed place already uses.
    const printed = printedName(name, adapterKeyFor(place.provider));
    if (Object.keys(printed).length === 0) {
      throw new ConflictException(
        `Places from ${place.provider} do not say what language they name ` +
          'things in, so this chain cannot be created with a name in one. ' +
          'Create the chain and pass an explicit supermarketId to attach ' +
          'this place to it.'
      );
    }
    try {
      return await this.catalog.createSupermarket({
        name: printed,
        externalBrandKey: place.brandKey,
      });
    } catch (error) {
      // Somebody else created it between the read and the write. Reporting a
      // failure here would name the one place whose call happened to lose,
      // over a chain that now exists and is the right one to attach to.
      const created = matchChain(await this.knownChains(), place, name);
      if (created) {
        return created;
      }
      throw error;
    }
  }

  /** Every chain catalog knows, indexed both ways a place can be matched. */
  private async knownChains(): Promise<KnownChains> {
    const byKey = new Map<string, SupermarketView>();
    const byName = new Map<string, SupermarketView>();
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listSupermarkets(cursor);
      for (const supermarket of page.items) {
        if (supermarket.externalBrandKey) {
          byKey.set(supermarket.externalBrandKey, supermarket);
        }
        for (const text of Object.values(supermarket.name)) {
          const key = chainNameKey(text ?? '');
          // The first chain of that name wins, so the answer does not depend on
          // which locale of which row was read last.
          if (key && !byName.has(key)) {
            byName.set(key, supermarket);
          }
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { byKey, byName };
  }

  private async load(id: string): Promise<DiscoveredPlace> {
    const row = await this.places.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Discovered place not found');
    }
    return row;
  }
}

/** Re-exported so the runner and the module share one constant. */
export { OSM_ATTRIBUTION, PriceScopeKind };
