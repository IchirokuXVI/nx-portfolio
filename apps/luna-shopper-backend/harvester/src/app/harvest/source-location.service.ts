import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceMatch,
  SourceLocationStatus,
  type ListSourceLocationsRequest,
  type MapSourceLocationRequest,
  type SourceLocationCandidate,
  type SourceLocationIdRequest,
  type SourceLocationPage,
  type SourceLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import { SourceLocation } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toSourceLocationView } from './harvest.mappers';
import {
  LocationNameIndex,
  rankLocations,
  type LocationCandidate,
} from './matching';
import { PlatformAdminService } from './platform-admin.service';

interface SourceLocationCursor {
  value: string;
  id: string;
}

/** One shop as a source named it, for {@link SourceLocationService.observe}. */
export interface ObservedShop {
  /** The source's own code, e.g. `T1`. Never the printed name. */
  externalId: string;
  /** What the source displayed, exactly. */
  printedName: string;
}

/**
 * Which shop of theirs is which of ours (plan 0084, section 6).
 *
 * A run that meets a shop it cannot resolve **writes no availability for it,
 * counts it, and finishes**. The row is what the back office shows, so the
 * operator sees a shop waiting to be mapped rather than a silence in a log. That
 * is the owner's rule: an unknown location needs no action from the run.
 *
 * **Mapping a shop does not backfill it.** The availability the run skipped
 * stays skipped until the next run. That is deliberate, and it is the opposite
 * of `sourceAlias.accept` in plan 0081, which does write the price it was queued
 * for: a price sits in the run's stored document and is a small number of
 * offers, while a shop's availability is one boolean per product across a whole
 * assortment that the run never stored. Re running is cheaper than keeping the
 * snapshot.
 */
@Injectable()
export class SourceLocationService {
  constructor(
    @InjectRepository(SourceLocation)
    private readonly shops: Repository<SourceLocation>,
    private readonly catalog: CatalogClient,
    private readonly admin: PlatformAdminService
  ) {}

  /**
   * What a run does with the shops a page named (plan 0084, section 6).
   *
   * **The default name match runs on first sight and never again.** A row that
   * already exists only has its printed name, `lastSeenAt` and `lastRunId`
   * moved. Re-matching would undo an operator's `unmap` on the next crawl, and
   * an `IGNORED` shop would climb back into the queue every run.
   *
   * The printed name **is** refreshed, because it is what the source displays
   * today and the queue shows it to a person. The mapping survives that, which
   * is the whole reason the row is keyed on the code.
   */
  async observe(
    supermarketId: string,
    shops: ObservedShop[],
    runId: string | null
  ): Promise<SourceLocation[]> {
    if (shops.length === 0) {
      return [];
    }
    // Last one wins on a repeated code, which a listing that files one shop
    // under two sections can produce.
    const seen = new Map(shops.map((shop) => [shop.externalId, shop]));
    const existing = await this.shops.find({
      where: { supermarketId, externalId: In([...seen.keys()]) },
    });
    const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

    const now = new Date();
    const rows: SourceLocation[] = [];
    let index: LocationNameIndex | null = null;

    for (const [externalId, shop] of seen) {
      const held = byExternalId.get(externalId);
      if (held) {
        held.printedName = shop.printedName;
        held.lastSeenAt = now;
        held.lastRunId = runId;
        rows.push(held);
        continue;
      }
      // Paid for only when a shop is genuinely new, which after the first run of
      // a chain is almost never.
      index ??= new LocationNameIndex(await this.chainLocations(supermarketId));
      const matched = index.match(shop.printedName);
      rows.push(
        this.shops.create({
          supermarketId,
          externalId,
          printedName: shop.printedName,
          supermarketLocationId: matched,
          status: matched
            ? SourceLocationStatus.ACTIVE
            : SourceLocationStatus.UNMAPPED,
          matchedBy: ItemSourceMatch.NAME_SIZE,
          firstSeenAt: now,
          lastSeenAt: now,
          firstRunId: runId,
          lastRunId: runId,
        })
      );
    }

    return this.shops.save(rows, { chunk: 100 });
  }

  /**
   * The queue, one chain at a time, filterable by status.
   *
   * An `UNMAPPED` row carries the chain's shops it may be (plan 0154), so an
   * operator maps it with one confirmation instead of a search. The proposal is
   * worked out on every read rather than stored, because a location imported
   * after the run is a candidate the next time the queue is opened.
   */
  async list(req: ListSourceLocationsRequest): Promise<SourceLocationPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as SourceLocationCursor | undefined;

