import { Injectable, Logger } from '@nestjs/common';
import { packCountOf, PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import {
  DIA_BASE_URL,
  DIA_CATEGORY_NAMES,
  DIA_CATEGORY_SLUGS,
  DiaClient,
  DiaSessionError,
  DiaStoppedError,
  regularPrice,
  splitSize,
  type DiaLeaf,
  type DiaListingPage,
  type DiaListingRow,
  type DiaStoreFile,
} from '@portfolio/luna-shopper/dia';
import type { SupermarketSource } from '../entities';
import type {
  CatalogDiscoveryInput,
  CatalogRunner,
  RunPriceScope,
} from './catalog-runner';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  SourceObservation,
  SourceObservationPrice,
} from './source-ingest';

/**
 * `CATALOG_DISCOVERY` against the `dia-api` adapter (plan 0174, section 6).
 *
 * **An online price belongs to a fulfilment store, not to a shop.** A postal
 * code maps to one store and about 50 of them serve Spain, so a run is given
 * the stores it walks as `LOCAL_AREA` scopes, the way a Mercadona walk is
 * given warehouses (plan 0108). The store code is the scope's own
 * `externalKey`, and a store discovery is what declares it, so the first DIA
 * run of a chain is a store discovery.
 *
 * The order:
 *
 * 1. `SCOPES`. Find the store an anonymous visitor is priced by, and a postal
 *    code for every scope: the session is set by postal code and the scope is
 *    keyed by store code.
 * 2. `LIST`. Read the menu once. Then, one scope after another and never in
 *    parallel, because the session is server state: start a session, confirm
 *    it holds the scope's own store, and walk every leaf, page by page.
 * 3. `INGEST`. Report every product once, with one regular price per walked
 *    scope that listed it, and its availability per walked scope.
 *
 * **The price written is the regular one, never the Club Dia price** (section
 * 4). The club price goes in `extra.loyalty`, which no shopper reads.
 *
 * **The national price** (section 3.2). A visitor who gives no postal code
 * sees one store's prices, so that list is what DIA shows the whole country.
 * When that store is among the walked scopes and the run has a default scope,
 * its prices are written a second time with `scopeKey: null`, which the ingest
 * sends to the chain's `NATIONAL` scope. The national scope is never declared
 * by key: it has none, and a declaration would create a second one.
 *
 * **It reads no product page.** The listing row carries everything a price run
 * needs, and the detail has no EAN.
 *
 * **It never claims the assortment is complete.** The sitemap names about
 * 7,600 products and a walk lists about 5,700. The rest are out of stock or
 * delisted, and no walk can tell which.
 */
