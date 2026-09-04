import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type CreateSupermarketRequest,
  type ListSupermarketsRequest,
  type SupermarketIdRequest,
  type SupermarketOrder,
  type SupermarketPage,
  type SupermarketView,
  type UpdateSupermarketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { Supermarket } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toSupermarketView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';

interface SupermarketCursor {
  order: SupermarketOrder;
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
      // Never set on creation, and not because it was forgotten: a scope
      // belongs to a chain, so a chain that does not exist yet has none to
      // point at. It is set by `update`, after the scopes are (plan 0049,
      // section 3.1).
      defaultPriceScopeId: null,
    });
    const saved = await this.audit.write(actor, (tx) =>
      tx.create(Supermarket, draft)
    );
    return toSupermarketView(saved);
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
    if (req.defaultPriceScopeId !== undefined) {
      row.defaultPriceScopeId =
        req.defaultPriceScopeId === null
          ? null
          : (
              await this.priceScopes.requireScopeOf(
                req.defaultPriceScopeId,
                row.id
              )
            ).id;
    }
    return toSupermarketView(
      await this.audit.write(actor, (tx) =>
        tx.update(Supermarket, before, row)
      )
    );
  }

  async delete(req: SupermarketIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    // Loaded rather than deleted by id alone, because the trail records what was
    // lost (plan 0075, section 1). The missing row is refused here instead of by
    // an affected count, which says the same thing one query earlier.
    const row = await this.load(req.supermarketId);
    await this.audit.write(actor, (tx) => tx.delete(Supermarket, row));
    return { id: req.supermarketId };
  }

  async get(req: SupermarketIdRequest): Promise<SupermarketView> {
    return toSupermarketView(await this.load(req.supermarketId));
  }

  async list(req: ListSupermarketsRequest): Promise<SupermarketPage> {
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as SupermarketCursor | undefined;

    const qb = this.supermarkets.createQueryBuilder('s').take(limit + 1);
    this.applySearch(qb, req.query);
    this.applyOrder(qb, order, cursor);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            order,
            value: this.cursorValue(order, last),
            id: last.id,
          })
        : null;

    return { items: page.map(toSupermarketView), nextCursor };
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
      // Order by the English label of the localized name; id breaks ties.
      qb.orderBy(`s.name ->> 'en'`, 'ASC').addOrderBy('s.id', 'ASC');
      if (cursor) {
        qb.andWhere(`(s.name ->> 'en', s.id) > (:cv, :cid)`, {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: SupermarketOrder, row: Supermarket): string {
    if (order === 'created') {
      return row.createdAt.toISOString();
    }
    if (order === 'updated') {
      return row.updatedAt.toISOString();
    }
    return row.name.en;
  }
}
