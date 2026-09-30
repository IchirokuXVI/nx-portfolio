import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  SHOP_WALK_LIMITS,
  SHOP_WALK_PATTERNS,
  validateMessageRequest,
  type AppendShopWalkEntryRequest,
  type AppendShopWalkEntryResult,
  type CreateShopWalkRequest,
  type ListShopWalksRequest,
  type LocationShopMapRequest,
  type LocationShopMapView,
  type ShopMapDocument,
  type ShopMapView,
  type ShopWalkEntryView,
  type ShopWalkIdRequest,
  type ShopWalkListView,
  type ShopWalkLogRequest,
  type ShopWalkLogView,
  type ShopWalkSummaryView,
  type ShopWalkView,
  type UpdateShopWalkRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  DEFAULT_LOCALE,
  getRequestContext,
  isUuid,
  NotFoundException,
  SHOP_MAP_LIMIT_DETAIL,
  SHOP_MAP_MAX_BYTES_DETAIL,
  SHOP_MAP_PROBLEMS_DETAIL,
  ShopMapInvalidException,
  ShopMapTooLargeException,
  ValidationException,
  WALK_CHANGED_LAST_SEQ_DETAIL,
  WalkChangedException,
} from '@portfolio/luna-shopper/platform';
import {
  shopperView,
  validateShopMapV2,
  walkOrderV2,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  DataSource,
  IsNull,
  LessThanOrEqual,
  Not,
  type EntityManager,
} from 'typeorm';
import { SectionService } from '../catalog/section.service';
import { ShopWalk, ShopWalkEntry } from '../entities';
import {
  emptyShopMapDocument,
  foldOnto,
  foldReplaying,
  jsonBytes,
  needsSnapshot,
  replacesState,
  toEntryView,
  toTimelineEntry,
  type FoldStart,
} from './walk-fold';

/** One row of {@link SUMMARY_SQL}. */
interface SummaryRow {
  id: string;
  supermarketLocationId: string;
  name: string;
  shown: boolean;
  lastSeq: number;
  markCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A walk's summary without reading its document: the mark count is taken from
 * the stored json in the statement.
 */
const SUMMARY_COLUMNS = `
  w."id"::text AS "id",
  w."supermarketLocationId"::text AS "supermarketLocationId",
  w."name" AS "name",
  w."shown" AS "shown",
  w."lastSeq" AS "lastSeq",
  coalesce(jsonb_array_length(w."document" -> 'marks'), 0)::int AS "markCount",
  w."createdAt" AS "createdAt",
  w."updatedAt" AS "updatedAt"
`;

/** How many shopper views the public read keeps, keyed by walk and `lastSeq`. */
const VIEW_CACHE_SIZE = 64;

/**
 * A shop's walks, their append only log, and the map shoppers see (backend
 * plan 0168).
 *
 * **The log only grows.** Nothing here updates or deletes an entry, and
 * deleting a walk sets `deletedAt`. A walk's `document` is always the fold of
 * its entries up to `lastSeq`, rewritten in the transaction that appends one,
 * and it always passes `validateShopMapV2`.
 *
 * **Who may call it** is decided by the gateway: every subject but
 * {@link mapForLocation} is reached only through routes behind
 * `@RequirePermission('shopMap.record')`, and the `userId` it is handed is
 * recorded as the author.
 *
 * **The shown walk writes the shop's section list** (section 4), inside the
 * same transaction as the change that moved it, through
 * `SectionService.followWalk`.
 */
@Injectable()
export class ShopWalkService {
  /**
   * walkId:lastSeq to the shopper's view of that fold, the expensive half of
   * the public read. The sections beside it are resolved on every read, so a
   * section an operator renames or deletes is never served stale.
   */
  private readonly views = new Map<string, ShopMapView['view']>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sections: SectionService
  ) {}