@Injectable()
export class DiaCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(DiaCatalogRunner.name);

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const scopes = requireScopes(input.priceScopes);
    const client = this.createClient(context, source);
    const walk = new Walk();

    try {
      await this.walkScopes(context, report, client, walk, scopes, source);
    } catch (error) {
      if (!(error instanceof DiaStoppedError)) {
        throw error;
      }
      // Five failed requests in a row (section 10). The report says what was
      // read and what stopped it, and the run then fails with that error named
      // rather than failing every remaining page at full speed.
      walk.stoppedBy = String(error.lastError);
      await context.flush();
      await context.setReport(walk.toReport(null, null, client.requests));
      throw error;
    }

    // --- 3. Report every product ---------------------------------------------
    const walked = walk.scopes.map((scope) => scope.key);
    const national = nationalOf(walk, walked, input.priceScopeId);
    await context.setStage(
      'INGEST',
      `Recording ${walk.products.size} product(s) of ${walked.length} scope(s)`
    );
    const observedAt = new Date();
    for (const product of walk.products.values()) {
      const observation = observationOf(
        product,
        walk,
        walked,
        national.store,
        observedAt
      );
      if (observation) {
        report.product(observation);
      }
      for (const claim of availabilityOf(product, walk, context.signal)) {
        report.availability(claim);
      }
    }

    await context.flush();
    await context.setReport(
      walk.toReport(national.from, national.reason, client.requests)
    );
    this.logger.log(
      `Run ${context.runId}: ${walk.products.size} product(s) across ` +
        `${walked.length} fulfilment store(s), ${walk.failedPages.length} ` +
        'failed page(s)'
    );
  }

  private async walkScopes(
    context: RunContext,
    report: RunReport,
    client: DiaClient,
    walk: Walk,
    scopes: readonly RunPriceScope[],
    source: SupermarketSource
  ): Promise<void> {
    // --- 1. The stores and their postal codes --------------------------------
    await context.setStage(
      'SCOPES',
      `Finding a postal code for ${scopes.length} fulfilment store(s)`
    );
    walk.anonymous = await client.anonymousStore();
    const postalCodes = await this.postalCodesFor(
      context,
      client,
      walk,
      scopes,
      source.config
    );

    // Declared before any price refers to one (plan 0103, D4). The spawn read
    // these rows, so the orchestrator finds each by key and creates nothing,
    // and the name is null because a walk does not rename a scope.
    for (const scope of scopes) {
      report.scope({
        key: scope.externalKey,
        kind: PriceScopeKind.LOCAL_AREA,
        name: null,
      });
    }

    // --- 2. The menu, then one session per scope -----------------------------
    await context.setStage('LIST', 'Reading the category menu');
    const menu = await client.menu();
    walk.noteLeaves(menu.leaves);
    await context.setTotalPlanned(menu.leaves.length * postalCodes.size);

    for (const scope of scopes) {
      if (context.signal.aborted) {
        return;
      }
      const postalCode = postalCodes.get(scope.externalKey);
      if (!postalCode) {
        continue;
      }
      await context.setStage(
        'LIST',
        `Walking fulfilment store ${scope.externalKey} (${postalCode})`
      );
      try {
        // Sections 3.4 and 6.2: the session must hold this code, and the code
        // must answer this store. A refusal keeps the code the session had,
        // so a scope is never walked under a borrowed one.
        await client.startSession(postalCode, scope.externalKey);
      } catch (error) {
        if (error instanceof DiaStoppedError || context.signal.aborted) {
          throw error;
        }
        walk.skip(
          scope.externalKey,
          error instanceof DiaSessionError ? error.reason : 'session-failed',
          String(error),
          postalCode
        );
        // The leaves planned for this scope are not walked.
        await context.report({ skipped: menu.leaves.length });
        continue;
      }
      const summary = walk.open(scope.externalKey, postalCode);
      for (const leaf of menu.leaves) {
        if (context.signal.aborted) {
          return;
        }
        await this.walkLeaf(context, client, walk, summary, leaf);
      }
      summary.finished = true;
      this.logger.log(
        `Run ${context.runId}: ${summary.listed.size} product(s) in store ` +
          `${scope.externalKey}`
      );
    }
  }

  /**
   * A postal code for each scope (section 6.2): the source row's own
   * `scopePostalCodes` first, and otherwise the store's own postal code, read
   * from its detail. The shop file is read once per run for that, and only
   * when a scope needs it.
   */
  private async postalCodesFor(
    context: RunContext,
    client: DiaClient,
    walk: Walk,
    scopes: readonly RunPriceScope[],
    config: Record<string, unknown>
  ): Promise<Map<string, string>> {
    const configured = readStringMap(config, 'scopePostalCodes');
    const postalCodes = new Map<string, string>();
    let file: DiaStoreFile | null = null;
    for (const scope of scopes) {
      if (context.signal.aborted) {
        break;
      }
      const key = scope.externalKey;
      const stated = configured.get(key);
      if (stated) {
        postalCodes.set(key, stated);
        continue;
      }
      file ??= await client.storeFile();
      const record = file.stores.find((store) => store.codigoTienda === key);
      if (!record) {
        walk.skip(
          key,
          'store-not-in-file',
          'The shop file holds no such store.'
        );
        continue;
      }
      try {
        const detail = await client.storeDetail(record.idTienda);
        if (detail?.postalCode) {
          postalCodes.set(key, detail.postalCode);
        } else {
          walk.skip(key, 'no-postal-code', 'The store detail states none.');
        }
      } catch (error) {
        if (error instanceof DiaStoppedError || context.signal.aborted) {
          throw error;
        }
        walk.skip(key, 'detail-failed', String(error));
      }
      await context.heartbeat();
    }
    return postalCodes;
  }

  /**
   * Every page of one leaf, under the current session (section 6.4).
   *
   * A failed page is named and the walk goes on to the next one. Page 1 is the
   * exception: without it the leaf's page count is unknown, so the leaf ends.
   */
  private async walkLeaf(
    context: RunContext,
    client: DiaClient,
    walk: Walk,
    scope: ScopeWalk,
    leaf: DiaLeaf
  ): Promise<void> {
    let path = leaf.path;
    let pages = 1;
    let whole = true;
    for (let page = 1; page <= pages; page += 1) {
      if (context.signal.aborted) {
        return;
      }
      let read: DiaListingPage;
      try {
        read = await client.listing(path, page);
      } catch (error) {
        if (error instanceof DiaStoppedError || context.signal.aborted) {
          throw error;
        }
        this.logger.warn(
          `Run ${context.runId}: store ${scope.key}, ${leaf.path} page ` +
            `${page} failed: ${String(error)}`
        );
        walk.failedPages.push({
          scope: scope.key,
          leaf: leaf.id,
          path,
          page,
          error: String(error),
        });
        scope.failedPages += 1;
        whole = false;
        await context.report({ failed: 1 });
        continue;
      }
      if (read.movedTo) {
        walk.moved(leaf, read.movedTo);
        path = read.movedTo;
      }
      if (page === 1) {
        pages = read.totalPages;
        walk.printed(leaf, read.totalItems);
      }
      for (const row of read.rows) {
        walk.record(scope, leaf, row);
      }
      // A walk of 50 stores is about three hours, and the stale reaper fires
      // after 900 seconds without a heartbeat (section 6.7).
      await context.heartbeat();
      if (read.rows.length === 0) {
        break;
      }
    }
    scope.leaves += 1;
    // A leaf with a failed page was counted as failed, and is not counted
    // twice.
    if (whole) {
      await context.report({ processed: 1 });
    }
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it.
   * There is no user agent to pass (decision D1, plan 0174, section 2).
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource
  ): DiaClient {
    return new DiaClient({
      baseUrl: readString(source.config, 'baseUrl'),
      // The run's own bucket. The client also holds 500 ms between requests,
      // so the source never sees more than 2 per second (section 10).
      acquire: context.acquire,
      signal: context.signal,
    });
  }
}

