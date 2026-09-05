import { Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import {
  DISCOVERED_PLACE_SEED,
  HARVEST_RUN_SEED,
  SOURCE_ENTRY_SEED,
  SOURCE_LOCATION_SEED,
  SUPERMARKET_SOURCE_SEED,
} from './harvest-seed';
import type {
  AcceptSourceEntryInput,
  CreateItemFromSourceEntryInput,
  EntryQuery,
  HarvestServiceI,
  ImportHarvestDocumentInput,
  PageQuery,
  PlaceGroupQuery,
  PlaceQuery,
  RunQuery,
  ShopQuery,
  SourceEntryAcceptResult,
} from './harvest-service';

/** How many rows a page holds when nothing asks for a size. */
const PAGE_SIZE = 25;

/**
 * The harvester, served out of memory.
 *
 * It is the default binding of {@link HARVEST_SERVICE}, so every spec and every
 * run with nothing listening gets working screens with no configuration.
 *
 * Two behaviours here are not decoration. It **mutates**, so confirming a
 * candidate takes it out of the unresolved queue and the next item really is the
 * next one, which is the property the queue screens are built around. And it
 * **paginates by index**, minting its own cursors, so a bug in a queue's own
 * paging cannot survive every spec that used this.
 *
 * The running run advances a little on each read, which is what makes the poll
 * observable without a backend. It stops at the planned total and finishes,
 * rather than counting forever past a denominator it was given.
 */
@Injectable({ providedIn: 'root' })
export class HarvestMemory implements HarvestServiceI {
  private readonly _runs: Wire.HarvestHarvestRunView[] =
    clone(HARVEST_RUN_SEED);
  private readonly _places: Wire.HarvestDiscoveredPlaceView[] = clone(
    DISCOVERED_PLACE_SEED
  );
  private readonly _entries: Wire.HarvestSourceCatalogEntryView[] =
    clone(SOURCE_ENTRY_SEED);
  private readonly _sources: Wire.HarvestSupermarketSourceView[] = clone(
    SUPERMARKET_SOURCE_SEED
  );
  private readonly _shops: Wire.HarvestSourceLocationView[] =
    clone(SOURCE_LOCATION_SEED);

  private _nextId = 1;

  async spawnRun(
    input: Wire.SpawnHarvestRunDto
  ): Promise<Wire.HarvestHarvestRunView> {
    // The real service answers 409 carrying the active run's id, because one
    // harvester runs one thing at a time. Refusing here too keeps the screen's
    // conflict branch reachable with no backend.
    const active = this._runs.find(
      (run) => run.status === 'PENDING' || run.status === 'RUNNING'
    );
    if (active !== undefined) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
      });
    }

    const now = new Date().toISOString();
    const run: Wire.HarvestHarvestRunView = {
      id: mintRunId(this._nextId++),
      supermarketId: input.supermarketId ?? null,
      sourceId: null,
      mode: input.mode,
      trigger: 'MANUAL',
      status: 'PENDING',
      requestedAt: now,
      startedAt: null,
      finishedAt: null,
      heartbeatAt: now,
      totalPlanned: null,
      processed: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      notFound: 0,
      // Nothing has run yet, so nothing has been dropped by a rule and no
      // document has been read (backend plan 0081, section 7).
      skipped: 0,
      failed: 0,
      stage: null,
      stageLabel: null,
      warnings: [],
      documentSha256: null,
      abortRequestedAt: null,
      error: null,
      // A run says nothing beyond its counters until it has finished and has
      // something to say (backend plan 0085).
      report: {},
      correlationId: null,
      // The audit trail attributes a run's writes to the service and not to the
      // operator who started it (plan 0006, section 6; backend plan 0075).
      requestedByUserId: null,
      // Nothing has been taken back from a run that has not run (backend plan
      // 0082).
      revertedAt: null,
      revertedByUserId: null,
      revertedPriceCount: null,
    };

    this._runs.unshift(run);
    return { ...run };
  }

  async listRuns(query: RunQuery): Promise<Wire.HarvestHarvestRunPage> {
    const matching = this._runs.filter(
      (run) =>
        (query.supermarketId === undefined ||
          run.supermarketId === query.supermarketId) &&
        (query.mode === undefined || run.mode === query.mode) &&
        (query.status === undefined || run.status === query.status) &&
        (query.reverted === undefined ||
          query.reverted === (run.revertedAt !== null))
    );

    return page(matching, query);
  }

  async readRun(id: string): Promise<Wire.HarvestHarvestRunView> {
    const run = this._runs.find((candidate) => candidate.id === id);
    if (run === undefined) {
      throw notFound();
    }

    this._advance(run);
    return { ...run };
  }

  async abortRun(id: string): Promise<Wire.HarvestHarvestRunView> {
    const run = this._runs.find((candidate) => candidate.id === id);
    if (run === undefined) {
      throw notFound();
    }

    // Graceful, exactly as the real one is: what was fetched before the abort is
    // kept, because prices already fetched are valid.
    run.abortRequestedAt = new Date().toISOString();
    run.status = 'ABORTED';
    run.finishedAt = run.abortRequestedAt;
    return { ...run };
  }

  /**
   * Take back what a run wrote (backend plan 0082).
   *
   * The refusals are the real one's, because they are what the screen draws
   * around: a second revert is a 409, and so is one asked of a run that has not
   * finished. The status is left exactly as it was, which is the rule the chip
   * on the runs list exists to show.
   *
   * The price count is the run's own `created`, which is what the confirmation
   * offered. The real service answers what catalog actually deleted, and the
   * two differ when an accepted row wrote more prices on the run's behalf; with
   * no catalog behind this there is nothing better to say.
   */
  async revertRun(id: string): Promise<Wire.HarvestHarvestRunView> {
    const run = this._runs.find((candidate) => candidate.id === id);
    if (run === undefined) {
      throw notFound();
    }
    if (run.revertedAt !== null) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
      });
    }
    if (run.status === 'PENDING' || run.status === 'RUNNING') {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
      });
    }

    run.revertedAt = new Date().toISOString();
    run.revertedByUserId = 'operator';
    run.revertedPriceCount = run.created;
    return { ...run };
  }

  async listPlaces(
    query: PlaceQuery
  ): Promise<Wire.HarvestDiscoveredPlacePage> {
    const matching = this._places.filter(
      (place) =>
        (query.runId === undefined || place.runId === query.runId) &&
        (query.brandKey === undefined || place.brandKey === query.brandKey) &&
        (query.status === undefined || place.status === query.status)
    );

    return page(matching, query);
  }

  async placeGroups(
    query: PlaceGroupQuery
  ): Promise<Wire.HarvestDiscoveredPlaceGroupsResult> {
    const matching = this._places.filter(
      (place) => query.runId === undefined || place.runId === query.runId
    );

    // Grouped on `brand:wikidata` and never on the name, which is the whole
    // point of the key: `Dia` and `Maxi Dia` share one QID.
    const byKey = new Map<string, Wire.HarvestDiscoveredPlaceView[]>();
    for (const place of matching) {
      const key = place.brandKey ?? '';
      byKey.set(key, [...(byKey.get(key) ?? []), place]);
    }

    const sampleSize = query.sampleSize ?? 3;
    return {
      groups: [...byKey.values()].map((places) => ({
        brandKey: places[0].brandKey,
        brandName: places[0].brandName,
        count: places.length,
        known: false,
        supermarketId: null,
        sample: places.slice(0, sampleSize).map((place) => ({ ...place })),
      })),
    };
  }

  async importPlace(
    id: string,
    input: Wire.ImportDiscoveredPlaceDto
  ): Promise<Wire.HarvestDiscoveredPlaceView> {
    return this._decidePlace(id, 'IMPORTED', input.supermarketId ?? null);
  }

  async rejectPlace(id: string): Promise<Wire.HarvestDiscoveredPlaceView> {
    return this._decidePlace(id, 'REJECTED', null);
  }

  /**
   * One chain's rows, filtered as the queue filters them.
   *
   * No status asked for means the queue: `CANDIDATE` and `UNRESOLVED` together,
   * which is what is waiting for a person. That default is the route's, not the
   * screen's, so it lives here rather than in the page.
   */
  async listEntries(
    query: EntryQuery
  ): Promise<Wire.HarvestSourceCatalogEntryPage> {
    const term = (query.query ?? '').trim().toLowerCase();
    const matching = this._entries.filter(
      (entry) =>
        entry.supermarketId === query.supermarketId &&
        (query.status === undefined
          ? entry.status === 'CANDIDATE' || entry.status === 'UNRESOLVED'
          : entry.status === query.status) &&
        (query.sourceKind === undefined ||
          entry.sourceKind === query.sourceKind) &&
        (term === '' ||
          entry.name.toLowerCase().includes(term) ||
          (entry.brand ?? '').toLowerCase().includes(term) ||
          (entry.ean ?? '').includes(term))
    );

    return page(matching, query);
  }

  /**
   * Bind a row to a product the catalog already holds.
   *
   * The chain's own `name` is **not touched**, which is the owner's rule and the
   * reason the column exists: the item can be renamed at will afterwards and the
   * next run that observes the same key still resolves.
   */
  async acceptEntry(
    id: string,
    input: AcceptSourceEntryInput
  ): Promise<SourceEntryAcceptResult> {
    const entry = this._entry(id);
    this._bind(entry, input.itemId);

    return {
      entry: { ...entry },
      pricesWritten: writablePrices(entry),
      createdItem: null,
    };
  }

  /**
   * The same, for a product the catalog does not hold yet.
   *
   * Every field of the input is optional and the row is the default for each, so
   * this fills in from the row exactly as the harvester does. `name.en` may be
   * absent and stays absent (backend plan 0079): before that plan the only way
   * to save a leaflet product was to copy the Spanish string into English, where
   * it claimed to be a translation.
   */
  async createItemFromEntry(
    id: string,
    input: CreateItemFromSourceEntryInput
  ): Promise<SourceEntryAcceptResult> {
    const entry = this._entry(id);
    const es = input.name?.es ?? entry.name;
    const en = input.name?.en;

    const item: Wire.CatalogItemView = {
      id: `item-${this._nextId++}`,
      name: en === undefined || en === '' ? { es } : { es, en },
      brand: input.brand ?? entry.brand,
      imageUrl: null,
      sku: entry.externalId,
      ean: input.ean ?? entry.ean,
      unitSize: input.unitSize ?? entry.unitSize,
      category: input.category ?? 'OTHER',
      defaultUnit: input.defaultUnit ?? 'UNIT',
      productGroupId: null,
    };

    this._bind(entry, item.id);

    return {
      entry: { ...entry },
      pricesWritten: writablePrices(entry),
      createdItem: item,
    };
  }

  /**
   * Not a product he tracks.
   *
   * The row stays as `REJECTED` rather than being deleted, so the next run that
   * observes the key touches it and asks nobody. The status is the owner's, and
   * a run does not get to overwrite a decision.
   */
  async rejectEntry(id: string): Promise<Wire.HarvestSourceCatalogEntryView> {
    const entry = this._entry(id);
    entry.status = 'REJECTED';
    entry.itemId = null;
    entry.matchedBy = 'MANUAL';
    entry.decidedAt = new Date().toISOString();
    return { ...entry };
  }

  /**
   * A document, imported (backend plan 0086, section 6.2).
   *
   * The refusal modelled here is the **document** one: a second upload of one
   * digest for one chain is 409, and reverting the earlier run is what makes a
   * corrected upload possible. That is the 409 this screen is built around, and
   * it is the one that is otherwise unreachable with nothing listening.
   *
   * The per chain run lock is deliberately not modelled. The seed always has a
   * catalog discovery running, so enforcing it here would make the upload
   * screen answer 409 to every operator who has no backend, which is exactly
   * the audience this seed exists for. The runs screen already draws that
   * refusal, from `spawnRun`, which does enforce it.
   */
  async importDocument(
    input: ImportHarvestDocumentInput
  ): Promise<Wire.HarvestHarvestRunView> {
    const sha256 = digestOf(input.document);
    const duplicate = this._runs.find(
      (run) =>
        run.supermarketId === input.supermarketId &&
        run.documentSha256 !== null &&
        run.documentSha256 === sha256 &&
        run.status !== 'FAILED' &&
        // A reverted run does not block a corrected upload, which is the whole
        // of backend plan 0082's requirement on the index: reverting is how a
        // document that was imported wrongly gets imported again.
        run.revertedAt === null
    );
    if (duplicate !== undefined) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
        detail:
          `That document has already been imported for this chain by run ` +
          `${duplicate.id}. Revert that run to import it again.`,
      });
    }

    const now = new Date().toISOString();
    const run: Wire.HarvestHarvestRunView = {
      id: mintRunId(this._nextId++),
      supermarketId: input.supermarketId,
      // Never a source. An upload fetches nothing, so a chain that publishes
      // only leaflets needs no source row at all.
      sourceId: null,
      mode: 'FILE_IMPORT',
      trigger: 'MANUAL',
      status: 'PENDING',
      requestedAt: now,
      startedAt: null,
      finishedAt: null,
      heartbeatAt: now,
      totalPlanned: null,
      processed: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      notFound: 0,
      skipped: 0,
      failed: 0,
      stage: null,
      stageLabel: null,
      warnings: [],
      documentSha256: sha256,
      abortRequestedAt: null,
      error: null,
      report: {},
      correlationId: null,
      requestedByUserId: null,
      // Nothing has run, so there is nothing to have taken back.
      revertedAt: null,
      revertedByUserId: null,
      revertedPriceCount: null,
    };

    this._runs.unshift(run);
    return { ...run };
  }

  /**
   * A finished run's rows, as a document (backend plan 0086, section 6.2).
   *
   * Only the rows this run was the last to observe, which is the rule the export
   * button's own help text states: a chain walked again since answers fewer
   * rows. Modelling it here rather than answering every row keeps the button's
   * warning honest with nothing listening.
   */
  async exportRun(id: string): Promise<Readonly<Record<string, unknown>>> {
    const run = this._runs.find((candidate) => candidate.id === id);
    if (run === undefined) {
      throw notFound();
    }

    const rows = this._entries.filter(
      (entry) =>
        entry.supermarketId === run.supermarketId && entry.lastRunId === run.id
    );

    return {
      schema_version: 1,
      sha256: `memory-${run.id}`,
      producer: {
        name: 'luna-harvester',
        version: '0.0.0',
        produced_at: new Date().toISOString(),
      },
      hints: {
        chain_id: run.supermarketId,
        source_kind: rows[0]?.sourceKind ?? 'OFFICIAL_API',
      },
      products: rows.map((entry) => ({
        id: entry.id,
        external_id: entry.externalId,
        name: entry.name,
        brand: entry.brand,
        ean: entry.ean,
        size: { label: entry.sizeFormat, quantity: entry.unitSize },
        category_path: entry.categoryPath,
        url: entry.url,
        extra: entry.extra,
      })),
      warnings: [],
    };
  }

  /**
   * One chain's shops, filtered by status.
   *
   * Chain scoped with no default, because the route's `supermarketId` is
   * required: a queue over every source's shops would be a list nobody could
   * act on, since the mapping only means anything inside one chain.
   */
  async listShops(query: ShopQuery): Promise<Wire.HarvestSourceLocationPage> {
    const matching = this._shops.filter(
      (shop) =>
        shop.supermarketId === query.supermarketId &&
        (query.status === undefined || shop.status === query.status)
    );

    return page(matching, query);
  }

  /**
   * Bind one row to a shop of ours.
   *
   * `MANUAL`, always, because a person did it. That is the whole point of the
   * column: a row the automatic name match bound and a row somebody checked
   * look identical otherwise and carry different confidence.
   */
  async mapShop(
    id: string,
    input: Wire.MapSourceLocationDto
  ): Promise<Wire.HarvestSourceLocationView> {
    const shop = this._shop(id);
    shop.supermarketLocationId = input.supermarketLocationId;
    shop.status = 'ACTIVE';
    shop.matchedBy = 'MANUAL';
    return { ...shop };
  }

  async unmapShop(id: string): Promise<Wire.HarvestSourceLocationView> {
    const shop = this._shop(id);
    shop.supermarketLocationId = null;
    shop.status = 'UNMAPPED';
    return { ...shop };
  }

  async ignoreShop(id: string): Promise<Wire.HarvestSourceLocationView> {
    const shop = this._shop(id);
    shop.status = 'IGNORED';
    return { ...shop };
  }

  /**
   * Back into the queue, at whatever the mapping already says.
   *
   * `ACTIVE` when the row still points at a shop of ours and `UNMAPPED` when it
   * does not, because ignoring never cleared the binding and un-ignoring must
   * not invent one.
   */
  async unignoreShop(id: string): Promise<Wire.HarvestSourceLocationView> {
    const shop = this._shop(id);
    shop.status = shop.supermarketLocationId === null ? 'UNMAPPED' : 'ACTIVE';
    return { ...shop };
  }

  async listSources(
    query: PageQuery
  ): Promise<Wire.HarvestSupermarketSourcePage> {
    return page(this._sources, query);
  }

  async readSource(
    supermarketId: string
  ): Promise<Wire.HarvestSupermarketSourceView> {
    const source = this._sources.find(
      (candidate) => candidate.supermarketId === supermarketId
    );
    if (source === undefined) {
      throw notFound();
    }

    return { ...source };
  }

  async upsertSource(
    supermarketId: string,
    input: Wire.UpsertSupermarketSourceDto
  ): Promise<Wire.HarvestSupermarketSourceView> {
    const existing = this._sources.find(
      (candidate) => candidate.supermarketId === supermarketId
    );

    if (existing !== undefined) {
      existing.adapterKey = input.adapterKey;
      existing.config = input.config ?? existing.config;
      existing.workers = input.workers ?? existing.workers;
      existing.maxRequestsPerSecond =
        input.maxRequestsPerSecond ?? existing.maxRequestsPerSecond;
      if (input.enabled !== undefined) {
        existing.enabled = input.enabled;
      }
      return { ...existing };
    }

    const source: Wire.HarvestSupermarketSourceView = {
      id: `source-${this._nextId++}`,
      supermarketId,
      adapterKey: input.adapterKey,
      enabled: input.enabled ?? false,
      config: input.config ?? {},
      workers: input.workers ?? 1,
      maxRequestsPerSecond: input.maxRequestsPerSecond ?? 1,
      lastRunAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    };
    this._sources.push(source);
    return { ...source };
  }

  async setSourceEnabled(
    supermarketId: string,
    enabled: boolean
  ): Promise<Wire.HarvestSupermarketSourceView> {
    const source = this._sources.find(
      (candidate) => candidate.supermarketId === supermarketId
    );
    if (source === undefined) {
      throw notFound();
    }

    source.enabled = enabled;
    return { ...source };
  }

  /**
   * A running run, one poll further along.
   *
   * Enough movement that the progress bar visibly changes between reads, and a
   * finish when the planned total is reached, so a spec watching for polling to
   * stop on a terminal status has something that actually becomes terminal.
   */
  private _advance(run: Wire.HarvestHarvestRunView): void {
    if (run.status === 'PENDING') {
      run.status = 'RUNNING';
      run.startedAt = new Date().toISOString();
      run.totalPlanned = 4383;
      run.stage = 'walk-categories';
      run.stageLabel = 'Walking the category tree';
    }

    if (run.status !== 'RUNNING') {
      return;
    }

    const total = run.totalPlanned ?? 0;
    run.heartbeatAt = new Date().toISOString();
    run.processed = Math.min(total, run.processed + 137);
    run.created += 61;
    run.unchanged += 76;

    if (total > 0 && run.processed >= total) {
      run.status = 'COMPLETED';
      run.finishedAt = run.heartbeatAt;
      run.stage = null;
      run.stageLabel = null;
    }
  }

  private _entry(id: string): Wire.HarvestSourceCatalogEntryView {
    const entry = this._entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      throw notFound();
    }
    return entry;
  }

  /** What accept and create both do to a row once the product is known. */
  private _bind(
    entry: Wire.HarvestSourceCatalogEntryView,
    itemId: string
  ): void {
    entry.itemId = itemId;
    entry.candidateEntryId = null;
    entry.status = 'ACTIVE';
    entry.matchedBy = 'MANUAL';
    entry.confidence = 1;
    entry.decidedAt = new Date().toISOString();
  }

  private _shop(id: string): Wire.HarvestSourceLocationView {
    const shop = this._shops.find((candidate) => candidate.id === id);
    if (shop === undefined) {
      throw notFound();
    }
    return shop;
  }

  private _decidePlace(
    id: string,
    status: Wire.EnumsDiscoveredPlaceStatus,
    supermarketLocationId: string | null
  ): Wire.HarvestDiscoveredPlaceView {
    const place = this._places.find((candidate) => candidate.id === id);
    if (place === undefined) {
      throw notFound();
    }

    place.status = status;
    place.supermarketLocationId = supermarketLocationId;
    return { ...place };
  }

}

