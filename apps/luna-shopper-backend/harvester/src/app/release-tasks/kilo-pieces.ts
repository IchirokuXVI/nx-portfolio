import {
  productGtin,
  UnitOfMeasure,
  type CreateItemInput,
  type ItemLinkedImageLink,
  type ItemView,
  type LinkItemImagesResult,
  type UpdateItemInput,
} from '@portfolio/luna-shopper/contracts';
import { approxWeightIn } from '@portfolio/luna-shopper/lidl';

/**
 * Release task 0006 of backend plan 0244, section 7: the products that
 * production holds today, corrected through the ordinary item messages.
 *
 * The groups, each decided by an ACTIVE queue row:
 *
 * - 7.1 `kilo`. A product with one ACTIVE Mercadona row sold by weight whose
 *   latest price label is `kg`, and which is GRAM with a size. It becomes
 *   KILOGRAM with no size, and its old size becomes its weight.
 * - 7.2 `piece`. The same row with the label `ud`, or a LIDL row that prints an
 *   approximate weight and is the only ACTIVE row of its product, on a GRAM
 *   product with a size. It becomes UNIT with no size, and its old size becomes
 *   its weight. The row agrees afterwards: a Mercadona row is no longer sold by
 *   weight, and a LIDL row holds the weight and no size.
 * - 7.3 `unweighed`. KILOGRAM products with no size and no weight that have an
 *   ACTIVE Mercadona row sold by weight. Counted, never written: the next run
 *   fills them.
 * - 7.4 `split`. A product with two or more ACTIVE Mercadona rows sold by
 *   weight. It keeps the row with the lowest price per kilo (a tie goes to the
 *   lower external id), and each other row gets a new product of its own.
 *
 * **One catalog write per converted product.** 7.1 and 7.2 are one
 * `item.update` that sends the unit, the null size, the old size as the
 * weight and `approxWeightSetBy: 'SOURCE'`, under an `expect` of the product
 * as the task read it. Catalog lets a service state `SOURCE`, so the next
 * Mercadona run corrects the 18 pieces whose weight moved since October (plan
 * 0244, D2). A product the update converted no longer matches 7.1 or 7.2.
 *
 * **What a stop between two databases leaves.** A piece of 7.2 also writes
 * its queue row. A stop after the catalog update and before that row write
 * leaves a UNIT product with a weight and a row that still disagrees: the
 * next run of the task finds it from that state, counts it under `rows` and
 * writes the row alone. A split creates in catalog and binds in the
 * harvester. Its create names the row in `createdFromEntry`, and before it
 * creates it asks `item.findCreatedFromEntry` for that row: an answer is the
 * product an earlier, interrupted run made, and the row is bound to it
 * (`adopted`). The bind is the last write, so a stop before it is always
 * found by the next run.
 *
 * Every catalog write is one transaction per product, audited with the
 * harvester's actor and refused by the same rules as any edit. Nothing here
 * writes a price, and no SQL here touches a catalog table.
 */

/** Prefixes of a LIDL size that cannot be an approximate weight, for SQL. */
const LIDL_APPROXIMATE_PREFILTER = '^(aprox|approx|ca|env)';

/** How many products one `item.getMany` may ask for. */
const LOOKUP_CHUNK = 500;

export type Group = 'kilo' | 'piece-mercadona' | 'piece-lidl' | 'split';

/** One ACTIVE bound row as the selection reads it. */
export interface RowRead {
  id: string;
  externalId: string;
  itemId: string;
  supermarketId: string;
  adapterKey: string | null;
  soldByWeight: boolean;
  ean: string | null;
  imageUrl: string | null;
  lastRunId: string | null;
  sizeFormat: string | null;
  /** The row's own `unitSize`, which a LIDL piece loses in 7.2. */
  unitSize: number | null;
  /** The label of the latest price row that has one, lower case. */
  label: string | null;
  /** The lowest stored price of the row across its scopes. */
  lowestPrice: number | null;
  /** ACTIVE rows of any chain bound to the same product. */
  rowsOnItem: number;
}