/** One product, as every scope that listed it described it. */
interface WalkedProduct {
  skuId: string;
  /** The first leaf it appeared under, which names its category path. */
  firstLeaf: DiaLeaf;
  /** Every leaf it appeared under, in walk order. */
  leafIds: string[];
}

/** What one scope's walk accumulates. */
interface ScopeWalk {
  key: string;
  postalCode: string;
  /** `sku_id` to the row this store listed. */
  listed: Map<string, DiaListingRow>;
  leaves: number;
  failedPages: number;
  /** Every leaf was asked for. False for a walk that an abort cut short. */
  finished: boolean;
}

/** What one run accumulates, and the report it writes (section 6.7). */
class Walk {
  anonymous: { postalCode: string | null; storeCode: string | null } = {
    postalCode: null,
    storeCode: null,
  };
  stoppedBy: string | null = null;
  readonly products = new Map<string, WalkedProduct>();
  readonly scopes: ScopeWalk[] = [];
  readonly skippedScopes: Array<{
    scope: string;
    reason: string;
    detail: string;
    postalCode?: string;
  }> = [];
  readonly failedPages: Array<{
    scope: string;
    leaf: string;
    path: string;
    page: number;
    error: string;
  }> = [];
  readonly movedLeaves = new Map<
    string,
    { id: string; from: string; to: string }
  >();
  readonly unmappedLeaves: Array<{ id: string; name: string }> = [];
  readonly renamedLeaves: Array<{ id: string; was: string; is: string }> = [];
  private readonly leaves = new Map<
    string,
    { id: string; name: string; printedTotal: number; rowsRead: number }
  >();

