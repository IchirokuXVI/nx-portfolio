import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ITEM_LOOKUP_LIMITS,
  type CreateItemRequest,
  type FindItemByEanRequest,
  type FindItemByEanResult,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemIdRequest,
  type ItemOfferView,
  type ItemOrder,
  type ItemPage,
  type ItemView,
  type ProductGroupOfferPage,
  type ProductGroupOfferView,
  type SearchItemsRequest,
  type SearchOffersRequest,
  type UpdateItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository, type SelectQueryBuilder } from 'typeorm';
import { Item, ProductGroup, SupermarketItem } from '../entities';
import {
  toItemOfferView,
  toItemView,
  toProductGroupView,
} from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';
import {
  parseSearchTerm,
  TRIGRAM_THRESHOLD,
  TRIGRAM_WEIGHT,
  type SearchTerm,
} from './search-term';

interface ItemCursor {
  order: ItemOrder;
  /** A sort value for a keyset order; an offset for `relevance`. */
  value: string;
  id: string;
}

/** Collects positional parameters while a query is assembled around them. */
function params() {
  const values: unknown[] = [];
  return {
    values,
    /** Binds a value and answers the placeholder that names it. */
    bind: (value: unknown): string => `$${values.push(value)}`,
  };
}

/**
 * Global products (plan 0012), and the search over them (plan 0048).
 *
 * Writes are owner only; reads are open to any authenticated user.
 *
 * ## What plan 0048 changed here
 *
 * `search` used to be `ILIKE '%term%'` over two JSON fields, which cannot rank,
 * cannot spell and cannot see a product's group. It is now the per locale
 * `tsvector` columns the migration maintains, with `pg_trgm` beside them for the
 * misspellings full text search handles badly, and it ranks. The subject, the
 * request and the response are the ones that were already there: with no query
 * it still lists, because the admin surface uses it that way.
 *
 * `searchOffers` is the new read beside it, and the one the list composer runs
 * for a bare word: ranked **groups**, each carrying its cheapest member.
 *
 * ## Scopes are taken and never invented
 *
 * Both reads accept a set of price scope ids and quote prices from those and no
 * others. **This service never invents a default set**: resolving one from the
 * caller's shopping profile is the gateway's job (plan 0049, section 2.1), which
 * is what keeps catalog stateless about users.
 *
 * **Absent and empty scopes are the same answer** (plan 0069, section 2): a
 * ranked, paged read with every price field null. They were different for a
 * while, an empty array answering an empty page, and that was the wrong shape of
 * rule: the catalog is a list of things that exist, and a scope is how a price
 * gets attached to one, so having none says something about prices and nothing
 * about products. Which of the three states a caller is in — nothing said, a
 * place nobody serves, everywhere refused — is read from `coverage` on the scope
 * view, not from the size of this page.
 *
 * A group with no priced member still comes back for the same reason: the
 * composer is attaching identity, not quoting a price, and the harvester is off
 * outside development.
 */
