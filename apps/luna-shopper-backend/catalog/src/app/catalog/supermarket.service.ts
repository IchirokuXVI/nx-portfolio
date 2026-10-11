import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DEFAULT_SCOPE_PRIORITY,
  PriceScopeKind,
  type CreateSupermarketRequest,
  type ListSupermarketsRequest,
  type SetSupermarketLinkedImagesRequest,
  type SupermarketIdRequest,
  type SupermarketOrder,
  type SupermarketPage,
  type SupermarketView,
  type UpdateSupermarketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  DEFAULT_LOCALE,
  encodeCursor,
  getRequestContext,
  NotFoundException,
  ValidationException,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { PriceScope, Supermarket } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import {
  decodeCursorForLocale,
  displayName,
  displayNameSql,
  toSupermarketView,
} from './catalog.mappers';
import {
  itemIdsLinkedTo,
  lockLinkedImageSwitches,
  refreshLinkedImages,
} from './item-linked-image.service';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';

interface SupermarketCursor {
  order: SupermarketOrder;
  /** The language the `value` was cut under (plan 0111, section 5). */
  locale: SupportedLocale;
  value: string;
  id: string;
}

/** Supermarket chains (plan 0012). Writes are owner only; reads are open. */
@Injectable()
export class SupermarketService {
  constructor(
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>,
    private readonly priceScopes: PriceScopeService,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  async create(req: CreateSupermarketRequest): Promise<SupermarketView> {
    const actor = await this.admin.requireAdmin(req);
    const draft = this.supermarkets.create({
      name: req.name,
      logoUrl: req.logoUrl ?? null,
      websiteUrl: req.websiteUrl ?? null,
      externalBrandKey: req.externalBrandKey ?? null,
      // Null only until the national scope below exists: a scope belongs to a
      // chain, so the chain is saved first and pointed at its scope after.
      defaultPriceScopeId: null,
    });
    // A chain starts with a NATIONAL scope as its default (plan 0153). Without
    // one, "show me this chain" with no place named had no answer until an
    // operator made a scope and nothing could set it as the default. The chain,
    // the scope and the default are one transaction, so a failure leaves none
    // of them behind.
    //
    // No inheritance runs for the scope, unlike `PriceScopeService.create`:
    // nothing is less specific than NATIONAL, and a new chain has no prices.
    const saved = await this.audit.write(actor, async (tx) => {
      const chain = await tx.create(Supermarket, draft);
      const national = await tx.create(
        PriceScope,
        tx.manager.create(PriceScope, {
          supermarketId: chain.id,
          kind: PriceScopeKind.NATIONAL,
          externalKey: null,
          label: chain.name,
          priority: DEFAULT_SCOPE_PRIORITY[PriceScopeKind.NATIONAL],
        })
      );
      const before = { ...chain };
      chain.defaultPriceScopeId = national.id;
      return tx.update(Supermarket, before, chain);
    });
    // A chain made a moment ago holds no shop, so nothing is counted.
    return { ...toSupermarketView(saved), locationCount: 0 };
  }

  async update(req: UpdateSupermarketRequest): Promise<SupermarketView> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.supermarketId);
    const before = { ...row };
    if (req.name !== undefined) {
      row.name = req.name;
    }
    if (req.logoUrl !== undefined) {
      row.logoUrl = req.logoUrl;
    }
    if (req.websiteUrl !== undefined) {
      row.websiteUrl = req.websiteUrl;
    }
    // Owner editable on purpose (plan 0038, section 5.4): the QID splits
    // `Carrefour` from `Carrefour Express`, which may or may not be what the
    // owner wants, so discovery's guess is a default rather than an oracle.
    if (req.externalBrandKey !== undefined) {
      row.externalBrandKey = req.externalBrandKey;
    }
    // The last rung of the scope ladder (plan 0049, section 3.1). Checked to
    // belong to this chain, because a default pointing at another chain's
    // warehouse would quote a competitor's prices under this brand's name.
    // A 400 rather than the 409 `requireScopeOf` answers (plan 0153): nothing
    // about the chain's state conflicts, the request names the wrong thing.
    if (req.defaultPriceScopeId !== undefined) {
      if (req.defaultPriceScopeId !== null) {
        const scope = await this.priceScopes.load(req.defaultPriceScopeId);
        if (scope.supermarketId !== row.id) {
          throw new ValidationException(
            'defaultPriceScopeId names a price scope of another chain. A ' +
              "chain's default scope is one of its own scopes."
          );
        }
      }
      row.defaultPriceScopeId = req.defaultPriceScopeId;
    }
    const saved = await this.audit.write(actor, (tx) =>
      tx.update(Supermarket, before, row)
    );
    return this.withLocationCount(saved);
  }

  async delete(req: SupermarketIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    // Loaded rather than deleted by id alone, because the trail records what was
    // lost (plan 0075, section 1). The missing row is refused here instead of by
    // an affected count, which says the same thing one query earlier.
    const row = await this.load(req.supermarketId);
    await this.audit.write(actor, async (tx) => {
      // The links of the chain go with it, by the cascade. The products that
      // showed its photos are read first and computed again after, so none
      // keeps a photo of a chain that no longer exists (plan 0198).
      await lockLinkedImageSwitches(tx.manager, 'exclusive');
      const shown = await itemIdsLinkedTo(tx.manager, row.id);
      await tx.delete(Supermarket, row);
      await refreshLinkedImages(tx.manager, { itemIds: shown });
    });
    return { id: req.supermarketId };
  }

  /**
   * Say whether the photos of one chain may be shown (plan 0198, section 4).
   *
   * The switch and what every product of the chain shows are written in one
   * transaction: after it commits, no read of a product answers a photo of a
   * chain that was turned off. The link rows stay, so turning the chain on
   * again needs no harvest.
   *
   * The products are computed again also when the switch already says what
   * was asked, which makes the request the repair for a list that disagrees
   * with it. The trail records the switch only when it moved.
   *
   * What it cannot reach: a photo that a browser already holds, and a product
   * that a client holds in memory until it reads again.
   */
  async setLinkedImagesEnabled(
    req: SetSupermarketLinkedImagesRequest
  ): Promise<SupermarketView> {
    const actor = await this.admin.requireAdmin(req);
    if (typeof req.enabled !== 'boolean') {
      throw new ValidationException('enabled is true or false.');
    }
    const saved = await this.audit.write(actor, async (tx) => {
      await lockLinkedImageSwitches(tx.manager, 'exclusive');
      const row = await tx.manager.findOne(Supermarket, {
        where: { id: req.supermarketId },
      });
      if (!row) {
        throw new NotFoundException('Supermarket not found');
      }
      if (row.linkedImagesEnabled !== req.enabled) {
        const before = { ...row };
        // Its own statement: the ORM never writes this column (see the
        // entity), so a save of the row would leave it as it was.
        await tx.manager.query(
          `UPDATE "supermarkets"
              SET "linkedImagesEnabled" = $2, "updatedAt" = now()
            WHERE "id" = $1`,
          [row.id, req.enabled]
        );
        row.linkedImagesEnabled = req.enabled;
        await tx.recordUpdate(Supermarket, before, row);
      }
      await refreshLinkedImages(tx.manager, { supermarketId: row.id });
      return row;
    });
    return this.withLocationCount(saved);
  }

  async get(req: SupermarketIdRequest): Promise<SupermarketView> {
    return this.withLocationCount(await this.load(req.supermarketId));
  }

  async list(req: ListSupermarketsRequest): Promise<SupermarketPage> {
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    // The caller's language, off the request context the gateway propagated
    // (plan 0111, section 3). It is not a field on the request: the context is
    // the one answer to this question and a second one could disagree with it.
    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    const cursor = decodeCursorForLocale<SupermarketCursor>(req.cursor, locale);

    const qb = this.supermarkets.createQueryBuilder('s').take(limit + 1);
    this.applySearch(qb, req.query);
    this.applyOrder(qb, order, locale, cursor);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            order,
            locale,
            value: this.cursorValue(order, locale, last),
            id: last.id,
          })
        : null;

    const counts = await this.locationCounts(page.map((row) => row.id));
    return {
      items: page.map((row) => ({
        ...toSupermarketView(row),
        locationCount: counts.get(row.id) ?? 0,
      })),
      nextCursor,
    };
  }

  /** One chain's view with its shop count, for the reads of a single chain. */
  private async withLocationCount(row: Supermarket): Promise<SupermarketView> {
    const counts = await this.locationCounts([row.id]);
    return {
      ...toSupermarketView(row),
      locationCount: counts.get(row.id) ?? 0,
    };
  }

  /**
   * How many shops each of these chains holds (admin plan 0042, section 2), in
   * one grouped query for the whole page rather than a count per row. A chain
   * with no shop has no group, so the caller reads a missing key as zero.
   */
  private async locationCounts(
    supermarketIds: readonly string[]
  ): Promise<Map<string, number>> {
    if (supermarketIds.length === 0) {
      return new Map();
    }
    const rows = (await this.supermarkets.query(
      `SELECT l."supermarketId"::text AS "id", count(*)::int AS "count"
         FROM "supermarket_locations" l
        WHERE l."supermarketId" = ANY($1::uuid[])
        GROUP BY l."supermarketId"`,
      [[...supermarketIds]]
    )) as { id: string; count: number }[];
    return new Map(rows.map((row) => [row.id, Number(row.count)]));
  }

  private async load(id: string): Promise<Supermarket> {
    const row = await this.supermarkets.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Supermarket not found');
    }
    return row;
  }

  /**
   * Narrow the page to the chains whose name or brand key contains the term.
   *
   * A substring match, not the ranked read a product group gets: a chain has no
   * search document and no synonyms, and its name is one or two words. Ranking
   * would also cost the keyset cursor, because a relevance score is computed per
   * query rather than stored and there is no column to seek into.
   *
   * The brand key is in because it is what tells two chains apart when their
   * names read alike, which is the case the operator is squinting at.
   */
  private applySearch(
    qb: SelectQueryBuilder<Supermarket>,
    query?: string
  ): void {
    const term = query?.trim() ?? '';
    if (term === '') {
      return;
    }

    // `strpos` rather than `ILIKE`, because `%` and `_` are wildcards to LIKE
    // and the operator typing them means those two characters. Nothing has to be
    // escaped this way, and an escape that is forgotten reads as a working
    // search that quietly matches too much.
    //
    // A null brand key makes `strpos` null, which is not true, so a chain
    // without one is simply not matched by that arm.
    qb.andWhere(
      `(
        strpos(lower(s.name ->> 'en'), lower(:term)) > 0
        OR strpos(lower(s.name ->> 'es'), lower(:term)) > 0
        OR strpos(lower(s."externalBrandKey"), lower(:term)) > 0
      )`,
      { term }
    );
  }

  private resolveOrder(order?: string): SupermarketOrder {
    return order === 'created' || order === 'updated' ? order : 'name';
  }

  private applyOrder(
    qb: SelectQueryBuilder<Supermarket>,
    order: SupermarketOrder,
    locale: SupportedLocale,
    cursor?: SupermarketCursor
  ): void {
    if (order === 'created') {
      qb.orderBy('s.createdAt', 'DESC').addOrderBy('s.id', 'DESC');
      if (cursor) {
        qb.andWhere('(s."createdAt", s.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'updated') {
      qb.orderBy('s.updatedAt', 'DESC').addOrderBy('s.id', 'DESC');
      if (cursor) {
        qb.andWhere('(s."updatedAt", s.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      // Order by the shown name, in the caller's language; id breaks ties.
      qb.orderBy(displayNameSql('s', locale), 'ASC').addOrderBy('s.id', 'ASC');
      if (cursor) {
        qb.andWhere(`(${displayNameSql('s', locale)}, s.id) > (:cv, :cid)`, {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(
    order: SupermarketOrder,
    locale: SupportedLocale,
    row: Supermarket
  ): string {
    if (order === 'created') {
      return row.createdAt.toISOString();
    }
    if (order === 'updated') {
      return row.updatedAt.toISOString();
    }
    return displayName(row.name, locale);
  }
}
