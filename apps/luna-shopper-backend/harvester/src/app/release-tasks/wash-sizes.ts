import {
  UnitOfMeasure,
  type ItemView,
  type UpdateItemInput,
} from '@portfolio/luna-shopper/contracts';

/**
 * Release task 0007 of backend plan 0271: the products that were made from a
 * row printing a wash count lose that count as their size.
 *
 * Before plan 0270, `40 lavados` was read as 40 `UNIT` by DEZA, Carrefour, DIA,
 * El Jamón and the leaflet import, and a product created from such a row kept
 * that size. A walk never rewrites a product's size, so the task does.
 *
 * **The selection (section 1).** An ACTIVE bound row whose stored `sizeFormat`
 * is a printed wash count and nothing wider ({@link readWashFormat}), on a
 * product that is `UNIT` with a `unitSize` equal to the row's count. Nothing
 * else is read: no name, no audit trail (D4), no other row's content.
 *
 * **The correction (section 2).** `unitSize` becomes null, `defaultUnit` stays
 * `UNIT`, and `packCount` becomes null only when it equals the pack the row
 * printed (`2x40 lavados` is a pack of 2). No size is set and no other row's
 * content is copied (D3). One `item.update` per product with the harvester's
 * actor, under an `expect` of the product as the task read it just before.
 *
 * **What it prints.** Counts only, because `check.sh` and `post.sh` print the
 * command's output into the deploy log, and that log is public. The products
 * themselves go to the review list file (section 5), which `post.sh` copies
 * into a ConfigMap and never prints.
 *
 * **The Mercadona note.** Mercadona is outside the selection. A pack it prices
 * per wash (label `lv`) and sizes as `ud` holds the number of washes as a
 * `UNIT` size, because `readUnitSize` of the adapter takes `total_units` when
 * the comparison price is the pack price over it. Those rows are listed for
 * the curator in a second file and never corrected.
 */

/** The chain whose per wash packs are noted and never corrected. */
const MERCADONA_ADAPTER = 'mercadona-api';

/** The catalog refusal of an `expect` that no longer holds. */
const EXPECTATION_FAILED = 'item_expectation_failed';

/** How many products one `item.getMany` may ask for. */
const LOOKUP_CHUNK = 500;

/** The units a weight or a volume is stored in. */
const CONTENT_UNITS: ReadonlySet<string> = new Set([
  UnitOfMeasure.GRAM,
  UnitOfMeasure.KILOGRAM,
  UnitOfMeasure.MILLILITER,
  UnitOfMeasure.LITER,
]);

/**
 * A printed wash count, on the trimmed stored text (section 1.1): an optional
 * `N x` (`x` or `X`, spaces allowed), a whole number `Q`, `lavado` or
 * `lavados`, and at most a full stop. `23+12 lavados` does not match.
 */
const WASH_FORMAT = /^(?:(\d+)\s*x\s*)?(\d+)\s*lavados?\.?$/i;

/** The count and the pack a wash format prints. */
export interface WashFormat {
  /** `Q`, or `N × Q`. */
  count: number;
  /** `N`, or null with no `N x`. */
  pack: number | null;
}

/** The count and pack of a printed wash count, or null for any other text. */
export function readWashFormat(text: string | null): WashFormat | null {
  const match = WASH_FORMAT.exec((text ?? '').trim());
  if (!match) {
    return null;
  }
  const quantity = Number(match[2]);
  const pack = match[1] === undefined ? null : Number(match[1]);
  return { count: pack === null ? quantity : pack * quantity, pack };
}

/**
 * The chain's slug as its adapter key names it: `deza-web` is `deza`. A chain
 * with no source row is named by its id, which names no product.
 */
export function chainOf(adapterKey: string | null, supermarketId: string) {
  return adapterKey ? adapterKey.split('-')[0] : supermarketId;
}

/** One ACTIVE bound row of a product the selection may touch. */
export interface StatedRow {
  itemId: string;
  chain: string;
  adapterKey: string | null;
  sizeFormat: string | null;
  unitSize: number | null;
  sizeUnit: string | null;
  packCount: number | null;
  /** The label of the latest price row that has one, lower case. */
  label: string | null;
}