  /** The shown walk's map, through `shopperView`, or null. No account. */
  async mapForLocation(
    req: LocationShopMapRequest
  ): Promise<LocationShopMapView> {
    await this.requireShop(this.dataSource.manager, req.supermarketLocationId);
    const walk = await this.dataSource.getRepository(ShopWalk).findOne({
      where: { supermarketLocationId: req.supermarketLocationId, shown: true },
    });
    if (!walk || walk.deletedAt !== null) {
      return { map: null };
    }
    const key = `${walk.id}:${walk.lastSeq}`;
    let view = this.views.get(key);
    if (!view) {
      view = shopperView(walk.document);
      this.remember(key, view);
    }
    const order = walkOrderV2(walk.document);
    const map: ShopMapView = {
      walkId: walk.id,
      savedAt: await this.savedAt(walk),
      view,
      sections: await this.sections.resolveWalkNames(
        walk.supermarketLocationId,
        order.sections.map((stop) => stop.name)
      ),
    };
    return { map };
  }

  /** A shop's walks that are not deleted: the shown one first, then by last change. */
  async list(req: ListShopWalksRequest): Promise<ShopWalkListView> {
    await this.requireShop(this.dataSource.manager, req.supermarketLocationId);
    const rows = (await this.dataSource.query(
      `SELECT ${SUMMARY_COLUMNS}
         FROM "shop_walks" w
        WHERE w."supermarketLocationId" = $1 AND w."deletedAt" IS NULL
        ORDER BY w."shown" DESC, w."updatedAt" DESC, w."id"`,
      [req.supermarketLocationId]
    )) as SummaryRow[];
    return { walks: rows.map(toSummary) };
  }

  /** A new empty walk on a shop, not shown. */
  async create(req: CreateShopWalkRequest): Promise<ShopWalkSummaryView> {
    const name = requireName(req.name);
    await this.requireShop(this.dataSource.manager, req.supermarketLocationId);
    const saved = await this.dataSource.getRepository(ShopWalk).save({
      supermarketLocationId: req.supermarketLocationId,
      name,
      shown: false,
      lastSeq: 0,
      document: emptyShopMapDocument(),
      createdByUserId: req.userId,
      deletedAt: null,
    });
    return this.summaryOf(this.dataSource.manager, saved.id);
  }

  /**
   * Rename, show or stop showing. Showing stops showing the shop's other walk
   * and rewrites the shop's section list, all in one transaction.
   */
  async update(req: UpdateShopWalkRequest): Promise<ShopWalkSummaryView> {
    const name = req.name === undefined ? undefined : requireName(req.name);
    return this.dataSource.transaction(async (manager) => {
      const known = await this.requireWalk(manager, req.walkId);
      if (req.shown === true && !known.shown) {
        // One writer of a shop's shown walk at a time, so the partial unique
        // index is never the thing that refuses a concurrent show.
        await manager.query(
          `SELECT 1 FROM "supermarket_locations" WHERE "id" = $1 FOR NO KEY UPDATE`,
          [known.supermarketLocationId]
        );
      }
      const walk = await this.lockWalk(manager, req.walkId);
      const changes: Partial<ShopWalk> = {};
      if (name !== undefined && name !== walk.name) {
        changes.name = name;
      }
      if (req.shown !== undefined && req.shown !== walk.shown) {
        changes.shown = req.shown;
      }
      if (Object.keys(changes).length > 0) {
        if (changes.shown === true) {
          await manager.query(
            `UPDATE "shop_walks" SET "shown" = false, "updatedAt" = now()
              WHERE "supermarketLocationId" = $1 AND "shown" AND "id" <> $2`,
            [walk.supermarketLocationId, walk.id]
          );
        }
        await manager.update(ShopWalk, { id: walk.id }, changes);
        if (changes.shown === true) {
          await this.followShownWalk(
            manager,
            walk.supermarketLocationId,
            walk.document
          );
        }
      }
      return this.summaryOf(manager, walk.id);
    });
  }

  /** Sets `deletedAt` and keeps every entry. A shown walk stops being shown. */
  async delete(req: ShopWalkIdRequest): Promise<{ id: string }> {
    return this.dataSource.transaction(async (manager) => {
      const walk = await this.lockWalk(manager, req.walkId);
      await manager.update(
        ShopWalk,
        { id: walk.id },
        { shown: false, deletedAt: new Date() }
      );
      return { id: walk.id };
    });
  }

