import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type CreateProductGroupRequest,
  type ListProductGroupsRequest,
  type ProductGroupIdRequest,
  type ProductGroupPage,
  type ProductGroupView,
  type UpdateProductGroupRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository } from 'typeorm';
import { ProductGroup } from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import {
  displayName,
  displayNameSql,
  toProductGroupView,
} from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';
import {
  parseSearchTerm,
  TRIGRAM_THRESHOLD,
  TRIGRAM_WEIGHT,
} from './search-term';

const PG_UNIQUE_VIOLATION = '23505';

interface ProductGroupCursor {
  /** An offset for a ranked page, a sort value for an ordinary one. */
  value: string;
  id: string;
}

/**
 * Product groups (plan 0048, section 1): "milk as a thing you can buy".
 *
 * Owner curated end to end. Writes go through the platform admin gate like every
 * other catalog write, and **nothing here assigns items to groups**: an item's
 * `productGroupId` is set through `item.update`, by a person, because the
 * matching ladder that would let a harvest run do it is backlog 0001 section 6.2
 * and needs the review queue that comes with it.
 *
 * The `search_es` and `search_en` columns are not touched anywhere in this file.
 * They are maintained by the triggers the migration installs, which is what keeps
 * a group's members findable by the group's words: renaming a group refreshes
 * every one of its items without this service knowing it happened.
 */
@Injectable()
export class ProductGroupService {
  constructor(
    @InjectRepository(ProductGroup)
    private readonly groups: Repository<ProductGroup>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService,
    // For {@link delete} alone (plan 0070, section 5). Nothing else here changes
    // a fact a subscribed line depends on: membership is `items.productGroupId`,
    // and this service does not assign it.
    private readonly events: CatalogEventsPublisher
  ) {}

  async create(req: CreateProductGroupRequest): Promise<ProductGroupView> {
    const actor = await this.admin.requireAdmin(req);
    const draft = this.groups.create({
      name: req.name,
      slug: this.validateSlug(req.slug),
      referenceUnit: req.referenceUnit,
      synonyms: normalizeSynonyms(req.synonyms),
    });
    try {
      const saved = await this.audit.write(actor, (tx) =>
        tx.create(ProductGroup, draft)
      );
      return toProductGroupView(saved);
    } catch (error) {
      throw this.asConflict(error);
    }
  }

