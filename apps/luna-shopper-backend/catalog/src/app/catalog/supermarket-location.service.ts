import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PostalCodeSource,
  type CountLocationsByPostalCodeRequest,
  type CreateSupermarketLocationRequest,
  type ListSupermarketLocationsRequest,
  type LocalizedText,
  type PostalCodeLocationCountsView,
  type SearchShopsRequest,
  type ShopPage,
  type SummarizeLocationsByChainRequest,
  type SupermarketLocationChainSummariesView,
  type SupermarketLocationIdRequest,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type UpdateSupermarketLocationRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import type { CatalogConfig } from '../config/app-config';
import { Supermarket, SupermarketLocation } from '../entities';
import {
  toSupermarketLocationView,
  toSupermarketView,
} from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';

interface LocationCursor {
  value: string;
  id: string;
}

/**
 * Supermarket locations (plan 0012). Writes owner only; reads open.
 *
 * Since plan 0061 it is also where a missing postal code is filled in. **Catalog
 * fills it, not the harvester** (section 3): every creator gets the behaviour,
 * including a supermarket an admin typed by hand, and the centroid table lives
 * here, so filling it from the harvester would send one fact across a service
 * boundary and straight back.
 */
@Injectable()
export class SupermarketLocationService {
  private readonly deriveMaxMetres: number;

  constructor(
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>,
    private readonly scopes: PriceScopeService,
    private readonly admin: PlatformAdminService,
    private readonly postalCodes: PostalCodeService,
    config: ConfigService
  ) {
    this.deriveMaxMetres =
      config.getOrThrow<CatalogConfig>('catalog').postalCodeDeriveMaxMetres;
  }

  /**
   * Create a store.
   *
   * Every location must price against a scope, and a caller that names none gets
   * a `STORE` scope of its own (plan 0038, section 5.1). That is what keeps hand
   * entered supermarkets working exactly as they did before scopes existed: the
   * per store shape is still expressible, it is just no longer the only one.
   *
   * The id is generated here rather than by the database because the scope and
   * the location each need the other's key: the scope's `externalKey` is the
   * location id, and the location's `priceScopeId` is the scope. Choosing the id
   * first breaks the cycle without a nullable column or a second UPDATE.
   */
  async create(
    req: CreateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    await this.admin.requireAdmin(req);
    const parent = await this.supermarkets.findOne({
      where: { id: req.supermarketId },
    });
    if (!parent) {
      throw new NotFoundException('Supermarket not found');
    }

    const id = randomUUID();
    const priceScopeId = req.priceScopeId
      ? (await this.scopes.requireScopeOf(req.priceScopeId, req.supermarketId))
          .id
      : (
          await this.scopes.ensureStoreScope(
            req.supermarketId,
            id,
            req.label ?? null
          )
        ).id;

    const draft = this.locations.create({
      id,
      supermarketId: req.supermarketId,
      priceScopeId,
      label: req.label ?? null,
      address: req.address ?? null,
      city: req.city ?? null,
      country: req.country ?? null,
      postalCode: req.postalCode ?? null,
      postalCodeSource: req.postalCode
        ? (req.postalCodeSource ?? PostalCodeSource.MANUAL)
        : null,
      latitude: req.latitude ?? null,
      longitude: req.longitude ?? null,
      externalRef: req.externalRef ?? null,
      externalProvider: req.externalProvider ?? null,
    });
    await this.fillPostalCodeFromCentroid(draft);

    return toSupermarketLocationView(await this.locations.save(draft));
  }

  async update(
    req: UpdateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.supermarketLocationId);
    if (req.priceScopeId !== undefined) {
      row.priceScopeId = (
        await this.scopes.requireScopeOf(req.priceScopeId, row.supermarketId)
      ).id;
    }
    if (req.label !== undefined) {
      row.label = req.label;
    }
    if (req.address !== undefined) {
      row.address = req.address;
    }
    if (req.city !== undefined) {
      row.city = req.city;
    }
    if (req.country !== undefined) {
      row.country = req.country;
    }
    if (req.latitude !== undefined) {
      row.latitude = req.latitude;
    }
    if (req.longitude !== undefined) {
      row.longitude = req.longitude;
    }
    if (req.postalCode !== undefined) {
      // An update that sets one is a statement (plan 0061, section 3), and it
      // stands even against a nearer centroid. Setting it to null hands the
      // field back to the lookup below.
      row.postalCode = req.postalCode;
      row.postalCodeSource = req.postalCode
        ? (req.postalCodeSource ?? PostalCodeSource.MANUAL)
        : null;
    }
    if (req.externalRef !== undefined) {
      row.externalRef = req.externalRef;
    }
    if (req.externalProvider !== undefined) {
      row.externalProvider = req.externalProvider;
    }
    await this.fillPostalCodeFromCentroid(row);