  /**
   * Every leaf the menu holds, checked against the category table (section
   * 7). A leaf the table does not know maps to nothing, so it is named for an
   * operator to add. A leaf whose name changed may have a new meaning, because
   * DIA reuses ids.
   */
  noteLeaves(leaves: readonly DiaLeaf[]): void {
    for (const leaf of leaves) {
      this.leaves.set(leaf.id, {
        id: leaf.id,
        name: leaf.name,
        printedTotal: 0,
        rowsRead: 0,
      });
      const known = DIA_CATEGORY_NAMES[leaf.id];
      if (known === undefined) {
        if (DIA_CATEGORY_SLUGS[leaf.id] === undefined) {
          this.unmappedLeaves.push({ id: leaf.id, name: leaf.name });
        }
      } else if (known !== leaf.name) {
        this.renamedLeaves.push({ id: leaf.id, was: known, is: leaf.name });
      }
    }
  }

  open(key: string, postalCode: string): ScopeWalk {
    const scope: ScopeWalk = {
      key,
      postalCode,
      listed: new Map(),
      leaves: 0,
      failedPages: 0,
      finished: false,
    };
    this.scopes.push(scope);
    return scope;
  }

  skip(
    scope: string,
    reason: string,
    detail: string,
    postalCode?: string
  ): void {
    this.skippedScopes.push({
      scope,
      reason,
      detail,
      ...(postalCode ? { postalCode } : {}),
    });
  }

  moved(leaf: DiaLeaf, to: string): void {
    this.movedLeaves.set(leaf.id, { id: leaf.id, from: leaf.path, to });
  }

  /** The count a leaf prints, summed over the walked scopes. */
  printed(leaf: DiaLeaf, total: number | null): void {
    const summary = this.leaves.get(leaf.id);
    if (summary && total !== null) {
      summary.printedTotal += total;
    }
  }

  /**
   * One listing row. A product sits in up to four leaves, so its rows are
   * merged: the scope keeps the first row it listed, and the product keeps
   * every leaf id, in walk order.
   */
  record(scope: ScopeWalk, leaf: DiaLeaf, row: DiaListingRow): void {
    const summary = this.leaves.get(leaf.id);
    if (summary) {
      summary.rowsRead += 1;
    }
    if (!scope.listed.has(row.skuId)) {
      scope.listed.set(row.skuId, row);
    }
    const product = this.products.get(row.skuId);
    if (!product) {
      this.products.set(row.skuId, {
        skuId: row.skuId,
        firstLeaf: leaf,
        leafIds: [leaf.id],
      });
    } else if (!product.leafIds.includes(leaf.id)) {
      product.leafIds.push(leaf.id);
    }
  }

  toReport(
    nationalFrom: { postalCode: string; store: string } | null,
    nationalReason: string | null,
    requests: number
  ): Record<string, unknown> {
    const rows = this.scopes.flatMap((scope) => [...scope.listed.values()]);
    const unparsed = [...this.products.values()]
      .map((product) => this.rowOf(product.skuId)?.displayName ?? '')
      .filter((name) => name !== '' && splitSize(name).sizeFormat === null);
    return {
      /** The store an anonymous visitor is priced by, written as NATIONAL. */
      nationalFrom,
      ...(nationalReason ? { nationalReason } : {}),
      anonymousSession: this.anonymous,
      scopes: this.scopes.map((scope) => ({
        scope: scope.key,
        // Confirmed by the session: `check-service` on this code answered
        // this store (section 6.2).
        postalCode: scope.postalCode,
        listed: scope.listed.size,
        inStock: [...scope.listed.values()].filter(
          (row) => row.unitsInStock > 0
        ).length,
        leaves: scope.leaves,
        failedPages: scope.failedPages,
        finished: scope.finished,
      })),
      /** Named, with the reason. A skipped scope is never walked. */
      skippedScopes: this.skippedScopes,
      /** Per leaf, the printed count and the rows read, summed over scopes. */
      leaves: [...this.leaves.values()],
      movedLeaves: [...this.movedLeaves.values()],
      unmappedLeaves: this.unmappedLeaves,
      renamedLeaves: this.renamedLeaves,
      listed: this.products.size,
      clubPrices: rows.filter((row) => row.prices?.isClubPrice).length,
      promotions: rows.filter((row) => row.promotions.length > 0).length,
      unitPriceScaled: rows.filter(
        (row) =>
          row.prices && regularPrice(row.prices).extra.unitPriceScaled === true
      ).length,
      unparsedSizes: {
        count: unparsed.length,
        examples: unparsed.slice(0, 20),
      },
      priceDifferences: this.priceDifferences(),
      /** Named, never only counted. */
      failedPages: this.failedPages,
      ...(this.stoppedBy ? { stoppedBy: this.stoppedBy } : {}),
      requests,
    };
  }