  /** The walk, its document and its timeline. */
  async get(req: ShopWalkIdRequest): Promise<ShopWalkView> {
    const manager = this.dataSource.manager;
    const walk = await this.requireWalk(manager, req.walkId);
    const rows = await manager.getRepository(ShopWalkEntry).find({
      select: {
        id: true,
        seq: true,
        kind: true,
        at: true,
        logFrom: true,
        logTo: true,
        rewoundTo: true,
        reason: true,
      },
      where: { walkId: walk.id },
      order: { seq: 'ASC' },
    });
    return {
      walk: await this.summaryOf(manager, walk.id),
      document: walk.document,
      timeline: rows.map(toTimelineEntry),
    };
  }

  /** The entries after the latest snapshot at or before `fromSeq`, with it. */
  async log(req: ShopWalkLogRequest): Promise<ShopWalkLogView> {
    const manager = this.dataSource.manager;
    const walk = await this.requireWalk(manager, req.walkId);
    const fromSeq = req.fromSeq ?? 0;
    if (!Number.isInteger(fromSeq) || fromSeq < 0) {
      throw new ValidationException('fromSeq must be a whole number from 0', {
        messageArgs: { field: 'fromSeq' },
      });
    }
    const snapshot =
      fromSeq > 0
        ? await manager.getRepository(ShopWalkEntry).findOne({
            select: { seq: true, snapshot: true },
            where: {
              walkId: walk.id,
              seq: LessThanOrEqual(fromSeq),
              snapshot: Not(IsNull()),
            },
            order: { seq: 'DESC' },
          })
        : null;
    const after = snapshot?.seq ?? 0;
    return {
      walkId: walk.id,
      snapshot:
        snapshot && snapshot.snapshot
          ? { seq: snapshot.seq, document: snapshot.snapshot }
          : null,
      entries: await this.entriesAfter(manager, walk.id, after, walk.lastSeq),
      lastSeq: walk.lastSeq,
    };
  }

  /**
   * Section 2. In one transaction with the walk row locked: a stored id
   * answers what it stored; a stale base is refused; the entry is folded onto
   * the document, validated and stored; and a shown walk rewrites its shop's
   * section list.
   */
  async append(
    req: AppendShopWalkEntryRequest
  ): Promise<AppendShopWalkEntryResult> {
    requireEntryShape(req);
    const entryBytes = jsonBytes(entryPayload(req));
    if (entryBytes > SHOP_WALK_LIMITS.entryMaxBytes) {
      throw tooLarge('entry', SHOP_WALK_LIMITS.entryMaxBytes);
    }
    return this.dataSource.transaction(async (manager) => {
      const walk = await this.lockWalk(manager, req.walkId);
      const stored = await manager.getRepository(ShopWalkEntry).findOne({
        where: { id: req.id },
      });
      if (stored) {
        if (stored.walkId !== walk.id) {
          throw new ConflictException(
            'That entry id is already stored on another walk.'
          );
        }
        return {
          walk: await this.summaryOf(manager, walk.id),
          entry: toTimelineEntry(stored),
          replayed: true,
        };
      }
      if (req.baseSeq !== walk.lastSeq) {
        throw new WalkChangedException(
          `This walk is at ${walk.lastSeq}, not ${req.baseSeq}.`,
          { details: { [WALK_CHANGED_LAST_SEQ_DETAIL]: walk.lastSeq } }
        );
      }
      const seq = walk.lastSeq + 1;
      const entry: ShopWalkEntryView = { ...entryPayload(req), seq };
      const document = replacesState(entry.kind)
        ? await this.foldReplaying(manager, walk, entry)
        : foldOnto(walk.document, entry);
      const problems = validateShopMapV2(document);
      if (problems.length > 0) {
        throw new ShopMapInvalidException(
          'The walk would fold to a map that does not validate.',
          { details: { [SHOP_MAP_PROBLEMS_DETAIL]: problems } }
        );
      }
      if (jsonBytes(document) > SHOP_WALK_LIMITS.documentMaxBytes) {
        throw tooLarge('document', SHOP_WALK_LIMITS.documentMaxBytes);
      }
      const row = await manager.getRepository(ShopWalkEntry).save({
        id: entry.id,
        walkId: walk.id,
        seq,
        kind: entry.kind,
        at: new Date(entry.at),
        logFrom: entry.logFrom,
        logTo: entry.logTo,
        events: entry.events,
        rewoundTo: entry.rewoundTo ?? null,
        reason: entry.reason ?? null,
        snapshot: needsSnapshot(seq, entry.kind) ? document : null,
        createdByUserId: req.userId,
      });
      await manager.update(
        ShopWalk,
        { id: walk.id },
        { document, lastSeq: seq }
      );
      if (walk.shown) {
        await this.followShownWalk(
          manager,
          walk.supermarketLocationId,
          document
        );
      }
      return {
        walk: await this.summaryOf(manager, walk.id),
        entry: toTimelineEntry(row),
        replayed: false,
      };
    });
  }

