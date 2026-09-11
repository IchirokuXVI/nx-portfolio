import { Logger } from '@nestjs/common';
import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type {
  BlockedPlace,
  DiscoveredPlaceService,
} from './discovered-place.service';
import type { RunScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import type {
  AvailabilityClaim,
  ObservedPlace,
  RunReport,
  ScopeDeclaration,
} from './run-report';
import type {
  SourceIngest,
  SourceIngestSession,
  SourceObservation,
} from './source-ingest';
import type { SourceLocationService } from './source-location.service';

/**
 * The write half of a run, and the only thing that has one (plan 0103, section
 * 2.3).
 *
 * **Its own file, and that is the point.** A runner imports `RunReport` as a
 * type from `run-report.ts`, which is erased at compile time, so a runner cannot
 * reach a repository, a `CatalogClient` or an ingest even by accident. Putting
 * this class beside the interface would put the store one import away from every
 * runner, which is exactly what this plan removed.
 *
 * Every `RunReport` method here is synchronous and returns nothing (D1). The
 * work they name is appended to one serial promise chain, so declarations,
 * chunks and places are written in the order the runner produced them and a
 * failure in any of them surfaces at {@link drain}. A runner cannot await the
 * chain and cannot see what it decided.
 */

/** How many products go into one ingest push. */
const PRODUCT_CHUNK = 400;

/** How many places are written in one pass. */
const PLACE_CHUNK = 100;

/** How many availability rows go to catalog in one call. */
const AVAILABILITY_BATCH = 200;

export interface RunReportSinkInput {
  /** The chain this run writes for, and null for a run that names none. */
  supermarketId: string | null;
  /** The scope a price naming none is written to. */
  defaultPriceScopeId: string | null;
  /** What observed the price, stamped on every row this run writes. */
  sourceKind: PriceSourceKind;
  /** How far a place with no postal code may reach for the nearest one. */
  postalCodeDeriveMaxMetres: number;
  /**
   * Whether this run's chain is trusted to write its own shops into the catalog
   * (plan 0107, section 3.1).
   *
   * It is the chain's `autoImportPlaces` column, read by the executor. Always
   * false for a run with no chain, which is every radius search: OpenStreetMap
   * has no row to carry the flag, and its data is why the review queue exists.
   */
  autoImportPlaces: boolean;
}

/** What the run wrote, for the counters and the run's report. */
export interface RunReportResult {
  products: number;
  /**
   * Prices this run stored on the chain's own source rows.
   *
   * The number a person means by "prices". It is every price the source stated
   * that resolved to a scope, and it is what the source products screen shows.
   */
  pricesRecorded: number;
  /**
   * Prices this run published to catalog, which only a row bound to a product
   * earns.
   *
   * It is legitimately zero for a chain nobody has matched yet, and reading it
   * beside {@link pricesRecorded} is what makes that readable rather than
   * alarming.
   */
  pricesPublished: number;
  /** Prices catalog already held at that value and only moved the clock on. */
  pricesConfirmed: number;
  placesCreated: number;
  placesRefreshed: number;
  /** Catalog locations this run wrote itself, which only a trusted chain earns. */
  placesImported: number;
  /**
   * Trusted places the completeness check sent to the review queue instead,
   * with the fields each was missing (plan 0107, section 3.2).
   *
   * Named rather than counted, like {@link shopsUnmapped}: an operator reading
   * the queue wants to know which shop they are looking at and why it is there.
   */
  placesNotImported: BlockedPlace[];
  scopesDeclared: number;
  scopesCreated: number;
  /** Shops the source named that no catalog location is bound to yet. */
  shopsUnmapped: { code: string; name: string }[];
  shopsWritten: number;
  availabilityWritten: number;
  /** Availability rows a person had typed, which the run left alone. */
  conflicts: Record<string, unknown>[];
}

export class RunReportSink implements RunReport {
  private readonly logger = new Logger(RunReportSink.name);

  /** Everything queued, in order. A failure anywhere surfaces at `drain`. */
  private chain: Promise<void> = Promise.resolve();
  private session: SourceIngestSession | null = null;

  private products: SourceObservation[] = [];
  private places: ObservedPlace[] = [];
  private readonly claims: AvailabilityClaim[] = [];
  /** The scope keys whose whole assortment this run walked. */
  private readonly complete = new Set<string | null>();
  /** Every external id the run named, for the negative availability diff. */
  private readonly observedIds = new Set<string>();
  /**
   * The item each row points at, whatever its status.
   *
   * **Per shop availability uses this and per scope availability does not**, and
   * the difference is deliberate. A price is written only for an `ACTIVE` row,
   * because a wrong number on a real product is worse than no number. Stock is
   * not a number: DEZA publishes no EAN at all, so an `ACTIVE` row there would
   * only ever be one a person accepted by hand, and reading availability from
   * `ACTIVE` alone would silence the whole crawl (plan 0085).
   */
  private readonly itemByExternalId = new Map<string, string>();
  /** The item each `ACTIVE` row resolved to, which is what a scope claim uses. */
  private readonly activeItemByExternalId = new Map<string, string>();

  private readonly result: RunReportResult = {
    products: 0,
    pricesRecorded: 0,
    pricesPublished: 0,
    pricesConfirmed: 0,
    placesCreated: 0,
    placesRefreshed: 0,
    placesImported: 0,
    placesNotImported: [],
    scopesDeclared: 0,
    scopesCreated: 0,
    shopsUnmapped: [],
    shopsWritten: 0,
    availabilityWritten: 0,
    conflicts: [],
  };

  constructor(
    private readonly context: RunContext,
    private readonly input: RunReportSinkInput,
    private readonly deps: {
      ingest: SourceIngest;
      scopes: RunScopeResolver | null;
      places: DiscoveredPlaceService;
      shops: SourceLocationService;
      catalog: CatalogClient;
      entries: Repository<SourceCatalogEntry>;
    }
  ) {}

  scope(declaration: ScopeDeclaration): void {
    const resolver = this.deps.scopes;
    if (!resolver) {
      // A run with no chain has nowhere to put a scope. Nothing declares one
      // today; saying so is cheaper than a null dereference later.
      this.logger.warn(
        `Run ${this.context.runId} declared the scope "${declaration.key}" ` +
          'but names no chain, so there is nothing to create it under.'
      );
      return;
    }
    this.result.scopesDeclared += 1;
    this.queue(async () => {
      await resolver.declare(declaration);
    });
  }

  product(observation: SourceObservation): void {
    this.products.push(observation);
    this.observedIds.add(observation.externalId);
    if (this.products.length >= PRODUCT_CHUNK) {
      const chunk = this.products;
      this.products = [];
      this.queue(() => this.pushProducts(chunk));
    }
  }

  place(place: ObservedPlace): void {
    this.places.push(place);
    if (this.places.length >= PLACE_CHUNK) {
      const chunk = this.places;
      this.places = [];
      this.queue(() => this.writePlaces(chunk));
    }
  }

  availability(claim: AvailabilityClaim): void {
    this.claims.push(claim);
  }

  assortmentComplete(scopeKey: string | null): void {
    this.complete.add(scopeKey);
  }

  /**
   * Write what is left, then everything that could only be decided at the end.
   *
   * The order matters. Products are written first, because availability is
   * stated per catalog item and only the ingest knows which item a row resolved
   * to. The negative half of availability is last, because it is the diff
   * between what the run named and what the chain is tracked for.
   */
  async drain(): Promise<RunReportResult> {
    if (this.products.length > 0) {
      const chunk = this.products;
      this.products = [];
      this.queue(() => this.pushProducts(chunk));
    }
    if (this.places.length > 0) {
      const chunk = this.places;
      this.places = [];
      this.queue(() => this.writePlaces(chunk));
    }
    await this.chain;

    if (this.session) {
      // The ingest already counted every price this run wrote, and the close
      // used to be called for its side effect alone and the answer dropped on
      // the floor. That is why a walk's report named no price at all and the
      // screen fell back to `updated`, which is rows the ladder changed.
      const { counters } = await this.session.close();
      this.result.pricesRecorded += counters.pricesRecorded;
      this.result.pricesPublished += counters.pricesWritten;
      this.result.pricesConfirmed += counters.pricesConfirmed;
    }
    this.result.scopesCreated = this.deps.scopes?.createdCount ?? 0;

    await this.writeShopAvailability();
    await this.writeScopeAvailability();
    return this.result;
  }

  /** Append to the serial chain, so writes happen in the order reported. */
  private queue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work);
  }

  private async pushProducts(
    chunk: readonly SourceObservation[]
  ): Promise<void> {
    const supermarketId = this.input.supermarketId;
    if (!supermarketId) {
      throw new Error(
        'This run reported products but names no chain, so there is nothing ' +
          'to record them against.'
      );
    }
    this.session ??= await this.deps.ingest.open(this.context, {
      supermarketId,
      defaultPriceScopeId: this.input.defaultPriceScopeId,
      sourceKind: this.input.sourceKind,
      // Read through the resolver on every price, so a scope declared just
      // before this chunk is already resolvable by it.
      scopeIdFor: (key) => this.deps.scopes?.idFor(key) ?? null,
    });

    const outcomes = await this.session.push(chunk);
    this.result.products += chunk.length;

    // Which item each row resolved to, for the availability the run states
    // afterwards. Only an `ACTIVE` row answers one, which is the same rule that
    // decides whether the row is owed a price.
    for (const outcome of outcomes) {
      if (outcome.entry.itemId) {
        this.itemByExternalId.set(
          outcome.entry.externalId,
          outcome.entry.itemId
        );
      }
      if (outcome.itemId) {
        this.activeItemByExternalId.set(
          outcome.entry.externalId,
          outcome.itemId
        );
      }
    }
  }

  private async writePlaces(chunk: readonly ObservedPlace[]): Promise<void> {
    const written = await this.deps.places.observe(chunk, {
      runId: this.context.runId,
      deriveMaxMetres: this.input.postalCodeDeriveMaxMetres,
      autoImport: this.input.autoImportPlaces,
      // Read through the resolver at import time, so a scope declared just
      // before this chunk is already resolvable by it. A key nothing declared
      // answers null and the shop takes a STORE scope of its own.
      scopeIdFor: (key) => this.deps.scopes?.idFor(key) ?? null,
    });
    this.result.placesCreated += written.created;
    this.result.placesRefreshed += written.refreshed;
    this.result.placesImported += written.imported;
    this.result.placesNotImported.push(...written.blocked);
    await this.context.report({
      processed: chunk.length,
      created: written.created,
      unchanged: written.refreshed,
    });
  }

  /**
   * Availability a source stated per shop of its own (plan 0103, section 6.3).
   *
   * The codes are resolved through `SourceLocationService`, which is the queue a
   * person works: a shop nothing is bound to yet writes no availability, is
   * counted and named, and the run finishes. Mapping it later does not backfill
   * what this run skipped.
   */
  private async writeShopAvailability(): Promise<void> {
    const byShop = new Map<string, AvailabilityClaim[]>();
    for (const claim of this.claims) {
      if (!claim.shopCode) {
        continue;
      }
      const held = byShop.get(claim.shopCode) ?? [];
      held.push(claim);
      byShop.set(claim.shopCode, held);
    }
    const supermarketId = this.input.supermarketId;
    if (byShop.size === 0 || !supermarketId) {
      return;
    }

    const names = new Map<string, string>();
    for (const claim of this.claims) {
      if (claim.shopCode) {
        names.set(claim.shopCode, claim.shopName ?? claim.shopCode);
      }
    }
    const rows = await this.deps.shops.observe(
      supermarketId,
      [...names].map(([externalId, printedName]) => ({
        externalId,
        printedName,
      })),
      this.context.runId
    );

    const observedAt = new Date();
    for (const row of rows) {
      if (!row.supermarketLocationId) {
        this.result.shopsUnmapped.push({
          code: row.externalId,
          name: row.printedName,
        });
        continue;
      }
      const entries = (byShop.get(row.externalId) ?? [])
        .map((claim) => ({
          itemId: this.itemByExternalId.get(claim.externalId),
          available: claim.available,
        }))
        .filter(
          (entry): entry is { itemId: string; available: boolean } =>
            entry.itemId !== undefined
        );
      if (entries.length === 0) {
        continue;
      }
      this.result.shopsWritten += 1;
      for (let i = 0; i < entries.length; i += AVAILABILITY_BATCH) {
        const result = await this.deps.catalog.setLocationAvailability(
          row.supermarketLocationId,
          entries.slice(i, i + AVAILABILITY_BATCH),
          this.context.runId,
          this.input.sourceKind,
          observedAt
        );
        this.result.availabilityWritten += result.written;
        for (const conflict of result.conflicts) {
          this.result.conflicts.push({ shop: row.externalId, ...conflict });
        }
      }
    }
  }

  /**
   * Availability for a whole scope, positive and, when the run walked the whole
   * assortment, negative too (plan 0103, section 6.1).
   *
   * **An aborted run declares no completeness**, so it writes positives only: a
   * walk that stopped early has not proved anything absent. The diff is against
   * the chain's `ACTIVE` rows of this run's own source kind, because a leaflet
   * row is a printed name rather than a product id a walk could have listed, and
   * its absence from the tree is not a claim about stock.
   */
  private async writeScopeAvailability(): Promise<void> {
    const supermarketId = this.input.supermarketId;
    if (!supermarketId || this.complete.size === 0) {
      // Nothing to state. A run that walked no whole assortment and named no
      // scope has only positives, and a positive with no scope to write it for
      // is not a claim anybody can read.
      return;
    }

    for (const scopeKey of this.complete) {
      const scopeId =
        scopeKey === null
          ? this.input.defaultPriceScopeId
          : this.deps.scopes?.idFor(scopeKey);
      if (!scopeId) {
        continue;
      }

      const byItem = new Map<string, boolean>();
      // Everything the run named is stocked here, by the fact it was listed.
      for (const [externalId, itemId] of this.activeItemByExternalId) {
        if (this.observedIds.has(externalId)) {
          byItem.set(itemId, true);
        }
      }
      // What the source said outright beats what the listing implied.
      for (const claim of this.claims) {
        if (claim.shopCode || (claim.scopeKey ?? null) !== scopeKey) {
          continue;
        }
        const itemId = this.activeItemByExternalId.get(claim.externalId);
        if (itemId) {
          byItem.set(itemId, claim.available);
        }
      }

      const tracked = await this.deps.entries.find({
        where: {
          supermarketId,
          sourceKind: this.input.sourceKind,
          status: SourceEntryStatus.ACTIVE,
        },
      });
      for (const row of tracked) {
        if (!row.itemId || this.observedIds.has(row.externalId)) {
          continue;
        }
        // A product two rows resolve to is stocked if either row saw it: the
        // false would be a claim the source never made.
        byItem.set(row.itemId, byItem.get(row.itemId) ?? false);
      }

      const entries = [...byItem].map(([itemId, available]) => ({
        itemId,
        available,
      }));
      for (let i = 0; i < entries.length; i += AVAILABILITY_BATCH) {
        await this.deps.catalog.setAvailability(
          scopeId,
          entries.slice(i, i + AVAILABILITY_BATCH)
        );
      }
      this.result.availabilityWritten += entries.length;
      this.logger.log(
        `Run ${this.context.runId}: availability for ${entries.length} item(s)`
      );
    }
  }
}