export interface HarvesterDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CatalogPort {
  getMany(ids: string[]): Promise<ItemView[]>;
  update(input: UpdateItemInput): Promise<ItemView>;
  create(input: CreateItemInput): Promise<ItemView>;
  /** `item.findCreatedFromEntry`: the product a create stated for a row. */
  findCreatedFromEntry(createdFromEntry: string): Promise<ItemView | null>;
  findItemByEan(ean: string): Promise<ItemView | null>;
  linkImages(links: ItemLinkedImageLink[]): Promise<LinkItemImagesResult>;
}

export interface KiloPiecesPorts {
  harvester: HarvesterDb;
  catalog: CatalogPort;
  log(line: string): void;
}

export type KiloPiecesOptions =
  | { mode: 'count' }
  | { mode: 'write'; maxKilo: number; maxPiece: number; maxSplit: number };

/** A product of 7.1 or 7.2, and the weight it is given. */
export interface Conversion {
  group: Exclude<Group, 'split'>;
  row: RowRead;
  item: ItemView;
  /** The product's old size, in grams. */
  approxWeight: number;
  /** For LIDL, the weight the row is given: the number it prints. */
  rowWeight: number | null;
}

/** A product of 7.4. */
export interface Split {
  item: ItemView;
  keep: RowRead;
  move: RowRead[];
}

/**
 * A piece of 7.2 whose product is converted and whose queue row still says
 * otherwise, because a run stopped between the two writes.
 */
export interface Resume {
  group: 'piece-mercadona' | 'piece-lidl';
  row: RowRead;
  item: ItemView;
}

export interface KiloPiecesPlan {
  kilo: Conversion[];
  piece: Conversion[];
  split: Split[];
  resume: Resume[];
  unweighed: number;
  /** Products a selection matched that the task leaves to a person. */
  held: string[];
  /** Whether catalog answers `approxWeight`, which every write needs. */
  catalogSpeaksWeight: boolean;
}

/**
 * Every ACTIVE row of Mercadona sold by weight, and every ACTIVE LIDL row
 * whose size may be approximate. The count of rows on a product is taken over
 * all chains before the filter, so the LIDL rule "its only ACTIVE row" reads
 * every chain.
 */
export const SELECT_ROWS_SQL = `
WITH active AS (
  SELECT e.*, count(*) OVER (PARTITION BY e."itemId")::int AS "rowsOnItem"
    FROM source_catalog_entries e
   WHERE e.status = 'ACTIVE' AND e."itemId" IS NOT NULL
)
SELECT a.id, a."externalId", a."itemId", a."supermarketId", s."adapterKey",
       a."soldByWeight", a.ean, a."imageUrl", a."lastRunId", a."sizeFormat",
       a."unitSize", a."rowsOnItem",
       (SELECT lower(btrim(p."unitPriceLabel"))
          FROM source_entry_prices p
         WHERE p."entryId" = a.id AND p."unitPriceLabel" IS NOT NULL
         ORDER BY p."observedAt" DESC, p."updatedAt" DESC
         LIMIT 1) AS label,
       (SELECT min(p.price)
          FROM source_entry_prices p
         WHERE p."entryId" = a.id AND p.price IS NOT NULL) AS "lowestPrice"
  FROM active a
  LEFT JOIN supermarket_sources s ON s."supermarketId" = a."supermarketId"
 WHERE (s."adapterKey" = 'mercadona-api' AND a."soldByWeight")
    OR (s."adapterKey" = 'lidl-api'
        AND btrim(coalesce(a."sizeFormat", '')) ~* '${LIDL_APPROXIMATE_PREFILTER}')
 ORDER BY a."itemId", a."externalId"`;

/** The harvester migration of plan 0244 adds this column. */
const ROW_WEIGHT_COLUMN_SQL = `
SELECT 1 AS present
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name = 'source_catalog_entries'
   AND column_name = 'approxWeight'`;

/**
 * Reads `--count`, or `--max-kilo <n> --max-piece <n> --max-split <n>`.
 * Anything else is refused, so a typo never becomes a run without a ceiling.
 */
