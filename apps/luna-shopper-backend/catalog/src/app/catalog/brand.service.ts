import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BrandBatchOutcome,
  brandKey,
  type BrandIdRequest,
  type BrandKeysRequest,
  type BrandKeysResult,
  type BrandPage,
  type BrandView,
  type CreateBrandRequest,
  type CreateBrandResult,
  type DeleteBrandRequest,
  type DeleteBrandResult,
  type ListBrandsRequest,
  type RegisterBrandsOutcome,
  type RegisterBrandsRequest,
  type RegisterBrandsResult,
  type RegisterBrandSuggestionRequest,
  type RegisterBrandSuggestionResult,
  type UpdateBrandRequest,
  type UpdateBrandResult,
} from '@portfolio/luna-shopper/contracts';
import {
  BRAND_KEY_HOLDER_DETAIL,
  BRAND_LINK_BLOCKER_DETAIL,
  BrandKeyTakenException,
  BrandLabelEmptyException,
  BrandLinkKeepsKeyException,
  BrandLinkOwnsNoChainException,
  BrandLinkTooDeepException,
  BrandLinkToSelfException,
  BrandNotLinkedException,
  clampPageSize,
  decodeCursor,
  DomainException,
  encodeCursor,
  ERROR_CODES,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';
import { Brand, Item } from '../entities';
import {
  CatalogAuditService,
  type AuditedWrite,
} from './catalog-audit.service';
import { toBrandView, type BrandCounts } from './catalog.mappers';
import {
  PlatformAdminService,
  type CatalogActor,
} from './platform-admin.service';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

/** A brand row with the page's counts and its canonical brand's label attached. */
interface BrandRow {
  id: string;
  key: string;
  label: string;
  privateLabelSupermarketId: string | null;
  canonicalBrandId: string | null;
  canonicalLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  linkCount: number;
}

/**
 * Where the reader stopped, under whichever order it was reading.
 *
 * The order travels in the cursor, as every other catalog cursor does, so a
 * caller that resends a different `order` mid walk keeps the page it was on
 * rather than silently jumping into a different sequence.
 */
type BrandCursor = {
  order: 'label' | 'itemCount';
  /** The label, or the item count as a string. */
  value: string;
  id: string;
};

/**
 * The registry of brands a person fills (plan 0115).
 *
 * Three things about this service are the plan rather than an implementation
 * detail:
 *
 * - **The key follows the label.** `key` is never a field of a request. It is
 *   `brandKey(label)`, recomputed on every write, so editing `Hacenado` to
 *   `Hacendado` is the only way its key becomes `hacendado`.
 * - **Registering a brand claims the products already carrying its key**, and a
 *   rename rewrites `items.brand` on everything linked to it. That copy is
 *   deliberate: the search trigger and the trigram index read `items.brand`, so
 *   keeping the label there means neither of them changes.
 * - **Items linked under an old key stay linked.** They were this brand, and a
 *   corrected spelling does not change that.
 *
 * Plan 0124 adds one more, and it is the reason for every lock in this file:
 *
 * - **A brand may be a spelling of another brand, one level deep.** A link
 *   never points at a linked brand, and a brand others point at is never linked
 *   itself. Neither half can be checked by a constraint, because both read a
 *   second row, so every write that changes a link locks the rows it is about
 *   with `SELECT ... FOR UPDATE` **in ascending id order, before it checks
 *   anything**. The order is what stops two requests linking `A` to `B` and `B`
 *   to `A` from deadlocking, and the lock is what makes the second of them see
 *   the first.
 *
 * Nothing here creates a row on its own: a person creates every one. The only
 * row a person may delete is a spelling linked to another brand; every other
 * brand still cannot be removed, as section 9 of plan 0115 says.
 */
@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(Brand) private readonly brands: Repository<Brand>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /**
   * Register a brand, and claim the products already carrying its key.
   *
   * One transaction, so a brand that exists always has its items, and the row
   * count of that claim is the `linkedItems` the back office reads out.
   *
   * The 409 is raised from the unique index rather than from a lookup before
   * it, because a lookup before it is a race. The holder is then read **after**
   * the transaction aborted, through this service's own repository, since
   * nothing can be queried inside a transaction Postgres has already given up
   * on.
   *
   * A brand created **linked** locks its target first and checks that the
   * target is not itself a spelling, which is the one level rule as it applies
   * here: the new row cannot yet be pointed at by anything, so the other half
   * of the rule has nothing to check.
   */
  async create(req: CreateBrandRequest): Promise<CreateBrandResult> {
    const actor = await this.admin.requireAdmin(req);
    return this.createAs(actor, req);
  }

  /**
   * Register many brands, one outcome per name (plan 0160).
   *
   * **Each name is the single create, in its own transaction**, so a name that
   * is refused rolls back only itself and the batch goes on. That is also what
   * keeps a name's claim of its products exactly what `POST brands` would have
   * claimed: the same code, the same lock, the same answer.
   *
   * A name whose key a brand already holds answers `EXISTS` with that brand's
   * id, and writes nothing. It is read before the insert, so an ordinary
   * duplicate costs no aborted transaction, and the unique index still answers
   * the race between two batches the same way. Two names in one batch that key
   * the same are the same case: the second finds the first.
   *
   * A refusal is any domain error the single create would have answered with,
   * plus a chain that does not exist, which the single create answers 500 for
   * because it only ever meets it through a foreign key. Anything else is not a
   * fact about one name, so it fails the request, and the names before it stay
   * registered: each was its own decision.
   */
  async registerMany(
    req: RegisterBrandsRequest
  ): Promise<RegisterBrandsResult> {
    const actor = await this.admin.requireAdmin(req);
    const results: RegisterBrandsOutcome[] = [];
    for (const entry of req.brands) {
      results.push(await this.registerOne(actor, req, entry));
    }
    return { results };
  }

  private async registerOne(
    actor: CatalogActor,
    req: RegisterBrandsRequest,
    entry: RegisterBrandsRequest['brands'][number]
  ): Promise<RegisterBrandsOutcome> {
    const label = entry.label;
    const key = brandKey((label ?? '').trim());
    if (key !== null) {
      const holder = await this.brands.findOne({ where: { key } });
      if (holder) {
        return exists(label, holder.id);
      }
    }
    try {
      const created = await this.createAs(actor, {
        userId: req.userId,
        adminToken: req.adminToken,
        label,
        privateLabelSupermarketId: entry.privateLabelSupermarketId ?? null,
      });
      return {
        label,
        outcome: BrandBatchOutcome.CREATED,
        brandId: created.id,
        linkedItems: created.linkedItems,
        reason: null,
      };
    } catch (error) {
      if (error instanceof BrandKeyTakenException) {
        const holderId = error.details?.[BRAND_KEY_HOLDER_DETAIL];
        return typeof holderId === 'string'
          ? exists(label, holderId)
          : refused(label, error.code, error.message);
      }
      if (error instanceof DomainException) {
        return refused(label, error.code, error.message);
      }
      if (
        error instanceof QueryFailedError &&
        (error as { driverError?: { code?: string } }).driverError?.code ===
          PG_FOREIGN_KEY_VIOLATION
      ) {
        return refused(
          label,
          ERROR_CODES.NOT_FOUND,
          'The private label chain does not exist.'
        );
      }
      throw error;
    }
  }

  /** {@link create} once the gate has let the caller through. */
  private async createAs(
    actor: CatalogActor,
    req: CreateBrandRequest
  ): Promise<CreateBrandResult> {
    const label = (req.label ?? '').trim();
    const key = this.requireKey(label);
    const canonicalBrandId = req.canonicalBrandId ?? null;
    const chain = req.privateLabelSupermarketId ?? null;
    this.refuseChainOnLink(canonicalBrandId, chain);

    try {
      return await this.audit.write(actor, async (tx) => {
        const canonical =
          canonicalBrandId === null
            ? null
            : await this.lockTarget(tx.manager, canonicalBrandId);
        const saved = await tx.create(
          Brand,
          this.brands.create({
            key,
            label,
            privateLabelSupermarketId: chain,
            canonicalBrandId,
          })
        );
        const linkedItems = await this.linkUnlinkedItems(
          tx.manager,
          saved,
          canonical ?? saved
        );
        const counts = await this.countsOf(tx.manager, saved);
        return { ...toBrandView(saved, counts), linkedItems };
      });
    } catch (error) {
      throw await this.asKeyTaken(error, key);
    }
  }

  /**
   * Rename a brand, move it under a chain, or point it at the brand it spells.
   *
   * **Locks first, then checks, then writes.** The row and the link's target
   * are locked in ascending id order before anything is read for a decision or
   * written, so two requests that would together build a chain of links
   * serialise and the second sees the first. Writing the brand row first would
   * take the same lock on the way past, one row at a time and in request order
   * rather than id order, which is the shape a deadlock needs.
   *
   * Inside, in this order: the row, then the products the changed link moves,
   * then the rename's rewrites, then the items the new key has just made
   * matchable.
   */
  async update(req: UpdateBrandRequest): Promise<UpdateBrandResult> {
    const actor = await this.admin.requireAdmin(req);
    // A missing id answers 404 before a transaction opens, as every catalog
    // read does. The row that decides anything is the locked one below.
    await this.load(req.brandId);

    let attemptedKey = '';
    try {
      return await this.audit.write(actor, async (tx) => {
        const linksTo = req.canonicalBrandId;
        const locked = await this.lockInIdOrder(tx.manager, [
          req.brandId,
          ...(linksTo ? [linksTo] : []),
        ]);
        const row = locked.get(req.brandId);
        if (!row) {
          throw new NotFoundException('Brand not found');
        }

        const before = { ...row };
        const keyBefore = row.key;
        const canonicalBefore = await this.canonicalOf(tx.manager, row);
        const canonicalAfter =
          linksTo === undefined
            ? canonicalBefore
            : await this.resolveLink(tx.manager, row, linksTo, locked);

        const linkedAfter = canonicalAfter.id !== row.id;
        if (req.label !== undefined) {
          const label = req.label.trim();
          const key = this.requireKey(label);
          // A spelling keeps its key: it is what the products printed with it
          // carry, and the only thing that can bring them back on an unlink.
          if (linkedAfter && key !== row.key) {
            throw new BrandLinkKeepsKeyException(
              'A brand that is a spelling of another keeps its key.'
            );
          }
          row.key = key;
          row.label = label;
        }
        if (req.privateLabelSupermarketId !== undefined) {
          row.privateLabelSupermarketId = req.privateLabelSupermarketId;
        }
        if (linksTo !== undefined) {
          row.canonicalBrandId = linksTo;
        }
        // The rule judges the row this request would leave behind, not the
        // request: a link sent beside a chain is refused, and a link sent
        // alone clears whatever chain the row held. A cleared chain is not
        // restored by a later unlink, because nothing records what it was.
        this.refuseChainOnLink(
          linkedAfter ? canonicalAfter.id : null,
          req.privateLabelSupermarketId
        );
        if (linkedAfter) {
          row.privateLabelSupermarketId = null;
        }

        attemptedKey = row.key;
        const saved = await tx.update(Brand, before, row);

        const movedItems =
          canonicalAfter.id === canonicalBefore.id
            ? 0
            : await this.moveItems(
                tx.manager,
                saved,
                keyBefore,
                canonicalBefore,
                canonicalAfter
              );

        if (req.label !== undefined) {
          await tx.manager
            .createQueryBuilder()
            .update(Item)
            .set({ brand: saved.label })
            .where('"brandId" = :id', { id: saved.id })
            .execute();
          // Only where the key still is this brand's own. A product printed
          // with a spelling registered as its own brand sits on the canonical
          // brand carrying **its** key, and stamping the canonical key over it
          // would leave the unlink nothing to find (section 4.3).
          await tx.manager
            .createQueryBuilder()
            .update(Item)
            .set({ brandKey: saved.key })
            .where('"brandId" = :id AND "brandKey" = :old', {
              id: saved.id,
              old: keyBefore,
            })
            .execute();
          if (saved.key !== keyBefore) {
            await this.linkUnlinkedItems(tx.manager, saved, canonicalAfter);
          }
        }

        const counts = await this.countsOf(tx.manager, saved);
        return { ...toBrandView(saved, counts), movedItems };
      });
    } catch (error) {
      throw await this.asKeyTaken(error, attemptedKey);
    }
  }

  /**
   * Register a suggestion under the name a person typed (plan 0124, section 5).
   *
   * One transaction for one decision. The back office has a single act to
   * perform here, "this spelling is that brand", and doing it as a create
   * followed by a link leaves the suggestion half registered whenever the
   * second call fails: a brand nothing points at, and a key still on the
   * suggestions list.
   *
   * Three cases, and the key the typed name makes decides which:
   *
   * - **The same key.** There is nothing to link, because one row already holds
   *   it. This is `POST /brands` with the typed label, and `linked` is null.
   * - **A different key nothing holds.** The typed name becomes a brand, and
   *   the spelling becomes a second brand pointing at it.
   * - **A different key some brand holds.** That brand's own canonical brand is
   *   the target, so registering `DEBORAH 48H` under a name that is itself a
   *   spelling still lands on the brand at the top. The chain in the request is
   *   ignored, because the row that would carry it already exists and already
   *   says.
   *
   * The canonical brand is **locked and re read** before the link is inserted,
   * for the reason the class comment gives: without it, another request may
   * link that brand between the lookup and the insert and leave two levels
   * behind.
   */
  async registerSuggestion(
    req: RegisterBrandSuggestionRequest
  ): Promise<RegisterBrandSuggestionResult> {
    const actor = await this.admin.requireAdmin(req);
    const spelling = (req.spelling ?? '').trim();
    const label = (req.label ?? '').trim();
    const suggestionKey = this.requireKey(spelling);
    const labelKey = this.requireKey(label);
    const chain = req.privateLabelSupermarketId ?? null;

    // Which insert is in flight, so a unique violation names the key that was
    // taken rather than whichever one this method happened to start with.
    let attemptedKey = labelKey;
    try {
      return await this.audit.write(actor, async (tx) => {
        if (suggestionKey === labelKey) {
          const saved = await tx.create(
            Brand,
            this.brands.create({
              key: labelKey,
              label,
              privateLabelSupermarketId: chain,
              canonicalBrandId: null,
            })
          );
          const linkedItems = await this.linkUnlinkedItems(
            tx.manager,
            saved,
            saved
          );
          return {
            brand: toBrandView(saved, await this.countsOf(tx.manager, saved)),
            linked: null,
            // The brand the person named did not exist a statement ago, which
            // is what this flag says. There is simply no second row.
            canonicalCreated: true,
            linkedItems,
          };
        }

        const { canonical, created } = await this.resolveCanonical(
          tx,
          labelKey,
          label,
          chain
        );

        attemptedKey = suggestionKey;
        const linked = await tx.create(
          Brand,
          this.brands.create({
            key: suggestionKey,
            label: spelling,
            // A spelling owns no chain: its canonical brand's is the one that
            // counts (section 2).
            privateLabelSupermarketId: null,
            canonicalBrandId: canonical.id,
          })
        );

        const linkedItems =
          (await this.linkUnlinkedItems(tx.manager, canonical, canonical)) +
          (await this.linkUnlinkedItems(tx.manager, linked, canonical));

        return {
          // Read again after the products moved, so the count the back office
          // says out loud is the one the registry now holds.
          brand: toBrandView(
            canonical,
            await this.countsOf(tx.manager, canonical)
          ),
          linked: toBrandView(linked, await this.countsOf(tx.manager, linked)),
          canonicalCreated: created,
          linkedItems,
        };
      });
    } catch (error) {
      throw await this.asKeyTaken(error, attemptedKey);
    }
  }

  /**
   * Remove a spelling, and put its products back where it found them.
   *
   * **Only a brand that is a spelling of another may go** (plan 0124). Its
   * products are the ones carrying its key on its canonical brand, and deleting
   * it hands them back the state they were in before it was registered:
   * unbranded, still printed with the text this spelling names. So its key
   * returns to the suggestions list of its own accord, because `brand.keys`
   * stops answering it, and registering the same spelling again picks the same
   * products up through {@link linkUnlinkedItems}. Every other brand still
   * cannot be removed, by section 9 of plan 0115, because its products have
   * nowhere to go.
   *
   * One `DELETE` row in the trail and none per product, the rule plan 0115 set
   * for every bulk move here.
   */
  async remove(req: DeleteBrandRequest): Promise<DeleteBrandResult> {
    const actor = await this.admin.requireAdmin(req);
    await this.load(req.brandId);

    return this.audit.write(actor, async (tx) => {
      const locked = await this.lockInIdOrder(tx.manager, [req.brandId]);
      const row = locked.get(req.brandId);
      if (!row) {
        throw new NotFoundException('Brand not found');
      }
      if (row.canonicalBrandId === null) {
        throw new BrandNotLinkedException(
          'Only a brand that is a spelling of another brand can be deleted.'
        );
      }
      const canonical = await this.canonicalOf(tx.manager, row);
      const moved = await tx.manager
        .createQueryBuilder()
        .update(Item)
        .set({ brandId: null, brand: row.label })
        .where('"brandId" = :canonicalId AND "brandKey" = :key', {
          canonicalId: canonical.id,
          key: row.key,
        })
        .execute();
      await tx.delete(Brand, row);
      return { id: req.brandId, movedItems: moved.affected ?? 0 };
    });
  }

  async get(req: BrandIdRequest): Promise<BrandView> {
    const row = await this.load(req.brandId);
    return toBrandView(row, await this.countsOf(this.brands.manager, row));
  }

  /**
   * The registry, paged (plan 0115, section 5.2).
   *
   * `itemCount` comes from **one grouped derived table** rather than a
   * correlated count per row, which is the difference between one scan of
   * `items` and one per brand on the page.
   *
   * The cursor is a keyset under both orders, and both break their tie on the
   * id, because the curation tool reads the whole registry by following
   * `nextCursor` and a page that repeated or skipped a row would change what it
   * decided without saying so.
   */
  async list(req: ListBrandsRequest): Promise<BrandPage> {
    const limit = clampPageSize(req.limit);
    const order = req.order === 'itemCount' ? 'itemCount' : 'label';
    const cursor = decodeCursor<BrandCursor>(req.cursor);
    const values: unknown[] = [];
    const bind = (value: unknown): string => `$${values.push(value)}`;

    const where: string[] = [];
    const query = req.query?.trim();
    if (query) {
      const key = brandKey(query);
      // A query with no letters or digits keys to nothing, so it can only be
      // matched against the label. Anything else is matched against both.
      const clauses = [`b."label" ILIKE ${bind(`%${query}%`)}`];
      if (key !== null) {
        clauses.push(`b."key" LIKE ${bind(`%${key}%`)}`);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    if (req.privateLabelSupermarketId) {
      // The canonical brand's chain counts for its spellings too: a linked
      // brand owns no chain of its own, so filtering on `b` alone would hide
      // every spelling of a private label (plan 0124, section 6).
      const chain = bind(req.privateLabelSupermarketId);
      where.push(
        `(b."privateLabelSupermarketId" = ${chain} OR c."privateLabelSupermarketId" = ${chain})`
      );
    }
    if (req.canonicalBrandId) {
      where.push(`b."canonicalBrandId" = ${bind(req.canonicalBrandId)}`);
    }

    const seek: string[] = [];
    if (cursor && cursor.order === order) {
      if (order === 'label') {
        seek.push(
          `(x."label", x."id") > (${bind(cursor.value)}, ${bind(cursor.id)})`
        );
      } else {
        // Descending on the count, ascending on the id, which is what the
        // ORDER BY below says and therefore what a keyset has to mirror.
        const count = bind(Number(cursor.value));
        seek.push(
          `(x."itemCount" < ${count} OR (x."itemCount" = ${count} AND x."id" > ${bind(cursor.id)}))`
        );
      }
    }

    const orderBy =
      order === 'label'
        ? 'x."label" ASC, x."id" ASC'
        : 'x."itemCount" DESC, x."id" ASC';

    const rows: BrandRow[] = await this.brands.query(
      `
      SELECT * FROM (
        SELECT b."id",
               b."key",
               b."label",
               b."privateLabelSupermarketId",
               b."canonicalBrandId",
               c."label" AS "canonicalLabel",
               b."createdAt",
               b."updatedAt",
               COALESCE(counts."itemCount", 0)::int AS "itemCount",
               COALESCE(links."linkCount", 0)::int AS "linkCount"
          FROM "brands" b
          LEFT JOIN "brands" c ON c."id" = b."canonicalBrandId"
          LEFT JOIN (
            SELECT "brandId", count(*)::int AS "itemCount"
              FROM "items"
             WHERE "brandId" IS NOT NULL
             GROUP BY "brandId"
          ) counts ON counts."brandId" = b."id"
          LEFT JOIN (
            SELECT "canonicalBrandId", count(*)::int AS "linkCount"
              FROM "brands"
             WHERE "canonicalBrandId" IS NOT NULL
             GROUP BY "canonicalBrandId"
          ) links ON links."canonicalBrandId" = b."id"
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ) x
      ${seek.length ? `WHERE ${seek.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT ${bind(limit + 1)}
      `,
      values
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) =>
        toBrandView(row, {
          itemCount: row.itemCount,
          canonicalLabel: row.canonicalLabel,
          linkCount: row.linkCount,
        })
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              order,
              value: order === 'label' ? last.label : String(last.itemCount),
              id: last.id,
            })
          : null,
    };
  }

  /**
   * Every registered key, and nothing else (plan 0115, section 7.3).
   *
   * The suggestions read is the harvester subtracting this set from the keys
   * its queued rows carry, and the harvester holds no copy of the registry: a
   * copy is a second answer to what is registered, and it can disagree with the
   * first. So the whole set travels in one message, whose ceiling is documented
   * on `BRAND_PATTERNS.keys`.
   */
  async keys(_req: BrandKeysRequest): Promise<BrandKeysResult> {
    const rows: { key: string }[] = await this.brands.query(
      `SELECT "key" FROM "brands" ORDER BY "key" ASC`
    );
    return { keys: rows.map((row) => row.key) };
  }

  /** Load a brand by id, or say it is not there as every catalog read does. */
  async load(id: string): Promise<Brand> {
    const row = await this.brands.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Brand not found');
    }
    return row;
  }

  /**
   * Claim every item that carries this brand's key and belongs to no brand.
   *
   * Answers the row count, which is the `linkedItems` a create reports. The
   * **canonical** brand's id and label are what get written, so a product
   * harvested as `DEBORAH 48H` joins `Deborah` and reads `Deborah` from the
   * moment its spelling is registered. The product keeps its own key, which is
   * what an unlink later reads.
   *
   * **Not audited row by row**, deliberately: one register can move thousands
   * of products and the trail would carry a row per product for a single human
   * act. The act itself is the brand's own `CREATE` or `UPDATE` row, which
   * names who did it and when.
   */
  private async linkUnlinkedItems(
    manager: EntityManager,
    brand: Brand,
    canonical: Brand
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .update(Item)
      .set({ brandId: canonical.id, brand: canonical.label })
      .where('"brandKey" = :key AND "brandId" IS NULL', { key: brand.key })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Move the products a changed link moves (plan 0124, section 4.2).
   *
   * One statement covers all three cases. **Link**: `before` is the brand
   * itself, so `"brandId" = :bId` takes every product it holds, including the
   * ones that joined it under an older key through a rename. **Relink**: only
   * the products carrying this brand's key leave the old canonical brand for
   * the new one. **Unlink**: those same products come back.
   *
   * The key is the brand's key **before** this request, because that is what
   * the products out there carry: a rename arriving in the same request has not
   * reached them yet, which is why the move runs before the rename's rewrites
   * and not after.
   *
   * **An unlink cannot restore everything**, and nothing can. A product that
   * joined this brand under an older key before it was linked now carries that
   * older key, so the unlink leaves it on the canonical brand. Nothing records
   * that it was ever this brand's.
   *
   * **A known cost, deliberately accepted.** `ItemMatchIndex` in the harvester
   * (`matching.ts`, rung 3) keys on `items.brand`, the label. Once a link has
   * rewritten that label to the canonical one, a freshly harvested row printed
   * with the linked spelling no longer matches by name, brand and size, and two
   * look alike products can land in one bucket that then matches nothing.
   * Catalog search by the printed spelling stops finding the moved products for
   * the same reason. Matching by EAN and by source reference is unaffected, and
   * a later plan is where this is addressed; `matching.ts` is untouched here.
   */
  private async moveItems(
    manager: EntityManager,
    saved: Brand,
    keyBefore: string,
    before: Brand,
    after: Brand
  ): Promise<number> {
    // `after` may be the row this write just changed, in which case its label
    // is the one the request sent rather than the one loaded.
    const label = after.id === saved.id ? saved.label : after.label;
    const result = await manager
      .createQueryBuilder()
      .update(Item)
      .set({ brandId: after.id, brand: label })
      .where(
        '"brandId" = :bId OR ("brandId" = :beforeId AND "brandKey" = :bKey)',
        { bId: saved.id, beforeId: before.id, bKey: keyBefore }
      )
      .execute();
    return result.affected ?? 0;
  }

  /**
   * The brand a brand belongs to: the one it points at, or itself.
   *
   * Everything a product reads comes from this row rather than from the brand
   * it was written against, which is the whole of section 4.1.
   */
  private async canonicalOf(
    manager: EntityManager,
    brand: Brand
  ): Promise<Brand> {
    if (brand.canonicalBrandId === null) {
      return brand;
    }
    const canonical = await manager.findOne(Brand, {
      where: { id: brand.canonicalBrandId },
    });
    if (!canonical) {
      // Unreachable through the foreign key, which sets this column null when
      // a row goes away rather than leaving it dangling.
      throw new NotFoundException('Brand not found');
    }
    return canonical;
  }

  /**
   * Lock the named brands, in ascending id order, one statement each.
   *
   * **The order is the point**, and so is one statement each. Postgres locks
   * the rows of a `SELECT ... FOR UPDATE` in the order it reads them, which an
   * `ORDER BY` over a sort node does not decide, so a single statement would
   * take them in whatever order the plan chose and two requests could take the
   * same pair the other way round. Locking id by id makes every writer in this
   * service queue in the same sequence, which is what a deadlock needs to be
   * impossible.
   */
  private async lockInIdOrder(
    manager: EntityManager,
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, Brand>> {
    const locked = new Map<string, Brand>();
    for (const id of [...new Set(ids)].sort()) {
      const row = await manager
        .createQueryBuilder(Brand, 'b')
        .setLock('pessimistic_write')
        .where('b.id = :id', { id })
        .getOne();
      if (row) {
        locked.set(id, row);
      }
    }
    return locked;
  }

  /** Lock one brand a new row is about to point at, and check it may be. */
  private async lockTarget(manager: EntityManager, id: string): Promise<Brand> {
    const locked = await this.lockInIdOrder(manager, [id]);
    const target = locked.get(id);
    if (!target) {
      throw new NotFoundException('Brand not found');
    }
    if (target.canonicalBrandId !== null) {
      throw new BrandLinkTooDeepException(
        'That brand is itself a spelling of another brand.',
        { details: { [BRAND_LINK_BLOCKER_DETAIL]: target.id } }
      );
    }
    return target;
  }

  /**
   * The brand an edited row would belong to afterwards, refusing the edits the
   * one level rule forbids (plan 0124, section 3).
   *
   * Both halves are checked here, against rows this transaction has locked: the
   * target must not be a spelling itself, and nothing may already point at the
   * row being linked.
   */
  private async resolveLink(
    manager: EntityManager,
    row: Brand,
    linksTo: string | null,
    locked: ReadonlyMap<string, Brand>
  ): Promise<Brand> {
    if (linksTo === null) {
      return row;
    }
    if (linksTo === row.id) {
      throw new BrandLinkToSelfException(
        'A brand is already itself, so it cannot be a spelling of itself.'
      );
    }
    const target = locked.get(linksTo);
    if (!target) {
      throw new NotFoundException('Brand not found');
    }
    if (target.canonicalBrandId !== null) {
      throw new BrandLinkTooDeepException(
        'That brand is itself a spelling of another brand.',
        { details: { [BRAND_LINK_BLOCKER_DETAIL]: target.id } }
      );
    }
    // Read without a lock of its own, and safely: anything that could point a
    // brand at this row has to lock this row first, and this transaction holds
    // it.
    const pointer = await manager.findOne(Brand, {
      where: { canonicalBrandId: row.id },
    });
    if (pointer) {
      throw new BrandLinkTooDeepException(
        'Other brands are spellings of this one, so it cannot be a spelling itself.',
        { details: { [BRAND_LINK_BLOCKER_DETAIL]: pointer.id } }
      );
    }
    return target;
  }

  /**
   * The brand a suggestion's typed name resolves to, created if it is new.
   *
   * Locked before it is used, and re read under that lock, so the row this
   * transaction is about to point at cannot become a spelling of a third brand
   * between the lookup and the insert.
   */
  private async resolveCanonical(
    tx: AuditedWrite,
    labelKey: string,
    label: string,
    chain: string | null
  ): Promise<{ canonical: Brand; created: boolean }> {
    const holder = await tx.manager.findOne(Brand, {
      where: { key: labelKey },
    });
    if (!holder) {
      const created = await tx.create(
        Brand,
        this.brands.create({
          key: labelKey,
          label,
          privateLabelSupermarketId: chain,
          canonicalBrandId: null,
        })
      );
      return { canonical: created, created: true };
    }

    const locked = await this.lockInIdOrder(tx.manager, [
      holder.id,
      ...(holder.canonicalBrandId ? [holder.canonicalBrandId] : []),
    ]);
    const row = locked.get(holder.id);
    if (!row) {
      throw new NotFoundException('Brand not found');
    }
    if (row.canonicalBrandId === null) {
      return { canonical: row, created: false };
    }
    const canonical = locked.get(row.canonicalBrandId);
    // Only when somebody linked this brand between the lookup and the lock, so
    // the brand at the top is one this transaction never locked. Refused rather
    // than followed, and the next attempt reads the new arrangement and works.
    if (!canonical || canonical.canonicalBrandId !== null) {
      throw new BrandLinkTooDeepException(
        'That brand was made a spelling of another while this was being registered.',
        { details: { [BRAND_LINK_BLOCKER_DETAIL]: row.id } }
      );
    }
    return { canonical, created: false };
  }

  /**
   * Refuse a write whose result would be a linked brand carrying a chain
   * (plan 0124, section 2).
   *
   * The rule judges the row that would be left behind, not the request, so a
   * chain sent beside a link is refused and a chain sent at a brand that is
   * already a spelling is refused too. A link sent **alone** is not refused: it
   * clears whatever chain the row held, because the canonical brand's chain is
   * the one that counts from then on.
   */
  private refuseChainOnLink(
    canonicalBrandId: string | null,
    sentChain: string | null | undefined
  ): void {
    if (canonicalBrandId !== null && sentChain != null) {
      throw new BrandLinkOwnsNoChainException(
        'A brand that is a spelling of another owns no private label chain.'
      );
    }
  }

  /**
   * What a brand row cannot answer about itself, read through the caller's
   * manager.
   *
   * Three reads for one row, and sequentially rather than together: a query
   * issued inside a transaction through a second connection waits for one the
   * transaction is holding. The list pays none of this, because it answers all
   * three for the whole page in one statement.
   */
  private async countsOf(
    manager: EntityManager,
    brand: Brand
  ): Promise<BrandCounts> {
    const itemCount = await manager.count(Item, {
      where: { brandId: brand.id },
    });
    const linkCount = await manager.count(Brand, {
      where: { canonicalBrandId: brand.id },
    });
    const canonical = brand.canonicalBrandId
      ? await manager.findOne(Brand, {
          where: { id: brand.canonicalBrandId },
        })
      : null;
    return { itemCount, linkCount, canonicalLabel: canonical?.label ?? null };
  }

  /** The key a label makes, or the 400 that says the label makes none. */
  private requireKey(label: string): string {
    const key = brandKey(label);
    if (key === null) {
      throw new BrandLabelEmptyException(
        'A brand label needs at least one letter or digit, because its key is ' +
          'made of nothing else.'
      );
    }
    return key;
  }

  /**
   * Turn a unique violation on `uq_brands_key` into the 409 that names the
   * holder, and leave every other error alone.
   */
  private async asKeyTaken(error: unknown, key: string): Promise<unknown> {
    const code = (error as { driverError?: { code?: string } }).driverError
      ?.code;
    if (!(error instanceof QueryFailedError) || code !== PG_UNIQUE_VIOLATION) {
      return error;
    }
    const holder = await this.brands.findOne({ where: { key } });
    return new BrandKeyTakenException('A brand already holds that key', {
      // The id is the whole reason this is not a plain conflict: the panel that
      // met it links to the brand that holds the key.
      details: holder ? { [BRAND_KEY_HOLDER_DETAIL]: holder.id } : undefined,
    });
  }
}

/** A batch name whose key a brand already holds. */
function exists(label: string, brandId: string): RegisterBrandsOutcome {
  return {
    label,
    outcome: BrandBatchOutcome.EXISTS,
    brandId,
    linkedItems: null,
    reason: null,
  };
}

/** A batch name the single create would have refused, with its reason. */
function refused(
  label: string,
  code: string,
  detail: string
): RegisterBrandsOutcome {
  return {
    label,
    outcome: BrandBatchOutcome.REFUSED,
    brandId: null,
    linkedItems: null,
    reason: { code, detail },
  };
}
