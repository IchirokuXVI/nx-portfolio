import { Injectable, Logger } from '@nestjs/common';
import {
  HarvestWarningCode,
  PriceScopeKind,
  PriceSourceKind,
  SourceEntryStatus,
  sourceSizeOf,
  type HarvestDocumentPrice,
  type HarvestDocumentProduct,
  type HarvestDocumentScope,
  type HarvestDocumentSize,
  type HarvestRunWarning,
  type SourceSize,
} from '@portfolio/luna-shopper/contracts';
import { distinctCategoryPaths } from './category-paths';
import { documentPhotoOf } from './document-photo';
import { readHarvestDocument } from './harvest-document.reader';
import { resolveImportWindow, type ImportWindow } from './import-window';
import { entryKey } from './matching';
import { PriceScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import {
  SourceIngest,
  type DocumentObservation,
  type SourceEntryOutcome,
  type SourceIngestCounters,
  type SourceObservation,
} from './source-ingest';

export interface FileImportInput {
  supermarketId: string;
  priceScopeId: string;
  sourceKind: PriceSourceKind;
  /**
   * The chain's adapter, for the language a scope this file declares is named
   * in (plan 0111, section 8). Null when the chain has no source row, and the
   * scope is then created unnamed rather than under a guessed language.
   */
  adapterKey: string | null;
}

/**
 * What the ingest of an import counted, and the rows whose category paths it
 * changed (plan 0268), which the run report states as `categoryPathsWritten`
 * as it does for a walk.
 */
export interface FileImportCounters extends SourceIngestCounters {
  categoryPathsWritten: number;
}

/**
 * The steps of an import that run after the ingest wrote its rows and prices:
 * the warnings and the skipped count of the outcomes, the write of the
 * category paths, and the last flush of the run's counters and warnings.
 */
export type FileImportStepAfterIngest = 'OUTCOMES' | 'CATEGORY_PATHS' | 'FLUSH';

/**
 * A step after the ingest failed, once the ingest had written its rows and
 * prices (plan 0268, owner decisions 96c and 102b).
 *
 * The run still fails, but those rows and prices are saved, so the report of
 * the failed run states them, as a walk whose drain failed states what its
 * chunks wrote (plan 0269, D9). {@link counters} is what the ingest counted,
 * and `categoryPathsWritten` the rows whose paths changed before the failure
 * (zero when the step that failed comes before the path write). {@link step}
 * names the step. The message is that of {@link failure}, the error the step
 * threw, so the run's sentence is the one the step gave.
 */
export class FileImportFailedAfterIngestError extends Error {
  constructor(
    readonly step: FileImportStepAfterIngest,
    readonly counters: FileImportCounters,
    readonly failure: unknown
  ) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = 'FileImportFailedAfterIngestError';
  }
}

/**
 * The currency a document that names none is stating.
 *
 * Every producer this backend has is Spanish and every price it has ever seen is
 * in euros. It is a default rather than a required field because a `unit_price`
 * block may carry only an amount and a label (plan 0086, section 6.1), and
 * refusing a whole file over the one field nobody varies would be a rule that
 * only ever rejected valid documents.
 */
const DEFAULT_CURRENCY = 'EUR';

/**
 * `FILE_IMPORT` (plan 0086, D6): read an uploaded `HarvestDocument` and run the
 * same second half every other run runs.
 *
 * **The upload is not a leaflet tool.** Every file is a list of products as a
 * source described them, whoever produced it: the leaflet extractor produces one,
 * the harvester's own export of a walk is one, and a person typing a chain's
 * prices produces one. The import does one thing with all of them, which is why
 * the document has no `kind` field.
 *
 * **It interprets nothing.** A product with a `price` becomes an observation
 * with that price and a product without one becomes an observation with none.
 * The three rules plan 0081 section 6 ran here, reading a tile's promotion,
 * loyalty and basis blocks to decide which number was the price, belong to the
 * producer now: those blocks are `extra`, and `extra` is stored, shown and never
 * read by any rule.
 *
 * The one rule it keeps is `DUPLICATE_KEY`, because **only the import can see
 * it**: two products colliding on the key it computes is a fact about this file
 * and about nothing else. Both become observations with no price, so a person
 * decides which product the number belonged to.
 *
 * **It asserts nothing about availability.** A file says what is in it, not what
 * is not.
 */