/**
 * Every ACTIVE bound row whose printed size names a wash. The pattern of
 * {@link readWashFormat} decides; this only keeps the read small.
 */
export const SELECT_WASH_ROWS_SQL = `
SELECT e."itemId"
  FROM source_catalog_entries e
 WHERE e.status = 'ACTIVE' AND e."itemId" IS NOT NULL
   AND e."sizeFormat" ~* 'lavado'`;

/**
 * Every ACTIVE bound row of the products in `$1`, with the label of its
 * latest price row, and every ACTIVE bound Mercadona row priced per wash and
 * sized as a count, for the note.
 */
export const SELECT_STATED_ROWS_SQL = `
SELECT r.* FROM (
  SELECT e.id, e."itemId", e."supermarketId", s."adapterKey", e."sizeFormat",
         e."unitSize", e."sizeUnit", e."packCount",
         (SELECT lower(btrim(p."unitPriceLabel"))
            FROM source_entry_prices p
           WHERE p."entryId" = e.id AND p."unitPriceLabel" IS NOT NULL
           ORDER BY p."observedAt" DESC, p."updatedAt" DESC
           LIMIT 1) AS label
    FROM source_catalog_entries e
    LEFT JOIN supermarket_sources s ON s."supermarketId" = e."supermarketId"
   WHERE e.status = 'ACTIVE' AND e."itemId" IS NOT NULL
     AND (e."itemId" = ANY($1::uuid[])
          OR (s."adapterKey" = '${MERCADONA_ADAPTER}' AND e."sizeUnit" = 'UNIT'))
) r
 WHERE r."itemId" = ANY($1::uuid[])
    OR (r."adapterKey" = '${MERCADONA_ADAPTER}' AND r.label = 'lv')
 ORDER BY r."itemId", r."supermarketId", r.id`;

export interface HarvesterDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CatalogPort {
  getMany(ids: string[]): Promise<ItemView[]>;
  update(input: UpdateItemInput): Promise<ItemView>;
}

/** Where the write run and `--review` put their lists. */
export interface ReviewSink {
  write(path: string, text: string): Promise<void>;
}

export interface WashSizesPorts {
  harvester: HarvesterDb;
  catalog: CatalogPort;
  files: ReviewSink;
  log(line: string): void;
}

export type WashSizesOptions =
  | { mode: 'count' }
  | { mode: 'review'; file: string }
  | { mode: 'write'; max: number; file: string };

/** One product the task corrects, as it was read. */
export interface Correction {
  item: ItemView;
  /** `C`: the size the product holds and the task takes off. */
  count: number;
  /** Whether its pack count is the pack a qualifying row printed. */
  clearPack: boolean;
  /** The chains whose rows qualified it, each with the formats they print. */
  washFormats: Map<string, string[]>;
  /** Every size text its ACTIVE rows state, as `<chain>: <text>`. */
  statedSizes: string[];
  /** Whether another ACTIVE row states a weight or a volume. */
  content: boolean;
}

/** One Mercadona row the curator is told about and the task does not touch. */
export interface PerWashNote {
  item: ItemView;
  row: StatedRow;
}

export interface WashSizesPlan {
  corrections: Correction[];
  /** Products by chain, including chains with a wash row and none to change. */
  byChain: Map<string, number>;
  /** Rows that print a wash count whose `C` is not a whole number above 0. */
  unread: number;
  /** Products that a qualifying row names and catalog has not or has merged. */
  held: number;
  notes: PerWashNote[];
}

/**
 * Reads `--count`, `--review <file>`, or `--max <n> --review <file>`.
 * Anything else is refused, so a typo never becomes a run without a ceiling.
 */
