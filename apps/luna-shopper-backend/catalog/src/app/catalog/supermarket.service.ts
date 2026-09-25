import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DEFAULT_SCOPE_PRIORITY,
  PriceScopeKind,
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
    return toSupermarketView(
      await this.audit.write(actor, (tx) => tx.update(Supermarket, before, row))
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