export function parseKiloPiecesArgs(argv: string[]): KiloPiecesOptions {
  const usage =
    'usage: node kilo-pieces.js --count | ' +
    '--max-kilo <n> --max-piece <n> --max-split <n>';
  if (argv.length === 1 && argv[0] === '--count') {
    return { mode: 'count' };
  }
  const values: Record<string, number> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !['--max-kilo', '--max-piece', '--max-split'].includes(flag) ||
      flag in values ||
      value === undefined ||
      !/^\d+$/.test(value)
    ) {
      throw new Error(usage);
    }
    values[flag] = Number(value);
  }
  if (Object.keys(values).length !== 3) {
    throw new Error(usage);
  }
  return {
    mode: 'write',
    maxKilo: values['--max-kilo'],
    maxPiece: values['--max-piece'],
    maxSplit: values['--max-split'],
  };
}

/** The rows of {@link SELECT_ROWS_SQL}, with numbers read as numbers. */
export async function readRows(db: HarvesterDb): Promise<RowRead[]> {
  const raw = await db.query<Record<string, unknown>>(SELECT_ROWS_SQL);
  return raw.map((row) => ({
    id: String(row['id']),
    externalId: String(row['externalId']),
    itemId: String(row['itemId']),
    supermarketId: String(row['supermarketId']),
    adapterKey: (row['adapterKey'] as string | null) ?? null,
    soldByWeight: row['soldByWeight'] === true,
    ean: (row['ean'] as string | null) ?? null,
    imageUrl: (row['imageUrl'] as string | null) ?? null,
    lastRunId: (row['lastRunId'] as string | null) ?? null,
    sizeFormat: (row['sizeFormat'] as string | null) ?? null,
    unitSize: numberOrNull(row['unitSize']),
    label: (row['label'] as string | null) ?? null,
    lowestPrice: numberOrNull(row['lowestPrice']),
    rowsOnItem: Number(row['rowsOnItem']),
  }));
}

/** Every product the rows name, by id, asked in chunks. */
export async function readItems(
  catalog: CatalogPort,
  rows: RowRead[]
): Promise<Map<string, ItemView>> {
  const ids = [...new Set(rows.map((row) => row.itemId))];
  const items = new Map<string, ItemView>();
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    for (const item of await catalog.getMany(ids.slice(i, i + LOOKUP_CHUNK))) {
      items.set(item.id, item);
    }
  }
  return items;
}

/**
 * The value a split's create states in `createdFromEntry`, and asks for
 * before it creates: the queue row's identity in the harvester, the chain
 * and the external id (`uq_source_catalog_entry`).
 */
export function createdFromEntryOf(row: RowRead): string {
  return `${row.supermarketId}:${row.externalId}`;
}

/**
 * The groups of section 7, decided from the rows and their products. Pure:
 * the same rows and products always answer the same plan.
 */