export function parseWashSizesArgs(argv: string[]): WashSizesOptions {
  const usage =
    'usage: node wash-sizes.js --count | --review <file> | ' +
    '--max <n> --review <file>';
  if (argv.length === 1 && argv[0] === '--count') {
    return { mode: 'count' };
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !['--max', '--review'].includes(flag) ||
      flag in values ||
      value === undefined ||
      value.startsWith('--') ||
      (flag === '--max' && !/^\d+$/.test(value))
    ) {
      throw new Error(usage);
    }
    values[flag] = value;
  }
  const file = values['--review'];
  if (file === undefined) {
    throw new Error(usage);
  }
  if (values['--max'] === undefined) {
    return { mode: 'review', file };
  }
  return { mode: 'write', max: Number(values['--max']), file };
}

/** The products that bear a wash row, then every row the plan reads. */
export async function readRows(db: HarvesterDb): Promise<StatedRow[]> {
  const ids = (await db.query<{ itemId: string }>(SELECT_WASH_ROWS_SQL)).map(
    (row) => String(row.itemId)
  );
  const raw = await db.query<Record<string, unknown>>(SELECT_STATED_ROWS_SQL, [
    [...new Set(ids)],
  ]);
  return raw.map((row) => {
    const adapterKey = (row['adapterKey'] as string | null) ?? null;
    return {
      itemId: String(row['itemId']),
      chain: chainOf(adapterKey, String(row['supermarketId'])),
      adapterKey,
      sizeFormat: (row['sizeFormat'] as string | null) ?? null,
      unitSize: numberOrNull(row['unitSize']),
      sizeUnit: (row['sizeUnit'] as string | null) ?? null,
      packCount: numberOrNull(row['packCount']),
      label: (row['label'] as string | null) ?? null,
    };
  });
}

/** Every product the rows name, by id, asked in chunks. */
export async function readItems(
  catalog: CatalogPort,
  ids: string[]
): Promise<Map<string, ItemView>> {
  const unique = [...new Set(ids)];
  const items = new Map<string, ItemView>();
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    for (const item of await catalog.getMany(
      unique.slice(i, i + LOOKUP_CHUNK)
    )) {
      items.set(item.id, item);
    }
  }
  return items;
}

/**
 * Whether a qualifying row of `count` and `pack` selects the product, and
 * the pack it clears. Section 1.2: the product is `UNIT` and holds `count`.
 */
function selects(item: ItemView, count: number): boolean {
  return (
    item.defaultUnit === UnitOfMeasure.UNIT &&
    item.unitSize !== null &&
    Number(item.unitSize) === count
  );
}

/**
 * The selection of section 1, the counts of section 6 and the note. Pure: the
 * same rows and products always answer the same plan.
 */
export function planWashSizes(
  rows: StatedRow[],
  items: Map<string, ItemView>
): WashSizesPlan {
  const plan: WashSizesPlan = {
    corrections: [],
    byChain: new Map(),
    unread: 0,
    held: 0,
    notes: [],
  };
  const byItem = new Map<string, StatedRow[]>();
  for (const row of rows) {
    const held = byItem.get(row.itemId) ?? [];
    held.push(row);
    byItem.set(row.itemId, held);
  }

  for (const [itemId, onItem] of byItem) {
    const washRows = onItem
      .map((row) => ({ row, wash: readWashFormat(row.sizeFormat) }))
      .filter(
        (pair): pair is { row: StatedRow; wash: WashFormat } =>
          pair.wash !== null
      );
    if (washRows.length === 0) {
      continue;
    }
    for (const { row, wash } of washRows) {
      if (!plan.byChain.has(row.chain)) {
        plan.byChain.set(row.chain, 0);
      }
      if (!Number.isInteger(wash.count) || wash.count <= 0) {
        plan.unread += 1;
      }
    }
    const item = items.get(itemId);
    if (!item || item.mergedInto) {
      plan.held += 1;
      continue;
    }
    const matching = washRows.filter(
      ({ wash }) => wash.count > 0 && selects(item, wash.count)
    );
    if (matching.length === 0) {
      continue;
    }
    const washFormats = new Map<string, string[]>();
    for (const { row } of matching) {
      const formats = washFormats.get(row.chain) ?? [];
      const text = String(row.sizeFormat).trim();
      if (!formats.includes(text)) {
        formats.push(text);
      }
      washFormats.set(row.chain, formats);
    }
    for (const chain of washFormats.keys()) {
      plan.byChain.set(chain, (plan.byChain.get(chain) ?? 0) + 1);
    }
    const statedSizes = [
      ...new Set(
        onItem
          .filter((row) => row.sizeFormat !== null && row.sizeFormat.trim())
          .map((row) => `${row.chain}: ${String(row.sizeFormat).trim()}`)
      ),
    ].sort();
    plan.corrections.push({
      item,
      count: Number(item.unitSize),
      clearPack: matching.some(
        ({ wash }) =>
          wash.pack !== null &&
          item.packCount !== null &&
          Number(item.packCount) === wash.pack
      ),
      washFormats,
      statedSizes,
      content: onItem.some(
        (row) =>
          row.unitSize !== null &&
          row.sizeUnit !== null &&
          CONTENT_UNITS.has(row.sizeUnit)
      ),
    });
  }

  const corrected = new Set(plan.corrections.map((c) => c.item.id));
  for (const row of rows) {
    if (
      row.adapterKey === MERCADONA_ADAPTER &&
      row.sizeUnit === UnitOfMeasure.UNIT &&
      row.label === 'lv' &&
      !corrected.has(row.itemId)
    ) {
      const item = items.get(row.itemId);
      if (item && !item.mergedInto) {
        plan.notes.push({ item, row });
      }
    }
  }
  return plan;
}