@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(ProductGroup)
    private readonly groups: Repository<ProductGroup>,
    @InjectRepository(SupermarketItem)
    private readonly prices: Repository<SupermarketItem>,
    private readonly productGroups: ProductGroupService,
    private readonly admin: PlatformAdminService
  ) {}

  async create(req: CreateItemRequest): Promise<ItemView> {
    this.admin.requireAdmin(req.userId);
    const saved = await this.items.save(
      this.items.create({
        name: req.name,
        brand: req.brand ?? null,
        imageUrl: req.imageUrl ?? null,
        sku: req.sku ?? null,
        ean: req.ean ?? null,
        unitSize: req.unitSize ?? null,
        category: req.category,
        defaultUnit: req.defaultUnit,
        productGroupId: await this.resolveGroup(req.productGroupId ?? null),
      })
    );
    return toItemView(saved);
  }

  async update(req: UpdateItemRequest): Promise<ItemView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.itemId);
    if (req.name !== undefined) {
      row.name = req.name;
    }
    if (req.brand !== undefined) {
      row.brand = req.brand;
    }
    if (req.imageUrl !== undefined) {
      row.imageUrl = req.imageUrl;
    }
    if (req.sku !== undefined) {
      row.sku = req.sku;
    }
    if (req.ean !== undefined) {
      row.ean = req.ean;
    }
    if (req.unitSize !== undefined) {
      row.unitSize = req.unitSize;
    }
    if (req.category !== undefined) {
      row.category = req.category;
    }
    if (req.defaultUnit !== undefined) {
      row.defaultUnit = req.defaultUnit;
    }
    if (req.productGroupId !== undefined) {
      row.productGroupId = await this.resolveGroup(req.productGroupId);
    }
    return toItemView(await this.items.save(row));
  }

  async delete(req: ItemIdRequest): Promise<{ id: string }> {
    this.admin.requireAdmin(req.userId);
    const result = await this.items.delete({ id: req.itemId });
    if (!result.affected) {
      throw new NotFoundException('Item not found');
    }
    return { id: req.itemId };
  }

  async get(req: ItemIdRequest): Promise<ItemView> {
    return toItemView(await this.load(req.itemId));
  }

  /**
   * Several products by id, in one query (plan 0051, section 6.1).
   *
   * A **lookup rather than a search**, in the same sense {@link findByEan} is
   * one, and the two consequences follow from that: an id naming nothing is
   * absent from the answer instead of raising a 404, and no ordering is promised
   * because the caller is matching by id rather than reading a list.
   *
   * It exists so the basket screen can name every line's pick and every option
   * behind it in one round trip. Without it, twenty lines with three options each
   * would be sixty {@link get} calls to draw one page.
   *
   * ## Priced when asked (plan 0066, section 2)
   *
   * With `priceScopeIds` every item carries `bestOffer`: the cheapest of its rows
   * across exactly those scopes, or **null** when it has none there, so a caller
   * can tell "not priced at your shops" from "this read quotes no prices".
   * Absent and empty scopes are the same answer here, unlike {@link search}: a
   * lookup by id returns the same items either way, so the only question is
   * whether a price is attached.
   *
   * Cheapest **by price, not by unit price** (section 2.1). The price is what the
   * till charges; ranking by unit price is the better answer to "which milk is
   * cheaper" and belongs to backlog 0004 with the threshold that makes it usable.
   */
  async getMany(req: GetItemsRequest): Promise<GetItemsResult> {
    const ids = [...new Set(req.ids)].slice(0, ITEM_LOOKUP_LIMITS.maxIds);
    if (ids.length === 0) {
      return { items: [] };
    }
    const rows = await this.items.find({ where: { id: In(ids) } });
    const scopeIds = req.priceScopeIds ?? [];
    if (scopeIds.length === 0) {
      // An arrow rather than a bare reference: `map` passes the index as the
      // second argument, which `toItemView` reads as `bestOffer`.
      return { items: rows.map((row) => toItemView(row)) };
    }
    const offers = await this.offersFor(
      rows.map((row) => row.id),
      scopeIds,
      'price'
    );
    return {
      items: rows.map((row) => ({
        ...toItemView(row),
        bestOffer: offers.get(row.id) ?? null,
      })),
    };
  }

  /**
   * Look an item up by its barcode (plan 0038, section 6.2). A **lookup**, not a
   * search: EAN is unique when present, so this either finds the one item or
   * finds nothing, and finding nothing is a normal answer rather than a 404. It
   * is step 2 of the matching ladder, and it is what stops a promoted discovery
   * entry creating a duplicate of a product catalog already holds.
   */
  async findByEan(req: FindItemByEanRequest): Promise<FindItemByEanResult> {
    const row = await this.items.findOne({ where: { ean: req.ean } });
    return { item: row ? toItemView(row) : null };
  }

  /**
   * Ranked items (plan 0048, section 3), and a plain listing when there is no
   * query, which is what the admin surface uses it as.
   *
   * The ranking order is the plan's: **text relevance, then an exact brand or
   * name match, then unit price ascending** where a price exists. Relevance is
   * rounded to four places before it is compared, which is what gives the second
   * key anything to break: `ts_rank` is a float, two genuinely equal matches
   * differ in the fifteenth digit, and without the rounding "exact match wins"
   * would be a rule that never fired.
   */
  async search(req: SearchItemsRequest): Promise<ItemPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ItemCursor | undefined;
    const term = parseSearchTerm(req.query);
    const order = this.resolveOrder(req.order, term);

    const rows =
      order === 'relevance' && term
        ? await this.rankedItems(req, term, limit, cursor)
        : await this.listedItems(req, term, order, limit, cursor);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const offers = await this.offersFor(
      page.map((row) => row.id),
      req.priceScopeIds
    );
    const last = page[page.length - 1];
    const nextCursor =
      !hasMore || !last
        ? null
        : this.nextCursor(order, page, cursor, limit, last);

    return {
      items: page.map((row) => toItemView(row, offers.get(row.id))),
      nextCursor,
    };
  }

  /**
   * Ranked groups, each with its cheapest member at the requested scopes (plan
   * 0048, section 3).
   *
   * **A group with no priced member still comes back**, with `cheapestItem` and
   * `offer` both null. That is the case, not an edge case: the harvester is off
   * outside development, so in staging and production almost every group is in
   * it, and a composer that dropped unpriced groups would show an empty dropdown
   * on a catalog full of exactly the right answers.
   */
  async searchOffers(req: SearchOffersRequest): Promise<ProductGroupOfferPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ItemCursor | undefined;
    const term = parseSearchTerm(req.query);
    const offset = Number(cursor?.value ?? 0) || 0;
    const scopeIds = req.priceScopeIds ?? [];

    const p = params();
    const query = term ? p.bind(term.tsquery) : null;
    const raw = term ? p.bind(term.raw) : null;
    const threshold = term ? p.bind(TRIGRAM_THRESHOLD) : null;

    // The cheapest member, resolved inside the ranking query rather than after
    // it, because unit price is one of the ranking keys. With no scopes there is
    // nothing to join to, so the lateral is left out entirely and every group
    // answers with null prices.
    const offerJoin =
      scopeIds.length === 0
        ? ''
        : `
      LEFT JOIN LATERAL (
        SELECT si."itemId", si."priceScopeId", si."price", si."currency",
               si."unitPrice", si."unitPriceLabel", si."priceObservedAt",
               si."priceSourceKind"
        FROM "supermarket_items" si
        JOIN "items" mi ON mi."id" = si."itemId"
        WHERE mi."productGroupId" = g."id"
          AND si."priceScopeId" = ANY(${p.bind(scopeIds)})
          AND si."available"
        ORDER BY si."unitPrice" ASC NULLS LAST,
                 si."price" ASC NULLS LAST,
                 si."itemId" ASC
        LIMIT 1
      ) o ON true`;

    const relevance =
      query && raw
        ? `GREATEST(
             ts_rank(g."search_es", to_tsquery('spanish', ${query})),
             ts_rank(g."search_en", to_tsquery('english', ${query})),
             GREATEST(
               similarity(g."name" ->> 'es', ${raw}),
               similarity(g."name" ->> 'en', ${raw})
             ) * ${TRIGRAM_WEIGHT}
           )`
        : '0';
    const exact =
      raw === null
        ? 'false'
        : `(lower(g."name" ->> 'es') = lower(${raw})
            OR lower(g."name" ->> 'en') = lower(${raw}))`;
    const where =
      query && raw && threshold
        ? `WHERE (
             g."search_es" @@ to_tsquery('spanish', ${query})
             OR g."search_en" @@ to_tsquery('english', ${query})
             OR similarity(g."name" ->> 'es', ${raw}) > ${threshold}
             OR similarity(g."name" ->> 'en', ${raw}) > ${threshold}
           )`
        : '';
    const priced = scopeIds.length === 0 ? 'NULL::numeric' : 'o."unitPrice"';

    const rows: RankedGroupRow[] = await this.groups.query(
      `
      SELECT g."id", g."name", g."slug", g."referenceUnit", g."synonyms",
             ${
               scopeIds.length === 0
                 ? `NULL::uuid AS "offerItemId", NULL::uuid AS "offerScopeId",
                    NULL::numeric AS "offerPrice", NULL::varchar AS "offerCurrency",
                    NULL::numeric AS "offerUnitPrice", NULL::varchar AS "offerUnitPriceLabel",
                    NULL::timestamptz AS "offerObservedAt",
                    NULL::"price_source_kind" AS "offerSourceKind"`
                 : `o."itemId" AS "offerItemId", o."priceScopeId" AS "offerScopeId",
                    o."price" AS "offerPrice", o."currency" AS "offerCurrency",
                    o."unitPrice" AS "offerUnitPrice", o."unitPriceLabel" AS "offerUnitPriceLabel",
                    o."priceObservedAt" AS "offerObservedAt",
                    o."priceSourceKind" AS "offerSourceKind"`
             },
             round(${relevance}::numeric, 4) AS "relevance"
      FROM "product_groups" g${offerJoin}
      ${where}
      ORDER BY "relevance" DESC,
               ${exact} DESC,
               ${priced} ASC NULLS LAST,
               g."name" ->> 'en' ASC,
               g."id" ASC
      LIMIT ${p.bind(limit + 1)} OFFSET ${p.bind(offset)}
      `,
      p.values
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // The cheapest member as a full ItemView, in one query for the page. The
    // ranking already knows which product it is; this is what it looks like.
    const itemIds = page
      .map((row) => row.offerItemId)
      .filter((id): id is string => id !== null);
    const members =
      itemIds.length === 0
        ? []
        : await this.items.find({ where: { id: In(itemIds) } });
    const byId = new Map(members.map((item) => [item.id, item]));

    return {
      items: page.map((row) => this.toOfferView(row, byId)),
      nextCursor: hasMore
        ? encodeCursor({
            order: 'relevance',
            value: String(offset + limit),
            id: '',
          })
        : null,
    };
  }

  private toOfferView(
    row: RankedGroupRow,
    members: Map<string, Item>
  ): ProductGroupOfferView {
    const group = toProductGroupView({
      id: row.id,
      name: row.name,
      slug: row.slug,
      referenceUnit: row.referenceUnit,
      synonyms: row.synonyms,
    } as ProductGroup);

    const member = row.offerItemId ? members.get(row.offerItemId) : undefined;
    if (!member || !row.offerScopeId) {
      return { group, cheapestItem: null, offer: null };
    }
    const offer: ItemOfferView = {
      itemId: member.id,
      priceScopeId: row.offerScopeId,
      price: row.offerPrice === null ? null : Number(row.offerPrice),
      currency: row.offerCurrency,
      unitPrice:
        row.offerUnitPrice === null ? null : Number(row.offerUnitPrice),
      unitPriceLabel: row.offerUnitPriceLabel,
      priceObservedAt: row.offerObservedAt
        ? new Date(row.offerObservedAt).toISOString()
        : null,
      priceSourceKind: row.offerSourceKind,
    };
    return { group, cheapestItem: toItemView(member, offer), offer };
  }

  /**
   * The cheapest price each of these items has at these scopes.
   *
   * `DISTINCT ON` rather than a group by with a self join: one pass, and the
   * ordering inside it is the definition of cheapest, which is the one thing the
   * two callers disagree on. {@link search} ranks by **unit price** first because
   * that is the field whose only purpose is comparison (plan 0038, section 2.4),
   * then the shelf price for a product whose source published no unit price at
   * all, which would otherwise never be quotable. {@link getMany} ranks by
   * **price** first (plan 0066, section 2.1): it quotes what the till charges for
   * one product, and a unit price ranking there would be half of backlog 0004.
   */
  private async offersFor(
    itemIds: string[],
    priceScopeIds?: string[],
    rank: 'unitPrice' | 'price' = 'unitPrice'
  ): Promise<Map<string, ItemOfferView>> {
    const offers = new Map<string, ItemOfferView>();
    if (itemIds.length === 0 || !priceScopeIds || priceScopeIds.length === 0) {
      return offers;
    }
    const [first, second] =
      rank === 'price'
        ? ['si."price"', 'si."unitPrice"']
        : ['si."unitPrice"', 'si."price"'];
    const rows = await this.prices
      .createQueryBuilder('si')
      .distinctOn(['si."itemId"'])
      .where('si."itemId" IN (:...itemIds)', { itemIds })
      .andWhere('si."priceScopeId" IN (:...scopeIds)', {
        scopeIds: priceScopeIds,
      })
      .andWhere('si."available"')
      .orderBy('si."itemId"', 'ASC')
      .addOrderBy(first, 'ASC', 'NULLS LAST')
      .addOrderBy(second, 'ASC', 'NULLS LAST')
      .getMany();
    for (const row of rows) {
      offers.set(row.itemId, toItemOfferView(row));
    }
    return offers;
  }

  /** The ranked branch of {@link search}: one raw query, offset paginated. */
  private async rankedItems(
    req: SearchItemsRequest,
    term: SearchTerm,
    limit: number,
    cursor?: ItemCursor
  ): Promise<Item[]> {
    const offset = Number(cursor?.value ?? 0) || 0;
    const p = params();
    const query = p.bind(term.tsquery);
    const raw = p.bind(term.raw);
    const threshold = p.bind(TRIGRAM_THRESHOLD);

    const filters: string[] = [];
    if (req.category) {
      filters.push(`i."category" = ${p.bind(req.category)}::"item_category"`);
    }
    if (req.productGroupId) {
      filters.push(`i."productGroupId" = ${p.bind(req.productGroupId)}::uuid`);
    }
    // Unit price is the last ranking key, so it is joined even when the caller
    // asked for no prices in the answer: with no scopes there is nothing to join
    // and every row sorts as unpriced, which is the same order.
    const scopeIds = req.priceScopeIds ?? [];
    const cheapest =
      scopeIds.length === 0
        ? 'NULL::numeric'
        : `(
            SELECT min(si."unitPrice")
            FROM "supermarket_items" si
            WHERE si."itemId" = i."id"
              AND si."priceScopeId" = ANY(${p.bind(scopeIds)})
              AND si."available"
          )`;

    return this.items.query(
      `
      SELECT i.*
      FROM "items" i
      WHERE (
        i."search_es" @@ to_tsquery('spanish', ${query})
        OR i."search_en" @@ to_tsquery('english', ${query})
        OR similarity(coalesce(i."brand", ''), ${raw}) > ${threshold}
        OR similarity(i."name" ->> 'es', ${raw}) > ${threshold}
        OR similarity(i."name" ->> 'en', ${raw}) > ${threshold}
      )
      ${filters.map((clause) => `AND ${clause}`).join('\n      ')}
      ORDER BY round(GREATEST(
                 ts_rank(i."search_es", to_tsquery('spanish', ${query})),
                 ts_rank(i."search_en", to_tsquery('english', ${query})),
                 GREATEST(
                   similarity(coalesce(i."brand", ''), ${raw}),
                   similarity(i."name" ->> 'es', ${raw}),
                   similarity(i."name" ->> 'en', ${raw})
                 ) * ${TRIGRAM_WEIGHT}
               )::numeric, 4) DESC,
               (
                 lower(coalesce(i."brand", '')) = lower(${raw})
                 OR lower(i."name" ->> 'es') = lower(${raw})
                 OR lower(i."name" ->> 'en') = lower(${raw})
               ) DESC,
               ${cheapest} ASC NULLS LAST,
               i."id" ASC
      LIMIT ${p.bind(limit + 1)} OFFSET ${p.bind(offset)}
      `,
      p.values
    );
  }

  /**
   * The listing branch: the orders plan 0012 defined, keyset paginated as they
   * always were, with the search filter applied when there is a term.
   *
   * A caller can still ask for `name` with a query, and it means what it says:
   * every match, alphabetically. That is what an admin filtering a table wants,
   * and it is why the order parameter was not simply overridden.
   */
  private async listedItems(
    req: SearchItemsRequest,
    term: SearchTerm | null,
    order: ItemOrder,
    limit: number,
    cursor?: ItemCursor
  ): Promise<Item[]> {
    const qb = this.items.createQueryBuilder('i').take(limit + 1);
    if (term) {
      qb.andWhere(
        `(
          i."search_es" @@ to_tsquery('spanish', :tsquery)
          OR i."search_en" @@ to_tsquery('english', :tsquery)
          OR similarity(coalesce(i."brand", ''), :raw) > :threshold
          OR similarity(i."name" ->> 'es', :raw) > :threshold
          OR similarity(i."name" ->> 'en', :raw) > :threshold
        )`,
        {
          tsquery: term.tsquery,
          raw: term.raw,
          threshold: TRIGRAM_THRESHOLD,
        }
      );
    }
    if (req.category) {
      qb.andWhere('i.category = :category', { category: req.category });
    }
    if (req.productGroupId) {
      qb.andWhere('i."productGroupId" = :groupId', {
        groupId: req.productGroupId,
      });
    }
    this.applyOrder(qb, order, cursor);
    return qb.getMany();
  }

  private nextCursor(
    order: ItemOrder,
    page: Item[],
    cursor: ItemCursor | undefined,
    limit: number,
    last: Item
  ): string {
    if (order === 'relevance') {
      const offset = Number(cursor?.value ?? 0) || 0;
      return encodeCursor({ order, value: String(offset + limit), id: '' });
    }
    return encodeCursor({
      order,
      value: this.cursorValue(order, last),
      id: last.id,
    });
  }

  /**
   * The group an item is being assigned to, checked to exist.
   *
   * The foreign key would refuse a dangling id anyway; this turns that into a
   * "product group not found" rather than a driver error, and it is the only
   * place an assignment is ever made.
   */
  private async resolveGroup(
    productGroupId: string | null
  ): Promise<string | null> {
    if (productGroupId === null) {
      return null;
    }
    const group = await this.productGroups.load(productGroupId);
    return group.id;
  }

  private async load(id: string): Promise<Item> {
    const row = await this.items.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Item not found');
    }
    return row;
  }

  /**
   * Which order this read runs in.
   *
   * `relevance` is the default **when there is something to be relevant to**, and
   * the reason the admin listing did not change: with no query there is no score,
   * so the default stays `name`. An explicit order always wins, including
   * `relevance` with no query, which quietly degrades to `name` rather than
   * sorting everything by zero.
   */
  private resolveOrder(
    order: string | undefined,
    term: SearchTerm | null
  ): ItemOrder {
    if (order === 'created' || order === 'updated' || order === 'name') {
      return order;
    }
    if (order === 'relevance') {
      return term ? 'relevance' : 'name';
    }
    return term ? 'relevance' : 'name';
  }

  private applyOrder(
    qb: SelectQueryBuilder<Item>,
    order: ItemOrder,
    cursor?: ItemCursor
  ): void {
    if (order === 'created') {
      qb.orderBy('i.createdAt', 'DESC').addOrderBy('i.id', 'DESC');
      if (cursor) {
        qb.andWhere('(i."createdAt", i.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'updated') {
      qb.orderBy('i.updatedAt', 'DESC').addOrderBy('i.id', 'DESC');
      if (cursor) {
        qb.andWhere('(i."updatedAt", i.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      qb.orderBy(`i.name ->> 'en'`, 'ASC').addOrderBy('i.id', 'ASC');
      if (cursor) {
        qb.andWhere(`(i.name ->> 'en', i.id) > (:cv, :cid)`, {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: ItemOrder, row: Item): string {
    if (order === 'created') {
      return row.createdAt.toISOString();
    }
    if (order === 'updated') {
      return row.updatedAt.toISOString();
    }
    return row.name.en;
  }
}

/** One row of the ranked group query, before it becomes a view. */
interface RankedGroupRow {
  id: string;
  name: ProductGroup['name'];
  slug: string;
  referenceUnit: ProductGroup['referenceUnit'];
  synonyms: ProductGroup['synonyms'];
  offerItemId: string | null;
  offerScopeId: string | null;
  offerPrice: string | null;
  offerCurrency: string | null;
  offerUnitPrice: string | null;
  offerUnitPriceLabel: string | null;
  offerObservedAt: string | null;
  offerSourceKind: SupermarketItem['priceSourceKind'];
}