export function planKiloPieces(
  rows: RowRead[],
  items: Map<string, ItemView>
): KiloPiecesPlan {
  const plan: KiloPiecesPlan = {
    kilo: [],
    piece: [],
    split: [],
    resume: [],
    unweighed: 0,
    held: [],
    catalogSpeaksWeight:
      items.size === 0 ||
      [...items.values()].every((item) => 'approxWeight' in item),
  };

  const mercadona = new Map<string, RowRead[]>();
  for (const row of rows) {
    if (row.adapterKey === 'mercadona-api' && row.soldByWeight) {
      const held = mercadona.get(row.itemId) ?? [];
      held.push(row);
      mercadona.set(row.itemId, held);
    }
  }

  const claimed = new Set<string>();
  for (const [itemId, onItem] of mercadona) {
    const item = items.get(itemId);
    if (!item || item.mergedInto) {
      plan.held.push(`${itemId}: ${item ? 'merged' : 'not in catalog'}`);
      continue;
    }
    if (isKiloWithNoWeight(item)) {
      plan.unweighed += 1;
    }
    if (onItem.length >= 2) {
      claimed.add(itemId);
      if (
        item.defaultUnit !== UnitOfMeasure.KILOGRAM ||
        item.unitSize !== null
      ) {
        plan.held.push(
          `${itemId}: ${onItem.length} Mercadona pieces on a product that is ` +
            `${item.defaultUnit} ${item.unitSize ?? 'with no size'}, not split`
        );
        continue;
      }
      const [keep, ...move] = [...onItem].sort(byKeeper);
      plan.split.push({ item, keep, move });
      continue;
    }
    const [row] = onItem;
    if (row.label === 'ud' && isConvertedPiece(item)) {
      // The update landed and the row write did not: the row alone is left.
      claimed.add(itemId);
      plan.resume.push({ group: 'piece-mercadona', row, item });
      continue;
    }
    if (!isSizedGram(item)) {
      continue;
    }
    const group =
      row.label === 'kg'
        ? 'kilo'
        : row.label === 'ud'
          ? 'piece-mercadona'
          : null;
    if (group === null) {
      continue;
    }
    claimed.add(itemId);
    const conversion: Conversion = {
      group,
      row,
      item,
      approxWeight: Number(item.unitSize),
      rowWeight: null,
    };
    (group === 'kilo' ? plan.kilo : plan.piece).push(conversion);
  }

  for (const row of rows) {
    if (row.adapterKey !== 'lidl-api' || claimed.has(row.itemId)) {
      continue;
    }
    const rowWeight = approxWeightIn(row.sizeFormat);
    const item = items.get(row.itemId);
    if (
      rowWeight === null ||
      row.rowsOnItem !== 1 ||
      !item ||
      item.mergedInto
    ) {
      continue;
    }
    if (isConvertedPiece(item)) {
      // Converted, and the row still holds the number as a size.
      if (row.unitSize !== null) {
        claimed.add(row.itemId);
        plan.resume.push({ group: 'piece-lidl', row, item });
      }
      continue;
    }
    if (!isSizedGram(item)) {
      continue;
    }
    claimed.add(row.itemId);
    plan.piece.push({
      group: 'piece-lidl',
      row,
      item,
      approxWeight: Number(item.unitSize),
      rowWeight,
    });
  }
  return plan;
}

/** The count lines both shell files read. */
export function countLines(plan: KiloPiecesPlan): string[] {
  const lidl = plan.piece.filter((c) => c.group === 'piece-lidl').length;
  return [
    `kilo ${plan.kilo.length}`,
    `piece ${plan.piece.length}`,
    `piece-mercadona ${plan.piece.length - lidl}`,
    `piece-lidl ${lidl}`,
    `split ${plan.split.length}`,
    `rows ${plan.resume.length}`,
    `unweighed ${plan.unweighed}`,
    ...plan.held.map((line) => `held ${line}`),
  ];
}

/**
 * The command: prints the counts, and in write mode refuses above a ceiling
 * before it writes anything. Answers the number of failures; each failure
 * stops only its own product.
 */
export async function runKiloPieces(
  ports: KiloPiecesPorts,
  options: KiloPiecesOptions
): Promise<number> {
  const rows = await readRows(ports.harvester);
  const items = await readItems(ports.catalog, rows);
  const plan = planKiloPieces(rows, items);
  for (const line of countLines(plan)) {
    ports.log(line);
  }
  if (options.mode === 'count') {
    return 0;
  }

  const over: string[] = [];
  if (plan.kilo.length > options.maxKilo) {
    over.push(`${plan.kilo.length} kilo pieces, above ${options.maxKilo}`);
  }
  if (plan.piece.length > options.maxPiece) {
    over.push(
      `${plan.piece.length} pieces priced as one, above ${options.maxPiece}`
    );
  }
  if (plan.split.length > options.maxSplit) {
    over.push(
      `${plan.split.length} merged products, above ${options.maxSplit}`
    );
  }
  if (over.length > 0) {
    throw new Error(`Refused, and nothing was changed: ${over.join('; ')}.`);
  }
  const work = plan.kilo.length + plan.piece.length + plan.split.length;
  if (work + plan.resume.length === 0) {
    ports.log('nothing to change');
    return 0;
  }
  if (!plan.catalogSpeaksWeight) {
    throw new Error(
      'Catalog answers no approxWeight, so it runs a release older than plan ' +
        '0244 and would drop the weight of every write. Nothing was changed.'
    );
  }
  const columns = await ports.harvester.query(ROW_WEIGHT_COLUMN_SQL);
  if (columns.length === 0) {
    throw new Error(
      'source_catalog_entries has no "approxWeight" column, so the harvester ' +
        'migration of plan 0244 has not run. Nothing was changed.'
    );
  }

  let failures = 0;
  const attempt = async (what: string, step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      failures += 1;
      ports.log(`failed ${what}: ${describe(error)}`);
    }
  };

  for (const conversion of [...plan.kilo, ...plan.piece]) {
    await attempt(
      `${conversion.group} ${conversion.row.externalId} ${conversion.item.id}`,
      () => convert(ports, conversion)
    );
  }
  for (const resume of plan.resume) {
    await attempt(
      `resume ${resume.group} ${resume.row.externalId} ${resume.item.id}`,
      async () => {
        await finishRow(ports.harvester, resume.group, resume.row);
        ports.log(
          `resumed ${resume.group} ${resume.row.externalId} ${resume.item.id} ` +
            `about ${resume.item.approxWeight} g`
        );
      }
    );
  }
  for (const split of plan.split) {
    for (const row of split.move) {
      await attempt(`split ${row.externalId} ${split.item.id}`, () =>
        moveRow(ports, split, row)
      );
    }
  }
  ports.log(`failures ${failures}`);
  return failures;
}