@Injectable()
export class FileImportRunner {
  private readonly logger = new Logger(FileImportRunner.name);

  constructor(
    private readonly ingest: SourceIngest,
    private readonly scopes: PriceScopeResolver
  ) {}

  /**
   * Read the document and record what it says, answering what the ingest
   * counted.
   *
   * The counters are answered rather than written here, because the run's
   * report is the orchestrator's to compose and an import must name its prices
   * the same way a walk does. Dropping them was how a run that recorded prices
   * came to report none of them.
   */
  async run(
    context: RunContext,
    input: FileImportInput
  ): Promise<FileImportCounters> {
    // Validated again here, because the harvester owns the schema version and a
    // broker message is not a trusted input (section 6.2). The gateway already
    // refused a malformed document; this refuses one that arrived some other way.
    const document = readHarvestDocument(context.run.input['document']);
    // The instants the spawn resolved, which already carry the admin's override
    // (section 5). Resolving them here from the document alone would silently
    // drop that override, so the stored pair is the answer and the document's
    // own days are only the fall back for a run written before it.
    const documentWindow =
      storedWindow(context.run.input) ??
      resolveImportWindow({
        documentFrom: document.validity?.from ?? null,
        documentUntil: document.validity?.until ?? null,
      });

    await context.setTotalPlanned(document.products.length);
    this.logger.log(
      `Run ${context.runId}: importing ${document.products.length} product(s) ` +
        `from ${document.producer?.name ?? 'an unnamed producer'} as ` +
        `${input.sourceKind} for scope ${input.priceScopeId}`
    );

    // The producer's own remarks, carried through as they are, so an admin sees
    // what the producer lost beside what the import queued.
    for (const warning of document.warnings ?? []) {
      context.warn({
        code: HarvestWarningCode.EXTRACTOR,
        offerId: warning.product_id ?? null,
        page: pageOf(warning.extra),
        name: null,
        message: warning.message,
      });
    }

    await context.setStage('READ', 'Reading the document');
    const started = new Date();
    const fallbackObservedAt =
      parseInstant(document.producer?.produced_at) ?? started;
    const duplicates = duplicateKeysIn(document.products);

    const observations = document.products.map((product) =>
      this.observe(product, {
        documentWindow,
        fallbackObservedAt,
        duplicates,
        adapterKey: input.adapterKey,
      })
    );

    // The one rule the import keeps, warned about before anything is written so
    // the message names the product whether or not the ingest reached it.
    document.products.forEach((product, index) => {
      if (duplicates.has(observations[index].externalId)) {
        context.warn(
          warningFor(
            HarvestWarningCode.DUPLICATE_KEY,
            product,
            index,
            'Two products in this document have the same name and size, so ' +
              'neither wrote a price.'
          )
        );
      }
    });

    // The groups of shops this file prices for, resolved before anything is
    // written (plan 0103, section 5.1). A document with none is every leaflet
    // and every version 1 file: its prices name no scope and fall to the one
    // the operator chose at the spawn.
    const scopes = this.scopes.forRun(
      input.supermarketId,
      input.adapterKey,
      (warning) => context.warn(warning)
    );
    for (const scope of document.scopes ?? []) {
      await scopes.declare({
        key: scope.key,
        kind: documentScopeKind(scope.kind),
        name: scope.name ?? null,
      });
    }
    if (scopes.createdCount > 0) {
      this.logger.log(
        `Run ${context.runId}: created ${scopes.createdCount} price scope(s) ` +
          'the document named and catalog did not hold'
      );
    }

    await context.setStage(
      'INGEST',
      `Recording ${observations.length} product(s)`
    );
    const { outcomes, counters } = await this.ingest.ingest(context, {
      supermarketId: input.supermarketId,
      defaultPriceScopeId: input.priceScopeId,
      sourceKind: input.sourceKind,
      scopeIdFor: scopes.idFor,
      observations,
    });

    // From here on the ingest has written rows and prices. A step below that
    // throws still fails the run, and the error carries what was written so
    // the report of the failed run states it (owner decision 102b). An ingest
    // that throws above wrote nothing this has to carry.
    // Counted as each row lands, so a failure midway leaves the true count.
    let categoryPathsWritten = 0;
    const afterIngest = async (
      step: FileImportStepAfterIngest,
      work: () => Promise<void>
    ): Promise<void> => {
      try {
        await work();
      } catch (error) {
        throw new FileImportFailedAfterIngestError(
          step,
          { ...counters, categoryPathsWritten },
          error
        );
      }
    };
    await afterIngest('OUTCOMES', () =>
      this.recordOutcomes(context, document.products, outcomes)
    );
    await afterIngest('CATEGORY_PATHS', () =>
      this.writeCategoryPaths(
        context.runId,
        input.sourceKind,
        document.products,
        outcomes,
        () => {
          categoryPathsWritten += 1;
        }
      )
    );
    await afterIngest('FLUSH', () => context.flush());
    return { ...counters, categoryPathsWritten };
  }

