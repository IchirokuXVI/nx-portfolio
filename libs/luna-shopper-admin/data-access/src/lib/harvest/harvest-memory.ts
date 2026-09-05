import { Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import {
  DISCOVERED_PLACE_SEED,
  HARVEST_RUN_SEED,
  ITEM_SOURCE_REF_SEED,
  SOURCE_ENTRY_SEED,
  SUPERMARKET_SOURCE_SEED,
} from './harvest-seed';
import type {
  EntryQuery,
  HarvestServiceI,
  ItemRefQuery,
  PageQuery,
  PlaceGroupQuery,
  PlaceQuery,
  RunQuery,
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
  private readonly _refs: Wire.HarvestItemSourceRefView[] =
    clone(ITEM_SOURCE_REF_SEED);
  private readonly _sources: Wire.HarvestSupermarketSourceView[] = clone(
    SUPERMARKET_SOURCE_SEED
  );

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
      id: `run-${this._nextId++}`,
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
      failed: 0,
      stage: null,
      stageLabel: null,
      abortRequestedAt: null,
      error: null,
      // A run says nothing beyond its counters until it has finished and has
      // something to say (backend plan 0085).
      report: {},
      correlationId: null,
      // The audit trail attributes a run's writes to the service and not to the
      // operator who started it (plan 0006, section 6; backend plan 0075).
      requestedByUserId: null,
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
        (query.status === undefined || run.status === query.status)
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

  async listEntries(
    query: EntryQuery
  ): Promise<Wire.HarvestSourceCatalogEntryPage> {
    const term = (query.query ?? '').trim().toLowerCase();
    const matching = this._entries.filter(
      (entry) =>
        entry.supermarketId === query.supermarketId &&
        (term === '' || entry.name.toLowerCase().includes(term))
    );

    return page(matching, query);
  }

  async createItemFromEntry(
    supermarketId: string,
    entryId: string,
    input: Wire.CreateItemFromEntryDto
  ): Promise<Wire.CatalogItemView> {
    const entry = this._entries.find(
      (candidate) =>
        candidate.id === entryId && candidate.supermarketId === supermarketId
    );
    if (entry === undefined) {
      throw notFound();
    }

    // Imported entries leave the queue, so the next one comes up by itself.
    this._entries.splice(this._entries.indexOf(entry), 1);

    return {
      id: `item-${this._nextId++}`,
      name: { en: entry.name, es: entry.name },
      brand: entry.brand,
      imageUrl: null,
      sku: entry.externalId,
      ean: entry.ean,
      unitSize: entry.unitSize,
      category: input.category ?? 'OTHER',
      defaultUnit: 'UNIT',
      productGroupId: null,
    };
  }

  async listItemRefs(
    query: ItemRefQuery
  ): Promise<Wire.HarvestItemSourceRefPage> {
    return page(
      this._refs.filter((ref) => matchesRef(ref, query)),
      query
    );
  }

  async listUnresolvedItemRefs(
    query: ItemRefQuery
  ): Promise<Wire.HarvestItemSourceRefPage> {
    const matching = this._refs.filter(
      (ref) => ref.status === 'CANDIDATE' && matchesRef(ref, query)
    );

    return page(matching, query);
  }

  async setManualItemRef(
    input: Wire.SetManualItemSourceRefDto
  ): Promise<Wire.HarvestItemSourceRefView> {
    const existing = this._refs.find(
      (ref) =>
        ref.itemId === input.itemId && ref.supermarketId === input.supermarketId
    );

    const now = new Date().toISOString();
    if (existing !== undefined) {
      existing.externalId = input.externalId;
      existing.matchedBy = 'MANUAL';
      existing.status = 'MANUAL';
      existing.confidence = 1;
      existing.lastResolvedAt = now;
      return { ...existing };
    }

    const ref: Wire.HarvestItemSourceRefView = {
      id: `ref-${this._nextId++}`,
      itemId: input.itemId,
      supermarketId: input.supermarketId,
      externalId: input.externalId,
      externalUrl: null,
      matchedBy: 'MANUAL',
      status: 'MANUAL',
      confidence: 1,
      lastResolvedAt: now,
      lastSeenAt: now,
    };
    this._refs.push(ref);
    return { ...ref };
  }

  async confirmItemRef(id: string): Promise<Wire.HarvestItemSourceRefView> {
    return this._decideRef(id, 'ACTIVE');
  }

  async rejectItemRef(id: string): Promise<Wire.HarvestItemSourceRefView> {
    return this._decideRef(id, 'REJECTED');
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

  private _decideRef(
    id: string,
    status: Wire.EnumsItemSourceRefStatus
  ): Wire.HarvestItemSourceRefView {
    const ref = this._refs.find((candidate) => candidate.id === id);
    if (ref === undefined) {
      throw notFound();
    }

    ref.status = status;
    ref.lastResolvedAt = new Date().toISOString();
    return { ...ref };
  }
}

function matchesRef(
  ref: Wire.HarvestItemSourceRefView,
  query: ItemRefQuery
): boolean {
  return (
    (query.itemId === undefined || ref.itemId === query.itemId) &&
    (query.supermarketId === undefined ||
      ref.supermarketId === query.supermarketId) &&
    (query.status === undefined || ref.status === query.status)
  );
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