  /** Section 4, for the walk now shown with `document`. */
  private async followShownWalk(
    manager: EntityManager,
    supermarketLocationId: string,
    document: ShopMapDocument
  ): Promise<void> {
    const names = walkOrderV2(document).sections.map((stop) => stop.name);
    await this.sections.followWalk(
      manager,
      supermarketLocationId,
      names,
      getRequestContext()?.locale ?? DEFAULT_LOCALE
    );
  }

  /** A rewind or a discard: the log read back from the newest snapshot that can hold it. */
  private async foldReplaying(
    manager: EntityManager,
    walk: ShopWalk,
    entry: ShopWalkEntryView
  ): Promise<ShopMapDocument> {
    const rows = await manager.getRepository(ShopWalkEntry).find({
      select: { seq: true, snapshot: true },
      where: { walkId: walk.id, snapshot: Not(IsNull()) },
      order: { seq: 'DESC' },
    });
    const starts: FoldStart[] = rows.map((row) => ({
      seq: row.seq,
      document: row.snapshot,
    }));
    return foldReplaying(
      starts,
      (after) => this.entriesAfter(manager, walk.id, after, walk.lastSeq),
      entry
    );
  }

  /** The entries after `after` and up to `through`, with their events, in `seq` order. */
  private async entriesAfter(
    manager: EntityManager,
    walkId: string,
    after: number,
    through: number
  ): Promise<ShopWalkEntryView[]> {
    const rows = await manager
      .getRepository(ShopWalkEntry)
      .createQueryBuilder('e')
      .select([
        'e.id',
        'e.seq',
        'e.kind',
        'e.at',
        'e.logFrom',
        'e.logTo',
        'e.events',
        'e.rewoundTo',
        'e.reason',
      ])
      .where('e."walkId" = :walkId', { walkId })
      .andWhere('e."seq" > :after', { after })
      .andWhere('e."seq" <= :through', { through })
      .orderBy('e."seq"', 'ASC')
      .getMany();
    return rows.map(toEntryView);
  }

  /** When the walk's document last changed: its newest entry, else the walk's creation. */
  private async savedAt(walk: ShopWalk): Promise<string> {
    if (walk.lastSeq === 0) {
      return walk.createdAt.toISOString();
    }
    const newest = await this.dataSource.getRepository(ShopWalkEntry).findOne({
      select: { createdAt: true },
      where: { walkId: walk.id, seq: walk.lastSeq },
    });
    return (newest?.createdAt ?? walk.updatedAt).toISOString();
  }

  private remember(key: string, view: ShopMapView['view']): void {
    this.views.set(key, view);
    while (this.views.size > VIEW_CACHE_SIZE) {
      const oldest = this.views.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.views.delete(oldest);
    }
  }

  private async summaryOf(
    manager: EntityManager,
    walkId: string
  ): Promise<ShopWalkSummaryView> {
    const rows = (await manager.query(
      `SELECT ${SUMMARY_COLUMNS} FROM "shop_walks" w WHERE w."id" = $1`,
      [walkId]
    )) as SummaryRow[];
    if (rows.length === 0) {
      throw walkNotFound();
    }
    return toSummary(rows[0]);
  }

  /** A walk that is not deleted, unlocked. */
  private async requireWalk(
    manager: EntityManager,
    walkId: string
  ): Promise<ShopWalk> {
    const walk = isUuid(walkId)
      ? await manager.getRepository(ShopWalk).findOne({ where: { id: walkId } })
      : null;
    if (!walk || walk.deletedAt !== null) {
      throw walkNotFound();
    }
    return walk;
  }