  /**
   * The category paths each product of the document states, added to the
   * paths its row holds (plan 0268, section 3): every path of
   * `category_paths`, then `category_path` when it is not among them.
   * `onWritten` is called once for each row whose paths changed, as it lands.
   *
   * **`ADD`, unless the file states the paths whole** (164a). A document is
   * one reading of one source: a leaflet shows one department of a product,
   * not every shelf it sits on, and has not shown that a stored path no
   * longer holds. A row's paths are replaced only when every product of the
   * document that resolved to it {@link statesPathsWhole}, and only for an
   * import of a walk's kind (`OFFICIAL_WEB`, `OFFICIAL_API`): the
   * harvester's export states `category_paths_complete` for a row the
   * exported walk read whole, and the import stands where that walk stood.
   * The replacing paths are those of every such product, `category_path`
   * included, and the write names this import's run on the row, so an
   * export of this import carries the statement on.
   *
   * Written after the ingest, so each row the import created exists, as a
   * walk writes its paths at the drain after the last chunk. An ingest that
   * throws reaches no line here, so a failed import writes no path. A write
   * here that throws fails the run, which {@link run} raises as a
   * {@link FileImportFailedAfterIngestError} carrying what the ingest wrote. A product
   * with no path makes no write. Two products of the document that resolve to
   * one row (`DUPLICATE_KEY`) add their paths to it together.
   *
   * A path is the chain's context for the curator and never a match: no row
   * is bound or resolved by it, and the ingest above resolved each row as it
   * did before (plan 0081).
   */
  private async writeCategoryPaths(
    runId: string,
    sourceKind: PriceSourceKind,
    products: readonly HarvestDocumentProduct[],
    outcomes: readonly SourceEntryOutcome[],
    onWritten: () => void
  ): Promise<void> {
    const replaces = WALK_KINDS.has(sourceKind);
    const byEntry = new Map<string, { paths: string[][]; whole: boolean }>();
    outcomes.forEach((outcome, index) => {
      const product = products[index];
      const paths = [
        ...(product?.category_paths ?? []),
        product?.category_path ?? [],
      ].filter((path) => path.length > 0);
      // Asked of every product of the row, one with no path included, so a
      // second product that does not state its paths whole keeps the row
      // at `ADD`.
      const whole =
        replaces && product !== undefined && statesPathsWhole(product);
      const held = byEntry.get(outcome.entry.id);
      if (held) {
        held.paths.push(...paths.map((path) => [...path]));
        held.whole = held.whole && whole;
      } else {
        byEntry.set(outcome.entry.id, {
          paths: paths.map((path) => [...path]),
          whole,
        });
      }
    });
    const writes = [...byEntry]
      .map(([entryId, { paths, whole }]) => ({
        entryId,
        paths: distinctCategoryPaths(paths),
        mode: whole ? ('REPLACE' as const) : ('ADD' as const),
      }))
      .filter((write) => write.paths.length > 0);
    if (writes.length === 0) {
      return;
    }
    await this.ingest.writeCategoryPaths(runId, writes, onWritten);
  }