/** The count lines both shell files read (section 6). Numbers only. */
export function countLines(plan: WashSizesPlan): string[] {
  return [
    ...[...plan.byChain.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([chain, n]) => `chain ${chain} ${n}`),
    `products ${plan.corrections.length}`,
    `pack ${plan.corrections.filter((c) => c.clearPack).length}`,
    `content ${plan.corrections.filter((c) => c.content).length}`,
    `unread ${plan.unread}`,
    `held ${plan.held}`,
    `mercadona-per-wash ${plan.notes.length}`,
  ];
}

const REVIEW_HEADER = [
  'chain',
  'item_id',
  'item_name',
  'old_unit_size',
  'old_default_unit',
  'old_pack_count',
  'wash_size_format',
  'stated_sizes',
];

const NOTE_HEADER = [
  'chain',
  'item_id',
  'item_name',
  'unit_size',
  'default_unit',
  'pack_count',
  'row_size_format',
  'row_unit_size',
  'row_size_unit',
  'unit_price_label',
];

/**
 * The review list of section 5: one line per corrected product and chain,
 * grouped by chain, then by Spanish name. Tab separated, with a header.
 */
export function reviewList(corrections: Correction[]): string {
  const lines = corrections.flatMap((c) =>
    [...c.washFormats.entries()].map(([chain, formats]) => ({
      chain,
      name: nameOf(c.item),
      cells: [
        chain,
        c.item.id,
        nameOf(c.item),
        String(c.item.unitSize),
        c.item.defaultUnit,
        c.item.packCount === null ? '' : String(c.item.packCount),
        formats.join('; '),
        c.statedSizes.join('; '),
      ],
    }))
  );
  return table(REVIEW_HEADER, sortLines(lines));
}

/**
 * The Mercadona note: the packs the chain prices per wash and sizes as a
 * count, which the task does not correct. Same order as the review list.
 */
export function perWashNote(notes: PerWashNote[]): string {
  const lines = notes.map(({ item, row }) => ({
    chain: row.chain,
    name: nameOf(item),
    cells: [
      row.chain,
      item.id,
      nameOf(item),
      item.unitSize === null ? '' : String(item.unitSize),
      item.defaultUnit,
      item.packCount === null ? '' : String(item.packCount),
      row.sizeFormat ?? '',
      row.unitSize === null ? '' : String(row.unitSize),
      row.sizeUnit ?? '',
      row.label ?? '',
    ],
  }));
  return table(NOTE_HEADER, sortLines(lines));
}

/** The file the Mercadona note goes to, beside the review list. */
export function notePathOf(reviewPath: string): string {
  return reviewPath.replace(/(\.tsv)?$/, '.mercadona-per-wash.tsv');
}