  /** A walk that is not deleted, locked for the rest of the transaction. No relations, see the raw SQL notes. */
  private async lockWalk(
    manager: EntityManager,
    walkId: string
  ): Promise<ShopWalk> {
    const walk = isUuid(walkId)
      ? await manager.getRepository(ShopWalk).findOne({
          where: { id: walkId },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (!walk || walk.deletedAt !== null) {
      throw walkNotFound();
    }
    return walk;
  }

  private async requireShop(
    manager: EntityManager,
    supermarketLocationId: string
  ): Promise<void> {
    const rows = isUuid(supermarketLocationId)
      ? ((await manager.query(
          `SELECT 1 FROM "supermarket_locations" WHERE "id" = $1`,
          [supermarketLocationId]
        )) as unknown[])
      : [];
    if (rows.length === 0) {
      throw new NotFoundException('Supermarket location not found');
    }
  }
}

function toSummary(row: SummaryRow): ShopWalkSummaryView {
  const lastSeq = Number(row.lastSeq);
  return {
    id: row.id,
    supermarketLocationId: row.supermarketLocationId,
    name: row.name,
    shown: row.shown,
    lastSeq,
    entryCount: lastSeq,
    markCount: Number(row.markCount),
    createdAt: new Date(row.createdAt).toISOString(),
    lastChangedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** The entry of a request, without the walk's id, the author or the base. */
function entryPayload(
  req: AppendShopWalkEntryRequest
): Omit<ShopWalkEntryView, 'seq'> {
  return {
    id: req.id,
    kind: req.kind,
    at: new Date(req.at).toISOString(),
    logFrom: req.logFrom,
    logTo: req.logTo,
    events: req.events,
    ...(req.rewoundTo !== undefined ? { rewoundTo: req.rewoundTo } : {}),
    ...(req.reason !== undefined ? { reason: req.reason } : {}),
  };
}

/**
 * The request against the contract schema, which states every event shape,
 * and the rules a schema does not say.
 */
function requireEntryShape(req: AppendShopWalkEntryRequest): void {
  const { valid, errors } = validateMessageRequest(
    SHOP_WALK_PATTERNS.append,
    req
  );
  if (!valid) {
    const first = errors[0];
    const where = first?.instancePath ? first.instancePath : 'entry';
    throw new ValidationException(
      `${where} ${first?.message ?? 'is not a walk entry'}`,
      { messageArgs: { field: 'events' } }
    );
  }
  if (!isUuid(req.id)) {
    throw new ValidationException('id must be a uuid', {
      messageArgs: { field: 'id' },
    });
  }
  if (Number.isNaN(Date.parse(req.at))) {
    throw new ValidationException('at must be an ISO date and time', {
      messageArgs: { field: 'at' },
    });
  }
  if (req.logTo < req.logFrom) {
    throw new ValidationException('logTo must not be before logFrom', {
      messageArgs: { field: 'logTo' },
    });
  }
  if (req.kind === 'rewound' && req.rewoundTo === undefined) {
    throw new ValidationException('rewoundTo is required on a rewound entry', {
      messageArgs: { field: 'rewoundTo' },
    });
  }
  if (req.kind !== 'rewound' && req.rewoundTo !== undefined) {
    throw new ValidationException('rewoundTo is only for a rewound entry', {
      messageArgs: { field: 'rewoundTo' },
    });
  }
}

function requireName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '' || trimmed.length > SHOP_WALK_LIMITS.nameMaxLength) {
    throw new ValidationException(
      `name must be 1 to ${SHOP_WALK_LIMITS.nameMaxLength} characters`,
      { messageArgs: { field: 'name' } }
    );
  }
  return trimmed;
}

function tooLarge(
  limit: 'entry' | 'document',
  maxBytes: number
): ShopMapTooLargeException {
  return new ShopMapTooLargeException(
    `The ${limit} is over its ${maxBytes} byte cap.`,
    {
      details: {
        [SHOP_MAP_LIMIT_DETAIL]: limit,
        [SHOP_MAP_MAX_BYTES_DETAIL]: maxBytes,
      },
    }
  );
}

function walkNotFound(): NotFoundException {
  return new NotFoundException('Walk not found');
}