  /**
   * One product, mapped onto an observation one to one (section 5).
   *
   * Everything here is a field of 6.1's table read as that table says, with one
   * decision of its own: a product colliding with another on the key carries no
   * price, which is what `DUPLICATE_KEY` means.
   */
  private observe(
    product: HarvestDocumentProduct,
    context: {
      documentWindow: ImportWindow | null;
      fallbackObservedAt: Date;
      duplicates: Set<string>;
      /** The importing chain's adapter, whose host rule a photo passes. */
      adapterKey: string | null;
    }
  ): DocumentObservation {
    const sizeFormat = product.size?.label ?? product.size?.unit ?? null;
    const soldByWeight = soldByWeightOf(product);
    const externalId =
      product.external_id ?? entryKey(product.name, sizeFormat);
    const imageUrl = documentPhotoOf(
      product.image_url,
      context.adapterKey,
      externalId
    );
    // The product's own window beats the document's, and neither is required.
    const window = product.validity
      ? resolveImportWindow({
          documentFrom: product.validity.from ?? null,
          documentUntil: product.validity.until ?? null,
        })
      : context.documentWindow;

    return {
      // The one observation that may leave a field unstated, and the mark
      // that it is a document's.
      fromDocument: true,
      // Read from the document and not from the converted size, so a
      // quantity that converts to none (`40 lavados`) still states a size.
      statesSizeQuantity: typeof product.size?.quantity === 'number',
      externalId,
      name: product.name,
      // **Absent stays absent.** A field the document does not state is
      // passed as undefined, and the ingest leaves the stored value of the
      // row alone, whatever the kind of the import. Only a stated value, a
      // null included, writes. A file is not the chain: a field it leaves
      // out says nothing about the product, and a harvester export leaves
      // out every field its row holds as null.
      brand: product.brand,
      ean: product.ean,
      // `size.quantity` in the unit `size.unit` names (plan 0177). The unit
      // used to be dropped, which left a 750 read from `75 cl` with nothing to
      // say it was already millilitres.
      ...sizeOf(product.size),
      // How the product is sold (plan 0181): stated by the export, or a tile
      // priced by the kilo. The ingest then writes the row with no size,
      // whatever the tile printed as one. Absent when the document does not
      // say, so a known row keeps its flag, as for the weight below.
      soldByWeight,
      // The weight of one piece in grams (plan 0244, section 5.5). The reader
      // refused it beside a size. Absent stays absent, so a document that
      // states none leaves the weight a row holds alone.
      ...(product.approx_weight === undefined
        ? {}
        : { approxWeight: product.approx_weight }),
      sizeFormat,
      // A null path is a statement that the source files it nowhere.
      categoryPath:
        product.category_path === undefined
          ? undefined
          : (product.category_path ?? []),
      url: product.url,
      // A document names a photo only through the rule a walk's address
      // passed (plan 0198): the host list of the importing chain's own
      // adapter library. An address that fails it is not written, so a
      // document cannot make a shopper's browser load an arbitrary host,
      // and the stored address stays.
      imageUrl,
      observedAt:
        parseInstant(product.observed_at) ?? context.fallbackObservedAt,
      // Stored and shown, never interpreted (D6). Whatever the producer knew
      // that the import does not read is in here and stays in here.
      extra: product.extra,
      prices: context.duplicates.has(externalId)
        ? []
        : pricesOf(product, window),
    };
  }