    const qb = this.shops
      .createQueryBuilder('sl')
      .where('sl."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('sl.createdAt', 'DESC')
      .addOrderBy('sl.id', 'DESC')
      .take(limit + 1);
    if (req.status) {
      qb.andWhere('sl.status = :status', { status: req.status });
    }
    if (cursor) {
      qb.andWhere('(sl."createdAt", sl.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const found = await qb.getMany();
    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(page),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Bind one row to a catalog location: `ACTIVE`, `matchedBy: MANUAL`.
   *
   * The location has to belong to this row's chain, and that is checked against
   * catalog rather than assumed. A back office picker scoped to the chain still
   * sends a uuid, and a uuid is not evidence of anything.
   */
  async map(req: MapSourceLocationRequest): Promise<SourceLocationView> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.sourceLocationId);
    const location = await this.catalog.getSupermarketLocation(
      req.supermarketLocationId
    );
    if (location.supermarketId !== row.supermarketId) {
      throw new ValidationException(
        'That location belongs to a different chain than this shop'
      );
    }

    row.supermarketLocationId = req.supermarketLocationId;
    row.status = SourceLocationStatus.ACTIVE;
    row.matchedBy = ItemSourceMatch.MANUAL;
    return this.view(await this.shops.save(row));
  }

  /**
   * Back to `UNMAPPED`, leaving what was already written in catalog alone.
   *
   * `matchedBy` returns to the default, because an unmapped row is bound by
   * nobody and leaving `MANUAL` on it would tell the queue a person had decided
   * something they undid.
   */
  async unmap(req: SourceLocationIdRequest): Promise<SourceLocationView> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.sourceLocationId);
    row.supermarketLocationId = null;
    row.status = SourceLocationStatus.UNMAPPED;
    row.matchedBy = ItemSourceMatch.NAME_SIZE;
    return this.view(await this.shops.save(row));
  }

  /**
   * A place the source lists that we do not sell from. DEZA publishes eighteen
   * centres, of which ten appear in the product listing and the rest are
   * warehouses, cafeterias, a bakery and a beauty salon.
   *
   * Marking one is a person's act and a run never does it, which is what
   * {@link observe} not re-matching an existing row makes true.
   */
  async ignore(req: SourceLocationIdRequest): Promise<SourceLocationView> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.sourceLocationId);
    row.supermarketLocationId = null;
    row.status = SourceLocationStatus.IGNORED;
    return this.view(await this.shops.save(row));
  }

  /** Back into the queue, unmapped. */
  async unignore(req: SourceLocationIdRequest): Promise<SourceLocationView> {
    await this.admin.requireAdmin(req);
    const row = await this.load(req.sourceLocationId);
    row.status = SourceLocationStatus.UNMAPPED;
    return this.view(await this.shops.save(row));
  }

  private async view(row: SourceLocation): Promise<SourceLocationView> {
    const [view] = await this.views([row]);
    return view;
  }

  /**
   * The rows as the queue shows them, with the proposals an `UNMAPPED` row
   * carries (plan 0154). Catalog is asked once per chain, and not at all when no
   * row needs a proposal.
   */
  private async views(rows: SourceLocation[]): Promise<SourceLocationView[]> {
    const locations = new Map<string, Promise<LocationCandidate[]>>();
    const locationsOf = (supermarketId: string) => {
      let held = locations.get(supermarketId);
      if (!held) {
        held = this.chainLocations(supermarketId);
        locations.set(supermarketId, held);
      }
      return held;
    };

    const views: SourceLocationView[] = [];
    for (const row of rows) {
      const candidates =
        row.status === SourceLocationStatus.UNMAPPED
          ? rankLocations(
              row.printedName,
              await locationsOf(row.supermarketId)
            ).map(
              ({ location, score, strong }): SourceLocationCandidate => ({
                supermarketLocationId: location.id,
                label: location.label,
                address: location.address,
                postalCode: location.postalCode,
                score,
                strong,
              })
            )
          : [];
      views.push(toSourceLocationView(row, candidates));
    }
    return views;
  }

  /** Every shop catalog holds for this chain, as the name match reads them. */
  private async chainLocations(
    supermarketId: string
  ): Promise<LocationCandidate[]> {
    const candidates: LocationCandidate[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listSupermarketLocations(
        supermarketId,
        cursor
      );
      for (const location of page.items) {
        candidates.push({
          id: location.id,
          label: location.label,
          address: location.address,
          postalCode: location.postalCode,
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return candidates;
  }

  private async load(id: string): Promise<SourceLocation> {
    const row = await this.shops.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Source location not found');
    }
    return row;
  }
}
