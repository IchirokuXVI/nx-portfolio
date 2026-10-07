import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  brandKey,
  BULK_DECISION_MAX_OPERATIONS,
  ITEM_LOOKUP_LIMITS,
  LINE_ITEM_SET_MAX,
  PACK_COUNT_FILL_MAX,
  PACK_COUNT_MAX,
  PACK_COUNT_MIN,
  packCountOf,
  PRODUCT_GROUP_MEMBERS_MAX,
  readGtin,
  type CreateItemInput,
  type CreateItemRequest,
  type CreateItemsRequest,
  type CreateItemsResult,
  type FillPackCountsRequest,
  type FillPackCountsResult,
  type FindItemByEanRequest,
  type FindItemByEanResult,
  type FindItemsByEansRequest,
  type FindItemsByEansResult,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemEanRefusal,
  type ItemEanRequest,
  type ItemIdRequest,
  type ItemOfferView,
  type ItemOrder,
  type ItemPage,
  type ItemView,
  type ProductGroupOfferPage,
  type ProductGroupOfferView,
  type SearchItemsRequest,
  type SearchOffersRequest,
  type TeachItemEansRequest,
  type TeachItemEansResult,
  type UpdateItemInput,
  type UpdateItemRequest,
  type UpdateItemsRequest,
  type UpdateItemsResult,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  DEFAULT_LOCALE,
  encodeCursor,
  getRequestContext,
  isUuid,
  ITEM_EAN_DETAIL,
  ITEM_EAN_HOLDER_DETAIL,
  ItemEanHeldException,
  NotFoundException,
  requireProductEan,
  ValidationException,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import {
  In,
  QueryFailedError,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  Brand,
  Item,
  ProductGroup,
  SupermarketItem,
  type Category,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import {
  CatalogAuditService,
  type AuditedWrite,
} from './catalog-audit.service';
import {
  decodeCursorForLocale,
  displayName,
  displayNameSql,
  toItemOfferView,
  toItemView,
  toProductGroupView,
} from './catalog.mappers';
import { CategoryService, toCategoryOnItem } from './category.service';
import { ItemEanStore } from './item-ean.store';
import {
  PlatformAdminService,
  type CatalogActor,
} from './platform-admin.service';
import { ProductGroupService } from './product-group.service';
import {
  brandTypedSql,
  GROUP_SEARCH_TEXT,
  ITEM_SEARCH_TEXT,
  literalMatchSql,
  parseSearchTerm,
  TRIGRAM_THRESHOLD,
  TRIGRAM_WEIGHT,
  wholeWordMatchSql,
  type SearchTerm,
} from './search-term';
import { unitBasisOf } from './unit-basis';

interface ItemCursor {
  order: ItemOrder;
  /** The language the `value` was cut under (plan 0111, section 5). */
  locale: SupportedLocale;
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
 * The products the named chains sell (plan 0146, section 2), written once for
 * both branches of the search.
 *
 * The caller hands in the placeholder that names its own bound list, because the
 * two branches bind differently: the ranked one assembles positional parameters
 * and the listing one goes through the query builder's named ones. What must not
 * differ is the rule itself, which is why it is a function here and not a string
 * in each of them.
 *
 * **An `EXISTS` rather than a join**, so a product the chain sells at nine of its
 * scopes is still one row rather than nine.
 *
 * **`available` is part of the meaning and not an optimization.** A source row
 * saying the chain does not stock the product is exactly the row that must not
 * put it in that chain's catalog, and `bestOffer` and the `scopes` array already
 * exclude it for the same reason (plan 0109, section 2).
 *
 * It says nothing about price. A product the chain sells with no price row is
 * listed with its price fields null, as it would be with no filter at all.
 */
function soldByChainSql(placeholder: string): string {
  return `EXISTS (
        SELECT 1
        FROM "supermarket_items" si
        JOIN "price_scopes" ps ON ps."id" = si."priceScopeId"
        WHERE si."itemId" = i."id"
          AND ps."supermarketId" = ANY(${placeholder})
          AND si."available"
      )`;
}

/**
 * The products under one category (plan 0166, section 4), written once for
 * both branches of the search for the reason {@link soldByChainSql} is.
 *
 * A leaf's own products, or for a root the products under any of its children:
 * `c.id` matches a leaf and `c."parentId"` matches a root, and a row can only
 * ever match one of the two. An `EXISTS` so a product on two leaves of one root
 * is still one row, planned on `ix_item_categories_category`.
 */
function underCategorySql(placeholder: string): string {
  return `EXISTS (
        SELECT 1
        FROM "item_categories" ic
        JOIN "categories" c ON c."id" = ic."categoryId"
        WHERE ic."itemId" = i."id"
          AND (c."id" = ${placeholder}::uuid OR c."parentId" = ${placeholder}::uuid)
      )`;
}

/**
 * The products on no category at all (admin plan 0043, section 2): what the
 * "No category" entry of the back office's tree lists. A product needs a
 * category to be written, so these are the rows a source left behind.
 */
const WITHOUT_CATEGORY_SQL = `NOT EXISTS (
        SELECT 1
        FROM "item_categories" ic
        WHERE ic."itemId" = i."id"
      )`;

/**
 * The products one price scope shows no price for (plan 0187), written once
 * for both branches of the search and for the count beside each.
 *
 * A product is listed unless the scope holds a row for it that is an answer:
 * a price, or `available = false`, which is the scope saying it does not sell
 * the product. A row with no price that still says "sold" is not an answer,
 * and neither is no row at all.
 *
 * **Read from `supermarket_items` and never worked out from `item_prices`.**
 * That row is the price a shopper sees, materialized on every write (plan
 * 0080), so an out of date price is a price here too.
 *
 * **`NOT EXISTS` and not a left join with a null test**, so the planner can
 * answer each product from the unique index on the pair, or build the set of
 * one scope's rows once from the index on the scope.
 */
function withoutPriceAtScopeSql(placeholder: string): string {
  return `NOT EXISTS (
        SELECT 1
        FROM "supermarket_items" np
        WHERE np."itemId" = i."id"
          AND np."priceScopeId" = ${placeholder}::uuid
          AND (np."price" IS NOT NULL OR NOT np."available")
      )`;
}

/**
 * What the ranked branch matches on, bound once and spent by the page and by
 * its count (plan 0187). The two must not be able to disagree, so neither
 * writes the filter itself.
 */
interface RankedMatch {
  /** The placeholder of the normalized tsquery. */
  readonly query: string;
  /**
   * The placeholder of the text as typed, or `''` when the statement has no
   * part that reads it and so it was never bound.
   */
  readonly raw: string;
  /** The barcode test, or the constant `false` when the query is words. */
  readonly barcode: string;
  /** The trigram branch, or `''` when the query is too short for it. */
  readonly fuzzy: string;
  /** Every narrowing clause, to be joined with `AND`. */
  readonly filters: readonly string[];
}

/**
 * The `WHERE` of the ranked branch, for the page and for its count.
 *
 * The literal recheck binds its words here, so the caller writes this where
 * the statement reads it.
 */
function rankedWhereSql(
  match: RankedMatch,
  term: SearchTerm,
  bind: (value: unknown) => string
): string {
  return `(
        ${match.barcode}
        OR (
          (
            i."search_es" @@ to_tsquery('spanish', ${match.query})
            OR i."search_en" @@ to_tsquery('english', ${match.query})
          )
          AND ${literalMatchSql(ITEM_SEARCH_TEXT, term.words, bind)}
        )
        ${match.fuzzy}
      )
      ${match.filters.map((clause) => `AND ${clause}`).join('\n      ')}`;
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
    // The registry every written brand is looked up in (plan 0115, section 4).
    // Read directly rather than through `BrandService`, because what the write
    // step needs is one lookup by key and nothing the service adds around it.
    @InjectRepository(Brand) private readonly brands: Repository<Brand>,
    private readonly productGroups: ProductGroupService,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService,
    // Where a product's group moves is where plan 0070's fan out starts. Fire and
    // forget: an admin's write must not fail because nobody was listening.
    private readonly events: CatalogEventsPublisher,
    // The leaves a write names, and the categories every read answers with
    // (plan 0166). Last, so the specs that build this positionally keep their
    // earlier arguments where they were.
    private readonly categories: CategoryService,
    // Every barcode of every product (plan 0185). `items.ean` is the first
    // one, and this is where the rest live.
    private readonly eans: ItemEanStore
  ) {}

  /**
   * A new product (plan 0012).
   *
   * It announces its group when it is created into one (plan 0070, section 5).
   * That is "joined", with nothing on the other side, and it is the same fact as
   * an update that moves a product into a group: a household subscribed to Milk
   * should get a milk the catalog has only just heard of, and there is no second
   * write coming that would tell them.
   */
  async create(req: CreateItemRequest): Promise<ItemView> {
    const actor = await this.admin.requireAdmin(req);
    // One or more leaves, checked before anything is written (plan 0166,
    // rules R2 and R3): a product always has a category.
    const leaves = await this.categories.requireLeaves(req.categoryIds ?? []);
    const draft = this.items.create({
      name: req.name,
      imageUrl: req.imageUrl ?? null,
      sku: req.sku ?? null,
      // A real barcode or none (plan 0184): an in-store code, or a code with
      // a wrong length or check digit, is refused with `item_ean_invalid`.
      ean: requireProductEan(req.ean),
      unitSize: req.unitSize ?? null,
      packCount: req.packCount ?? null,
      defaultUnit: req.defaultUnit,
      productGroupId: await this.resolveGroup(req.productGroupId ?? null),
    });
    // The three brand columns, in the one step every write shares (plan 0115,
    // section 4). An unregistered brand is still accepted: refusing it is the
    // curator's decision, not the catalog's.
    this.applyBrand(draft, req.brand, await this.registeredBrands([req.brand]));
    // Guarded for the same reason {@link createMany} is: the barcode is unique
    // when present, so a product the catalog already holds under it refuses the
    // insert. Unguarded, that reaches the operator as a 500 saying nothing,
    // which is what the route's own `conflict: true` already promised not to do.
    let saved: Item;
    try {
      saved = await this.audit.write(actor, async (tx) => {
        const row = await tx.create(Item, draft);
        // In the same transaction as the product, so there is never a product
        // with no category to read.
        await this.categories.setItemCategories(tx.manager, row.id, leaves);
        // And its first barcode is a row of `item_eans` from the start (plan
        // 0185). A barcode another product holds as one of its further
        // barcodes fails here, on the primary key, as a duplicate
        // `items.ean` fails on its index.
        if (row.ean) {
          await this.eans.insert(tx.manager, row.id, row.ean);
        }
        return row;
      });
    } catch (error) {
      throw asEanConflict(error, EAN_TAKEN_ON_CREATE);
    }
    if (saved.productGroupId !== null) {
      this.events.itemGroupChanged(saved.id, null, saved.productGroupId);
    }
    return toItemView(saved, leaves.map(toCategoryOnItem), firstEanOf(saved));
  }

  /**
   * Several products, in one transaction, all or nothing (plan 0100).
   *
   * The step a bulk entry decision needs before it can bind anything: a
   * decisions file that creates forty products and binds forty rows to them
   * must create forty or none, because a half filled catalog leaves the
   * operator to work out which half and the binds that follow name every one.
   *
   * **Not a loop over {@link create}, and that is the whole point.** Forty calls
   * are forty transactions, so the thirty seventh failing leaves thirty six
   * products nothing points at. One transaction here fails as one thing.
   *
   * Announced after the commit, one event per product that landed in a group,
   * for the same reason {@link create} announces one: a household subscribed to
   * Milk should get a milk the catalog has only just heard of, and no second
   * write is coming that would tell them.
   */
  async createMany(req: CreateItemsRequest): Promise<CreateItemsResult> {
    const actor = await this.admin.requireAdmin(req);
    if (req.items.length === 0) {
      throw new ValidationException(
        'A bulk create needs at least one product.'
      );
    }
    if (req.items.length > BULK_DECISION_MAX_OPERATIONS) {
      throw new ValidationException(
        `A bulk create carries at most ${BULK_DECISION_MAX_OPERATIONS} ` +
          `products, and this one carries ${req.items.length}. Split the work ` +
          'into separate files: this request is refused whole rather than ' +
          'chunked, because two chunks are two transactions and the first can ' +
          'land while the second fails.'
      );
    }
    // Every barcode of the batch is a real one or absent (plan 0184), checked
    // before anything is read or written, so the first bad one refuses the
    // whole request. The trimmed codes are what the drafts below store.
    const eans = req.items.map((input) => requireProductEan(input.ean));
    this.refuseRepeatedEans(req.items);

    // Every group is resolved before the transaction opens, which is where the
    // audit service says validating reads belong. A group deleted between the
    // check and the write fails on the foreign key, and fails the whole batch.
    // Every distinct key of the batch in **one** query, not one per product
    // (plan 0115, section 4). A file of a thousand products is a thousand
    // lookups otherwise, for a registry of a few hundred rows.
    const registered = await this.registeredBrands(
      req.items.map((input) => input.brand)
    );
    // Every leaf the batch names, in one query too (plan 0166), and each
    // product's list checked against it before anything is written.
    const leavesOf = await this.categories.leaveChecker(
      req.items.map((input) => input.categoryIds ?? [])
    );

    const drafts: { draft: Item; leaves: Category[] }[] = [];
    for (const [index, input] of req.items.entries()) {
      const leaves = leavesOf(input.categoryIds ?? []);
      const draft = this.items.create({
        name: input.name,
        imageUrl: input.imageUrl ?? null,
        sku: input.sku ?? null,
        ean: eans[index],
        unitSize: input.unitSize ?? null,
        packCount: input.packCount ?? null,
        defaultUnit: input.defaultUnit,
        productGroupId: await this.resolveGroup(input.productGroupId ?? null),
      });
      this.applyBrand(draft, input.brand, registered);
      drafts.push({ draft, leaves });
    }

    let saved: { row: Item; leaves: Category[] }[];
    try {
      saved = await this.audit.write(actor, async (tx) => {
        const rows: { row: Item; leaves: Category[] }[] = [];
        for (const { draft, leaves } of drafts) {
          const row = await tx.create(Item, draft);
          await this.categories.setItemCategories(tx.manager, row.id, leaves);
          if (row.ean) {
            await this.eans.insert(tx.manager, row.id, row.ean);
          }
          rows.push({ row, leaves });
        }
        return rows;
      });
    } catch (error) {
      throw asEanConflict(error, eanTakenInBatch(takenEanOf(error)));
    }

    for (const { row } of saved) {
      if (row.productGroupId !== null) {
        this.events.itemGroupChanged(row.id, null, row.productGroupId);
      }
    }
    return {
      items: saved.map(({ row, leaves }) =>
        toItemView(row, leaves.map(toCategoryOnItem), firstEanOf(row))
      ),
    };
  }

  /**
   * Edit a product (plan 0012).
   *
   * **This is where group membership moves one product at a time**, and
   * therefore one of the places plan 0070's fan out is triggered from.
   * `ProductGroupService` says so in its own class doc: nothing there assigns
   * items to groups, so "an admin adds three products to Milk" is three calls to
   * this method, and a sync hung off the group service would watch a service
   * that never fires.
   *
   * The other two places are {@link createMany} above, which creates a product
   * straight into a group, and `ProductGroupAssignmentService`, which replays a
   * whole curation session (plan 0100). Both announce the same event for the
   * same reason. Anything else that ever writes `productGroupId` has to as well.
   *
   * Announced only when the group actually moved, and only after the write. Every
   * other field an admin can change here means nothing to a subscribed line, and
   * the consumer's work is proportional to how many households subscribe to the
   * group, so an event for a rename would be a fan out over nothing.
   */
  async update(req: UpdateItemRequest): Promise<ItemView> {
    const actor = await this.admin.requireAdmin(req);
    const [view] = await this.applyUpdates(actor, [req], EAN_TAKEN_ON_UPDATE);
    return view;
  }

  /**
   * Several product edits in one transaction, all or nothing (plan 0166,
   * section 3).
   *
   * Each entry is applied exactly as {@link update} applies one, which is why
   * both go through {@link applyUpdates}; the difference is only that every
   * entry shares one transaction, so the first refusal refuses the whole
   * request and nothing is written. It is what the back office's "Set
   * categories" action sends, one entry per ticked row, and a set applied to
   * half the rows would leave the operator to work out which half.
   *
   * Capped and refused whole past the cap, for the reason {@link createMany}
   * gives: two chunks are two transactions.
   */
  async updateMany(req: UpdateItemsRequest): Promise<UpdateItemsResult> {
    const actor = await this.admin.requireAdmin(req);
    if (req.items.length === 0) {
      throw new ValidationException(
        'A bulk update needs at least one product.'
      );
    }
    if (req.items.length > BULK_DECISION_MAX_OPERATIONS) {
      throw new ValidationException(
        `A bulk update carries at most ${BULK_DECISION_MAX_OPERATIONS} ` +
          `products, and this one carries ${req.items.length}. Split the ` +
          'work: this request is refused whole rather than chunked, because ' +
          'two chunks are two transactions and the first can land while the ' +
          'second fails.'
      );
    }
    const seen = new Set<string>();
    for (const input of req.items) {
      if (seen.has(input.itemId)) {
        throw new ValidationException(
          `The product ${input.itemId} is named twice in one bulk update. ` +
            'Send one entry per product with every change it needs.'
        );
      }
      seen.add(input.itemId);
    }
    return {
      items: await this.applyUpdates(
        actor,
        req.items,
        EAN_TAKEN_IN_UPDATE_BATCH
      ),
    };
  }

  async delete(req: ItemIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.itemId);
    await this.audit.write(actor, (tx) => tx.delete(Item, row));
    return { id: req.itemId };
  }

  async get(req: ItemIdRequest): Promise<ItemView> {
    const row = await this.load(req.itemId);
    return (await this.viewer([row]))(row);
  }

  /**
   * Give a product one more barcode (plan 0185).
   *
   * The barcode is a real one or the request is refused with
   * `item_ean_invalid`, as on every other write. A barcode another product
   * holds is refused with `item_ean_held`, naming that product. A barcode this
   * product already holds changes nothing and answers the product as it is.
   *
   * A product with no first barcode takes this one as its first, so
   * `items.ean` is never empty while the product holds a barcode.
   */
  async addEan(req: ItemEanRequest): Promise<ItemView> {
    const actor = await this.admin.requireAdmin(req);
    const ean = this.requireEan(req.ean);
    const row = await this.load(req.itemId);
    let heldBy: string | null;
    try {
      heldBy = await this.audit.write(
        actor,
        async (tx) => (await this.giveEan(tx, row, ean)).heldBy
      );
    } catch (error) {
      // Two writers gave two products the barcode at once, and this one lost
      // on the primary key.
      throw asEanConflict(error, EAN_TAKEN_ON_UPDATE);
    }
    if (heldBy !== null) {
      throw eanHeld(ean, heldBy);
    }
    return (await this.viewer([row]))(row);
  }

  /**
   * Take one barcode off a product (plan 0185). A barcode the product does not
   * hold is a 404.
   *
   * When it was the product's first barcode, the oldest of the rest becomes
   * the first, and a product left with none has a null `ean`.
   */
  async removeEan(req: ItemEanRequest): Promise<ItemView> {
    const actor = await this.admin.requireAdmin(req);
    const ean = req.ean.trim();
    const row = await this.load(req.itemId);
    await this.audit.write(actor, async (tx) => {
      if (!(await this.eans.remove(tx.manager, row.id, ean))) {
        throw new NotFoundException(
          `Item ${row.id} does not hold the barcode ${ean}.`
        );
      }
      if (row.ean === ean) {
        const before = { ...row };
        row.ean = await this.oldestEan(tx, row.id);
        await tx.update(Item, before, row);
      }
    });
    return (await this.viewer([row]))(row);
  }

  /**
   * Teach products the barcodes their bound rows printed (plan 0185), in one
   * transaction.
   *
   * What a queue decision calls after it bound a row whose barcode its product
   * did not hold. **A pair that cannot be written is named in the answer and
   * does not fail the call**: the bind it follows has already landed, and one
   * barcode another product took in the meantime must not cost the rest of a
   * file theirs. Asking first is the caller's job, and the refusal that stops
   * a decision is made there, before anything is written.
   */
  async teachEans(req: TeachItemEansRequest): Promise<TeachItemEansResult> {
    const actor = await this.admin.requireAdmin(req);
    if (req.entries.length > BULK_DECISION_MAX_OPERATIONS) {
      throw new ValidationException(
        `A barcode batch carries at most ${BULK_DECISION_MAX_OPERATIONS} ` +
          `pairs, and this one carries ${req.entries.length}.`
      );
    }
    const refused: ItemEanRefusal[] = [];
    const pairs: { itemId: string; ean: string }[] = [];
    for (const entry of req.entries) {
      const reading = readGtin(entry.ean);
      if (reading.kind !== 'GTIN' || !isUuid(entry.itemId)) {
        refused.push({
          itemId: entry.itemId,
          ean: entry.ean,
          reason: reading.kind !== 'GTIN' ? 'INVALID' : 'NOT_FOUND',
          heldBy: null,
        });
      } else {
        pairs.push({ itemId: entry.itemId, ean: reading.gtin });
      }
    }
    if (pairs.length === 0) {
      return { added: 0, refused };
    }
    const rows = new Map(
      (
        await this.items.find({
          where: { id: In([...new Set(pairs.map((pair) => pair.itemId))]) },
        })
      ).map((row) => [row.id, row])
    );

    let added = 0;
    try {
      added = await this.audit.write(actor, async (tx) => {
        let written = 0;
        for (const pair of pairs) {
          const row = rows.get(pair.itemId);
          if (!row) {
            refused.push({ ...pair, reason: 'NOT_FOUND', heldBy: null });
            continue;
          }
          const given = await this.giveEan(tx, row, pair.ean);
          if (given.heldBy !== null) {
            refused.push({ ...pair, reason: 'HELD', heldBy: given.heldBy });
          } else if (given.added) {
            written += 1;
          }
        }
        return written;
      });
    } catch (error) {
      throw asEanConflict(error, EAN_TAKEN_IN_UPDATE_BATCH);
    }
    return { added, refused };
  }

  /**
   * Write a pack count onto each product that has none (plan 0162, section 3).
   *
   * **One statement, and it never overwrites.** The `IS NULL` is the rule, not
   * a detail of it: a count that is set was either read by an earlier run or
   * typed by a person, and only {@link update} may change it, so a correction
   * survives every run after it. A pair naming a product that is gone writes
   * nothing and is not counted.
   *
   * The harvester already left out every product whose sources disagree, so a
   * product named twice here is a caller's mistake and is refused whole rather
   * than settled by whichever pair came last.
   */
  async fillPackCounts(
    req: FillPackCountsRequest
  ): Promise<FillPackCountsResult> {
    const actor = await this.admin.requireAdmin(req);
    if (req.entries.length > PACK_COUNT_FILL_MAX) {
      throw new ValidationException(
        `A pack count fill carries at most ${PACK_COUNT_FILL_MAX} products, ` +
          `and this one carries ${req.entries.length}. Send several calls: ` +
          'each product is written on its own merit, so nothing is half done.'
      );
    }
    const ids = new Set<string>();
    for (const entry of req.entries) {
      if (ids.has(entry.itemId)) {
        throw new ValidationException(
          `The product ${entry.itemId} is named twice in one pack count fill.`
        );
      }
      if (packCountOf(entry.packCount) !== entry.packCount) {
        throw new ValidationException(
          `The pack count ${entry.packCount} for ${entry.itemId} is not a ` +
            `whole number from ${PACK_COUNT_MIN} to ${PACK_COUNT_MAX}.`
        );
      }
      ids.add(entry.itemId);
    }
    // An id that is not a uuid names no product, and casting it would fail the
    // whole statement rather than skip one pair.
    const entries = req.entries.filter((entry) => isUuid(entry.itemId));
    if (entries.length === 0) {
      return { written: 0 };
    }

    return this.audit.write(actor, async (tx) => {
      // `UPDATE ... RETURNING` answers `[rows, rowCount]` through `query()`.
      const [rows] = (await tx.manager.query(
        `UPDATE "items" AS i
            SET "packCount" = v."packCount", "updatedAt" = now()
           FROM unnest($1::uuid[], $2::smallint[]) AS v("id", "packCount")
          WHERE i."id" = v."id"
            AND i."packCount" IS NULL
      RETURNING i."id", i."packCount"`,
        [
          entries.map((entry) => entry.itemId),
          entries.map((entry) => entry.packCount),
        ]
      )) as [{ id: string; packCount: number }[], number];
      // Only the one column moved, so the trail records that and nothing
      // else: every other field reads the same on both sides.
      for (const row of rows) {
        await tx.recordUpdate(Item, { id: row.id, packCount: null }, {
          id: row.id,
          packCount: row.packCount,
        } as Item);
      }
      return { written: rows.length };
    });
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
    const view = await this.viewer(rows);
    const scopeIds = req.priceScopeIds ?? [];
    if (scopeIds.length === 0) {
      // An arrow rather than a bare reference: `map` passes the index as the
      // second argument, which `view` reads as the offer.
      return { items: rows.map((row) => view(row)) };
    }
    const itemIds = rows.map((row) => row.id);
    if (req.offers === 'all') {
      const perItem = await this.allOffersFor(itemIds, scopeIds);
      return {
        items: rows.map((row) => {
          const offers = perItem.get(row.id) ?? [];
          return {
            ...view(row),
            // Filled from the same array rather than from a second query, so
            // "the cheapest" and "the first of all of them" cannot disagree
            // (plan 0109, section 2).
            bestOffer: offers[0] ?? null,
            offers,
          };
        }),
      };
    }
    const offers = await this.offersFor(itemIds, scopeIds);
    return {
      items: rows.map((row) => ({
        ...view(row),
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
   *
   * **Any barcode of the product finds it** (plan 0185): the lookup reads
   * `item_eans`, where the first barcode is a row like the rest. An in-store
   * or invalid code that an old product still carries on `items.ean` is in no
   * row, so it finds nothing, which is the rule plan 0184 set for every
   * caller: such a code joins nothing.
   */
  async findByEan(req: FindItemByEanRequest): Promise<FindItemByEanResult> {
    const itemId = (await this.eans.holdersOf([req.ean])).get(req.ean);
    const row = itemId
      ? await this.items.findOne({ where: { id: itemId } })
      : null;
    if (!row) {
      return { item: null };
    }
    return { item: (await this.viewer([row]))(row) };
  }

  /**
   * {@link findByEan} for a whole decisions file, in one query. The file's
   * barcode check used to ask once per barcode, and a thousand round trips
   * ran past the gateway's route timeout before anything was created.
   *
   * Answers only the barcodes catalog holds. A barcode absent from the answer
   * is free, and a repeated one is asked about once.
   */
  async findByEans(
    req: FindItemsByEansRequest
  ): Promise<FindItemsByEansResult> {
    const eans = [...new Set(req.eans)];
    if (eans.length > BULK_DECISION_MAX_OPERATIONS) {
      throw new ValidationException(
        `A barcode lookup carries at most ${BULK_DECISION_MAX_OPERATIONS} ` +
          `barcodes, and this one carries ${eans.length}.`
      );
    }
    if (eans.length === 0) {
      return { items: [] };
    }
    // Through `item_eans` (plan 0185), so a product is found by any of its
    // barcodes. Two of them in one request find one product, answered once:
    // the caller reads `eans` on the view to see which barcodes it holds.
    const itemIds = [...new Set((await this.eans.holdersOf(eans)).values())];
    if (itemIds.length === 0) {
      return { items: [] };
    }
    const rows = await this.items.find({ where: { id: In(itemIds) } });
    const view = await this.viewer(rows);
    return { items: rows.map((row) => view(row)) };
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
   *
   * ## A barcode is one of the things a query can be
   *
   * A query that is a whole barcode also matches `ean`, and the row carrying it
   * sorts above every text hit. This is a **search** and {@link findByEan} is
   * still a lookup: the two differ in what they are for, not in how they compare
   * the digits. The lookup answers the harvester's matching ladder, where the
   * only acceptable answer is that one product or none; this puts the scanned
   * product at the top of a dropdown that goes on offering the text matches
   * underneath, because somebody typing digits may not have been scanning at
   * all.
   */
  async search(req: SearchItemsRequest): Promise<ItemPage> {
    // Plan 0187: the worklist of one scope. The scope is checked before
    // anything is read, because an empty page for a scope that does not exist
    // would say "every product is priced there".
    const counted = req.withoutPriceAtScopeId !== undefined;
    if (req.withoutPriceAtScopeId !== undefined) {
      await this.requirePriceScope(req.withoutPriceAtScopeId);
    }
    if (req.categoryId !== undefined && !isUuid(req.categoryId)) {
      // An id that is not a uuid names no category, so the filter matches
      // nothing, as an unknown uuid does (plan 0166, section 3). Casting it
      // would fail the query instead.
      return { items: [], nextCursor: null, ...(counted ? { total: 0 } : {}) };
    }
    const limit = clampPageSize(req.limit);
    // The caller's language, off the request context the gateway propagated
    // (plan 0111, section 3).
    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    const cursor = decodeCursorForLocale<ItemCursor>(req.cursor, locale);
    const term = parseSearchTerm(req.query);
    const order = this.resolveOrder(req.order, term);

    // One statement for the page and, for the worklist of plan 0187 alone,
    // one for the count. The count is of the whole request and not of what is
    // left after the cursor, so every page of one request carries one number.
    const [rows, matching] = await Promise.all([
      order === 'relevance' && term
        ? this.rankedItems(req, term, limit, cursor)
        : this.listedItems(req, term, order, locale, limit, cursor),
      !counted
        ? undefined
        : order === 'relevance' && term
          ? this.rankedCount(req, term)
          : this.listedCount(req, term),
    ]);
    const total = matching === undefined ? {} : { total: matching };

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      !hasMore || !last
        ? null
        : this.nextCursor(order, locale, cursor, limit, last);

    const pageIds = page.map((row) => row.id);
    const view = await this.viewer(page);
    const scopeIds = req.priceScopeIds ?? [];
    if (req.offers === 'all' && scopeIds.length > 0) {
      // Plan 0161, section 1: what `getMany` answers for `all`, for the same
      // reason. `bestOffer` is the first entry of the one array rather than a
      // second query, so the two cannot disagree.
      const perItem = await this.allOffersFor(pageIds, scopeIds);
      return {
        items: page.map((row) => {
          const offers = perItem.get(row.id) ?? [];
          return {
            ...view(row),
            bestOffer: offers[0] ?? null,
            offers,
          };
        }),
        nextCursor,
        ...total,
      };
    }
    const offers = await this.offersFor(pageIds, req.priceScopeIds);
    return {
      items: page.map((row) => view(row, offers.get(row.id))),
      nextCursor,
      ...total,
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
   *
   * **Barcodes are matched by {@link search} and not here**, which is why this
   * read gained nothing when they were. The rule the suggest endpoint enforces
   * is that a group beats an item for a bare *word*, and it holds because a word
   * names a kind of thing while a barcode names one product. Somebody who scans
   * a carton is not asking to be shown milk.
   */
  async searchOffers(req: SearchOffersRequest): Promise<ProductGroupOfferPage> {
    const limit = clampPageSize(req.limit);
    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    const cursor = decodeCursorForLocale<ItemCursor>(req.cursor, locale);
    const term = parseSearchTerm(req.query);
    const offset = Number(cursor?.value ?? 0) || 0;
    const scopeIds = req.priceScopeIds ?? [];

    const p = params();
    const query = term ? p.bind(term.tsquery) : null;
    const raw = term ? p.bind(term.raw) : null;

    // The cheapest member, resolved inside the ranking query rather than after
    // it, because unit price is one of the ranking keys. With no scopes there is
    // nothing to join to, so the lateral is left out entirely and every group
    // answers with null prices.
    //
    // A member with a till price comes before any other key (plan 0157). The
    // members are different products, so unit price is still how they are
    // compared, but only among offers somebody can pay: a leaflet row with no
    // price and a unit price of 2 is not the cheapest beer in the group.
    const offerJoin =
      scopeIds.length === 0
        ? ''
        : `
      LEFT JOIN LATERAL (
        SELECT si."itemId", si."priceScopeId", si."price", si."currency",
               si."unitPrice", si."unitPriceLabel", si."priceObservedAt",
               si."priceSourceKind", si."priceCopiedFromScopeId", si."stale"
        FROM "supermarket_items" si
        JOIN "items" mi ON mi."id" = si."itemId"
        WHERE mi."productGroupId" = g."id"
          AND si."priceScopeId" = ANY(${p.bind(scopeIds)})
          AND si."available"
        ORDER BY si."price" IS NULL ASC,
                 si."unitPrice" ASC NULLS LAST,
                 si."price" ASC NULLS LAST,
                 si."itemId" ASC
        LIMIT 1
      ) o ON true`;

    const relevance =
      query && raw
        ? `GREATEST(
             ts_rank(g."search_es", to_tsquery('spanish', ${query}), 1),
             ts_rank(g."search_en", to_tsquery('english', ${query}), 1),
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
      term && query && raw
        ? `WHERE (
             (
               (
                 g."search_es" @@ to_tsquery('spanish', ${query})
                 OR g."search_en" @@ to_tsquery('english', ${query})
               )
               AND ${literalMatchSql(GROUP_SEARCH_TEXT, term.words, p.bind)}
             )
             ${
               term.fuzzy
                 ? `OR similarity(g."name" ->> 'es', ${raw}) > ${p.bind(
                     TRIGRAM_THRESHOLD
                   )}
                    OR similarity(g."name" ->> 'en', ${raw}) > ${p.bind(
                      TRIGRAM_THRESHOLD
                    )}`
                 : ''
             }
           )`
        : '';
    // The whole word key, as on the items: a group whose name *is* the typed
    // word comes before one that merely contains it. Written only when there is
    // a term, because Postgres refuses a bare constant in `ORDER BY`.
    const wholeWords = term
      ? `(${wholeWordMatchSql(GROUP_SEARCH_TEXT, term.words, p.bind)}) DESC,
               `
      : '';
    // The offer's unit price only when the offer has a till price, the rule the
    // items' `cheapest` key follows (plan 0157). The lateral already prefers a
    // priced member, so this is null only for a group none of whose members has
    // a price here, which then ranks with the unpriced ones.
    const priced =
      scopeIds.length === 0
        ? 'NULL::numeric'
        : 'CASE WHEN o."price" IS NULL THEN NULL ELSE o."unitPrice" END';

    const rows: RankedGroupRow[] = await this.groups.query(
      `
      SELECT g."id", g."name", g."slug", g."referenceUnit", g."synonyms",
             ${
               scopeIds.length === 0
                 ? `NULL::uuid AS "offerItemId", NULL::uuid AS "offerScopeId",
                    NULL::numeric AS "offerPrice", NULL::varchar AS "offerCurrency",
                    NULL::numeric AS "offerUnitPrice", NULL::varchar AS "offerUnitPriceLabel",
                    NULL::timestamptz AS "offerObservedAt",
                    NULL::"price_source_kind" AS "offerSourceKind",
                    NULL::uuid AS "offerCopiedFromScopeId",
                    NULL::boolean AS "offerStale"`
                 : `o."itemId" AS "offerItemId", o."priceScopeId" AS "offerScopeId",
                    o."price" AS "offerPrice", o."currency" AS "offerCurrency",
                    o."unitPrice" AS "offerUnitPrice", o."unitPriceLabel" AS "offerUnitPriceLabel",
                    o."priceObservedAt" AS "offerObservedAt",
                    o."priceSourceKind" AS "offerSourceKind",
                    o."priceCopiedFromScopeId" AS "offerCopiedFromScopeId",
                    o."stale" AS "offerStale"`
             },
             round(${relevance}::numeric, 4) AS "relevance"
      FROM "product_groups" g${offerJoin}
      ${where}
      ORDER BY ${wholeWords}"relevance" DESC,
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
    const groupIds = page.map((row) => row.id);

    // The whole membership of every group on the page, which is what choosing one
    // attaches to a line, and the cheapest few as products when they were asked
    // for (plan 0161, section 2). One query each for the page rather than one per
    // group.
    const memberCount = Math.min(req.members ?? 0, PRODUCT_GROUP_MEMBERS_MAX);
    const [membership, ranked] = await Promise.all([
      this.membersOf(groupIds),
      memberCount > 0
        ? this.cheapestMembersOf(groupIds, scopeIds, memberCount)
        : Promise.resolve(undefined),
    ]);

    // The cheapest member as a full ItemView, in one query for the page. The
    // ranking already knows which product it is; this is what it looks like. The
    // ranked members are loaded by the same query.
    const cheapestIds = page
      .map((row) => row.offerItemId)
      .filter((id): id is string => id !== null);
    const itemIds = [
      ...new Set([
        ...cheapestIds,
        ...[...(ranked?.values() ?? [])].flat().map((row) => row.itemId),
      ]),
    ];
    const [members, offers] = await Promise.all([
      itemIds.length === 0
        ? Promise.resolve([] as Item[])
        : this.items.find({ where: { id: In(itemIds) } }),
      // Plan 0161, section 1: every scope's price for each cheapest member.
      req.offers === 'all' && scopeIds.length > 0
        ? this.allOffersFor(cheapestIds, scopeIds)
        : Promise.resolve(undefined),
    ]);
    const byId = new Map(members.map((item) => [item.id, item]));
    const view = await this.viewer(members);

    return {
      items: page.map((row) =>
        this.toOfferView(row, byId, membership.get(row.id) ?? [], {
          offers,
          members: ranked ? (ranked.get(row.id) ?? []) : undefined,
          view,
        })
      ),
      nextCursor: hasMore
        ? encodeCursor({
            order: 'relevance',
            locale,
            value: String(offset + limit),
            id: '',
          })
        : null,
    };
  }

  /**
   * The members of each of these groups, capped per group, in one query.
   *
   * The cap is applied **in the database** with a window function rather than by
   * slicing what came back, because the unbounded read is the thing worth
   * avoiding: ten groups on a page and no cap is ten whole product ranges pulled
   * out of Postgres to answer one keystroke.
   *
   * Ordered by English name, then id. Any deterministic order would do for the
   * cap to be stable, and this one also decides the order the products sit in on
   * the line the composer is about to create, where alphabetical is a better
   * answer than insertion order.
   */
  private async membersOf(groupIds: string[]): Promise<Map<string, string[]>> {
    if (groupIds.length === 0) {
      return new Map();
    }
    const p = params();
    const rows: { id: string; productGroupId: string }[] =
      await this.items.query(
        `
      SELECT "id", "productGroupId"
      FROM (
        SELECT i."id", i."productGroupId",
               row_number() OVER (
                 PARTITION BY i."productGroupId"
                 ORDER BY i."name" ->> 'en' ASC, i."id" ASC
               ) AS rn
        FROM "items" i
        WHERE i."productGroupId" = ANY(${p.bind(groupIds)})
      ) ranked
      WHERE rn <= ${p.bind(LINE_ITEM_SET_MAX)}
      ORDER BY "productGroupId" ASC, rn ASC
      `,
        p.values
      );

    const byGroup = new Map<string, string[]>();
    for (const row of rows) {
      const current = byGroup.get(row.productGroupId);
      if (current === undefined) {
        byGroup.set(row.productGroupId, [row.id]);
      } else {
        current.push(row.id);
      }
    }
    return byGroup;
  }

  /**
   * The cheapest `count` members of each group, as the card's reveal draws them
   * (plan 0161, section 2), in one query for the page.
   *
   * **The same keys as the lateral in {@link searchOffers}**, applied twice:
   * once to pick each member's own offer, and once to rank the members by it.
   * That is what makes the first member the group's `cheapestItem`: the lateral
   * takes the lowest row of the whole group by those keys, and the lowest of
   * every member's lowest row is that same row. A member with no offer at these
   * scopes sorts after every member that has one, by English name then id,
   * which is the order {@link membersOf} uses.
   *
   * Capped **in the database** with a window function, for the reason
   * {@link membersOf} gives: ten groups must not pull ten whole ranges out of
   * Postgres to answer one keystroke.
   */
  private async cheapestMembersOf(
    groupIds: string[],
    scopeIds: string[],
    count: number
  ): Promise<Map<string, RankedMemberRow[]>> {
    const byGroup = new Map<string, RankedMemberRow[]>();
    if (groupIds.length === 0) {
      return byGroup;
    }
    const p = params();
    // With no scopes there is no offer to join, and every member ranks by name.
    const offerJoin =
      scopeIds.length === 0
        ? ''
        : `
          LEFT JOIN LATERAL (
            SELECT si."priceScopeId", si."price", si."currency",
                   si."unitPrice", si."unitPriceLabel", si."priceObservedAt",
                   si."priceSourceKind", si."priceCopiedFromScopeId", si."stale"
            FROM "supermarket_items" si
            WHERE si."itemId" = i."id"
              AND si."priceScopeId" = ANY(${p.bind(scopeIds)})
              AND si."available"
            ORDER BY si."price" IS NULL ASC,
                     si."unitPrice" ASC NULLS LAST,
                     si."price" ASC NULLS LAST,
                     si."priceScopeId" ASC
            LIMIT 1
          ) o ON true`;
    const offerColumns =
      scopeIds.length === 0
        ? `NULL::uuid AS "offerScopeId",
           NULL::numeric AS "offerPrice", NULL::varchar AS "offerCurrency",
           NULL::numeric AS "offerUnitPrice", NULL::varchar AS "offerUnitPriceLabel",
           NULL::timestamptz AS "offerObservedAt",
           NULL::"price_source_kind" AS "offerSourceKind",
           NULL::uuid AS "offerCopiedFromScopeId",
           NULL::boolean AS "offerStale"`
        : `o."priceScopeId" AS "offerScopeId",
           o."price" AS "offerPrice", o."currency" AS "offerCurrency",
           o."unitPrice" AS "offerUnitPrice", o."unitPriceLabel" AS "offerUnitPriceLabel",
           o."priceObservedAt" AS "offerObservedAt",
           o."priceSourceKind" AS "offerSourceKind",
           o."priceCopiedFromScopeId" AS "offerCopiedFromScopeId",
           o."stale" AS "offerStale"`;
    const rank =
      scopeIds.length === 0
        ? `i."name" ->> 'en' ASC, i."id" ASC`
        : `o."price" IS NULL ASC,
           o."unitPrice" ASC NULLS LAST,
           o."price" ASC NULLS LAST,
           o."priceScopeId" IS NULL ASC,
           CASE WHEN o."priceScopeId" IS NULL THEN i."name" ->> 'en' END ASC,
           i."id" ASC`;

    const rows: (RankedMemberRow & { rn: string })[] = await this.items.query(
      `
      SELECT *
      FROM (
        SELECT i."id" AS "itemId", i."productGroupId", ${offerColumns},
               row_number() OVER (
                 PARTITION BY i."productGroupId"
                 ORDER BY ${rank}
               ) AS rn
        FROM "items" i${offerJoin}
        WHERE i."productGroupId" = ANY(${p.bind(groupIds)})
      ) ranked
      WHERE rn <= ${p.bind(count)}
      ORDER BY "productGroupId" ASC, rn ASC
      `,
      p.values
    );

    for (const row of rows) {
      const current = byGroup.get(row.productGroupId);
      if (current === undefined) {
        byGroup.set(row.productGroupId, [row]);
      } else {
        current.push(row);
      }
    }
    return byGroup;
  }

  private toOfferView(
    row: RankedGroupRow,
    members: Map<string, Item>,
    itemIds: string[],
    extra: {
      /** Every scope's offer per cheapest member, when `offers: 'all'`. */
      offers?: Map<string, ItemOfferView[]>;
      /** The ranked members, when `members` was asked for. */
      members?: RankedMemberRow[];
      /**
       * A member as a view, with its categories and barcodes, both loaded for
       * the page in one query each.
       */
      view: ItemViewer;
    }
  ): ProductGroupOfferView {
    const toView = extra.view;
    const group = toProductGroupView({
      id: row.id,
      name: row.name,
      slug: row.slug,
      referenceUnit: row.referenceUnit,
      synonyms: row.synonyms,
    } as ProductGroup);

    const member = row.offerItemId ? members.get(row.offerItemId) : undefined;
    const offer =
      member && row.offerScopeId
        ? rawOfferView(member.id, row.offerScopeId, row)
        : null;

    const view: ProductGroupOfferView =
      !member || !offer
        ? { group, cheapestItem: null, offer: null, itemIds }
        : {
            group,
            cheapestItem: extra.offers
              ? {
                  ...toView(member, offer),
                  // The group's own offer leads the array, so `bestOffer` is
                  // its first entry without being changed (plan 0161, section
                  // 1). The lateral ranks one product's rows by unit price
                  // before price and `allOffersFor` by price first; for one
                  // product the two almost always agree, and where they do not
                  // the offer the group was ranked by is the one that stays.
                  offers: [
                    offer,
                    ...(extra.offers.get(member.id) ?? []).filter(
                      (other) => other.priceScopeId !== offer.priceScopeId
                    ),
                  ],
                }
              : toView(member, offer),
            offer,
            itemIds,
          };

    if (extra.members === undefined) {
      return view;
    }
    const ranked: ItemView[] = [];
    for (const entry of extra.members) {
      const item = members.get(entry.itemId);
      if (!item) {
        // Deleted between the two reads. A missing product is left out rather
        // than drawn without a name.
        continue;
      }
      ranked.push(
        // `members[0]` is `cheapestItem` exactly: the same product by the
        // ranking, and the same offer even where two of its scopes tie.
        offer && item.id === offer.itemId && ranked.length === 0
          ? toView(item, offer)
          : toView(
              item,
              entry.offerScopeId
                ? rawOfferView(item.id, entry.offerScopeId, entry)
                : undefined
            )
      );
    }
    return { ...view, members: ranked };
  }

  /**
   * The cheapest price each of these items has at these scopes.
   *
   * `DISTINCT ON` rather than a group by with a self join: one pass, and the
   * ordering inside it is the definition of cheapest, which is
   * {@link orderOffers} and is the same for every caller (plan 0157).
   *
   * {@link search} used to rank by unit price here, and that is how a leaflet
   * row with no till price and a unit price of 2 was quoted over a Mercadona row
   * at 0,69 € with none, while the basket, ranking by price, quoted the
   * Mercadona row for the same product. Every row this picks between prices one
   * product, so the till price is the comparison, and a search result and a
   * basket line cannot name two different best offers.
   */
  private async offersFor(
    itemIds: string[],
    priceScopeIds?: string[]
  ): Promise<Map<string, ItemOfferView>> {
    const offers = new Map<string, ItemOfferView>();
    if (itemIds.length === 0 || !priceScopeIds || priceScopeIds.length === 0) {
      return offers;
    }
    const rows = await orderOffers(
      this.prices
        .createQueryBuilder('si')
        .distinctOn(['si."itemId"'])
        .where('si."itemId" IN (:...itemIds)', { itemIds })
        .andWhere('si."priceScopeId" IN (:...scopeIds)', {
          scopeIds: priceScopeIds,
        })
        .andWhere('si."available"')
    ).getMany();
    for (const row of rows) {
      offers.set(row.itemId, toItemOfferView(row));
    }
    return offers;
  }

  /**
   * Every price each of these items has at these scopes, cheapest first (plan
   * 0109, section 2).
   *
   * {@link offersFor} without the `DISTINCT ON`, and that is the whole of the
   * difference: the same rows, the same `available` filter, the same ordering,
   * and nothing thrown away. It exists because the cheapest offer is the right
   * answer to "what will this cost" and cannot answer "what does this shop
   * charge": a product a chain stocks but is cheaper elsewhere has no row in the
   * collapsed answer at all, so a filter built on it silently drops exactly the
   * products it was asked about.
   *
   * Ranked by {@link orderOffers}, the ordering {@link offersFor} uses: this
   * quotes what the till charges (plan 0066, section 2.1), and the caller reads
   * the first entry as the cheapest.
   *
   * Unpaged, and bounded by the caller: a basket of forty lines against ten
   * scopes is four hundred rows in one query, which is less than the product
   * detail the same read already carries.
   */
  private async allOffersFor(
    itemIds: string[],
    priceScopeIds?: string[]
  ): Promise<Map<string, ItemOfferView[]>> {
    const offers = new Map<string, ItemOfferView[]>();
    if (itemIds.length === 0 || !priceScopeIds || priceScopeIds.length === 0) {
      return offers;
    }
    const rows = await orderOffers(
      this.prices
        .createQueryBuilder('si')
        .where('si."itemId" IN (:...itemIds)', { itemIds })
        .andWhere('si."priceScopeId" IN (:...scopeIds)', {
          scopeIds: priceScopeIds,
        })
        // A row that says the product is not on the shelf is absent rather than
        // listed as unavailable, exactly as it is from the cheapest answer, so
        // "no row" is the client's one way of reading "not sold here".
        .andWhere('si."available"')
    ).getMany();
    for (const row of rows) {
      const list = offers.get(row.itemId);
      if (list) {
        list.push(toItemOfferView(row));
      } else {
        offers.set(row.itemId, [toItemOfferView(row)]);
      }
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
    const match = this.rankedMatch(req, term, p, true);
    const { query, raw, barcode } = match;
    // The same test as a ranking key, with the two things SQL three valued logic
    // does to it spelled out.
    //
    // **`NULLS LAST`, because most products have no barcode at all**, and
    // `NULL = '8480000181077'` is NULL rather than false. A descending sort puts
    // nulls first by default, so without this every unbarcoded text match would
    // rank above the very product that was scanned.
    //
    // **Written only when there is a barcode to rank on**: Postgres refuses a
    // bare constant in `ORDER BY`, so the `false` that is harmless in the filter
    // is a syntax error here. Leaving the key out is the same ordering anyway,
    // since a key every row ties on decides nothing.
    const barcodeKey =
      term.ean === null ? '' : `(${barcode}) DESC NULLS LAST,\n               `;
    // Unit price is the last ranking key, so it is joined even when the caller
    // asked for no prices in the answer: with no scopes there is nothing to join
    // and every row sorts as unpriced, which is the same order.
    //
    // Only over rows with a till price (plan 0157). A leaflet row with no price
    // and a unit price of 2 is not an offer, so a product whose only cheap unit
    // price is one of those ranks by its priced rows, or with the unpriced.
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
              AND si."price" IS NOT NULL
          )`;

    return this.items.query(
      `
      SELECT i.*
      FROM "items" i
      WHERE ${rankedWhereSql(match, term, p.bind)}
      ORDER BY ${barcodeKey}(${wholeWordMatchSql(
        ITEM_SEARCH_TEXT,
        term.words,
        p.bind
      )}) DESC,
               ${brandTypedSql('i."brand"', term.words, p.bind)} DESC,
               round(GREATEST(
                 ts_rank(i."search_es", to_tsquery('spanish', ${query}), 1),
                 ts_rank(i."search_en", to_tsquery('english', ${query}), 1),
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
   * How many products the ranked branch matches (plan 0187): the `WHERE` of
   * {@link rankedItems}, from the same two functions, with no ordering, no
   * limit and no offset.
   *
   * No ordering is also why this statement does not always read the text as
   * typed, so it tells {@link rankedMatch} that only the filter is written.
   */
  private async rankedCount(
    req: SearchItemsRequest,
    term: SearchTerm
  ): Promise<number> {
    const p = params();
    const match = this.rankedMatch(req, term, p, false);
    const rows: { total: string }[] = await this.items.query(
      `
      SELECT count(*) AS "total"
      FROM "items" i
      WHERE ${rankedWhereSql(match, term, p.bind)}
      `,
      p.values
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * What {@link rankedItems} and {@link rankedCount} both match on.
   *
   * `ordered` says that the caller writes the ranking keys after the filter.
   * The page does and its count does not, and that decides one binding: see
   * the text as typed, below.
   */
  private rankedMatch(
    req: SearchItemsRequest,
    term: SearchTerm,
    p: ReturnType<typeof params>,
    ordered: boolean
  ): RankedMatch {
    // Through `catalog_norm` before the stemmer, because the item documents are
    // built from normalized text (plan 0156). The group search binds the same
    // tsquery unnormalized, since group documents still keep their accents.
    const query = `"catalog_norm"(${p.bind(term.tsquery)})`;
    // The text as typed is read by the ranking keys and by the fuzzy branch,
    // and by nothing else. A count has no ranking keys, so under four
    // characters, where the fuzzy branch is not written, no part of the count
    // names it. Postgres cannot type a parameter that the statement never
    // mentions, and it refuses the whole statement (42P18), so the text is
    // bound only for a statement that reads it. The page always does, which
    // leaves its text and its bind order as they were.
    const raw = ordered || term.fuzzy ? p.bind(term.raw) : '';
    // The barcode test, bound once and spent in both the filter and the
    // ordering, or the constant `false` when the query is words. A barcode names
    // one product, so the row carrying it is not merely the most relevant
    // answer, it is the answer, and it has to beat a text hit that scored above
    // the zero an all digit query earns from `ts_rank`.
    //
    // Any barcode of the product (plan 0185). The first test keeps an old
    // in-store code on `items.ean` findable by the person who pastes it, and
    // the second reads `item_eans` once for the whole statement.
    const barcode =
      term.ean === null ? 'false' : barcodeMatchSql(p.bind(term.ean));
    // The fuzzy branch, or nothing at all when the query is too short for
    // trigram distance to mean anything. It is the one part of the filter the
    // literal recheck is not applied to, and that is the point of it: a
    // misspelling has no literal occurrence to find.
    //
    // The threshold is bound inside the branch rather than beside the other
    // parameters, because a `$n` that no part of the statement mentions is a
    // bind error and not a harmless extra.
    const fuzzy = term.fuzzy
      ? `OR similarity(coalesce(i."brand", ''), ${raw}) > ${p.bind(
          TRIGRAM_THRESHOLD
        )}
        OR similarity(i."name" ->> 'es', ${raw}) > ${p.bind(TRIGRAM_THRESHOLD)}
        OR similarity(i."name" ->> 'en', ${raw}) > ${p.bind(TRIGRAM_THRESHOLD)}`
      : '';

    const filters: string[] = [];
    if (req.categoryId) {
      filters.push(underCategorySql(p.bind(req.categoryId)));
    }
    if (req.productGroupId) {
      filters.push(`i."productGroupId" = ${p.bind(req.productGroupId)}::uuid`);
    }
    // Plan 0073, section 4, applied on both branches: an operator who types a
    // word while filtering to the ungrouped products means both, and a filter
    // that silently stopped applying when the ordering changed would be worse
    // than one that was never offered.
    if (req.withoutProductGroup) {
      filters.push('i."productGroupId" IS NULL');
    }
    // Admin plan 0043, on both branches for the reason the flag above gives.
    if (req.withoutCategory) {
      filters.push(WITHOUT_CATEGORY_SQL);
    }
    // Plan 0146: which chains sell the product, which is not what the scopes
    // below decide. Empty is the same as absent, so a person who cleared the
    // chain chips reads the catalog rather than an empty page.
    if (req.soldBy?.length) {
      filters.push(soldByChainSql(p.bind(req.soldBy)));
    }
    // Plan 0187: what this scope shows no price for, on both branches.
    if (req.withoutPriceAtScopeId !== undefined) {
      filters.push(withoutPriceAtScopeSql(p.bind(req.withoutPriceAtScopeId)));
    }
    return { query, raw, barcode, fuzzy, filters };
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
    locale: SupportedLocale,
    limit: number,
    cursor?: ItemCursor
  ): Promise<Item[]> {
    const qb = this.listedMatch(req, term).take(limit + 1);
    this.applyOrder(qb, order, locale, cursor);
    return qb.getMany();
  }

  /**
   * How many products the listing branch matches (plan 0187): the filters of
   * {@link listedItems} with no order and no cursor, so the number is of the
   * whole request on every page of it.
   */
  private async listedCount(
    req: SearchItemsRequest,
    term: SearchTerm | null
  ): Promise<number> {
    const row = await this.listedMatch(req, term)
      .select('count(*)', 'total')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /** What {@link listedItems} and {@link listedCount} both match on. */
  private listedMatch(
    req: SearchItemsRequest,
    term: SearchTerm | null
  ): SelectQueryBuilder<Item> {
    const qb = this.items.createQueryBuilder('i');
    if (term) {
      // The same filter the ranked branch applies, named parameters apart. It is
      // written twice because the two branches assemble their SQL differently,
      // and it has to stay one rule: an admin who narrows a table by a word and
      // then sorts it by name is asking for an ordering, not for a wider search.
      const words: Record<string, string> = {};
      const literal = literalMatchSql(ITEM_SEARCH_TEXT, term.words, (value) => {
        const name = `word${Object.keys(words).length}`;
        words[name] = String(value);
        return `:${name}`;
      });
      const fuzzy = term.fuzzy
        ? `OR similarity(coalesce(i."brand", ''), :raw) > :threshold
           OR similarity(i."name" ->> 'es', :raw) > :threshold
           OR similarity(i."name" ->> 'en', :raw) > :threshold`
        : '';
      qb.andWhere(
        `(
          ${term.ean === null ? 'false' : barcodeMatchSql(':ean')}
          OR (
            (
              i."search_es" @@ to_tsquery('spanish', "catalog_norm"(:tsquery))
              OR i."search_en" @@ to_tsquery('english', "catalog_norm"(:tsquery))
            )
            AND ${literal}
          )
          ${fuzzy}
        )`,
        {
          tsquery: term.tsquery,
          raw: term.raw,
          ...words,
          ...(term.fuzzy ? { threshold: TRIGRAM_THRESHOLD } : {}),
          // The barcode filters here too, so an admin who pastes one into a
          // table ordered by name finds the product rather than an empty table.
          // Only the ordering is the ranked branch's alone.
          ...(term.ean === null ? {} : { ean: term.ean }),
        }
      );
    }
    if (req.categoryId) {
      // The same rule the ranked branch applies, from the same function.
      qb.andWhere(underCategorySql(':categoryId'), {
        categoryId: req.categoryId,
      });
    }
    if (req.productGroupId) {
      qb.andWhere('i."productGroupId" = :groupId', {
        groupId: req.productGroupId,
      });
    }
    if (req.withoutProductGroup) {
      // Plan 0073, section 4: what curation has not reached. Applied beside the
      // group filter rather than instead of it, so asking for both answers with
      // nothing, which is what the two clauses together mean.
      qb.andWhere('i."productGroupId" IS NULL');
    }
    if (req.withoutCategory) {
      // Admin plan 0043: the products on no category at all. Beside a
      // category it answers nothing, which is what the two together mean.
      qb.andWhere(WITHOUT_CATEGORY_SQL);
    }
    if (req.soldBy?.length) {
      // The same rule the ranked branch applies, from the same function: the
      // chain chips must not stop narrowing the moment somebody types a word.
      qb.andWhere(soldByChainSql(':soldBy'), { soldBy: req.soldBy });
    }
    if (req.withoutPriceAtScopeId !== undefined) {
      // Plan 0187, from the same function as the ranked branch: a word typed
      // into the worklist narrows the worklist.
      qb.andWhere(withoutPriceAtScopeSql(':withoutPriceAtScopeId'), {
        withoutPriceAtScopeId: req.withoutPriceAtScopeId,
      });
    }
    return qb;
  }

  private nextCursor(
    order: ItemOrder,
    locale: SupportedLocale,
    cursor: ItemCursor | undefined,
    limit: number,
    last: Item
  ): string {
    if (order === 'relevance') {
      const offset = Number(cursor?.value ?? 0) || 0;
      return encodeCursor({
        order,
        locale,
        value: String(offset + limit),
        id: '',
      });
    }
    return encodeCursor({
      order,
      locale,
      value: this.cursorValue(order, locale, last),
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
  /**
   * A file that names one EAN twice is a file that contradicts itself.
   *
   * Postgres would refuse the second insert anyway, since EAN is unique when
   * present, and the batch would fail as a whole with the driver's message.
   * Saying it here names both products instead, before anything is written.
   */
  private refuseRepeatedEans(items: readonly CreateItemInput[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      const ean = item.ean?.trim();
      if (!ean) {
        continue;
      }
      if (seen.has(ean)) {
        throw new ValidationException(
          `Two products of this request carry EAN ${ean}. An EAN names one ` +
            'product, so one of the two is the same product written twice.'
        );
      }
      seen.add(ean);
    }
  }

  private async resolveGroup(
    productGroupId: string | null
  ): Promise<string | null> {
    if (productGroupId === null) {
      return null;
    }
    const group = await this.productGroups.load(productGroupId);
    return group.id;
  }

  /**
   * The scope a worklist names, checked to exist (plan 0187).
   *
   * The 404 the price scope read answers, in the same words. An id that is
   * not a uuid names no scope either, and is refused here rather than failing
   * the cast in the statement.
   */
  private async requirePriceScope(priceScopeId: string): Promise<void> {
    const found: unknown[] = isUuid(priceScopeId)
      ? await this.items.query(
          'SELECT 1 FROM "price_scopes" WHERE "id" = $1::uuid LIMIT 1',
          [priceScopeId]
        )
      : [];
    if (found.length === 0) {
      throw new NotFoundException('Price scope not found');
    }
  }

  private async load(id: string): Promise<Item> {
    const row = await this.items.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Item not found');
    }
    return row;
  }

  /**
   * Several products by id, in the order asked for, or a 404 naming the first
   * that is missing. One product is the lookup {@link update} always made; more
   * are one query, because a bulk edit of a thousand rows must not be a
   * thousand round trips before it writes anything.
   */
  private async loadInOrder(ids: readonly string[]): Promise<Item[]> {
    if (ids.length === 1) {
      return [await this.load(ids[0])];
    }
    const found = await this.items.find({
      where: { id: In(ids.filter((id) => isUuid(id))) },
    });
    const byId = new Map(found.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row) {
        throw new NotFoundException(`Item ${id} not found`);
      }
      return row;
    });
  }

  /**
   * What turns these products into views: their categories and their
   * barcodes, each read in one query for all of them. Every read and every
   * write answer goes through it, so no view leaves without either.
   */
  private async viewer(rows: readonly Item[]): Promise<ItemViewer> {
    const ids = rows.map((row) => row.id);
    const [categories, eans] = await Promise.all([
      this.categories.categoriesOf(ids),
      this.eans.eansOf(ids),
    ]);
    return (row, offer) =>
      toItemView(
        row,
        categories.get(row.id) ?? [],
        orderedEans(row.ean, eans.get(row.id) ?? []),
        offer
      );
  }

  /** The barcode a request names, trimmed, or a refusal. Never null. */
  private requireEan(ean: string): string {
    const code = requireProductEan(ean);
    if (code === null) {
      throw new ValidationException('A barcode is required.');
    }
    return code;
  }

  /**
   * Give `row` the barcode, inside the caller's transaction (plan 0185).
   *
   * Three answers: written, already this product's (nothing to do), or held by
   * another product, which is named and not written. A product with no first
   * barcode takes this one as its first.
   */
  private async giveEan(
    tx: AuditedWrite,
    row: Item,
    ean: string
  ): Promise<{ added: boolean; heldBy: string | null }> {
    const holder = await this.eans.holder(tx.manager, ean);
    if (holder === row.id) {
      return { added: false, heldBy: null };
    }
    if (holder !== null) {
      return { added: false, heldBy: holder };
    }
    await this.eans.insert(tx.manager, row.id, ean);
    if (row.ean === null) {
      const before = { ...row };
      row.ean = ean;
      await tx.update(Item, before, row);
    }
    return { added: true, heldBy: null };
  }

  /** The barcode a product has held longest, or null for a product with none. */
  private async oldestEan(
    tx: AuditedWrite,
    itemId: string
  ): Promise<string | null> {
    return (
      (await this.eans.eansOf([itemId], tx.manager)).get(itemId)?.[0] ?? null
    );
  }

  /**
   * Keep `item_eans` in step with an edit that changed `items.ean` (plan
   * 0185), inside the edit's own transaction and before the product is saved.
   *
   * The `ean` field of an update is the product's **first** barcode. Three
   * cases:
   *
   * - **A barcode the product already holds** is a reorder. It becomes the
   *   first, and the old first barcode stays one of the product's barcodes.
   * - **A barcode the product does not hold** replaces the first one: the old
   *   first barcode is taken off the product and the new one is given to it.
   *   The product's further barcodes are not touched.
   * - **Null** takes the first barcode off and promotes the oldest of the
   *   rest, so `items.ean` is never empty while the product holds a barcode.
   */
  private async moveFirstEan(
    tx: AuditedWrite,
    before: Item,
    row: Item,
    eanTaken: string
  ): Promise<void> {
    if (row.ean === before.ean) {
      return;
    }
    const holder =
      row.ean === null ? null : await this.eans.holder(tx.manager, row.ean);
    if (holder === row.id) {
      // A reorder: nothing leaves the product.
      return;
    }
    if (holder !== null) {
      // One of another product's barcodes. `uq_items_ean` cannot see it when
      // it is not that product's `items.ean`.
      throw new ConflictException(eanTaken);
    }
    if (before.ean) {
      await this.eans.remove(tx.manager, row.id, before.ean);
    }
    if (row.ean === null) {
      row.ean = await this.oldestEan(tx, row.id);
      return;
    }
    await this.eans.insert(tx.manager, row.id, row.ean);
  }

  /**
   * The one path every product edit takes, a single {@link update} and each
   * entry of {@link updateMany} alike, in one transaction.
   *
   * Every validating read happens first and in as few queries as the request
   * allows: the products, the brand keys and the leaves each in one. Then every
   * edit is written, its categories replaced where it names them, and the group
   * moves are announced after the commit, one per product whose group moved.
   */
  private async applyUpdates(
    actor: CatalogActor,
    inputs: readonly UpdateItemInput[],
    eanTaken: string
  ): Promise<ItemView[]> {
    const rows = await this.loadInOrder(inputs.map((input) => input.itemId));
    const branded = inputs.filter((input) => input.brand !== undefined);
    const registered =
      branded.length === 0
        ? new Map<string, Brand>()
        : await this.registeredBrands(branded.map((input) => input.brand));
    const named = inputs
      .map((input) => input.categoryIds)
      .filter((ids): ids is string[] => ids !== undefined);
    const leavesOf =
      named.length === 0 ? null : await this.categories.leaveChecker(named);

    const edits: {
      row: Item;
      before: Item;
      groupBefore: string | null;
      leaves: Category[] | null;
    }[] = [];
    for (const [index, input] of inputs.entries()) {
      const row = rows[index];
      const before = { ...row };
      const groupBefore = row.productGroupId;
      await this.applyEdits(row, input, registered);
      const leaves =
        input.categoryIds === undefined || leavesOf === null
          ? null
          : leavesOf(input.categoryIds);
      edits.push({ row, before, groupBefore, leaves });
    }

    // An edit reaches the same unique index a create does, because a barcode
    // typed onto this product can be one another product already carries.
    let saved: Item[];
    try {
      saved = await this.audit.write(actor, async (tx) => {
        const written: Item[] = [];
        for (const edit of edits) {
          await this.moveFirstEan(tx, edit.before, edit.row, eanTaken);
          written.push(await tx.update(Item, edit.before, edit.row));
          if (edit.leaves !== null) {
            await this.categories.setItemCategories(
              tx.manager,
              edit.row.id,
              edit.leaves
            );
          }
        }
        return written;
      });
    } catch (error) {
      throw asEanConflict(error, eanTaken);
    }

    for (const [index, row] of saved.entries()) {
      const groupBefore = edits[index].groupBefore;
      if (row.productGroupId !== groupBefore) {
        this.events.itemGroupChanged(row.id, groupBefore, row.productGroupId);
      }
    }
    // The products whose set did not change answer with the set they hold.
    const [held, eans] = await Promise.all([
      this.categories.categoriesOf(
        saved
          .filter((_, index) => edits[index].leaves === null)
          .map((row) => row.id)
      ),
      this.eans.eansOf(saved.map((row) => row.id)),
    ]);
    return saved.map((row, index) => {
      const leaves = edits[index].leaves;
      return toItemView(
        row,
        leaves === null
          ? (held.get(row.id) ?? [])
          : leaves.map(toCategoryOnItem),
        orderedEans(row.ean, eans.get(row.id) ?? [])
      );
    });
  }

  /** One product's edit onto its row, every field the request names. */
  private async applyEdits(
    row: Item,
    input: UpdateItemInput,
    registered: ReadonlyMap<string, Brand>
  ): Promise<void> {
    if (input.name !== undefined) {
      row.name = input.name;
    }
    if (input.brand !== undefined) {
      this.applyBrand(row, input.brand, registered);
    }
    if (input.imageUrl !== undefined) {
      row.imageUrl = input.imageUrl;
    }
    if (input.sku !== undefined) {
      row.sku = input.sku;
    }
    // Checked only when the write changes the barcode (plan 0184). A product
    // that already holds an in-store or invalid code still saves: the rule is
    // about a code being set, not about one that is already there. The back
    // office sends only the fields that changed, so it never meets this. A
    // client that sends the whole product back does, and refusing its
    // unchanged EAN would lock the product against every other edit.
    if (input.ean !== undefined && input.ean !== row.ean) {
      row.ean = requireProductEan(input.ean);
    }
    if (input.unitSize !== undefined) {
      row.unitSize = input.unitSize;
    }
    if (input.packCount !== undefined) {
      row.packCount = input.packCount;
    }
    if (input.defaultUnit !== undefined) {
      row.defaultUnit = input.defaultUnit;
    }
    if (input.productGroupId !== undefined) {
      row.productGroupId = await this.resolveGroup(input.productGroupId);
    }
  }

  /**
   * The brand each of the given texts belongs to, by key (plan 0115, section 4,
   * and plan 0124, section 4.1).
   *
   * **One query for a whole batch**, which is why it takes a list rather than a
   * string: `createMany` resolves every distinct key of the file at once, and a
   * per product lookup would be a thousand round trips for a registry of a few
   * hundred rows. A single write calls it with one text, which is the same code
   * path with a list of one.
   *
   * The value is the **canonical** brand of the row a key found, not the row
   * itself, because that is what a product belongs to: a text printed
   * `DEBORAH 48H` reads `Deborah` from the moment somebody says the two are one
   * brand. One extra query for the canonical brands of whatever the first query
   * found, and only when something it found is linked.
   */
  private async registeredBrands(
    texts: readonly (string | null | undefined)[]
  ): Promise<ReadonlyMap<string, Brand>> {
    const keys = [
      ...new Set(
        texts
          .map((text) => brandKey(text))
          .filter((key): key is string => key !== null)
      ),
    ];
    if (keys.length === 0) {
      return new Map();
    }
    const rows = await this.brands.find({ where: { key: In(keys) } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = [
      ...new Set(
        rows
          .map((row) => row.canonicalBrandId)
          .filter((id): id is string => Boolean(id) && !byId.has(id as string))
      ),
    ];
    if (missing.length > 0) {
      for (const canonical of await this.brands.find({
        where: { id: In(missing) },
      })) {
        byId.set(canonical.id, canonical);
      }
    }
    return new Map(
      rows.map((row) => [
        row.key,
        (row.canonicalBrandId ? byId.get(row.canonicalBrandId) : row) ?? row,
      ])
    );
  }

  /**
   * The three brand columns for one written product (plan 0115, section 4).
   *
   * The one step `create`, `createMany` and `update` share, and the four cases
   * of the section, in order:
   *
   * 1. A text with no letters or digits has no key, so the product has no
   *    brand: all three columns are null. `-` and `---` from a LIDL leaflet
   *    reach here and need no special case of their own.
   * 2. A registered key stores that brand's **label**, whatever spelling the
   *    request sent, so `MAHOU` from a Carrefour accept is stored as `Mahou`.
   *    The label is copied onto `brand` rather than joined at read time because
   *    the search trigger, the trigram index and the ranking all read that
   *    column. When the key belongs to a spelling of another brand, the id and
   *    the label are the **canonical** brand's (plan 0124, section 4.1), while
   *    `brandKey` stays the key of the text as printed: that key is the only
   *    thing that can bring this product back if the link is ever undone.
   * 3. An unregistered brand is **still accepted**, trimmed, with its key beside
   *    it and no `brandId`. Refusing it is the curator's decision (curation plan
   *    `0004`) and not the catalog's: a person creating a product by hand in the
   *    back office has to be able to.
   */
  private applyBrand(
    row: Pick<Item, 'brand' | 'brandKey' | 'brandId'>,
    brand: string | null | undefined,
    registered: ReadonlyMap<string, Brand>
  ): void {
    const text = brand?.trim() ?? null;
    const key = brandKey(text);
    if (key === null) {
      row.brand = null;
      row.brandKey = null;
      row.brandId = null;
      return;
    }
    const held = registered.get(key);
    row.brand = held ? held.label : (text as string);
    row.brandKey = key;
    row.brandId = held ? held.id : null;
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
    locale: SupportedLocale,
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
      qb.orderBy(displayNameSql('i', locale), 'ASC').addOrderBy('i.id', 'ASC');
      if (cursor) {
        qb.andWhere(`(${displayNameSql('i', locale)}, i.id) > (:cv, :cid)`, {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(
    order: ItemOrder,
    locale: SupportedLocale,
    row: Item
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

/** A product as a view, with what the page's two lookups found for it. */
type ItemViewer = (row: Item, offer?: ItemOfferView) => ItemView;

/**
 * A product's barcodes in the order a view lists them (plan 0185): the first
 * barcode, then the rest, oldest first.
 *
 * `held` is the product's rows of `item_eans`. `items.ean` leads when it is
 * one of them, which it always is unless it is an old in-store or invalid
 * code. Such a code is in no row, so it is not in the list either.
 */
function orderedEans(first: string | null, held: readonly string[]): string[] {
  return first !== null && held.includes(first)
    ? [first, ...held.filter((ean) => ean !== first)]
    : [...held];
}

/** The barcodes of a product that was just created: its first one, or none. */
function firstEanOf(row: Pick<Item, 'ean'>): string[] {
  return row.ean ? [row.ean] : [];
}

/**
 * Whether the product aliased `i` carries the barcode `placeholder` names, as
 * its first barcode or as any other (plan 0185).
 *
 * The scalar subquery runs once for the statement and is one primary key
 * lookup. It answers NULL when no product holds the barcode, so the whole test
 * is NULL for every row whose own `ean` does not match, which the ranked
 * branch's `NULLS LAST` already expects.
 */
function barcodeMatchSql(placeholder: string): string {
  return `(i."ean" = ${placeholder} OR i."id" = (
          SELECT ie."itemId" FROM "item_eans" ie WHERE ie."ean" = ${placeholder}
        ))`;
}

/** The refusal of a barcode another product holds (plan 0185). */
function eanHeld(ean: string, heldBy: string): ItemEanHeldException {
  return new ItemEanHeldException(
    `Product ${heldBy} already holds the barcode ${ean}. A barcode names ` +
      'one product, so take it off that product first.',
    { details: { [ITEM_EAN_DETAIL]: ean, [ITEM_EAN_HOLDER_DETAIL]: heldBy } }
  );
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * What a duplicate barcode means, in the words of the write that met it.
 *
 * Three sentences and not one, because what the operator can do about it
 * differs: a batch landed nothing at all, a create landed nothing, and an edit
 * left the product as it was. A single message would have to leave out which.
 */
function eanTakenInBatch(ean: string | null): string {
  // The barcode, because "one of these products" in a file of a thousand
  // leaves the operator to find which (plan 0158).
  const which = ean
    ? `A product of this batch carries EAN ${ean}, which the catalog ` +
      'already holds'
    : 'One of these products carries an EAN the catalog already holds';
  return (
    `${which}, so none of them were created. Bind that row onto the ` +
    'product that has the barcode instead of creating a second one.'
  );
}

/**
 * The barcode a unique violation on `uq_items_ean` names. Postgres writes it
 * into the error's detail as `Key (ean)=(8480000123456) already exists.`
 */
function takenEanOf(error: unknown): string | null {
  const detail = (error as { driverError?: { detail?: unknown } })?.driverError
    ?.detail;
  if (typeof detail !== 'string') {
    return null;
  }
  return /\(ean\)=\(([^)]+)\)/.exec(detail)?.[1] ?? null;
}

const EAN_TAKEN_ON_CREATE =
  'The catalog already holds a product with this EAN, so nothing was ' +
  'created. Bind onto the product that has the barcode instead of creating ' +
  'a second one.';

const EAN_TAKEN_ON_UPDATE =
  'Another product in the catalog already holds this EAN, so nothing was ' +
  'changed. A barcode names one product, so take it off that product first.';

const EAN_TAKEN_IN_UPDATE_BATCH =
  'One of these edits types an EAN another product already holds, so none ' +
  'of them were applied. A barcode names one product, so take it off that ' +
  'product first.';

/**
 * The one way writing a product fails that an operator can act on.
 *
 * EAN is unique when present, so a product the catalog already holds under the
 * same barcode refuses the write, and in a batch takes every other row with it.
 * The driver message names a constraint; this names the thing to do about it.
 *
 * **Every write that can reach `uq_items_ean` goes through here.** Unguarded,
 * the `QueryFailedError` reaches `GlobalExceptionFilter` as an unclassified
 * error and the operator is told 500 "Something went wrong on our side" for a
 * barcode they can see and fix. `create` and `update` were unguarded until the
 * curation toolchain met the 500 fifteen times in one run.
 */
function asEanConflict(error: unknown, message: string): unknown {
  if (
    error instanceof QueryFailedError &&
    (error as { driverError?: { code?: string } }).driverError?.code ===
      PG_UNIQUE_VIOLATION
  ) {
    return new ConflictException(message);
  }
  return error;
}

/**
 * The one definition of "the best offer" for one product (plan 0157), applied
 * to a query over `supermarket_items` aliased `si`.
 *
 * **A row with a till price first, before any other key.** A leaflet row can
 * carry a unit price and no price, on purpose (plan 0081): a per kilo tile or
 * a conditional promotion is information, and it is not an offer anybody can
 * pay. Then the price, then the unit price for two rows at one price, then the
 * scope id, so that two equal rows cannot swap places between the search read
 * and the basket read of the same product.
 */
function orderOffers(
  query: SelectQueryBuilder<SupermarketItem>
): SelectQueryBuilder<SupermarketItem> {
  return query
    .orderBy('si."itemId"', 'ASC')
    .addOrderBy('si."price" IS NULL', 'ASC')
    .addOrderBy('si."price"', 'ASC', 'NULLS LAST')
    .addOrderBy('si."unitPrice"', 'ASC', 'NULLS LAST')
    .addOrderBy('si."priceScopeId"', 'ASC');
}

/**
 * The offer columns a raw query aliases with an `offer` prefix, as Postgres
 * hands them back: numerics as strings.
 */
interface RawOfferColumns {
  offerPrice: string | null;
  offerCurrency: string | null;
  offerUnitPrice: string | null;
  offerUnitPriceLabel: string | null;
  offerObservedAt: string | Date | null;
  offerSourceKind: SupermarketItem['priceSourceKind'];
  offerCopiedFromScopeId: string | null;
  offerStale: boolean | null;
}

/** One offer out of a raw query's `offer` columns. */
function rawOfferView(
  itemId: string,
  priceScopeId: string,
  row: RawOfferColumns
): ItemOfferView {
  return {
    itemId,
    priceScopeId,
    price: row.offerPrice === null ? null : Number(row.offerPrice),
    currency: row.offerCurrency,
    unitPrice: row.offerUnitPrice === null ? null : Number(row.offerUnitPrice),
    unitPriceLabel: row.offerUnitPriceLabel,
    unitBasis: unitBasisOf(row.offerUnitPriceLabel),
    observedAt: row.offerObservedAt
      ? new Date(row.offerObservedAt).toISOString()
      : null,
    sourceKind: row.offerSourceKind ?? null,
    priceCopiedFromScopeId: row.offerCopiedFromScopeId ?? null,
    stale: row.offerStale ?? false,
  };
}

/** One member of a group, ranked for the card's reveal (plan 0161). */
interface RankedMemberRow extends RawOfferColumns {
  itemId: string;
  productGroupId: string;
  offerScopeId: string | null;
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
  offerCopiedFromScopeId: string | null;
  offerStale: boolean | null;
}