  /**
   * A warning per product, from what the ladder answered (section 5).
   *
   * The ingest itself is silent: a walk touches four thousand unresolved rows
   * and a warning for each is a column nobody reads. A file has hundreds of rows
   * and a person reads that list, so the codes the leaflet import produced are
   * produced here, from the outcomes rather than from a second ladder.
   */
  private async recordOutcomes(
    context: RunContext,
    products: readonly HarvestDocumentProduct[],
    outcomes: readonly SourceEntryOutcome[]
  ): Promise<void> {
    let skipped = 0;
    outcomes.forEach((outcome, index) => {
      const product = products[index];
      const warning = warningOf(outcome, product, index);
      if (!warning) {
        return;
      }
      context.warn(warning);
      skipped += 1;
    });
    if (skipped > 0) {
      await context.report({ skipped });
    }
  }
}

/**
 * Every price a product states, one per group of shops it named.
 *
 * The document arrives normalized into the version 2 shape (plan 0103, D7), so
 * a version 1 product is already one entry naming no scope, and there is no
 * branch here on which version the file was written for.
 *
 * **A price's own window beats the one resolved above it.** A region can date a
 * product differently from its neighbour, which is the thing section 4 of plan
 * 0089 says the model has to be able to store.
 */
function pricesOf(
  product: HarvestDocumentProduct,
  window: ImportWindow | null
): SourceObservation['prices'] {
  const soldByWeight = soldByWeightOf(product) === true;
  const unpayable = unpayableForOne(product);
  return (product.prices ?? []).map((price) => {
    const own = price.validity
      ? resolveImportWindow({
          documentFrom: price.validity.from ?? null,
          documentUntil: price.validity.until ?? null,
        })
      : window;
    return {
      scopeKey: price.scope ?? null,
      // Null when the source stated only a comparison figure. The ingest then
      // writes the unit price and no till price, which is plan 0081 section
      // 6.1's one surviving decision. A product sold by weight is the
      // exception (plan 0181): its price is the price of a kilo.
      price: priceOf(price, soldByWeight, unpayable),
      currency: price.currency || DEFAULT_CURRENCY,
      unitPrice: price.unit_price?.amount ?? null,
      unitPriceLabel: price.unit_price?.label ?? null,
      validFrom: own?.validFrom ?? null,
      validUntil: own?.validUntil ?? null,
    };
  });
}

/**
 * Whether a product of the document is sold by weight (plan 0181), or
 * undefined when the document does not say.
 *
 * **`sold_by_weight` first**, which the harvester's export states from the
 * flag its row holds, true or false.
 *
 * **Then `extra.basis`, the one rule that reads `extra`.** The leaflet
 * producer writes no `sold_by_weight`. It writes the tile's basis into
 * `extra` (`unit`, `kg`, `l`), and a tile whose basis is `kg` prints the
 * price of a kilo: a piece of cheese, a tray of meat, loose fruit.
 *
 * **Any other basis, or none, says nothing**, and answers undefined: a known
 * row keeps how it is sold, and a new row is not sold by weight. A litre
 * basis is not a way to sell either. It is the comparison figure of a
 * bottle, and the bottle has a size and a price of its own, so its price
 * stays null when the producer stated none.
 */
export function soldByWeightOf(
  product: HarvestDocumentProduct
): boolean | undefined {
  if (typeof product.sold_by_weight === 'boolean') {
    return product.sold_by_weight;
  }
  return product.extra?.['basis'] === 'kg' ? true : undefined;
}

/**
 * The kinds an import may replace a row's category paths as (164a): the
 * kinds a walk stamps. A leaflet, a person and every other kind only add.
 */