/**
 * 7.1 and 7.2: one catalog update that sends the unit, the size and the
 * weight as the source's, then for a piece the row.
 */
async function convert(ports: KiloPiecesPorts, c: Conversion): Promise<void> {
  const saved = await ports.catalog.update({
    itemId: c.item.id,
    defaultUnit:
      c.group === 'kilo' ? UnitOfMeasure.KILOGRAM : UnitOfMeasure.UNIT,
    unitSize: null,
    approxWeight: c.approxWeight,
    approxWeightSetBy: 'SOURCE',
    expect: {
      defaultUnit: UnitOfMeasure.GRAM,
      unitSize: c.approxWeight,
      approxWeight: null,
    },
  });
  if (saved.approxWeightSetBy !== 'SOURCE') {
    // The product is converted and stays so. Its weight is a person's, so no
    // run moves it until a person sends `approxWeight: null`.
    throw new Error(
      `catalog stored the weight as ${saved.approxWeightSetBy ?? 'nothing'}, ` +
        'not SOURCE, so it runs a release older than this task expects'
    );
  }
  if (c.group !== 'kilo') {
    await finishRow(ports.harvester, c.group, c.row);
  }
  ports.log(
    `${c.group} ${c.row.externalId} ${c.item.id} ` +
      `${c.group === 'kilo' ? 'KILOGRAM' : 'UNIT'} about ${c.approxWeight} g`
  );
}

/** The harvester half of 7.2: the row agrees with its converted product. */
async function finishRow(
  db: HarvesterDb,
  group: 'piece-mercadona' | 'piece-lidl',
  row: RowRead
): Promise<void> {
  if (group === 'piece-mercadona') {
    await updateOne(
      db,
      `UPDATE source_catalog_entries
          SET "soldByWeight" = false, "updatedAt" = now()
        WHERE id = $1`,
      [row.id]
    );
    return;
  }
  const weight = approxWeightIn(row.sizeFormat);
  if (weight === null) {
    throw new Error(`the row prints "${row.sizeFormat}", which is no weight`);
  }
  await updateOne(
    db,
    `UPDATE source_catalog_entries
        SET "unitSize" = NULL, "sizeUnit" = NULL, "approxWeight" = $2,
            "updatedAt" = now()
      WHERE id = $1`,
    [row.id, weight]
  );
}

/**
 * 7.4 for one row that leaves its product: the product an earlier run
 * created for it, or a new one, then the bind, then its photo link.
 */