  /** The row of a product in the first walked scope that listed it. */
  rowOf(skuId: string, preferred?: string | null): DiaListingRow | null {
    const first = preferred
      ? this.scopes.find((scope) => scope.key === preferred)?.listed.get(skuId)
      : undefined;
    if (first) {
      return first;
    }
    for (const scope of this.scopes) {
      const row = scope.listed.get(skuId);
      if (row) {
        return row;
      }
    }
    return null;
  }

  /** Per pair of walked scopes, how many products differ in regular price. */
  private priceDifferences(): Array<{
    scopes: [string, string];
    inBoth: number;
    differ: number;
  }> {
    const differences = [];
    for (let a = 0; a < this.scopes.length; a += 1) {
      for (let b = a + 1; b < this.scopes.length; b += 1) {
        let inBoth = 0;
        let differ = 0;
        for (const [skuId, row] of this.scopes[a].listed) {
          const other = this.scopes[b].listed.get(skuId);
          if (!other || !row.prices || !other.prices) {
            continue;
          }
          inBoth += 1;
          if (
            regularPrice(row.prices).price !== regularPrice(other.prices).price
          ) {
            differ += 1;
          }
        }
        differences.push({
          scopes: [this.scopes[a].key, this.scopes[b].key] as [string, string],
          inBoth,
          differ,
        });
      }
    }
    return differences;
  }
}

/**
 * Whether this run writes the national row, and why not when it does not
 * (section 3.2).
 */
function nationalOf(
  walk: Walk,
  walked: readonly string[],
  defaultScopeId: string | undefined
): {
  store: string | null;
  from: { postalCode: string; store: string } | null;
  reason: string | null;
} {
  const { postalCode, storeCode } = walk.anonymous;
  if (!postalCode || !storeCode) {
    return {
      store: null,
      from: null,
      reason: 'The anonymous session named no store.',
    };
  }
  if (!walked.includes(storeCode)) {
    return {
      store: null,
      from: null,
      reason:
        `The anonymous session is priced by store ${storeCode} ` +
        `(${postalCode}), which this run did not walk.`,
    };
  }
  if (!defaultScopeId) {
    return {
      store: null,
      from: null,
      reason:
        'The run was given no default scope, so there is no NATIONAL scope ' +
        'to write to.',
    };
  }
  return {
    store: storeCode,
    from: { postalCode, store: storeCode },
    reason: null,
  };
}

/**
 * One product, with one regular price per walked scope that listed it, and
 * the national row when it applies (sections 4 and 6.4).
 *
 * The identity fields and the `extra` are read from one row: the national
 * store's when it listed the product, and otherwise the first walked scope
 * that did. A row carries one `extra`, so the club price and the promotion
 * text it holds are those of that one scope.
 */