/**
 * The command. Answers the number of failures; each failure stops only its
 * own product. Prints counts and never a product.
 */
export async function runWashSizes(
  ports: WashSizesPorts,
  options: WashSizesOptions
): Promise<number> {
  const rows = await readRows(ports.harvester);
  const items = await readItems(
    ports.catalog,
    rows.map((row) => row.itemId)
  );
  const plan = planWashSizes(rows, items);
  for (const line of countLines(plan)) {
    ports.log(line);
  }
  if (options.mode === 'count') {
    return 0;
  }
  if (options.mode === 'review') {
    await writeLists(ports, options.file, plan.corrections, plan.notes);
    ports.log(`review ${plan.corrections.length}`);
    return 0;
  }

  if (plan.unread > 0) {
    throw new Error(
      `Refused, and nothing was changed: ${plan.unread} rows print a wash ` +
        'count that is not a whole number above 0.'
    );
  }
  if (plan.corrections.length > options.max) {
    throw new Error(
      `Refused, and nothing was changed: ${plan.corrections.length} ` +
        `products, above ${options.max}.`
    );
  }

  const done: Correction[] = [];
  let skipped = 0;
  let failures = 0;
  for (const correction of plan.corrections) {
    try {
      const saved = await correct(ports.catalog, correction);
      if (saved === null) {
        skipped += 1;
      } else {
        done.push(saved);
      }
    } catch (error) {
      if (codeOf(error) === EXPECTATION_FAILED) {
        skipped += 1;
        continue;
      }
      failures += 1;
      // A code, never the refusal itself, which can name the product.
      ports.log(`failed ${codeOf(error) ?? 'error'}`);
    }
  }
  await writeLists(ports, options.file, done, plan.notes);
  ports.log(`corrected ${done.length}`);
  ports.log(`skipped ${skipped}`);
  ports.log(`failures ${failures}`);
  return failures;
}

/**
 * One product: read again, skip it when it no longer holds `C` `UNIT`
 * (section 1.4), else one update under an `expect` of what was just read.
 * Answers the correction as it was before the write, or null when skipped.
 */
async function correct(
  catalog: CatalogPort,
  planned: Correction
): Promise<Correction | null> {
  const [fresh] = await catalog.getMany([planned.item.id]);
  if (!fresh || fresh.mergedInto || !selects(fresh, planned.count)) {
    return null;
  }
  const clearPack =
    planned.clearPack && fresh.packCount === planned.item.packCount;
  await catalog.update({
    itemId: fresh.id,
    unitSize: null,
    ...(clearPack ? { packCount: null } : {}),
    expect: {
      defaultUnit: UnitOfMeasure.UNIT,
      unitSize: planned.count,
      packCount: fresh.packCount,
    },
  });
  return { ...planned, item: fresh, clearPack };
}

async function writeLists(
  ports: WashSizesPorts,
  file: string,
  corrections: Correction[],
  notes: PerWashNote[]
): Promise<void> {
  await ports.files.write(file, reviewList(corrections));
  await ports.files.write(notePathOf(file), perWashNote(notes));
}

interface Line {
  chain: string;
  name: string;
  cells: string[];
}

function sortLines(lines: Line[]): Line[] {
  return [...lines].sort(
    (a, b) =>
      (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0) ||
      a.name.localeCompare(b.name, 'es') ||
      (a.cells[1] < b.cells[1] ? -1 : a.cells[1] > b.cells[1] ? 1 : 0)
  );
}

function table(header: string[], lines: Line[]): string {
  return [header, ...lines.map((line) => line.cells)]
    .map((cells) => cells.map(cell).join('\t'))
    .join('\n')
    .concat('\n');
}

/** A tab or a line break inside a value would break the list's shape. */
function cell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ');
}

function nameOf(item: ItemView): string {
  return item.name.es ?? item.name.en ?? '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The error code of a catalog refusal, which arrives as a plain object. */
export function codeOf(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[a-z0-9_]+$/.test(code)) {
      return code;
    }
  }
  return null;
}

/** The message of a failure that stops the command. Names no product. */
export function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return codeOf(error) ?? 'the command failed';
}