async function moveRow(
  ports: KiloPiecesPorts,
  split: Split,
  row: RowRead
): Promise<void> {
  const { catalog, harvester, log } = ports;
  const createdFromEntry = createdFromEntryOf(row);
  let target = await catalog.findCreatedFromEntry(createdFromEntry);
  const adopted = target !== null;
  if (target !== null && (target.id === split.item.id || target.mergedInto)) {
    throw new Error(
      `catalog holds ${target.id} as created for ${createdFromEntry}, and it ` +
        `is ${target.mergedInto ? `merged into ${target.mergedInto}` : 'the product the row leaves'}; ` +
        'a person decides where the row goes'
    );
  }

  if (target === null) {
    const gtin = productGtin(row.ean);
    let ean: string | null = null;
    if (gtin !== null) {
      const holder = await catalog.findItemByEan(gtin);
      if (holder === null) {
        ean = gtin;
      } else {
        log(`ean-stays ${row.externalId} ${gtin} ${holder.id}`);
      }
    }
    target = await catalog.create({
      name: split.item.name,
      brand: split.item.brand,
      imageUrl: split.item.ownImageUrl,
      packCount: split.item.packCount,
      categoryIds: split.item.categories.map((category) => category.id),
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: null,
      ean,
      createdFromEntry,
    });
  }

  // Last, so a stop before it leaves the row on its old product, and the
  // next run finds the created product through `createdFromEntry`.
  await updateOne(
    harvester,
    `UPDATE source_catalog_entries
        SET "itemId" = $2, "candidateEntryId" = NULL, "matchedBy" = 'MANUAL',
            confidence = 1, "decidedAt" = now(), "updatedAt" = now()
      WHERE id = $1 AND "itemId" = $3 AND status = 'ACTIVE'`,
    [row.id, target.id, split.item.id]
  );
  log(
    `${adopted ? 'adopted' : 'created'} ${row.externalId} ${target.id} ` +
      `from ${split.item.id}, kept ${split.keep.externalId}`
  );

  if (row.imageUrl) {
    const { rejected } = await catalog.linkImages([
      {
        sourceEntryId: row.id,
        itemId: target.id,
        supermarketId: row.supermarketId,
        url: row.imageUrl,
        runId: row.lastRunId,
      },
    ]);
    for (const rejection of rejected) {
      // The bind stands. The next run sends the link again.
      log(`photo-not-moved ${row.externalId}: ${describe(rejection)}`);
    }
  }
}

/**
 * Runs one UPDATE and refuses unless it changed exactly one row. Wrapped in a
 * CTE so the driver answers a SELECT, whose shape does not depend on the verb.
 */
async function updateOne(
  db: HarvesterDb,
  update: string,
  params: unknown[]
): Promise<void> {
  const [answer] = await db.query<{ changed: number }>(
    `WITH changed AS (${update} RETURNING 1) SELECT count(*)::int AS changed FROM changed`,
    params
  );
  if (Number(answer?.changed) !== 1) {
    throw new Error(
      `the harvester row ${String(params[0])} changed under the task ` +
        `(${answer?.changed ?? 0} rows updated)`
    );
  }
}

/** The keeper first: lowest price per kilo, then the lower external id. */
export function byKeeper(a: RowRead, b: RowRead): number {
  const pa = a.lowestPrice ?? Number.POSITIVE_INFINITY;
  const pb = b.lowestPrice ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) {
    return pa < pb ? -1 : 1;
  }
  return compareExternalIds(a.externalId, b.externalId);
}

/** Numerically when both are numbers, as Mercadona's ids are. */
function compareExternalIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b) && a.length !== b.length) {
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function isSizedGram(item: ItemView): boolean {
  return (
    item.defaultUnit === UnitOfMeasure.GRAM &&
    item.unitSize !== null &&
    (item.approxWeight ?? null) === null
  );
}

/** A piece priced as one, as 7.2 leaves it. */
function isConvertedPiece(item: ItemView): boolean {
  return (
    item.defaultUnit === UnitOfMeasure.UNIT &&
    item.unitSize === null &&
    (item.approxWeight ?? null) !== null
  );
}

function isKiloWithNoWeight(item: ItemView): boolean {
  return (
    item.defaultUnit === UnitOfMeasure.KILOGRAM &&
    item.unitSize === null &&
    (item.approxWeight ?? null) === null
  );
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A catalog refusal arrives as a plain object, not an Error. */
export function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