    return toSupermarketLocationView(await this.locations.save(row));
  }

  async delete(req: SupermarketLocationIdRequest): Promise<{ id: string }> {
    await this.admin.requireAdmin(req);
    const result = await this.locations.delete({
      id: req.supermarketLocationId,
    });
    if (!result.affected) {
      throw new NotFoundException('Supermarket location not found');
    }
    return { id: req.supermarketLocationId };
  }

  async get(
    req: SupermarketLocationIdRequest
  ): Promise<SupermarketLocationView> {
    return toSupermarketLocationView(
      await this.load(req.supermarketLocationId)
    );
  }

  /**
   * A chain's shops, newest first, and everybody's alike.
   *
   * **It applies no refusals**, because it is the owner's read of one chain
   * rather than a shopper's read of their neighbourhood. What a person has
   * switched off belongs to {@link search} and {@link summarizeByChain}, which
   * are narrowed to their postal codes and take the refusals with them (plan
   * 0068).
   */
  async list(
    req: ListSupermarketLocationsRequest
  ): Promise<SupermarketLocationPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LocationCursor | undefined;

    const qb = this.locations
      .createQueryBuilder('l')
      .where('l."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('l.createdAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .take(limit + 1);
    if (req.priceScopeId) {
      // Plan 0066, section 4: the shops that sell at one scope, which is how a
      // price keyed by scope becomes somewhere a person can go.
      qb.andWhere('l."priceScopeId" = :scope', { scope: req.priceScopeId });
    }
    if (cursor) {
      qb.andWhere('(l."createdAt", l.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items: page.map(toSupermarketLocationView), nextCursor };
  }

  /**
   * The chains with at least one shop in these postal codes (plan 0068, section
   * 3.1). The franchise buttons of `apps/velista/plans/0059`.
   *
   * **Counted rather than paged**, like {@link countByPostalCode} above it: a
   * country has tens of chains and a neighbourhood a handful, and the caller
   * draws all of them at once.
   *
   * The counts are over every shop in the codes, refused or not, which is what
   * makes the three franchise states derivable from one row. `includeExcluded`
   * governs only whether a chain the caller refused **whole** gets a row at all,
   * because a caller offering shops has nothing to do with such a chain and the
   * screen that edits the refusals has everything to do with it.
   */
  async summarizeByChain(
    req: SummarizeLocationsByChainRequest
  ): Promise<SupermarketLocationChainSummariesView> {
    const codes = distinct(req.postalCodes);
    if (codes.length === 0) {
      // No code is no place, and no place is no chains. Answering the country
      // instead would be a different question with a much larger answer.
      return { chains: [] };
    }

    const refusedLocations = distinct(req.excludedSupermarketLocationIds ?? []);
    const qb = this.locations
      .createQueryBuilder('l')
      .innerJoin('l.supermarket', 's')
      .select('s.id', 'supermarketId')
      .addSelect('s.name', 'name')
      .addSelect('s."logoUrl"', 'logoUrl')
      .addSelect('s."externalBrandKey"', 'externalBrandKey')
      .addSelect('COUNT(*)', 'locations')
      .addSelect(
        // An empty refusal list has no `IN` to write: `(:...ids)` renders as
        // `()` and Postgres rejects it, so the filter degrades to a constant
        // false rather than to a query that cannot run.
        refusedLocations.length > 0
          ? 'COUNT(*) FILTER (WHERE l.id IN (:...refusedLocations))'
          : 'COUNT(*) FILTER (WHERE false)',
        'excluded'
      )
      .where('l."postalCode" IN (:...codes)', { codes })
      .setParameters(refusedLocations.length > 0 ? { refusedLocations } : {})
      .groupBy('s.id')
      // Busiest chain first, then the id, so the order is total and a page of
      // buttons does not reshuffle between two identical reads. How it finally
      // reads is the client's: it has to bucket the keyless chains into one
      // button (section 4), which reorders the list anyway.
      .orderBy('COUNT(*)', 'DESC')
      .addOrderBy('s.id', 'ASC');

    const refusedChains = distinct(req.excludedSupermarketIds ?? []);
    if (!req.includeExcluded && refusedChains.length > 0) {
      qb.andWhere('s.id NOT IN (:...refusedChains)', { refusedChains });
    }

    const rows = await qb.getRawMany<{
      supermarketId: string;
      name: LocalizedText;
      logoUrl: string | null;
      externalBrandKey: string | null;
      locations: string;
      excluded: string;
    }>();

    return {
      chains: rows.map((row) => ({
        supermarketId: row.supermarketId,
        name: row.name,
        logoUrl: row.logoUrl,
        externalBrandKey: row.externalBrandKey,
        // `COUNT` comes back as a string through node-postgres, exactly as
        // `numeric` does: cast it here or the first arithmetic is a NaN.
        locations: Number(row.locations),
        excluded: Number(row.excluded),
      })),
    };
  }

  /**
   * A page of shops in these postal codes, optionally one chain's, optionally
   * matching a typed word (plan 0068, section 3.2).
   *
   * **Narrow by postal code first, then match**, which is the whole of section
   * 5: the candidate set is the shops in one profile's codes, which is dozens,
   * and a case insensitive substring over dozens of rows is not a query worth
   * the `tsvector` and trigram index that `item.search` needs against tens of
   * thousands. If a profile ever holds enough codes for that to stop being true,
   * the answer is a cap on the codes rather than a second search stack.
   *
   * Ordered by postal code and then id, ascending: the screen groups by code,
   * every row in the answer has one (it is why the row is here), and the pair is
   * unique, so the cursor cannot repeat or skip a shop.
   */
  async search(req: SearchShopsRequest): Promise<ShopPage> {
    const codes = distinct(req.postalCodes);
    if (codes.length === 0) {
      return { items: [], nextCursor: null };
    }

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LocationCursor | undefined;
    const refusedLocations = new Set(req.excludedSupermarketLocationIds ?? []);
    const refusedChains = new Set(req.excludedSupermarketIds ?? []);

    const qb = this.locations
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.supermarket', 's')
      .where('l."postalCode" IN (:...codes)', { codes })
      .orderBy('l.postalCode', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .limit(limit + 1);

    if (req.supermarketId) {
      qb.andWhere('l."supermarketId" = :sid', { sid: req.supermarketId });
    }
    if (!req.includeExcluded) {
      // Refused shops are absent by default, because every other caller is
      // offering a shop rather than editing an opinion about one (section 6).
      if (refusedLocations.size > 0) {
        qb.andWhere('l.id NOT IN (:...refusedLocations)', {
          refusedLocations: [...refusedLocations],
        });
      }
      if (refusedChains.size > 0) {
        qb.andWhere('l."supermarketId" NOT IN (:...refusedChains)', {
          refusedChains: [...refusedChains],
        });
      }
    }
    const term = matchTerm(req.query);
    if (term) {
      qb.andWhere(
        `(
          l.address ILIKE :term
          OR l.city ILIKE :term
          OR l."postalCode" ILIKE :term
          OR EXISTS (SELECT 1 FROM jsonb_each_text(l.label) t WHERE t.value ILIKE :term)
          OR EXISTS (SELECT 1 FROM jsonb_each_text(s.name) t WHERE t.value ILIKE :term)
        )`,
        { term }
      );
    }
    if (cursor) {
      qb.andWhere('(l."postalCode", l.id) > (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.postalCode ?? '', id: last.id })
        : null;

    return {
      items: page.map((row) => ({
        location: toSupermarketLocationView(row),
        supermarket: toSupermarketView(row.supermarket),
        excluded: refusedLocations.has(row.id),
        excludedChain: refusedChains.has(row.supermarketId),
      })),
      nextCursor,
    };
  }

  /**
   * How many shops we hold in each of these postal codes (plan 0063, section 5).
   *
   * The harvester's definition of an **unknown** code, and the reason a postal
   * code someone put on their profile turns into a discovery run. It is one
   * grouped count rather than a page per code because a profile write announces
   * several codes at once, and it answers a zero for every code asked about:
   * without the zeros the caller cannot tell "no shops" from "not asked".
   *
   * Only meaningful after plan 0061, which is what stopped two thirds of
   * imported locations carrying a null postcode. Before it almost every code
   * counted zero, and the queue would have re discovered the country.
   */
  async countByPostalCode(
    req: CountLocationsByPostalCodeRequest
  ): Promise<PostalCodeLocationCountsView> {
    const country = req.country.trim().toLowerCase();
    const codes = [
      ...new Set(req.postalCodes.map((code) => code.trim()).filter(Boolean)),
    ];
    if (codes.length === 0) {
      return { country, counts: [] };
    }

    const rows = await this.locations
      .createQueryBuilder('l')
      .select('l."postalCode"', 'postalCode')
      .addSelect('COUNT(*)', 'locations')
      .where('l."postalCode" IN (:...codes)', { codes })
      // A location with no country recorded is counted for whatever country
      // asked: the column arrived with plan 0061 and the rows that predate it
      // are all Spanish. Excluding them would report a code we do serve as
      // unknown and spend a discovery run finding shops already in the catalog.
      .andWhere('(l.country IS NULL OR lower(l.country) = :country)', {
        country,
      })
      .groupBy('l."postalCode"')
      .getRawMany<{ postalCode: string; locations: string }>();

    const found = new Map(
      rows.map((row) => [row.postalCode, Number(row.locations)])
    );
    return {
      country,
      counts: codes.map((postalCode) => ({
        postalCode,
        locations: found.get(postalCode) ?? 0,
      })),
    };
  }

  /**
   * Take the nearest postal code centroid where the row has no code of its own
   * (plan 0061, sections 3 and 4). Mutates the row in place, and does nothing at
   * all to a row that has one.
   *
   * **A source postcode is never overridden**, which is the rule this exists to
   * obey rather than to bend: the centroid is an approximation of a boundary and
   * the tag is somebody's observation of a sign on a building. The guard is the
   * first line, and it is the whole of it.
   *
   * **A guess beyond the bound is not made.** A store in the middle of nowhere
   * whose nearest centroid is 30 km away keeps a null postcode, because a wrong
   * postcode is worse than none: none produces a price flagged approximate,
   * wrong produces a confident price for the wrong scope.
   *
   * The country is required and has to be alpha-2, because the lookup is keyed
   * on `(country, postalCode)` and a search with no country would put Spain and
   * Bolivia in one result. A row carrying a country spelled some other way is
   * left alone rather than guessed at.
   */
  private async fillPostalCodeFromCentroid(
    row: Pick<
      SupermarketLocation,
      'country' | 'latitude' | 'longitude' | 'postalCode' | 'postalCodeSource'
    >
  ): Promise<void> {
    if (row.postalCode) {
      return;
    }
    row.postalCodeSource = null;

    const country = alpha2(row.country);
    if (!country || row.latitude === null || row.longitude === null) {
      return;
    }

    const { nearest } = await this.postalCodes.nearest({
      country,
      latitude: row.latitude,
      longitude: row.longitude,
      maxDistanceMetres: this.deriveMaxMetres,
    });
    if (!nearest) {
      return;
    }

    row.postalCode = nearest.postalCode;
    row.postalCodeSource = PostalCodeSource.DERIVED;
  }

  private async load(id: string): Promise<SupermarketLocation> {
    const row = await this.locations.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Supermarket location not found');
    }
    return row;
  }
}

/**
 * The values de-duplicated, empties dropped, order kept.
 *
 * Every list a shop read takes comes from somebody else's data: a profile's
 * postal codes, its refusals. A repeated code would multiply nothing here (it is
 * an `IN`), but an empty string is a filter on a column that is never empty, and
 * both are cheaper to drop than to reason about.
 */
function distinct(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * The typed word as an `ILIKE` pattern, or null when nothing was typed.
 *
 * The wildcards are escaped rather than passed through: somebody searching for
 * `100%` means the string, and an unescaped `%` would match every shop in their
 * codes and read as a search that had quietly stopped working.
 */
function matchTerm(query: string | undefined): string | null {
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const escaped = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/**
 * The country as the centroid table spells it, or null. `country` on a location
 * is a free text column an admin can type a full name into, and only alpha-2 is
 * a key into `postal_code_points`.
 */
function alpha2(country: string | null): string | null {
  const trimmed = (country ?? '').trim();
  return trimmed.length === 2 ? trimmed.toLowerCase() : null;
}