const WALK_KINDS: ReadonlySet<PriceSourceKind> = new Set([
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_API,
]);

/**
 * Whether a product of the document states its category paths whole (164a):
 * `category_paths_complete` is `true` **and** `category_paths` holds at least
 * one path. A statement of completeness beside no paths, an empty list or
 * only empty paths replaces nothing, so a file cannot wipe the paths of a row
 * by stating none.
 */
export function statesPathsWhole(product: HarvestDocumentProduct): boolean {
  return (
    product.category_paths_complete === true &&
    Array.isArray(product.category_paths) &&
    distinctCategoryPaths(product.category_paths).length > 0
  );
}

/**
 * The price of one entry of a product, as the row holds it (plan 0181).
 *
 * The producer answers no till price for a tile priced by the kilo, because a
 * leaflet prints no pack price for it, and puts the tile's headline figure in
 * the unit price. That figure is the price of a kilo, and a product sold by
 * weight has no other price, so it is written as the price as well. Without it
 * 21 products showed no price at a chain whose leaflet printed one.
 *
 * A price the producer did state is never replaced. Nor is a null with no
 * unit price beside it: that is a tile that needs a loyalty card, and a card
 * price is not one a shopper without the card pays.
 *
 * **Nor is the null of a conditional promotion** ({@link unpayableForOne}).
 * The unit price beside it is the tile's comparison line, and the producer
 * left the price null because nobody pays that number for one unit.
 */
function priceOf(
  price: HarvestDocumentPrice,
  soldByWeight: boolean,
  unpayable: boolean
): number | null {
  if (price.amount !== null && price.amount !== undefined) {
    return price.amount;
  }
  return soldByWeight && !unpayable ? (price.unit_price?.amount ?? null) : null;
}

/**
 * The promotion types whose printed number holds only under a condition: buy
 * two, buy three, the second unit. They restate `CONDITIONAL_PROMOTIONS` of
 * the leaflet producer (`to-harvest-document.mjs`), which is the list that
 * decided the price was null.
 */
const CONDITIONAL_PROMOTIONS: ReadonlySet<unknown> = new Set([
  'second_unit_discount',
  'multibuy_unit_price',
  'multibuy_total',
  'buy_n_get_free',
]);

/**
 * Whether the tile prints a conditional promotion and no price for a single
 * unit (plan 0181).
 *
 * Read from `extra.promotion`, which the leaflet producer carries verbatim:
 * its `type` is one of the conditional ones and its `single_unit_price`
 * states no amount. That is exactly the case in which the producer answered
 * no price and said the only number on the tile is one a shopper cannot pay
 * for one unit. When the tile does print a single unit price, the producer
 * put that number in the unit price, and it is the price of a kilo.
 *
 * A document with no `extra.promotion` answers false, so a producer that
 * writes none is read as before.
 */
export function unpayableForOne(product: HarvestDocumentProduct): boolean {
  const promotion = product.extra?.['promotion'];
  if (typeof promotion !== 'object' || promotion === null) {
    return false;
  }
  const { type, single_unit_price: single } = promotion as {
    type?: unknown;
    single_unit_price?: { amount?: unknown } | null;
  };
  return CONDITIONAL_PROMOTIONS.has(type) && typeof single?.amount !== 'number';
}

/**
 * A document's size as the row holds it: the number, and the catalog unit the
 * number is in (plan 0177).
 *
 * `size.unit` is free text in the file schema, so it is read the way a printed
 * unit is: `ml`, `MILLILITER`, `unit` and `ud` all name a catalog unit, and a
 * centilitre is written as ten millilitres. A unit the catalog does not hold,
 * or no unit at all, keeps the quantity as the document stated it and states
 * no unit, which is what every row imported before this plan says. A length
 * (`m`, `cm`) is the one exception: it is a dimension and not a size, so it
 * states no quantity either (plan 0183).
 *
 * `size.label` is not read here. It is the row's `sizeFormat` and half of its
 * key, and it stays exactly what the source printed.
 */