  async update(req: UpdateProductGroupRequest): Promise<ProductGroupView> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.productGroupId);
    const before = { ...row };
    if (req.name !== undefined) {
      row.name = req.name;
    }
    if (req.slug !== undefined) {
      row.slug = this.validateSlug(req.slug);
    }
    if (req.referenceUnit !== undefined) {
      row.referenceUnit = req.referenceUnit;
    }
    if (req.synonyms !== undefined) {
      row.synonyms = normalizeSynonyms(req.synonyms);
    }
    try {
      return toProductGroupView(
        await this.audit.write(actor, (tx) =>
          tx.update(ProductGroup, before, row)
        )
      );
    } catch (error) {
      throw this.asConflict(error);
    }
  }

  /**
   * Delete a group.
   *
   * Its members are **not** deleted and are not refused either: the foreign key
   * sets their `productGroupId` to null, which fires the item search trigger and
   * drops the group's words out of their search documents by itself. Undoing a
   * curation decision must not be blocked by the products it was about.
   *
   * ## It announces itself, and that is not a convenience (plan 0070, section 5)
   *
   * The nulling above happens **inside Postgres** and emits nothing, so without
   * its own event a deletion would be invisible to core and the next unrelated
   * item write would be the first hint. Worse, if the deletion did somehow arrive
   * as a burst of per item changes, core would read it as "the admin removed every
   * product from Milk" and empty every subscribed line, where what it must
   * actually do is unbind them and leave every product where it is.
   */
  async delete(req: ProductGroupIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.productGroupId);
    await this.audit.write(actor, (tx) => tx.delete(ProductGroup, row));
    this.events.productGroupDeleted(req.productGroupId);
    return { id: req.productGroupId };
  }

  async get(req: ProductGroupIdRequest): Promise<ProductGroupView> {
    return toProductGroupView(await this.load(req.productGroupId));
  }

  /**
   * List or search groups.
   *
   * With a query it is the same ranked read `item.searchOffers` performs, minus
   * the prices: full text over the group's own name and synonyms, with trigram
   * beside it so a typo still lands. With no query it is an ordinary listing by
   * name, which is what the admin surface uses.
   */
  async list(req: ListProductGroupsRequest): Promise<ProductGroupPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ProductGroupCursor | undefined;
    const term = parseSearchTerm(req.query);

    if (!term) {
      const qb = this.groups
        .createQueryBuilder('g')
        .orderBy(displayNameSql('g'), 'ASC')
        .addOrderBy('g.id', 'ASC')
        .take(limit + 1);
      if (cursor) {
        qb.andWhere(`(${displayNameSql('g')}, g.id) > (:cv, :cid)`, {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
      const rows = await qb.getMany();
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toProductGroupView),
        nextCursor:
          hasMore && last
            ? encodeCursor({ value: displayName(last.name), id: last.id })
            : null,
      };
    }

    // A ranked page is offset paginated, and the cursor carries that offset. A
    // keyset cursor needs a total order over stored columns, and a relevance
    // score is computed per query rather than stored: there is no column to seek
    // into. The offset is still opaque to the caller, so this stays a decision
    // the service can revisit without a contract change.
    const offset = Number(cursor?.value ?? 0) || 0;
    const rows = await this.groups.query(
      `
      SELECT g.*, ${RANK_SQL} AS "relevance"
      FROM "product_groups" g
      WHERE ${MATCH_SQL}
      ORDER BY "relevance" DESC, ${EXACT_SQL} DESC, g."id" ASC
      LIMIT $4 OFFSET $5
      `,
      [term.tsquery, term.raw, TRIGRAM_THRESHOLD, limit + 1, offset]
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit) as ProductGroup[];
    return {
      items: page.map(toProductGroupView),
      nextCursor: hasMore
        ? encodeCursor({ value: String(offset + limit), id: '' })
        : null,
    };
  }

  /** Load a group by id, for the item service's assignment check. */
  async load(id: string): Promise<ProductGroup> {
    const row = await this.groups.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Product group not found');
    }
    return row;
  }

  /**
   * The slug is a handle, so it may only contain what a handle may contain.
   *
   * Checked here and not only in the gateway DTO, for the reason core states
   * about quantity bounds: the gateway is one caller among several rather than a
   * wall, and a rule enforced at one layer is a rule a second client walks
   * straight through.
   */
  private validateSlug(slug: string): string {
    const trimmed = slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
      throw new ValidationException(
        'slug must be lower case words separated by single dashes',
        { messageArgs: { field: 'slug' } }
      );
    }
    return trimmed;
  }

  private asConflict(error: unknown): unknown {
    if (
      error instanceof QueryFailedError &&
      (error as { driverError?: { code?: string } }).driverError?.code ===
        PG_UNIQUE_VIOLATION
    ) {
      return new ConflictException('A product group already has that slug');
    }
    return error;
  }
}

/**
 * The synonym lists as the database should hold them: two arrays, trimmed, with
 * the empties and the duplicates gone.
 *
 * Normalised on the way in rather than on the way out, because the trigger that
 * builds the search document reads the stored value and a list of empty strings
 * would put nothing but noise into it.
 */
function normalizeSynonyms(
  synonyms: CreateProductGroupRequest['synonyms']
): ProductGroup['synonyms'] {
  const clean = (words?: string[]): string[] => [
    ...new Set((words ?? []).map((word) => word.trim()).filter(Boolean)),
  ];
  return { en: clean(synonyms?.en), es: clean(synonyms?.es) };
}

/**
 * The three SQL fragments the ranked group read is built from.
 *
 * `$1` is the `to_tsquery` expression, `$2` the raw term for the trigram and
 * exact comparisons, `$3` the trigram threshold. They are shared between the
 * WHERE and the ORDER BY so the thing that decides whether a row matches and the
 * thing that decides where it sits cannot describe different rows.
 */
const MATCH_SQL = `(
  g."search_es" @@ to_tsquery('spanish', $1)
  OR g."search_en" @@ to_tsquery('english', $1)
  OR similarity(g."name" ->> 'es', $2) > $3
  OR similarity(g."name" ->> 'en', $2) > $3
)`;

const RANK_SQL = `GREATEST(
  ts_rank(g."search_es", to_tsquery('spanish', $1)),
  ts_rank(g."search_en", to_tsquery('english', $1)),
  GREATEST(
    similarity(g."name" ->> 'es', $2),
    similarity(g."name" ->> 'en', $2)
  ) * ${TRIGRAM_WEIGHT}
)`;

const EXACT_SQL = `(
  lower(g."name" ->> 'es') = lower($2) OR lower(g."name" ->> 'en') = lower($2)
)`;