/**
 * How many prices accepting this row would write (backend plan 0086, section 7).
 *
 * Every price whose window has not closed, one per scope, which is why a row
 * with two regional leaflets writes two and a DEZA row writes none. The count is
 * what the confirmation sentence names, and getting it wrong here would teach an
 * operator with no backend that accepting a priceless row had failed.
 */
function writablePrices(entry: Wire.HarvestSourceCatalogEntryView): number {
  const now = Date.now();
  return entry.prices.filter(
    (price) => price.validUntil === null || Date.parse(price.validUntil) > now
  ).length;
}

/** One page of a list, by index, with a cursor that says whether there is more. */
function page<T>(
  rows: readonly T[],
  query: PageQuery
): { items: T[]; nextCursor: string | null } {
  const from = cursorIndex(query.cursor);
  const size = query.limit ?? PAGE_SIZE;
  const items = rows.slice(from, from + size).map((row) => ({ ...row }));
  const next = from + size;

  return { items, nextCursor: next < rows.length ? String(next) : null };
}

function cursorIndex(cursor: string | undefined): number {
  const index = Number(cursor ?? '0');
  return Number.isInteger(index) && index > 0 ? index : 0;
}

function notFound(): GatewayError {
  return new GatewayError({
    code: 'not_found',
    status: 404,
    correlationId: '',
  });
}

function clone<T>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/**
 * A run's id, shaped like the server's.
 *
 * The seeded runs keep readable ids, because a spec that names one reads better
 * for it. A run this fake **creates** gets a uuid, because one of them is read
 * back out of prose: the leaflet upload's 409 names the earlier run inside a
 * sentence, and a uuid is the only shape that can be found in one (backend plan
 * 0081, section 7). `run-4` in that sentence would leave the screen with a
 * refusal it could not link anywhere, which is a state that exists nowhere but
 * here.
 */
function mintRunId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/**
 * A digest of a document, for the dedupe alone.
 *
 * **Not SHA-256.** The real digest is computed by the extractor, carried in
 * `source.sha256`, and recomputed by the harvester; a browser can only compute
 * one asynchronously through `crypto.subtle`, which is not available in the
 * test environment and is not worth a fake implementation of. So a document
 * that states its own digest is keyed on it, and one that does not is keyed on
 * its own text. Both give a second upload of one file the same key, which is
 * the only property the in-memory dedupe needs.
 */
function digestOf(document: Readonly<Record<string, unknown>>): string {
  const stated = document['sha256'];

  return typeof stated === 'string' && stated !== ''
    ? stated
    : JSON.stringify(document);
}