function observationOf(
  product: WalkedProduct,
  walk: Walk,
  walked: readonly string[],
  nationalStore: string | null,
  observedAt: Date
): SourceObservation | null {
  const row = walk.rowOf(product.skuId, nationalStore);
  if (!row) {
    return null;
  }
  const size = splitSize(row.displayName);
  const prices: SourceObservationPrice[] = [];
  for (const scope of walk.scopes) {
    const listed = scope.listed.get(product.skuId);
    if (!listed?.prices || !walked.includes(scope.key)) {
      continue;
    }
    const regular = regularPrice(listed.prices, listed.promotions);
    const price = {
      price: regular.price,
      currency: regular.currency,
      unitPrice: regular.unitPrice,
      unitPriceLabel: regular.unitPriceLabel,
      // The site states no dates (section 4).
      validFrom: null,
      validUntil: null,
    };
    prices.push({ scopeKey: scope.key, ...price });
    if (scope.key === nationalStore) {
      prices.push({ scopeKey: null, ...price });
    }
  }

  const extra: Record<string, unknown> = {
    // Every leaf the product was listed under, which is what files it under
    // our categories (section 7).
    diaCategoryIds: product.leafIds,
  };
  if (row.image) {
    extra['image'] = absolute(row.image);
  }
  if (row.weightInGrams !== null) {
    extra['weightInGrams'] = row.weightInGrams;
  }
  if (row.averageWeight !== null) {
    extra['averageWeight'] = row.averageWeight;
  }
  if (row.prices) {
    Object.assign(extra, regularPrice(row.prices, row.promotions).extra);
  }

  return {
    externalId: product.skuId,
    name: size.name,
    brand: row.brand,
    // Neither the listing nor the detail carries one (section 1).
    ean: null,
    unitSize: size.unitSize,
    sizeUnit: size.sizeUnit,
    sizeFormat: size.sizeFormat,
    packCount: packCountOf(size.packCount),
    categoryPath: [product.firstLeaf.rootName, product.firstLeaf.name],
    url: row.url ? absolute(row.url) : null,
    observedAt,
    extra,
    prices,
  };
}

/**
 * Availability per walked scope (section 6.5).
 *
 * - Listed with stock: available.
 * - Listed with no stock: not available.
 * - Not listed here and listed by another scope of this run: not available
 *   here, as plan 0108 requires of a run over several warehouses.
 *
 * The third claim needs a whole walk. A scope whose walk an abort cut short,
 * or that had a failed page, has not proved anything absent, so it states the
 * first two only.
 */
function availabilityOf(
  product: WalkedProduct,
  walk: Walk,
  signal: AbortSignal
): Array<{ externalId: string; available: boolean; scopeKey: string }> {
  const claims = [];
  for (const scope of walk.scopes) {
    const listed = scope.listed.get(product.skuId);
    if (listed) {
      claims.push({
        externalId: product.skuId,
        available: listed.unitsInStock > 0,
        scopeKey: scope.key,
      });
    } else if (scope.finished && scope.failedPages === 0 && !signal.aborted) {
      claims.push({
        externalId: product.skuId,
        available: false,
        scopeKey: scope.key,
      });
    }
  }
  return claims;
}

function absolute(path: string): string {
  return /^https?:\/\//i.test(path)
    ? path
    : `${DIA_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * The fulfilment stores this walk covers, which are the scopes it writes for.
 * The spawn refuses an empty list, so reaching here with none means the run
 * was written some other way, and an error beats a walk that fetches nothing.
 */
function requireScopes(
  scopes: readonly RunPriceScope[] | undefined
): readonly RunPriceScope[] {
  if (!scopes || scopes.length === 0) {
    throw new Error(
      'This walk covers the fulfilment stores its price scopes name, and it ' +
        'was given none. Run a store discovery first, then start it again ' +
        'with at least one of the scopes that run declared.'
    );
  }
  return scopes;
}

/** A setting from the source row rather than the environment (plan 0083). */
function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

/** `source.config.scopePostalCodes`: store code to postal code. */
function readStringMap(
  config: Record<string, unknown>,
  key: string
): Map<string, string> {
  const value = config[key];
  const entries = new Map<string, string>();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [name, raw] of Object.entries(value)) {
      if (typeof raw === 'string' && raw.trim() !== '') {
        entries.set(name, raw.trim());
      }
    }
  }
  return entries;
}
