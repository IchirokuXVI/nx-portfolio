import { Logger } from '@nestjs/common';
import {
  APPROX_WEIGHT_FILL_MAX,
  HarvestRunWrites,
  HarvestWarningCode,
  PACK_COUNT_FILL_MAX,
  PriceSourceKind,
  SourceEntryStatus,
  type ApproxWeightFill,
  type PackCountFill,
  type SupermarketItemAvailabilityEntry,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { NotWholeListing } from './delisting';
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
import type { SizeDoubtExample } from './size-doubt';
import type {
  SourceEntryAvailabilityWriter,
  StoredClaim,
} from './source-entry-availability';
import type {
  PriceConflict,
  ReportedObservation,
  SourceEntryOutcome,
  SourceIngest,
  SourceIngestSession,
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

/** One bound row and the weight of one piece it states (plan 0244). */
interface WeighedRow {
  entryId: string;
  externalId: string;
  approxWeight: number;
}

/** How many availability rows go to catalog in one call. */
const AVAILABILITY_BATCH = 200;

/**
 * How many price conflicts a run's report names (plan 0191). The count beside
 * them is always the whole number, so a report that names fewer says so.
 */
const PRICE_CONFLICTS_NAMED = 200;

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
  /**
   * The scopes that also receive what this run writes at a scope (plan 0118,
   * section 4), resolved by the executor. Absent means the run copies nothing.
   */
  copiesOf?: (priceScopeId: string) => readonly string[];
  /**
   * What this run writes of what it read (plan 0119, section 7). Absent means
   * both. The prices are skipped by the ingest, the availability here, and a
   * copy follows whichever its walked scope wrote.
   */
  writes?: HarvestRunWrites;
  /**
   * Whether this chain's runs may declare a whole listing (plan 0220, section
   * 15.3): the adapter's `provesDelisting`, or Carrefour's own switch, read by
   * the executor. Absent is false, and a declaration is then refused and named.
   */
  provesDelisting?: boolean;
}

/** One whole listing, resolved to its scope at drain (plan 0220, section 4.4). */
export interface WholeListing {
  key: string | null;
  scopeId: string;
  listed: readonly string[];
  /**
   * The items the run made an explicit claim about at this scope, read after
   * the drain. The counter turns no product on that a claim spoke for
   * (section 15.1): DIA's stock and Mercadona's 404 beat a listing.
   */
  claimed?: readonly string[];
}

/** What the delisting counter reads off the sink once the run has drained. */
export interface DelistingListings {
  whole: WholeListing[];
  notWhole: NotWholeListing[];
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
  /**
   * Items two entries of the chain priced at one scope with two amounts,
   * whose prices were withheld (plan 0155), counted once per run (plan 0191).
   */
  pricesConflicted: number;
  /**
   * Those items, named with the rows that disagree (plan 0191), so a person
   * finds the pair without a query. The first {@link PRICE_CONFLICTS_NAMED}
   * of them: {@link pricesConflicted} is the whole number.
   */
  priceConflicts: PriceConflict[];
  /**
   * Rows this run proposed by the words of their name in any order (plan
   * 0221), new and waiting rows together. Each waits for a person as a
   * `CANDIDATE` with `NAME_WORDS_SIZE`.
   */
  wordOrderProposals: number;
  /**
   * Rows this run queued pointing at the one rejected row their words meet
   * (plan 0221, the owner's answer of 2026-11-05). Not part of
   * {@link wordOrderProposals}.
   */
  wordOrderRejectedPointers: number;
  /**
   * Observations whose stated size their own price and comparison price
   * disprove (plan 0249). Each row keeps its size and carries a doubt; a
   * product is created from it only with a size a person names.
   */
  sizesDisproved: number;
  /**
   * The first twenty of them, each with its name, the stated and the implied
   * size and the label. {@link sizesDisproved} is the whole number.
   */
  sizesDisprovedExamples: SizeDoubtExample[];
  /**
   * Of {@link sizesDisproved}, the rows whose ratio is within 2% of a whole
   * number from 2 to 48 and that state no pack count: a probable pack
   * stated at the size of one of its units.
   */
  probablePackCounts: number;
  /**
   * Photo links this run sent for its bound rows (plan 0198): rows that had
   * no link or state a new address. Saved whatever the chain's switch says.
   */
  imagesLinked: number;
  /** Rows whose link went to another product. */
  imagesMoved: number;
  /** Rows whose link already said this. Every run sends every bound row. */
  imagesUnchanged: number;
  /** Links catalog would not save, each logged with its reason. */
  imagesRejected: number;
  /** Links removed: a row that left its product or states no photo now. */
  imagesUnlinked: number;
  /**
   * Rows whose link message failed. The run does not fail for it: every run
   * sends every bound row again, so the next one repairs it.
   */
  imageLinksFailed: number;
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
  /**
   * Per shop claims this run stored on the source's own rows (plan 0182).
   *
   * Every claim that named a shop and a product the run reported, whether or
   * not the row is bound and whether or not the shop is mapped. It is the sum
   * of {@link claimsWritten} and {@link claimsWaiting}.
   */
  claimsStored: number;
  /**
   * Of those, the claims whose row is bound to a product and whose shop names a
   * location, which is what reached catalog. Not {@link availabilityWritten}:
   * that one counts the rows catalog changed, and a claim catalog already held
   * changes nothing.
   */
  claimsWritten: number;
  /** Of those, the claims still waiting, which is the next two added up. */
  claimsWaiting: number;
  /** Claims whose row is not bound yet, a `CANDIDATE` proposal included. */
  claimsWaitingForBinding: number;
  /** Claims whose row is bound and whose shop no location is mapped to yet. */
  claimsWaitingForShop: number;
  /**
   * Offers with no price this run created (plan 0182): one per product whose
   * bound row the run saw, that holds no price in any scope, and that had no
   * row yet in the chain's default scope. A product that already had a row is
   * left alone and is not counted, so this is zero on a run that follows one
   * which wrote them.
   */
  pricelessOffersWritten: number;
  /**
   * Products this run could not offer, because the call to catalog that
   * carried them failed. The run does not fail for it: every price and claim
   * has landed by then, and the next run offers them again.
   */
  pricelessOffersFailed: number;
  /** Availability rows a person had typed, which the run left alone. */
  conflicts: Record<string, unknown>[];
  /** Every scope that received at least one price read at it (plan 0118). */
  pricedScopes: string[];
  /**
   * Per scope copied from, the price rows sent to catalog for its targets (plan
   * 0118, section 7). Not part of {@link pricesPublished}.
   */
  pricesCopied: Record<string, number>;
  /**
   * Per scope copied from, the availability rows written at its targets: every
   * item once per target. Not part of {@link availabilityWritten}.
   */
  availabilityCopied: Record<string, number>;
  /**
   * Products whose null pack count this run filled (plan 0162, section 3).
   * A product whose count was already set is not counted: catalog keeps it.
   */
  packCountsFilled: number;
  /**
   * Products two entries of this run bound to with two different counts, and
   * the counts they carried. Nothing was sent for them: under the merge rules a
   * pack size makes a new product, so this is a bad merge for a person to look
   * at, not a tie to break. Named rather than counted, like
   * {@link shopsUnmapped}.
   */
  packCountConflicts: { itemId: string; packCounts: number[] }[];
  /**
   * Products whose weight of one piece this run wrote (plan 0244, section
   * 5.7). A product that already held the same weight is not counted.
   */
  approxWeightsWritten: number;
  /** Products skipped because a person wrote their weight. */
  approxWeightsSkippedSetByAdmin: number;
  /** Products skipped because they are still a sized pack. */
  approxWeightsSkippedHasSize: number;
}

export class RunReportSink implements RunReport {
  private readonly logger = new Logger(RunReportSink.name);

  /** Everything queued, in order. A failure anywhere surfaces at `drain`. */
  private chain: Promise<void> = Promise.resolve();
  private session: SourceIngestSession | null = null;

  private products: ReportedObservation[] = [];
  private places: ObservedPlace[] = [];
  private readonly claims: AvailabilityClaim[] = [];
  /** The scope keys whose whole assortment this run walked. */
  private readonly complete = new Set<string | null>();
  /**
   * The whole listings the runner declared, by scope key, with the external
   * ids each one named (plan 0220, section 2).
   */
  private readonly wholeListings = new Map<string | null, Set<string>>();
  /** What a walk read of a scope whose listing is not whole. */
  private readonly partialListings = new Map<string | null, Set<string>>();
  /** Every scope a runner walked and did not declare whole, with why. */
  private readonly notWhole: NotWholeListing[] = [];
  /** The whole listings resolved to scopes, set at drain. */
  private resolvedWhole: WholeListing[] = [];
  /** Per scope id, the items an explicit scope claim of this run named. */
  private readonly claimedByScope = new Map<string, Set<string>>();
  /** Every external id the run named, for the negative availability diff. */
  private readonly observedIds = new Set<string>();
  /**
   * The row each external id was written to, bound or not.
   *
   * **Per shop availability is kept against the row, not against the item**
   * (plan 0182). A claim is stored for every row this run reported, and which
   * of them reach catalog is decided from the table by
   * `SourceEntryAvailabilityWriter`, at the end of this run and again whenever
   * a row is bound or a shop is mapped. Per scope availability below still
   * reads the item, and only an `ACTIVE` one.
   */
  private readonly entryIdByExternalId = new Map<string, string>();
  /** The item each `ACTIVE` row resolved to, which is what a scope claim uses. */
  private readonly activeItemByExternalId = new Map<string, string>();

  private readonly result: RunReportResult = {
    products: 0,
    pricesRecorded: 0,
    pricesPublished: 0,
    pricesConfirmed: 0,
    pricesConflicted: 0,
    priceConflicts: [],
    wordOrderProposals: 0,
    wordOrderRejectedPointers: 0,
    sizesDisproved: 0,
    sizesDisprovedExamples: [],
    probablePackCounts: 0,
    imagesLinked: 0,
    imagesMoved: 0,
    imagesUnchanged: 0,
    imagesRejected: 0,
    imagesUnlinked: 0,
    imageLinksFailed: 0,
    placesCreated: 0,
    placesRefreshed: 0,
    placesImported: 0,
    placesNotImported: [],
    scopesDeclared: 0,
    scopesCreated: 0,
    shopsUnmapped: [],
    shopsWritten: 0,
    availabilityWritten: 0,
    claimsStored: 0,
    claimsWritten: 0,
    claimsWaiting: 0,
    claimsWaitingForBinding: 0,
    claimsWaitingForShop: 0,
    pricelessOffersWritten: 0,
    pricelessOffersFailed: 0,
    conflicts: [],
    pricedScopes: [],
    pricesCopied: {},
    availabilityCopied: {},
    packCountsFilled: 0,
    packCountConflicts: [],
    approxWeightsWritten: 0,
    approxWeightsSkippedSetByAdmin: 0,
    approxWeightsSkippedHasSize: 0,
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
      /** Where per shop claims are kept, and what sends them (plan 0182). */
      availability: SourceEntryAvailabilityWriter;
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

  product(observation: ReportedObservation): void {
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
   * A whole listing (plan 0220, section 2), kept for the scope diff and the
   * delisting counter.
   *
   * **Refused for a chain that cannot prove a delisting** (section 15.3): the
   * capability table and the runners then cannot disagree. A refused listing is
   * named in `notWhole` and still states the positives of what it read.
   */
  listingWhole(scopeKey: string | null, listed: Iterable<string>): void {
    const ids = new Set(listed);
    if (this.input.provesDelisting !== true) {
      this.notWhole.push({
        key: scopeKey,
        reason: 'adapter-cannot-prove',
        detail: [],
      });
      this.partialListings.set(scopeKey, ids);
      return;
    }
    this.wholeListings.set(scopeKey, ids);
  }

  listingNotWhole(
    scopeKey: string | null,
    reason: string,
    detail: readonly unknown[] = [],
    listed?: Iterable<string>
  ): void {
    this.notWhole.push({ key: scopeKey, reason, detail: [...detail] });
    if (listed) {
      this.partialListings.set(scopeKey, new Set(listed));
    }
  }

  /**
   * The whole listings of this run, resolved to their scopes, and the scopes
   * that were not whole (plan 0220, section 4.4). Read after {@link drain}.
   */
  delistingListings(): DelistingListings {
    return {
      whole: this.resolvedWhole.map((listing) => ({
        ...listing,
        claimed: [...(this.claimedByScope.get(listing.scopeId) ?? [])],
      })),
      notWhole: [...this.notWhole],
    };
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
      const { outcomes, counters, copies, priceConflicts, images, sizeDoubts } =
        await this.session.close();
      this.result.imagesLinked = images.linked;
      this.result.imagesMoved = images.moved;
      this.result.imagesUnchanged = images.unchanged;
      this.result.imagesRejected = images.rejected;
      this.result.imagesUnlinked = images.unlinked;
      this.result.imageLinksFailed = images.failed;
      this.result.pricesRecorded += counters.pricesRecorded;
      this.result.pricesPublished += counters.pricesWritten;
      this.result.pricesConfirmed += counters.pricesConfirmed;
      this.result.pricesConflicted += counters.pricesConflicted;
      this.result.wordOrderProposals += counters.wordOrderProposals;
      this.result.wordOrderRejectedPointers +=
        counters.wordOrderRejectedPointers;
      this.result.sizesDisproved += counters.sizesDisproved;
      this.result.probablePackCounts += counters.probablePackCounts;
      this.result.sizesDisprovedExamples = sizeDoubts;
      this.result.priceConflicts = priceConflicts.slice(
        0,
        PRICE_CONFLICTS_NAMED
      );
      this.result.pricedScopes = [...copies.pricedScopes];
      this.result.pricesCopied = Object.fromEntries(copies.pricesCopied);
      await this.fillPackCounts(outcomes);
      await this.writeApproxWeights(outcomes);
    }
    this.result.scopesCreated = this.deps.scopes?.createdCount ?? 0;
    this.resolveWholeListings();

    // A run that writes prices only states no stock, per shop or per scope, and
    // its copies state none either (plan 0119, section 7).
    if (this.input.writes !== HarvestRunWrites.PRICES) {
      await this.writeShopAvailability();
      await this.writeScopeAvailability();
      await this.writePricelessOffers();
    }
    return this.result;
  }

  /**
   * The pack counts this run read, onto the products that have none (plan
   * 0162, section 3).
   *
   * Only an `ACTIVE` row names its product, which is the rule that decides a
   * price as well. The rows are grouped by product first: a product two rows
   * bound to with two different counts is left out and named in the report,
   * because a pack size makes a new product and a disagreement is a bad merge.
   * Catalog writes each count only where the product has none, so a count a
   * person corrected survives every run.
   *
   * A partial observation carries the row's stored count, which is what the
   * last full read said, so a walk that fetched no detail still fills.
   */
  private async fillPackCounts(
    outcomes: readonly SourceEntryOutcome[]
  ): Promise<void> {
    const counts = new Map<string, Set<number>>();
    for (const outcome of outcomes) {
      const count = outcome.entry.packCount ?? null;
      if (!outcome.itemId || count === null) {
        continue;
      }
      const held = counts.get(outcome.itemId) ?? new Set<number>();
      held.add(Number(count));
      counts.set(outcome.itemId, held);
    }

    const fills: PackCountFill[] = [];
    for (const [itemId, held] of counts) {
      if (held.size === 1) {
        fills.push({ itemId, packCount: [...held][0] });
        continue;
      }
      this.result.packCountConflicts.push({
        itemId,
        packCounts: [...held].sort((a, b) => a - b),
      });
    }
    for (let i = 0; i < fills.length; i += PACK_COUNT_FILL_MAX) {
      const { written } = await this.deps.catalog.fillPackCounts(
        fills.slice(i, i + PACK_COUNT_FILL_MAX)
      );
      this.result.packCountsFilled += written;
    }
  }

  /**
   * The weight of one piece this run read, onto the products its rows are
   * bound to (plan 0244, section 5.7). After the prices, in the shape of
   * {@link fillPackCounts}.
   *
   * Only an `ACTIVE` row names its product. Unlike a pack count, a weight is
   * rewritten on every run, so the latest run wins (D2). Catalog skips a
   * product that has a size and one whose weight a person wrote, and the
   * report counts both.
   *
   * **Rows that disagree write nothing.** Two pieces of different weight are
   * two products (owner, 2026-11-03), so two `ACTIVE` rows of this chain on
   * one product with two weights are a bad merge. That product is left out
   * and the run warns `APPROX_WEIGHT_ROWS_DISAGREE`, naming it and the rows.
   *
   * A partial observation carries the row's stored weight, which is what the
   * listing or the last full read said, so a walk that fetched no detail
   * still writes.
   */
  private async writeApproxWeights(
    outcomes: readonly SourceEntryOutcome[]
  ): Promise<void> {
    // Per product, per row: the same row twice in a run is one row.
    const byItem = new Map<string, Map<string, WeighedRow>>();
    for (const outcome of outcomes) {
      const weight = outcome.entry.approxWeight ?? null;
      if (!outcome.itemId || weight === null) {
        continue;
      }
      const rows = byItem.get(outcome.itemId) ?? new Map<string, WeighedRow>();
      rows.set(outcome.entry.id, {
        entryId: outcome.entry.id,
        externalId: outcome.entry.externalId,
        approxWeight: Number(weight),
      });
      byItem.set(outcome.itemId, rows);
    }

    const fills: ApproxWeightFill[] = [];
    for (const [itemId, rows] of byItem) {
      const weights = new Set(
        [...rows.values()].map((row) => row.approxWeight)
      );
      if (weights.size === 1) {
        fills.push({ itemId, approxWeight: [...weights][0] });
        continue;
      }
      this.warnWeightsDisagree(itemId, [...rows.values()]);
    }
    for (let i = 0; i < fills.length; i += APPROX_WEIGHT_FILL_MAX) {
      const answer = await this.deps.catalog.setApproxWeights(
        fills.slice(i, i + APPROX_WEIGHT_FILL_MAX)
      );
      this.result.approxWeightsWritten += answer.written;
      this.result.approxWeightsSkippedSetByAdmin += answer.skippedSetByAdmin;
      this.result.approxWeightsSkippedHasSize += answer.skippedHasSize;
    }
  }

  private warnWeightsDisagree(itemId: string, rows: WeighedRow[]): void {
    const named = [...rows]
      .sort((a, b) => a.approxWeight - b.approxWeight)
      .map(
        (row) => `${row.externalId} (${row.entryId}) at ${row.approxWeight} g`
      )
      .join(', ');
    this.context.warn({
      code: HarvestWarningCode.APPROX_WEIGHT_ROWS_DISAGREE,
      message:
        `The product ${itemId} is bound to rows of this chain that state ` +
        `different weights of one piece: ${named}. Two pieces of different ` +
        'weight are two products, so no weight was written onto it. Split ' +
        'the product, or remove the row that does not belong.',
      offerId: rows[0]?.externalId ?? null,
      page: null,
      name: null,
    });
  }

  /**
   * Each whole listing to the scope it names, as the scope diff resolves a key:
   * null is the run's default scope, and any other key goes through the
   * resolver. A key that resolves to nothing is named and not counted.
   */
  private resolveWholeListings(): void {
    this.resolvedWhole = [];
    for (const [key, listed] of this.wholeListings) {
      const scopeId = this.scopeIdOf(key);
      if (!scopeId) {
        this.notWhole.push({ key, reason: 'scope-unresolved', detail: [] });
        continue;
      }
      this.resolvedWhole.push({ key, scopeId, listed: [...listed] });
    }
  }

  private scopeIdOf(scopeKey: string | null): string | null {
    return scopeKey === null
      ? this.input.defaultPriceScopeId
      : (this.deps.scopes?.idFor(scopeKey) ?? null);
  }

  /** Append to the serial chain, so writes happen in the order reported. */
  private queue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work);
  }

  private async pushProducts(
    chunk: readonly ReportedObservation[]
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
      copiesOf: this.input.copiesOf,
      writes: this.input.writes,
    });

    const outcomes = await this.session.push(chunk);
    this.result.products += chunk.length;

    // Which row each product was written to, for the per shop claims the run
    // states afterwards, and which item each `ACTIVE` row resolved to, for the
    // per scope ones. Only an `ACTIVE` row answers an item, which is the same
    // rule that decides whether the row is owed a price.
    for (const outcome of outcomes) {
      this.entryIdByExternalId.set(outcome.entry.externalId, outcome.entry.id);
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
      created: written.created,
      unchanged: written.refreshed,
    });
    // A place is the unit of a store discovery, unless the runner counts its
    // own (plan 0217, section 4). Then this adds nothing.
    await this.context.advance(chunk.length);
  }

  /**
   * Availability a source stated per shop of its own (plan 0103, section 6.3).
   *
   * **Every claim is stored first, and what is ready is sent from the table**
   * (plan 0182). The codes are resolved through `SourceLocationService`, which
   * is the queue a person works, and a claim is kept against the source's own
   * row and the source's own shop whether or not either is decided yet. A row
   * nobody has bound and a shop nobody has mapped write nothing to catalog
   * now, are counted, and are sent the moment the row is bound or the shop is
   * mapped. The first run of a chain used to lose every claim it made here,
   * because on a first run nothing is bound.
   *
   * A claim about a product this run did not report has no row to be kept
   * against and is dropped, which no runner does today: each of them reports
   * the product before it states where the product is.
   */
  private async writeShopAvailability(): Promise<void> {
    const names = new Map<string, string>();
    for (const claim of this.claims) {
      if (claim.shopCode) {
        names.set(claim.shopCode, claim.shopName ?? claim.shopCode);
      }
    }
    const supermarketId = this.input.supermarketId;
    if (names.size === 0 || !supermarketId) {
      return;
    }

    const rows = await this.deps.shops.observe(
      supermarketId,
      [...names].map(([externalId, printedName]) => ({
        externalId,
        printedName,
      })),
      this.context.runId
    );

    const shopIdByCode = new Map<string, string>();
    for (const row of rows) {
      shopIdByCode.set(row.externalId, row.id);
      if (!row.supermarketLocationId) {
        this.result.shopsUnmapped.push({
          code: row.externalId,
          name: row.printedName,
        });
      }
    }

    const stored: StoredClaim[] = [];
    for (const claim of this.claims) {
      const sourceLocationId = claim.shopCode
        ? shopIdByCode.get(claim.shopCode)
        : undefined;
      const entryId = this.entryIdByExternalId.get(claim.externalId);
      if (sourceLocationId && entryId) {
        stored.push({ entryId, sourceLocationId, available: claim.available });
      }
    }
    await this.deps.availability.store(stored, this.context.runId, new Date());

    // Read back from the table and not from memory, so the end of a run sends
    // exactly what binding a row or mapping a shop would send afterwards.
    const sent = await this.deps.availability.writeForRun(
      this.context.runId,
      supermarketId
    );
    this.result.shopsWritten += sent.shops;
    this.result.availabilityWritten += sent.written;
    this.result.conflicts.push(...sent.conflicts);

    const counts = await this.deps.availability.countsForRun(
      this.context.runId
    );
    this.result.claimsStored = counts.stored;
    this.result.claimsWritten = counts.written;
    this.result.claimsWaitingForBinding = counts.waitingForBinding;
    this.result.claimsWaitingForShop = counts.waitingForShop;
    this.result.claimsWaiting =
      counts.waitingForBinding + counts.waitingForShop;
  }

  /**
   * The offer with no price for every bound row this run saw (plan 0182).
   *
   * A chain that lists a product sells it. A row bound today gets the offer
   * when it is bound; a row bound before the offer existed gets it here, and
   * both go through `SourceEntryAvailabilityWriter`. Last, after the two
   * availability writes, so a row they created is one this leaves alone. The
   * offer never changes a row that exists, so a run that follows one which
   * wrote them reads and writes nothing.
   *
   * **A call to catalog that fails here does not fail the run**, unlike the
   * two availability writes above it, which reject the drain. Those state
   * what this run read and nothing sends them again. The offer is sent again
   * by every run, so the products of a failed call are counted and the rest
   * is kept.
   */
  private async writePricelessOffers(): Promise<void> {
    const supermarketId = this.input.supermarketId;
    if (!supermarketId || !this.session) {
      // No chain, or a run that reported no product: it saw no row.
      return;
    }
    const sent = await this.deps.availability.writePricelessOffersForRun(
      this.context.runId,
      supermarketId
    );
    this.result.pricelessOffersWritten = sent.written;
    this.result.pricelessOffersFailed = sent.failed;
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
   *
   * **A whole listing decides the diff** (plan 0220, section 3). For a scope a
   * runner declared whole with `listingWhole`, per tracked `ACTIVE` row:
   *
   * - Named by the listing: the positive when the run reported it, with
   *   `outOfStock: false`, and the explicit claims, which override it. A named
   *   row the run failed to read further gets no statement, and neither does
   *   another row of its product, so a failed detail never writes a negative.
   * - Not named, and the scope never listed it (no presence row and no price
   *   the scope read itself): `false`, as plan 0108 requires. The scope never
   *   sold it, and the row says so.
   * - Not named, and the scope once listed it: nothing here. The delisting
   *   counter is the one writer for it, out of stock at the first miss and
   *   gone at the threshold.
   *
   * A listing that is not whole states the positives of what it read and the
   * claims, and no negative. A scope with `assortmentComplete` and no listing
   * keeps the rule of plan 0103: every tracked row the run did not report is
   * not stocked.
   *
   * **A copy writes the same entries at each target** (plan 0118, section 6),
   * the positives, the negatives and the explicit claims alike, because they
   * are one statement about the assortment the walk read. A per shop claim is
   * not copied: it names a shop, not a scope.
   */
  private async writeScopeAvailability(): Promise<void> {
    const supermarketId = this.input.supermarketId;
    const keys = new Set<string | null>([
      ...this.complete,
      ...this.wholeListings.keys(),
      ...this.partialListings.keys(),
    ]);
    if (!supermarketId || keys.size === 0) {
      // Nothing to state. A run that walked no whole assortment and named no
      // scope has only positives, and a positive with no scope to write it for
      // is not a claim anybody can read.
      return;
    }

    const tracked = await this.deps.entries.find({
      where: {
        supermarketId,
        sourceKind: this.input.sourceKind,
        status: SourceEntryStatus.ACTIVE,
      },
    });
    // A claim may name a product the run did not report: a Mercadona detail
    // that answered 404 is "not stocked here" and is never an observation. Its
    // item is read off the tracked row.
    const trackedItem = new Map<string, string>();
    for (const row of tracked) {
      if (row.itemId) {
        trackedItem.set(row.externalId, row.itemId);
      }
    }

    for (const scopeKey of keys) {
      const scopeId = this.scopeIdOf(scopeKey);
      if (!scopeId) {
        continue;
      }
      const whole = this.wholeListings.get(scopeKey);
      const listing = whole ?? this.partialListings.get(scopeKey) ?? null;

      const byItem = new Map<string, SupermarketItemAvailabilityEntry>();
      // Everything the run named is stocked here, by the fact it was listed.
      // With a listing, only what this scope's listing named. A whole listing
      // also says the product is on the shelf, which clears the out of stock
      // mark of a first miss; a claim below overrides it (section 15.1).
      for (const [externalId, itemId] of this.activeItemByExternalId) {
        if (
          this.observedIds.has(externalId) &&
          (listing === null || listing.has(externalId))
        ) {
          byItem.set(
            itemId,
            whole
              ? { itemId, available: true, outOfStock: false }
              : { itemId, available: true }
          );
        }
      }
      const claimed = new Set<string>();
      // What the source said outright beats what the listing implied.
      for (const claim of this.claims) {
        if (claim.shopCode || (claim.scopeKey ?? null) !== scopeKey) {
          continue;
        }
        const itemId =
          this.activeItemByExternalId.get(claim.externalId) ??
          trackedItem.get(claim.externalId);
        if (itemId) {
          claimed.add(itemId);
          byItem.set(itemId, {
            itemId,
            available: claim.available,
            ...(claim.outOfStock === undefined
              ? {}
              : { outOfStock: claim.outOfStock }),
          });
        }
      }

      if (claimed.size > 0) {
        this.claimedByScope.set(scopeId, claimed);
      }

      if (whole) {
        const unnamed = tracked.filter(
          (row) => row.itemId && !whole.has(row.externalId)
        );
        // A product a named row stands for is not the scope's negative, even
        // when that row's detail failed and stated nothing.
        const named = new Set(
          tracked
            .filter((row) => row.itemId && whole.has(row.externalId))
            .map((row) => row.itemId as string)
        );
        const once = await this.listedOnceAt(
          scopeId,
          unnamed.map((row) => row.id)
        );
        // A product the counter tracks here through any of its rows is the
        // counter's, so no other row of it writes a negative.
        const counted = new Set(
          unnamed
            .filter((row) => once.has(row.id))
            .map((row) => row.itemId as string)
        );
        for (const row of unnamed) {
          const itemId = row.itemId as string;
          if (
            once.has(row.id) ||
            counted.has(itemId) ||
            named.has(itemId) ||
            byItem.has(itemId)
          ) {
            continue;
          }
          byItem.set(itemId, { itemId, available: false });
        }
      } else if (listing === null) {
        for (const row of tracked) {
          if (!row.itemId || this.observedIds.has(row.externalId)) {
            continue;
          }
          // A product two rows resolve to is stocked if either row saw it: the
          // false would be a claim the source never made.
          if (!byItem.has(row.itemId)) {
            byItem.set(row.itemId, { itemId: row.itemId, available: false });
          }
        }
      }

      const entries = [...byItem.values()];
      for (let i = 0; i < entries.length; i += AVAILABILITY_BATCH) {
        await this.deps.catalog.setAvailability(
          scopeId,
          entries.slice(i, i + AVAILABILITY_BATCH)
        );
      }
      this.result.availabilityWritten += entries.length;
      for (const target of this.input.copiesOf?.(scopeId) ?? []) {
        for (let i = 0; i < entries.length; i += AVAILABILITY_BATCH) {
          await this.deps.catalog.setAvailability(
            target,
            entries.slice(i, i + AVAILABILITY_BATCH)
          );
        }
        this.result.availabilityCopied[scopeId] =
          (this.result.availabilityCopied[scopeId] ?? 0) + entries.length;
      }
      this.logger.log(
        `Run ${this.context.runId}: availability for ${entries.length} item(s)`
      );
    }
  }

  /**
   * Of these rows, the ones this scope once listed (plan 0220, section 3): a
   * presence row at the scope, or a price the scope read itself, of this run's
   * kind. A copy writes rows at its targets too, and a copy target was never
   * listed, so a copied price does not count. It is the seed's own condition
   * (section 4.2, step 2), so the counter seeds exactly the rows this leaves
   * to it.
   */
  private async listedOnceAt(
    scopeId: string,
    entryIds: readonly string[]
  ): Promise<Set<string>> {
    if (entryIds.length === 0) {
      return new Set();
    }
    const rows: { id: string }[] = await this.deps.entries.query(
      `
      SELECT e."id"::text AS "id"
        FROM "source_catalog_entries" e
       WHERE e."id" = ANY($1::uuid[])
         AND (
           EXISTS (
             SELECT 1 FROM "source_entry_scope_presence" s
              WHERE s."entryId" = e."id" AND s."priceScopeId" = $2::uuid
           )
           OR EXISTS (
             SELECT 1 FROM "source_entry_prices" p
              WHERE p."entryId" = e."id"
                AND p."priceScopeId" = $2::uuid
                AND p."copiedFromScopeId" IS NULL
                AND p."sourceKind" = $3
           )
         )
      `,
      [[...entryIds], scopeId, this.input.sourceKind]
    );
    return new Set(rows.map((row) => row.id));
  }
}
