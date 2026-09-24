import { Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { brandKey } from '@portfolio/luna-shopper/contracts/brand-key';
import { GatewayError } from '../gateway-error';
import {
  DISCOVERED_PLACE_SEED,
  HARVEST_RUN_PRESET_SEED,
  HARVEST_RUN_PRICE_SEED,
  HARVEST_RUN_SEED,
  ITEM_SOURCE_ENTRY_SEED,
  PLACE_CANDIDATE_SEED,
  POSTAL_CODE_DISCOVERY_SEED,
  SOURCE_ENTRY_SEED,
  SOURCE_LOCATION_SEED,
  SUPERMARKET_SOURCE_SEED,
} from './harvest-seed';
import type {
  AcceptSourceEntryInput,
  CreateItemFromSourceEntryInput,
  EntryQuery,
  HarvestRunPresetInput,
  HarvestRunPresetPatch,
  HarvestServiceI,
  ImportHarvestDocumentInput,
  PageQuery,
  PlaceGroupQuery,
  PlaceQuery,
  PostalCodeQuery,
  RunPriceQuery,
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
  private readonly _runPrices: Wire.CatalogItemPriceView[] = clone(
    HARVEST_RUN_PRICE_SEED
  );
  private readonly _itemEntries: Wire.HarvestSourceCatalogEntryView[] = clone(
    ITEM_SOURCE_ENTRY_SEED
  );
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
  private readonly _postalCodes: Wire.HarvestPostalCodeDiscoveryRequestView[] =
    clone(POSTAL_CODE_DISCOVERY_SEED);
  private readonly _presets: StoredPreset[] = HARVEST_RUN_PRESET_SEED.map(
    (preset) => ({ ...preset, input: copyInput(preset.input) })
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
          query.reverted === (run.revertedAt !== null)) &&
        (query.presetId === undefined || run.presetId === query.presetId)
    );

    return page(matching, query);
  }

  /**
   * The saved runs, ordered by name as the harvester orders them (backend plan
   * 0120, section 5), each with its latest run read off the runs.
   */
  async listPresets(
    supermarketId?: string,
    cursor?: string
  ): Promise<Wire.HarvestHarvestRunPresetPage> {
    const matching = this._presets
      .filter(
        (preset) =>
          supermarketId === undefined ||
          supermarketId === '' ||
          preset.supermarketId === supermarketId
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const answer = page(matching, { cursor });
    return {
      items: answer.items.map((preset) => this._presetView(preset)),
      nextCursor: answer.nextCursor,
    };
  }

  async readPreset(id: string): Promise<Wire.HarvestHarvestRunPresetView> {
    return this._presetView(this._preset(id));
  }

  /**
   * Save a request under a name.
   *
   * The duplicate name refusal is the harvester's own: a 409 compared without
   * case within the chain, naming the preset that holds the name, so the
   * screen's conflict branch is reachable with nothing listening.
   */
  async createPreset(
    supermarketId: string,
    name: string,
    input: HarvestRunPresetInput
  ): Promise<Wire.HarvestHarvestRunPresetView> {
    const trimmed = this._presetName(supermarketId, name, null);
    const now = new Date().toISOString();
    const preset: StoredPreset = {
      id: mintPresetId(this._nextId++),
      supermarketId,
      name: trimmed,
      input: copyInput(input),
      createdAt: now,
      updatedAt: now,
    };
    this._presets.push(preset);
    return this._presetView(preset);
  }

  async updatePreset(
    id: string,
    patch: HarvestRunPresetPatch
  ): Promise<Wire.HarvestHarvestRunPresetView> {
    const preset = this._preset(id);
    if (patch.name !== undefined) {
      preset.name = this._presetName(preset.supermarketId, patch.name, id);
    }
    if (patch.input !== undefined) {
      preset.input = copyInput(patch.input);
    }
    preset.updatedAt = new Date().toISOString();
    return this._presetView(preset);
  }

  async deletePreset(id: string): Promise<void> {
    const preset = this._preset(id);
    this._presets.splice(this._presets.indexOf(preset), 1);
  }

  /**
   * A spawn of the saved request, with the chain added back and the run
   * recording the preset it came from (backend plan 0120, section 7).
   */
  async startPreset(id: string): Promise<Wire.HarvestHarvestRunView> {
    const preset = this._preset(id);
    const run = await this.spawnRun({
      ...copyInput(preset.input),
      supermarketId: preset.supermarketId,
    });
    const stored = this._runs.find((candidate) => candidate.id === run.id);
    if (stored !== undefined) {
      stored.presetId = preset.id;
    }
    return { ...run, presetId: preset.id };
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
        (query.status === undefined || place.status === query.status) &&
        (query.country === undefined || place.country === query.country) &&
        (query.postalCode === undefined ||
          place.postalCode === query.postalCode)
    );

    return page(matching, query);
  }

  async placeGroups(
    query: PlaceGroupQuery
  ): Promise<Wire.HarvestDiscoveredPlaceGroupsResult> {
    const matching = this._places.filter(
      (place) => query.runId === undefined || place.runId === query.runId
    );

    // Grouped on `brand:wikidata` first, which is the whole point of the key:
    // `Dia` and `Maxi Dia` share one QID. A place with no key is grouped by its
    // printed brand, then its name, as the harvester does since backend plan
    // 0154, so unbranded shops no longer share one arbitrary bucket.
    const byKey = new Map<string, Wire.HarvestDiscoveredPlaceView[]>();
    for (const place of matching) {
      const key =
        place.brandKey ??
        `name:${(place.brandName ?? place.name ?? '').trim().toLowerCase()}`;
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

  /**
   * An import, refused the ways the server refuses one (backend plans 0152 and
   * 0153).
   *
   * An imported place answers `place_already_imported`. A place the seed says
   * the catalog may already hold answers `place_matches_location` with the
   * candidates under `details`, unless `force` is sent. An OpenStreetMap place
   * with no brand key and no chain named answers the plain conflict the
   * harvester answers, because the place cannot say what language its name is
   * in; `newChain` is the way through.
   */
  async importPlace(
    id: string,
    input: Wire.ImportDiscoveredPlaceDto
  ): Promise<Wire.HarvestDiscoveredPlaceView> {
    const place = this._undecidedPlace(id);

    if (input.force !== true) {
      const candidates = PLACE_CANDIDATE_SEED[place.id] ?? [];
      if (candidates.length > 0) {
        throw new GatewayError({
          code: 'place_matches_location',
          status: 409,
          correlationId: '',
          details: { candidates: candidates.map((row) => ({ ...row })) },
        });
      }
    }

    const unnamed =
      place.provider.toLowerCase() === 'osm' &&
      place.brandKey === null &&
      (input.supermarketId ?? '') === '' &&
      input.newChain === undefined;
    if (unnamed) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
        detail:
          'Places from osm do not say what language they name things in. ' +
          'Pass an explicit supermarketId, or newChain with a name and its ' +
          'language.',
      });
    }

    return this._decidePlace(id, 'IMPORTED', input.supermarketId ?? null);
  }

  /** A place joins a shop the catalog holds, and nothing is created. */
  async linkPlace(
    id: string,
    input: Wire.LinkDiscoveredPlaceDto
  ): Promise<Wire.HarvestDiscoveredPlaceView> {
    this._undecidedPlace(id);
    return this._decidePlace(id, 'IMPORTED', input.supermarketLocationId);
  }

  /**
   * An imported place answers 409 `place_already_imported` (backend plan 0152,
   * section 5): removing its shop is a catalog act on the location.
   */
  async rejectPlace(id: string): Promise<Wire.HarvestDiscoveredPlaceView> {
    this._undecidedPlace(id);
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
    const chain = query.supermarketId ?? '';
    const matching = this._entries.filter(
      (entry) =>
        // Absent lists every chain's rows, as the route does.
        (chain === '' || entry.supermarketId === chain) &&
        (query.status === undefined
          ? entry.status === 'CANDIDATE' || entry.status === 'UNRESOLVED'
          : entry.status === query.status) &&
        (query.sourceKind === undefined ||
          entry.sourceKind === query.sourceKind) &&
        // The key the row's own brand text makes, compared to the key that was
        // asked for. A value that makes no key matches nothing, which is what
        // the route does with it: `brandKey` never answers punctuation.
        (query.brandKey === undefined ||
          brandKey(entry.brand ?? '') === query.brandKey) &&
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
   * The rows a run wrote, from a table of its own.
   *
   * An unknown run answers an empty page, as the route does: a run id is only
   * a filter over catalog's rows.
   */
  async listRunPrices(
    runId: string,
    query: RunPriceQuery
  ): Promise<Wire.CatalogItemPricePage> {
    const matching = this._runPrices.filter(
      (row) =>
        (row.sourceRunId === runId || row.lastObservedRunId === runId) &&
        (query.itemId === undefined ||
          query.itemId === '' ||
          row.itemId === query.itemId)
    );

    return page(matching, query);
  }

  /**
   * The rows naming one product: the bound seed, and any queue row an accept
   * bound since, so an accept on the queue shows on the product.
   */
  async listItemEntries(
    itemId: string,
    query: PageQuery
  ): Promise<Wire.HarvestItemSourceEntryPage> {
    const everyRow = [...this._itemEntries, ...this._entries];
    const matching = everyRow
      .filter((entry) => entry.itemId === itemId)
      .map((entry) => ({
        ...entry,
        eanSharedBy:
          entry.ean === null
            ? null
            : everyRow.filter(
                (other) =>
                  other.supermarketId === entry.supermarketId &&
                  other.ean === entry.ean
              ).length,
      }));

    return page(matching, query);
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

  /**
   * The queue, narrowed the three ways the route narrows it.
   *
   * `postalCode` is a prefix rather than an equality, because that is what the
   * route does and a screen tested against an equality here would look right and
   * be wrong against the real one.
   */
  async listPostalCodes(
    query: PostalCodeQuery
  ): Promise<Wire.HarvestPostalCodeDiscoveryRequestPage> {
    const wanted = query.dismissed === true;
    const rows = this._postalCodes.filter(
      (row) =>
        row.dismissed === wanted &&
        (query.country === undefined || row.country === query.country) &&
        (query.status === undefined || row.status === query.status) &&
        (query.postalCode === undefined ||
          row.postalCode.startsWith(query.postalCode))
    );

    return page(rows, query);
  }

  /**
   * The queue at a glance.
   *
   * `draining` is **true** here, because the in-memory service is what a
   * developer with nothing listening sees and a permanent "nothing drains this"
   * banner over a working screen would be a lie about the seed. The banner's own
   * spec supplies a false one rather than reading it from here.
   */
  async postalCodeSummary(): Promise<Wire.HarvestPostalCodeDiscoverySummaryView> {
    const working = this._postalCodes.filter((row) => !row.dismissed);
    const count = (status: Wire.EnumsPostalCodeDiscoveryStatus): number =>
      working.filter((row) => row.status === status).length;

    const queued = working
      .filter((row) => row.status === 'QUEUED')
      .map((row) => row.requestedAt)
      .sort();

    return {
      queued: queued.length,
      running: count('RUNNING'),
      done: count('DONE'),
      failed: count('FAILED'),
      parked: count('PARKED'),
      oldestQueuedAt: queued[0] ?? null,
      draining: true,
    };
  }

  /**
   * Add one code.
   *
   * The refusal is modelled as well as the write, because it is the common
   * answer rather than an edge: a code catalog does not hold is a typo, and the
   * screen names it per code. Anything that is not five digits stands in for
   * that here, since this fake holds no centroid table to check against.
   */
  async addPostalCode(
    input: Wire.AddPostalCodeDiscoveryDto
  ): Promise<Wire.HarvestPostalCodeDiscoveryRequestView> {
    if (!/^\d{5}$/.test(input.postalCode)) {
      throw new GatewayError({
        code: 'postal_code_unknown',
        status: 400,
        correlationId: '',
      });
    }

    const existing = this._postalCodes.find(
      (row) =>
        row.country === input.country && row.postalCode === input.postalCode
    );
    if (existing !== undefined) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
      });
    }

    const row: Wire.HarvestPostalCodeDiscoveryRequestView = {
      id: `postal-${input.postalCode}`,
      country: input.country,
      postalCode: input.postalCode,
      status: input.discoverNow ? 'QUEUED' : 'PARKED',
      requestedAt: new Date().toISOString(),
      lastAttemptedAt: null,
      discoveredAt: null,
      nextAttemptAt: null,
      attempts: 0,
      runId: null,
      error: null,
      placeName: null,
      dismissed: false,
      foundByItsRuns: { total: 0, imported: 0, rejected: 0, undecided: 0 },
      locatedInIt: { total: 0, imported: 0, rejected: 0, undecided: 0 },
    };
    this._postalCodes.unshift(row);
    return { ...row };
  }

  /**
   * Queue it again, past the cooldown, and take back a dismissal.
   *
   * Refused on a `RUNNING` row the way the real one is, so the screen's conflict
   * branch is reachable with nothing listening.
   */
  async requeuePostalCode(
    id: string
  ): Promise<Wire.HarvestPostalCodeDiscoveryRequestView> {
    const row = this._postalCode(id);
    if (row.status === 'RUNNING') {
      throw new GatewayError({
        code: 'run_in_progress',
        status: 409,
        correlationId: '',
      });
    }

    row.status = 'QUEUED';
    row.attempts = 0;
    row.nextAttemptAt = null;
    row.error = null;
    row.dismissed = false;
    return { ...row };
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
      if (input.autoImportPlaces !== undefined) {
        existing.autoImportPlaces = input.autoImportPlaces;
      }
      return { ...existing };
    }

    const source: Wire.HarvestSupermarketSourceView = {
      id: `source-${this._nextId++}`,
      supermarketId,
      adapterKey: input.adapterKey,
      enabled: input.enabled ?? false,
      // Untrusted, like `enabled`: describing a chain says nothing about
      // whether its shops may reach the catalog unreviewed.
      autoImportPlaces: input.autoImportPlaces ?? false,
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

  async deleteSource(supermarketId: string): Promise<{ id: string }> {
    const at = this._sources.findIndex(
      (candidate) => candidate.supermarketId === supermarketId
    );
    if (at === -1) {
      throw notFound();
    }

    const [removed] = this._sources.splice(at, 1);
    return { id: removed.id };
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

  private _postalCode(id: string): Wire.HarvestPostalCodeDiscoveryRequestView {
    const row = this._postalCodes.find((candidate) => candidate.id === id);
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private _shop(id: string): Wire.HarvestSourceLocationView {
    const shop = this._shops.find((candidate) => candidate.id === id);
    if (shop === undefined) {
      throw notFound();
    }
    return shop;
  }

  /** The place, refused with the server's code when it is imported already. */
  private _undecidedPlace(id: string): Wire.HarvestDiscoveredPlaceView {
    const place = this._places.find((candidate) => candidate.id === id);
    if (place === undefined) {
      throw notFound();
    }
    if (place.status === 'IMPORTED') {
      throw new GatewayError({
        code: 'place_already_imported',
        status: 409,
        correlationId: '',
      });
    }
    return place;
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

  private _preset(id: string): StoredPreset {
    const preset = this._presets.find((candidate) => candidate.id === id);
    if (preset === undefined) {
      throw notFound();
    }
    return preset;
  }

  /** A trimmed name, refused when empty or when the chain already holds it. */
  private _presetName(
    supermarketId: string,
    name: string,
    exceptId: string | null
  ): string {
    const trimmed = name.trim();
    if (trimmed === '') {
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: '',
        detail: 'A preset needs a name.',
      });
    }
    const existing = this._presets.find(
      (preset) =>
        preset.id !== exceptId &&
        preset.supermarketId === supermarketId &&
        preset.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing !== undefined) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
        detail:
          `This chain already has a preset named "${existing.name}": ` +
          `${existing.id}. Names are compared without case.`,
      });
    }
    return trimmed;
  }

  private _presetView(preset: StoredPreset): Wire.HarvestHarvestRunPresetView {
    const latest = this._runs
      .filter((run) => run.presetId === preset.id)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
    return {
      ...preset,
      input: copyInput(preset.input),
      lastRun:
        latest === undefined
          ? null
          : {
              id: latest.id,
              status: latest.status,
              requestedAt: latest.requestedAt,
            },
    };
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
/** A preset as the memory back end holds it: its latest run is read, not kept. */
type StoredPreset = Omit<Wire.HarvestHarvestRunPresetView, 'lastRun'>;

/** A deep copy of a saved request, so no caller holds the stored one. */
function copyInput<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function mintPresetId(index: number): string {
  return `66666666-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

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