export function sizeOf(
  size: HarvestDocumentSize | null | undefined
): SourceSize {
  return sourceSizeOf(size?.quantity ?? null, size?.unit ?? null);
}

/** The keys more than one product in this document resolves to (D2). */
export function duplicateKeysIn(
  products: readonly HarvestDocumentProduct[]
): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const product of products) {
    const sizeFormat = product.size?.label ?? product.size?.unit ?? null;
    const key = product.external_id ?? entryKey(product.name, sizeFormat);
    if (seen.has(key)) {
      twice.add(key);
    }
    seen.add(key);
  }
  return twice;
}

/**
 * What this outcome is worth telling a person about, or null when it is nothing.
 *
 * An `ACTIVE` row wrote its price and needs no remark, whether a person had
 * accepted it before or the EAN rung accepted it just now.
 */
export function warningOf(
  outcome: SourceEntryOutcome,
  product: HarvestDocumentProduct,
  index: number
): HarvestRunWarning | null {
  const status = outcome.entry.status;
  if (status === SourceEntryStatus.ACTIVE) {
    return null;
  }
  if (status === SourceEntryStatus.REJECTED) {
    return warningFor(
      HarvestWarningCode.REJECTED_ALIAS,
      product,
      index,
      `"${product.name}" was rejected for this chain, so it was skipped and ` +
        'not asked about again.'
    );
  }
  if (!outcome.created) {
    return warningFor(
      HarvestWarningCode.ALREADY_QUEUED,
      product,
      index,
      `"${product.name}" is already waiting in this chain's queue.`
    );
  }
  return status === SourceEntryStatus.CANDIDATE
    ? warningFor(
        HarvestWarningCode.CANDIDATE_MATCH,
        product,
        index,
        `"${product.name}" looks like something the catalog knows, so it is ` +
          'queued for a person: a fuzzy match never writes a price.'
      )
    : warningFor(
        HarvestWarningCode.NO_MATCH,
        product,
        index,
        `"${product.name}" matched nothing, so it is queued for a person.`
      );
}

/** The window the spawn resolved and stored on the run (section 5). */
function storedWindow(input: Record<string, unknown>): ImportWindow | null {
  const validFrom = parseInstant(input?.['validFrom']);
  const validUntil = parseInstant(input?.['validUntil']);
  return validFrom && validUntil ? { validFrom, validUntil } : null;
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The page a producer's own warning names, when it named one.
 *
 * This reads a **warning's** bag, not a product's. D6's rule is that no decision
 * may be taken from a product's `extra`; a run warning has a `page` field the run
 * page renders, and dropping the number the producer put there would lose it for
 * no reason.
 */
function pageOf(
  extra: Record<string, unknown> | null | undefined
): number | null {
  const page = extra?.['page'];
  return typeof page === 'number' ? page : null;
}

/**
 * A document's scope kind, read under its current name (plan 0116, section 2.1).
 *
 * `POSTAL_CODE` is what `LOCAL_AREA` was called before plan 0116. A version 2
 * file that validated then still validates, and it declares the kind by its
 * current name.
 */
export function documentScopeKind(
  kind: HarvestDocumentScope['kind']
): PriceScopeKind {
  return kind === 'POSTAL_CODE'
    ? PriceScopeKind.LOCAL_AREA
    : (kind as PriceScopeKind);
}

function warningFor(
  code: HarvestWarningCode,
  product: HarvestDocumentProduct,
  index: number,
  message: string
): HarvestRunWarning {
  return {
    code,
    // The document's own id when it gave one, so a message names a product; the
    // index names it otherwise (section 6.1).
    offerId: product.id ?? `#${index + 1}`,
    page: null,
    name: product.name,
    message,
  };
}
