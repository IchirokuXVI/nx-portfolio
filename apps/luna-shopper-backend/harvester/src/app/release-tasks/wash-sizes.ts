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
 * **The notes.** Some rows look like a wash count and are outside the
 * selection. The task lists them for the curator in a second file, one line
 * per row, and never corrects them ({@link readNoteFormat}, {@link NoteKind}).
 * A note is selected from stored fields only, never from a product name, and a
 * product the task corrects is not also noted.
 *
 * - `mercadona-per-wash`: an ACTIVE bound Mercadona row that states a count of
 *   units above 1 as its size (`unitSize` above 1, `sizeUnit` `UNIT`) and
 *   whose latest price label is `lv`, the chain pricing it per wash. Such a
 *   count may be the number of washes, whichever path of the adapter's
 *   `readUnitSize` produced it: the stored `unit_size`, or `total_units` when
 *   the comparison price is the pack price over it.
 * - `pack-of-units`: Carrefour's `pack de 2 unidades de 50 lavados.`, the pack
 *   phrase that its parser before plan 0270 multiplied into N × Q `UNIT`, on a
 *   product that holds N × Q `UNIT`.
 * - `short-wash-word`: El Jamón's `40lav` or `40lv`, on a product that holds
 *   40 `UNIT`. No old parser read these as a size, so where the product's size
 *   came from is not known.
 * - `sum`: `23+12 lavados`, `23+12lav`, on a product that holds N + M `UNIT`.
 *
 * **Across runs.** A list never loses a line an earlier run recorded. The
 * command reads the ConfigMap the earlier runs saved (`--recorded`) and keeps
 * each of its lines as it stands, old size and all, adding only the lines it
 * does not hold yet ({@link mergeList}). The one change a later run makes to a
 * recorded line is the review list's `outcome`, from `planned` to `corrected`.
 *
 * `planned` means the task meant to correct the product and has no
 * confirmation that it did: check the product. `corrected` means the
 * product's wash count was taken off. An update can go through with no answer
 * that says so (a run stopped after it, or an answer that timed out), so every
 * run that is given recorded lists confirms their planned lines by reading
 * the product ({@link reconcileReview}).
 *
 * **A second selection (backend plan 0279, release task 0009).** The data
 * proved that the products of a sum (`35+18 lavados`, `30+6lav`) and of El
 * Jamón's short word (`40lav`, `60lv`) hold the count too. Under
 * `--selection sum-and-short-word` those two shapes qualify a product by the
 * same rule ({@link selects}), and nothing else does: `40 lavados` is task
 * 0007's. The two selections are disjoint by row, not by product: no printed
 * text qualifies under both, but a product bound to a `40 lavados` row and a
 * `40lav` row is counted by both tasks until one of them corrects it, and the
 * other then finds it has no size. Neither shape prints a pack, so no pack
 * count is cleared. The notes then keep `pack-of-units` and
 * `mercadona-per-wash` only, because the other two kinds are now
 * corrections. With no `--selection`, the command answers exactly what it
 * answered before.
 *
 * **The hold of the second selection (owner decision 156b, 2026-11-26).** A
 * product the selection qualifies is not corrected when another ACTIVE row
 * bound to it states the same number as a count of units
 * ({@link statesUnitCount}): El Jamón prints `10lav`, the product holds 10
 * `UNIT`, and DEZA states `10 ud`. A chain then confirms the 10 as a real
 * count (a capsule product, one capsule per wash). Such a product is counted
 * as `confirmed-units`, noted under that kind with the confirming row's chain
 * and text, and never written. The default selection has no hold.
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
 * What a note says about a row the task does not correct. `confirmed-units`
 * is the second selection's hold ({@link statesUnitCount}), which `--count`
 * prints on its own line and only under that selection.
 */
export type NoteKind =
  | 'pack-of-units'
  | 'short-wash-word'
  | 'sum'
  | 'mercadona-per-wash'
  | 'confirmed-units';

/** The kind of note the hold of the second selection makes. */
export const CONFIRMED_UNITS = 'confirmed-units' as const;

/** The kinds in the order `--count` prints them, under every selection. */
export const NOTE_KINDS: readonly NoteKind[] = [
  'pack-of-units',
  'short-wash-word',
  'sum',
  'mercadona-per-wash',
];

/**
 * The nouns Carrefour's parser before plan 0270 counted a pack in after a
 * number (`CONTAINER` of `carrefour/src/lib/listing.ts` at 7b274b091).
 */
const CARREFOUR_CONTAINER = String.raw`(?:caja|cajas|lata|latas|bote|botes|botella|botellas|brick|bricks|estuche|estuches|tarrina|tarrinas|bandeja|bandejas|bolsa|bolsas|sobre|sobres|unidad|unidades|ud|uds|pieza|piezas|base|bases|pack|packs|vaso|vasos|tarro|tarros|barra|barras|rollo|rollos|blister|blisters)`;

/**
 * A printed pack of N units of Q washes, as Carrefour's parser before plan
 * 0270 split it off a name and stored it as N × Q `UNIT`: one of its three
 * pack phrases with the count N stated (`pack de 2 unidades de`, `pack 2 de`,
 * `2 cajas de`, `pack 2 bolsas`), then a plain quantity Q, then `lavado` or
 * `lavados`, then what that parser left on the stored text after the word (a
 * full stop, `aprox`, more full stops). A phrase with no N (`caja de 50
 * lavados`) multiplied nothing, and a quantity joined by `x` or `+` stated no
 * size, so neither is this shape.
 */
const PACK_OF_UNITS = new RegExp(
  String.raw`^(?:pack\s+(?:de\s+)?(\d+)(?:\s+[A-Za-zÀ-ÿ]{2,12})?\s+de\s+|(\d+)\s*${CARREFOUR_CONTAINER}\s+de\s+|pack\s+(\d+)\s+${CARREFOUR_CONTAINER}\s+)(\d+(?:[.,]\d+)?)\s*lavados?\.?(?:\s+aprox)?\.*$`,
  'i'
);

/**
 * A wash count in El Jamón's short word: a whole number directly followed by
 * `lav` or `lv`, with at most one space between and at most a full stop after
 * (`40lav`, `40 lv.`), and nothing else.
 */
const SHORT_WASH_WORD = /^(\d+) ?(?:lav|lv)\.?$/i;

/**
 * A bonus pack printed as a sum of washes: `N+M lavados`, `N+Mlav` or
 * `N+Mlv`, spaces allowed around the `+`, at most a full stop after. The
 * short words take at most one space after the number, as
 * {@link WASH_PREFILTER} admits them; `lavados` takes any.
 */
const WASH_SUM = /^(\d+)\s*\+\s*(\d+)(?:\s*lavados?| ?(?:lav|lv))\.?$/i;

/** The kind of note a row's printed text has, and the size it would state. */
export interface NoteFormat {
  kind: Exclude<NoteKind, 'mercadona-per-wash' | 'confirmed-units'>;
  /** The `UNIT` count a product made from the row would hold. */
  count: number;
}

/**
 * The note a printed size makes, or null. Disjoint from
 * {@link readWashFormat}: no text both are corrected and noted.
 */
export function readNoteFormat(text: string | null): NoteFormat | null {
  const trimmed = (text ?? '').trim();
  const pack = PACK_OF_UNITS.exec(trimmed);
  if (pack) {
    const units = Number(pack[1] ?? pack[2] ?? pack[3]);
    const quantity = Number(pack[4].replace(',', '.'));
    return { kind: 'pack-of-units', count: units * quantity };
  }
  const short = SHORT_WASH_WORD.exec(trimmed);
  if (short) {
    return { kind: 'short-wash-word', count: Number(short[1]) };
  }
  const sum = WASH_SUM.exec(trimmed);
  if (sum) {
    return { kind: 'sum', count: Number(sum[1]) + Number(sum[2]) };
  }
  return null;
}

/**
 * Which products a run selects. `printed-count` is task 0007's (plan 0271,
 * section 1), the default. `sum-and-short-word` is task 0009's (plan 0279,
 * section 1).
 */
export type WashSelection = 'printed-count' | 'sum-and-short-word';

/** Every selection `--selection` accepts. */
export const WASH_SELECTIONS: readonly WashSelection[] = [
  'printed-count',
  'sum-and-short-word',
];

/** Whether a selection holds back a product a row confirms as units. */
const HOLDS_CONFIRMED_UNITS: Record<WashSelection, boolean> = {
  'printed-count': false,
  'sum-and-short-word': true,
};

/** The note kinds a selection corrects, and so never notes. */
const CORRECTED_KINDS: Record<WashSelection, ReadonlySet<NoteKind>> = {
  'printed-count': new Set<NoteKind>(),
  'sum-and-short-word': new Set<NoteKind>(['sum', 'short-wash-word']),
};

/**
 * The count a row's printed size qualifies a product with under a selection,
 * or null. `printed-count` reads {@link readWashFormat}. `sum-and-short-word`
 * reads only a sum or a short word of {@link readNoteFormat}, which print no
 * pack.
 */
export function readSelectedFormat(
  text: string | null,
  selection: WashSelection
): WashFormat | null {
  if (selection === 'printed-count') {
    return readWashFormat(text);
  }
  const note = readNoteFormat(text);
  return note !== null && CORRECTED_KINDS[selection].has(note.kind)
    ? { count: note.count, pack: null }
    : null;
}

/**
 * A count of pieces as a row stores its printed size: a whole number, at most
 * spaces, then `u`, `ud`, `uds`, `unid`, `unids`, `unidad` or `unidades`, and
 * at most a full stop (`10 ud`, `10 uds.`), or the bare word with no number,
 * which is how Mercadona stores it (`ud`, the number in `unitSize`). No other
 * word: `10 dosis`, `10 cápsulas` and `40 toallitas` are a count too, but a
 * dose can be a wash, so they confirm nothing.
 */
const UNIT_COUNT_FORMAT =
  /^(?:(\d+)\s*)?(?:u|ud|uds|unid|unids|unidad|unidades)\.?$/i;

/**
 * The hold of the second selection (owner decision 156b, plan 0279 section
 * 1.5): whether `row`, another ACTIVE bound row of the product, states `count`
 * as a count of units. Stored row fields only, never a name: all of
 *
 * - its trimmed `sizeFormat` is a count of pieces ({@link UNIT_COUNT_FORMAT}),
 *   and the number it prints, if it prints one, is `count`. A wash text
 *   (`10 lavados`, `10lav`), a sum and a volume (`1.6 L`) never match;
 * - its stored size is `count` in `UNIT` (`unitSize`, `sizeUnit`), the unit of
 *   counted pieces, as DEZA, El Jamón, DIA and Carrefour store `10 ud` and
 *   Mercadona stores `ud` beside the number;
 * - it states no pack (`packCount` null), so the count is the whole of it;
 * - its latest price label is not `lv`: a chain that prices the row per wash
 *   says its count is washes (`mercadona-per-wash`).
 *
 * A row outside ACTIVE, or bound to no product, is never read
 * ({@link SELECT_STATED_ROWS_SQL}), so it confirms nothing.
 */
export function statesUnitCount(row: StatedRow, count: number): boolean {
  const match = UNIT_COUNT_FORMAT.exec((row.sizeFormat ?? '').trim());
  return (
    match !== null &&
    (match[1] === undefined || Number(match[1]) === count) &&
    row.sizeUnit === UnitOfMeasure.UNIT &&
    row.unitSize !== null &&
    row.unitSize === count &&
    row.packCount === null &&
    row.label !== 'lv'
  );
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
  /** The row's own id, which keys a note across runs. */
  entryId: string;
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
 * What a printed size must contain for its product to be read at all: the
 * word `lavado` ({@link readWashFormat}, and the pack and sum notes), or a
 * digit before `lav` or `lv`, one space allowed (the short word and short sum
 * notes). The same text in Postgres and in JavaScript, with no backslash.
 * The patterns of {@link readWashFormat} and {@link readNoteFormat} decide;
 * this only keeps the read small, so a wider one corrects nothing more.
 */
export const WASH_PREFILTER = 'lavado|[0-9] ?(lav|lv)';

/** Every ACTIVE bound row whose printed size passes {@link WASH_PREFILTER}. */
export const SELECT_WASH_ROWS_SQL = `
SELECT e."itemId"
  FROM source_catalog_entries e
 WHERE e.status = 'ACTIVE' AND e."itemId" IS NOT NULL
   AND e."sizeFormat" ~* '${WASH_PREFILTER}'`;

/**
 * Every ACTIVE bound row of the products in `$1`, with the label of its
 * latest price row, and every ACTIVE bound Mercadona row priced per wash and
 * sized as a count above 1, for the note.
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
          OR (s."adapterKey" = '${MERCADONA_ADAPTER}' AND e."sizeUnit" = 'UNIT'
              AND e."unitSize" > 1))
) r
 WHERE r."itemId" = ANY($1::uuid[])
    OR (r."adapterKey" = '${MERCADONA_ADAPTER}' AND r.label = 'lv'
        AND r."unitSize" > 1)
 ORDER BY r."itemId", r."supermarketId", r.id`;

export interface HarvesterDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CatalogPort {
  getMany(ids: string[]): Promise<ItemView[]>;
  update(input: UpdateItemInput): Promise<ItemView>;
}

/**
 * Where the write run and `--review` put their lists, and where they read
 * what earlier runs recorded. `read('-')` is standard input.
 */
export interface ReviewSink {
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string>;
}

export interface WashSizesPorts {
  harvester: HarvesterDb;
  catalog: CatalogPort;
  files: ReviewSink;
  log(line: string): void;
}

/**
 * `recorded` names the file that holds what earlier runs saved: the
 * ConfigMap as `kubectl get -o json` prints it, or nothing when there is none.
 * `selection` is absent unless `--selection` named one, and absent means
 * `printed-count`.
 */
export type WashSizesOptions = { selection?: WashSelection } & (
  | { mode: 'count' }
  | { mode: 'review'; file: string; recorded: string | null }
  | { mode: 'write'; max: number; file: string; recorded: string | null }
);

/**
 * A refusal the command words itself. Its message names no product, so it is
 * the one kind of error whose message is printed ({@link describe}).
 */
export class WashSizesRefusal extends Error {
  override readonly name = 'WashSizesRefusal';
}

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

/** One row the curator is told about and the task does not touch. */
export interface Note {
  kind: NoteKind;
  item: ItemView;
  row: StatedRow;
  /** Every size text the product's ACTIVE rows state, as in the review list. */
  statedSizes: string[];
}

export interface WashSizesPlan {
  corrections: Correction[];
  /** Products by chain, including chains with a wash row and none to change. */
  byChain: Map<string, number>;
  /** Rows that print a wash count whose `C` is not a whole number above 0. */
  unread: number;
  /** Products that a qualifying row names and catalog has not or has merged. */
  held: number;
  /**
   * Products the second selection qualifies and holds back, because another
   * row states the count as units ({@link statesUnitCount}). Always 0 under
   * `printed-count`, which has no hold.
   */
  confirmed: number;
  /** The selection the plan was made under, which decides the count lines. */
  selection: WashSelection;
  notes: Note[];
}

/**
 * Reads `--count`, `--review <file>`, or `--max <n> --review <file>`, the
 * last two with an optional `--recorded <file|->`, each with an optional
 * `--selection <name>` of {@link WASH_SELECTIONS}. Anything else is refused,
 * so a typo never becomes a run without a ceiling, or a run of the other
 * task's selection.
 */
export function parseWashSizesArgs(argv: string[]): WashSizesOptions {
  const usage =
    'usage: node wash-sizes.js --count | --review <file> | ' +
    '--max <n> --review <file>, each list with [--recorded <file|->], ' +
    `each with [--selection ${WASH_SELECTIONS.join('|')}]`;
  const values: Record<string, string> = {};
  let count = false;
  for (let i = 0; i < argv.length; ) {
    const flag = argv[i];
    if (flag === '--count') {
      if (count) {
        throw new WashSizesRefusal(usage);
      }
      count = true;
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (
      !['--max', '--review', '--recorded', '--selection'].includes(flag) ||
      flag in values ||
      value === undefined ||
      value.startsWith('--') ||
      (flag === '--max' && !/^\d+$/.test(value)) ||
      (flag === '--selection' &&
        !(WASH_SELECTIONS as readonly string[]).includes(value))
    ) {
      throw new WashSizesRefusal(usage);
    }
    values[flag] = value;
    i += 2;
  }
  const named = values['--selection'] as WashSelection | undefined;
  const selection = named === undefined ? {} : { selection: named };
  if (count) {
    if (Object.keys(values).some((flag) => flag !== '--selection')) {
      throw new WashSizesRefusal(usage);
    }
    return { mode: 'count', ...selection };
  }
  const file = values['--review'];
  if (file === undefined) {
    throw new WashSizesRefusal(usage);
  }
  const recorded = values['--recorded'] ?? null;
  if (values['--max'] === undefined) {
    return { mode: 'review', file, recorded, ...selection };
  }
  return {
    mode: 'write',
    max: Number(values['--max']),
    file,
    recorded,
    ...selection,
  };
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
      entryId: String(row['id']),
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
 * same rows and products always answer the same plan. `selection` decides
 * which printed sizes qualify a product ({@link readSelectedFormat}) and
 * which kinds are noted; with none it is task 0007's.
 */
export function planWashSizes(
  rows: StatedRow[],
  items: Map<string, ItemView>,
  selection: WashSelection = 'printed-count'
): WashSizesPlan {
  const plan: WashSizesPlan = {
    corrections: [],
    byChain: new Map(),
    unread: 0,
    held: 0,
    confirmed: 0,
    selection,
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
      .map((row) => ({
        row,
        wash: readSelectedFormat(row.sizeFormat, selection),
      }))
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
    if (HOLDS_CONFIRMED_UNITS[selection]) {
      const confirming = onItem.filter((row) =>
        statesUnitCount(row, Number(item.unitSize))
      );
      if (confirming.length > 0) {
        plan.confirmed += 1;
        const statedSizes = statedSizesOf(onItem);
        for (const row of confirming) {
          plan.notes.push({ kind: CONFIRMED_UNITS, item, row, statedSizes });
        }
        continue;
      }
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
      statedSizes: statedSizesOf(onItem),
      content: onItem.some(
        (row) =>
          row.unitSize !== null &&
          row.sizeUnit !== null &&
          CONTENT_UNITS.has(row.sizeUnit)
      ),
    });
  }

  // A product the task corrects is on the review list, so it is not noted.
  const corrected = new Set(plan.corrections.map((c) => c.item.id));
  for (const row of rows) {
    const item = items.get(row.itemId);
    if (corrected.has(row.itemId) || !item || item.mergedInto) {
      continue;
    }
    const kind = noteKindOf(row, item);
    if (kind !== null && !CORRECTED_KINDS[selection].has(kind)) {
      plan.notes.push({
        kind,
        item,
        row,
        statedSizes: statedSizesOf(byItem.get(row.itemId) ?? []),
      });
    }
  }
  return plan;
}

/**
 * The note one row of a product the task does not correct makes, or null.
 * Stored fields only: the row's printed size, its stored size and label, and
 * the product's stored size. Never a name.
 */
function noteKindOf(row: StatedRow, item: ItemView): NoteKind | null {
  if (
    row.adapterKey === MERCADONA_ADAPTER &&
    row.sizeUnit === UnitOfMeasure.UNIT &&
    row.unitSize !== null &&
    row.unitSize > 1 &&
    row.label === 'lv'
  ) {
    return 'mercadona-per-wash';
  }
  const note = readNoteFormat(row.sizeFormat);
  return note !== null && note.count > 0 && selects(item, note.count)
    ? note.kind
    : null;
}

/** Every size text a product's ACTIVE rows state, as `<chain>: <text>`. */
function statedSizesOf(onItem: StatedRow[]): string[] {
  return [
    ...new Set(
      onItem
        .filter((row) => row.sizeFormat !== null && row.sizeFormat.trim())
        .map((row) => `${row.chain}: ${statedSizeOf(row)}`)
    ),
  ].sort();
}

/**
 * One row's size text for `stated_sizes`, from its stored columns. Mercadona
 * stores the bare unit as `sizeFormat` (`l`, `ud`) and the number in
 * `unitSize`, so a text with no digit is printed after the stored number:
 * `2 l`. A text with no digit and no stored number is printed as it stands.
 * This renders stored fields and reads no name.
 */
export function statedSizeOf(row: StatedRow): string {
  const text = String(row.sizeFormat ?? '').trim();
  if (/\d/.test(text) || row.unitSize === null) {
    return text;
  }
  return `${row.unitSize} ${text}`;
}

/**
 * The count lines both shell files read (section 6). Numbers only. A
 * selection with a hold prints `confirmed-units` after `held`; the default
 * prints exactly the lines it printed before.
 */
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
    ...(HOLDS_CONFIRMED_UNITS[plan.selection]
      ? [`${CONFIRMED_UNITS} ${plan.confirmed}`]
      : []),
    ...NOTE_KINDS.map(
      (kind) => `${kind} ${plan.notes.filter((n) => n.kind === kind).length}`
    ),
  ];
}

/** Where a review line stands: saved before its update, or after it. */
export type Outcome = 'planned' | 'corrected';

export const REVIEW_HEADER = [
  'chain',
  'item_id',
  'item_name',
  'old_unit_size',
  'old_default_unit',
  'old_pack_count',
  'wash_size_format',
  'stated_sizes',
  'outcome',
];

export const NOTES_HEADER = [
  'kind',
  'chain',
  'item_id',
  'item_name',
  'unit_size',
  'default_unit',
  'pack_count',
  'row_size_format',
  'stated_sizes',
  'entry_id',
];

/**
 * The review list of section 5: one line per product and chain that
 * qualified it, grouped by chain, then by Spanish name. Tab separated, with a
 * header. `outcome` is `corrected` for the products in `corrected`, whose
 * update went through, and `planned` for every other.
 */
export function reviewList(
  corrections: Correction[],
  corrected: ReadonlySet<string> = new Set()
): string {
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
        corrected.has(c.item.id) ? 'corrected' : 'planned',
      ],
    }))
  );
  return table(REVIEW_HEADER, sortLines(lines));
}

/**
 * The notes: one line per noted row, which the task does not correct,
 * grouped by kind, then as the review list. The size columns are the
 * product's as it stands. A `confirmed-units` line is the row that confirms
 * the count: its `chain` and its `row_size_format`, rendered as
 * `stated_sizes` renders it ({@link statedSizeOf}: Mercadona's `ud` is
 * `10 ud`), say which chain states the count and how.
 */
export function notesList(notes: Note[]): string {
  const lines = notes.map(({ kind, item, row, statedSizes }) => ({
    chain: `${kind}\t${row.chain}`,
    name: nameOf(item),
    cells: [
      kind,
      row.chain,
      item.id,
      nameOf(item),
      item.unitSize === null ? '' : String(item.unitSize),
      item.defaultUnit,
      item.packCount === null ? '' : String(item.packCount),
      kind === CONFIRMED_UNITS
        ? statedSizeOf(row)
        : String(row.sizeFormat ?? '').trim(),
      statedSizes.join('; '),
      row.entryId,
    ],
  }));
  return table(NOTES_HEADER, sortLines(lines));
}

/** The file the notes go to, beside the review list. */
export function notesPathOf(reviewPath: string): string {
  return reviewPath.replace(/(\.tsv)?$/, '.notes.tsv');
}

/** The ConfigMap keys the two lists are saved under (`post.sh`). */
export const REVIEW_KEY = 'review.tsv';
export const NOTES_KEY = 'notes.tsv';

/**
 * The ConfigMap each selection's `post.sh` saves the lists in, as kubectl
 * names it. Each task has its own, so neither writes over the other's list,
 * and a refusal of a recorded list names the one the run was given.
 */
export const REVIEW_CONFIGMAPS: Record<WashSelection, string> = {
  'printed-count': 'configmap/release-task-0007-review',
  'sum-and-short-word': 'configmap/release-task-0009-review',
};

/** Task 0007's ConfigMap, the one a run with no selection names. */
export const REVIEW_CONFIGMAP = REVIEW_CONFIGMAPS['printed-count'];

/** The key an earlier shape of this task kept the Mercadona note under. */
const OLD_NOTE_KEY = 'mercadona-per-wash.tsv';

/** The words that end every refusal of a recorded list. */
function recordedRemedy(configMap: string): string {
  return (
    `Delete ${configMap}, or restore the header of this task as the ` +
    'first line of each key, and run again.'
  );
}

/** What earlier runs saved in the ConfigMap, by key. */
export interface RecordedLists {
  review: string;
  notes: string;
}

/**
 * The lists earlier runs saved, read out of the ConfigMap as
 * `kubectl get configmap -o json` prints it. Empty text means there is no
 * ConfigMap yet. Anything else that cannot be read is refused, and the
 * refusal quotes none of it, and names `configMap`.
 */
export function readRecorded(
  text: string,
  configMap: string = REVIEW_CONFIGMAP
): RecordedLists {
  if (text.trim() === '') {
    return { review: '', notes: '' };
  }
  let data: unknown;
  try {
    data = (JSON.parse(text) as { data?: unknown }).data ?? {};
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') {
    throw new WashSizesRefusal(
      `Refused, and nothing was changed: ${configMap} cannot be ` +
        `read as a ConfigMap. ${recordedRemedy(configMap)}`
    );
  }
  if (OLD_NOTE_KEY in data) {
    throw new WashSizesRefusal(
      `Refused, and nothing was changed: ${configMap} holds the key ` +
        `${OLD_NOTE_KEY} of an earlier shape of this task. ` +
        recordedRemedy(configMap)
    );
  }
  const value = (key: string) => {
    const held = (data as Record<string, unknown>)[key];
    return typeof held === 'string' ? held : '';
  };
  return { review: value(REVIEW_KEY), notes: value(NOTES_KEY) };
}

/** How one list is merged across runs. */
export interface ListShape {
  header: readonly string[];
  /** The ConfigMap key it is saved under, which a refusal names. */
  key: string;
  /** The cells that name one line across runs. */
  keyOf(cells: string[]): string;
  /** The columns {@link sortLines} groups by, then the name's column. */
  groupOf(cells: string[]): string;
  nameOf(cells: string[]): string;
  /**
   * Whether a later line replaces a line held under the same key. Without
   * it the first line held stays.
   */
  replaces?(held: string[], next: string[]): boolean;
}

/**
 * The review list's shape: a line per product and chain (`chain`,
 * `item_id`). A `planned` line becomes the `corrected` line of a later run,
 * and a `corrected` line is never replaced.
 */
export const REVIEW_SHAPE: ListShape = {
  header: REVIEW_HEADER,
  key: REVIEW_KEY,
  keyOf: (cells) => `${cells[0]}\t${cells[1]}`,
  groupOf: (cells) => cells[0],
  nameOf: (cells) => cells[2] ?? '',
  replaces: (held, next) =>
    held[REVIEW_HEADER.length - 1] === 'planned' &&
    next[REVIEW_HEADER.length - 1] === 'corrected',
};

/**
 * The notes' shape: a line per row (`kind`, `chain`, `item_id` and the
 * row's `entry_id`), so two noted rows of one product are two lines.
 */
export const NOTES_SHAPE: ListShape = {
  header: NOTES_HEADER,
  key: NOTES_KEY,
  keyOf: (cells) =>
    [cells[0], cells[1], cells[2], cells[NOTES_HEADER.length - 1]].join('\t'),
  groupOf: (cells) => `${cells[0]}\t${cells[1]}`,
  nameOf: (cells) => cells[3] ?? '',
};

/**
 * One list: every line `recorded` holds, as it stands, and every line of
 * `next` whose key it does not hold yet. An earlier run's line keeps the old
 * size it recorded, so a product corrected by a run that failed later is
 * never dropped by the next one, and merging the same lines twice changes
 * nothing. The one replacement is the shape's own ({@link REVIEW_SHAPE}).
 * One header, the same order as the list. A refusal of the recorded list
 * names `configMap`.
 */
export function mergeList(
  shape: ListShape,
  recorded: string,
  next: string,
  configMap: string = REVIEW_CONFIGMAP
): string {
  const lines = new Map<string, Line>();
  for (const [source, text] of [
    ['recorded', recorded],
    ['next', next],
  ] as const) {
    const rows = text.split('\n').filter((line) => line.trim() !== '');
    if (rows.length === 0) {
      continue;
    }
    if (rows[0].replace(/\r$/, '') !== shape.header.join('\t')) {
      throw new WashSizesRefusal(
        source === 'recorded'
          ? `Refused, and nothing was changed: the key ${shape.key} of ` +
              `${configMap} does not start with the header of this ` +
              `task. ${recordedRemedy(configMap)}`
          : `Refused, and nothing was changed: the ${shape.key} this run ` +
              'wrote does not start with the header of this task.'
      );
    }
    for (const row of rows.slice(1)) {
      const cells = row.replace(/\r$/, '').split('\t');
      const key = shape.keyOf(cells);
      const held = lines.get(key);
      if (!held || shape.replaces?.(held.cells, cells)) {
        lines.set(key, {
          chain: shape.groupOf(cells),
          name: shape.nameOf(cells),
          cells,
        });
      }
    }
  }
  return table(shape.header, sortLines([...lines.values()]));
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
  const selection = options.selection ?? 'printed-count';
  const configMap = REVIEW_CONFIGMAPS[selection];
  const plan = planWashSizes(rows, items, selection);
  for (const line of countLines(plan)) {
    ports.log(line);
  }
  if (options.mode === 'count') {
    return 0;
  }
  // Read before any write, so a recorded list that cannot be read refuses
  // while nothing has changed.
  const recorded =
    options.recorded === null
      ? readRecorded('', configMap)
      : readRecorded(await ports.files.read(options.recorded), configMap);
  // A recorded list of another shape refuses here, before any write, and not
  // when the lists are written after the updates.
  mergeList(REVIEW_SHAPE, recorded.review, '', configMap);
  mergeList(NOTES_SHAPE, recorded.notes, '', configMap);
  // Whether there is anything to save is decided on the lists as they were
  // recorded, before the reconcile reads catalog.
  const plannedBefore = plannedIdsOf(recorded.review).length;
  const reconciled: RecordedLists = {
    ...recorded,
    review: (await reconcileReview(ports.catalog, recorded.review, configMap))
      .text,
  };
  if (options.mode === 'review') {
    // Nothing is written to a database, so every line this run adds is
    // `planned`. A line an earlier run recorded keeps its outcome, except a
    // planned line the reconcile confirmed.
    const written = await writeLists(
      ports,
      options.file,
      reviewList(plan.corrections),
      plan.notes,
      reconciled,
      configMap
    );
    ports.log(`review ${plan.corrections.length}`);
    ports.log(
      `save ${listsToSave(plannedBefore, recorded.notes, written.notes) ? 1 : 0}`
    );
    return 0;
  }

  if (plan.unread > 0) {
    throw new WashSizesRefusal(
      `Refused, and nothing was changed: ${plan.unread} rows print a wash ` +
        'count that is not a whole number above 0.'
    );
  }
  if (plan.corrections.length > options.max) {
    throw new WashSizesRefusal(
      `Refused, and nothing was changed: ${plan.corrections.length} ` +
        `products, above ${options.max}.`
    );
  }

  // Every product the run meant to correct is listed: `corrected`, with the
  // values it read just before its update, once that update went through, and
  // `planned`, as it was counted, when it was skipped or failed.
  const listed: Correction[] = [];
  const done = new Set<string>();
  let skipped = 0;
  let failures = 0;
  for (const correction of plan.corrections) {
    try {
      const saved = await correct(ports.catalog, correction);
      if (saved === null) {
        skipped += 1;
        listed.push(correction);
      } else {
        done.add(saved.item.id);
        listed.push(saved);
      }
    } catch (error) {
      listed.push(correction);
      if (codeOf(error) === EXPECTATION_FAILED) {
        skipped += 1;
        continue;
      }
      failures += 1;
      // A code, never the refusal itself, which can name the product.
      ports.log(`failed ${codeOf(error) ?? 'error'}`);
    }
  }
  await writeLists(
    ports,
    options.file,
    reviewList(listed, done),
    plan.notes,
    reconciled,
    configMap
  );
  ports.log(`corrected ${done.size}`);
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
  review: string,
  notes: Note[],
  recorded: RecordedLists,
  configMap: string
): Promise<RecordedLists> {
  // Both merged before either is written, so a refusal writes neither.
  const reviewText = mergeList(
    REVIEW_SHAPE,
    recorded.review,
    review,
    configMap
  );
  const notesText = mergeList(
    NOTES_SHAPE,
    recorded.notes,
    notesList(notes),
    configMap
  );
  await ports.files.write(file, reviewText);
  await ports.files.write(notesPathOf(file), notesText);
  return { review: reviewText, notes: notesText };
}

/** The column of the review list that holds the outcome. */
const OUTCOME = REVIEW_HEADER.length - 1;

/** The lines of a list below its header, each split into its cells. */
function linesOf(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(1)
    .map((line) => line.replace(/\r$/, '').split('\t'));
}

/** The product of each `planned` line of a review list. */
export function plannedIdsOf(review: string): string[] {
  return linesOf(review)
    .filter((cells) => cells[OUTCOME] === 'planned')
    .map((cells) => cells[1]);
}

/**
 * Whether the product a `planned` line names now shows that its wash count
 * was taken off: catalog has it, unmerged, `UNIT`, with no size. A product
 * that holds any size, or that catalog lacks or merged, confirms nothing.
 */
export function confirmsCorrection(item: ItemView | undefined): boolean {
  return (
    item !== undefined &&
    !item.mergedInto &&
    item.defaultUnit === UnitOfMeasure.UNIT &&
    (item.unitSize === null || item.unitSize === undefined)
  );
}

/**
 * The reconcile: each `planned` line of a recorded review list is read again
 * from catalog with the same read the selection uses, and becomes
 * `corrected` when its product confirms it ({@link confirmsCorrection}). The
 * size the line names is then gone, which is what the curator acts on. Every
 * other line stays as it stands, and a `corrected` line is never read.
 * Reads only: it sends no update. Answers the list and how many lines turned.
 */
export async function reconcileReview(
  catalog: CatalogPort,
  review: string,
  configMap: string = REVIEW_CONFIGMAP
): Promise<{ text: string; turned: number }> {
  const planned = linesOf(review).filter(
    (cells) => cells[OUTCOME] === 'planned'
  );
  if (planned.length === 0) {
    return { text: review, turned: 0 };
  }
  const items = await readItems(
    catalog,
    planned.map((cells) => cells[1])
  );
  const turned = planned
    .filter((cells) => confirmsCorrection(items.get(cells[1])))
    .map((cells) =>
      cells.map((value, i) => (i === OUTCOME ? 'corrected' : value))
    );
  if (turned.length === 0) {
    return { text: review, turned: 0 };
  }
  // The shape's own replacement turns each held `planned` line.
  const next = table(
    REVIEW_HEADER,
    turned.map((cells) => ({
      chain: REVIEW_SHAPE.groupOf(cells),
      name: REVIEW_SHAPE.nameOf(cells),
      cells,
    }))
  );
  return {
    text: mergeList(REVIEW_SHAPE, review, next, configMap),
    turned: turned.length,
  };
}

/**
 * Whether a run with no product to correct must still save the lists
 * (`post.sh`, on `products 0`): when the recorded review list held a
 * `planned` line, which the reconcile may have confirmed, or when the notes
 * of this run hold a line the recorded notes do not. Otherwise nothing is
 * saved and an earlier ConfigMap stays as it is.
 */
export function listsToSave(
  plannedRecorded: number,
  recordedNotes: string,
  mergedNotes: string
): boolean {
  return (
    plannedRecorded > 0 ||
    linesOf(mergedNotes).length > linesOf(recordedNotes).length
  );
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
      compare(a.cells.join('\t'), b.cells.join('\t'))
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function table(header: readonly string[], lines: Line[]): string {
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

/**
 * The line printed for a failure that stops the command. Names no product.
 *
 * Only a {@link WashSizesRefusal} is printed with its message, because the
 * command wrote that message. Any other error can carry a value out of a row
 * or a product (a `QueryFailedError` quotes its parameters, a rejected read
 * may quote what it read), so it is printed as its class name and its code,
 * and never as its message.
 */
export function describe(error: unknown): string {
  if (error instanceof WashSizesRefusal) {
    return error.message;
  }
  const code = codeOf(error) ?? sqlStateOf(error);
  const name =
    error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
      ? error.name
      : null;
  const what = [name, code].filter((part) => part !== null).join(' ');
  return what ? `the command failed: ${what}` : 'the command failed';
}

/**
 * The line printed for a process warning: its class name and its code, never
 * its message, which can quote a value (a deprecation names the call, a
 * listener leak names the emitter).
 */
export function describeWarning(warning: unknown): string {
  const raw =
    warning && typeof warning === 'object'
      ? (warning as { name?: unknown; code?: unknown })
      : {};
  const name =
    typeof raw.name === 'string' && /^[A-Za-z]{1,40}$/.test(raw.name)
      ? raw.name
      : 'Warning';
  return typeof raw.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(raw.code)
    ? `warning ${name} ${raw.code}`
    : `warning ${name}`;
}

/** The part of `process` {@link guardOutput} hooks into. */
export interface GuardedProcess {
  on(event: string, listener: (value: unknown) => void): unknown;
  removeAllListeners(event: string): unknown;
}

/**
 * Routes everything Node would print on its own through the words above.
 * Node prints an uncaught error whole, query parameters and all, and a
 * warning with its message; after this an uncaught error prints
 * {@link describe} and exits 1, and a warning prints
 * {@link describeWarning}. Answers the failure handler, for the command's own
 * rejection.
 */
export function guardOutput(
  target: GuardedProcess,
  printError: (line: string) => void,
  exit: (code: number) => void
): (error: unknown) => void {
  const fail = (error: unknown) => {
    printError(describe(error));
    exit(1);
  };
  target.on('uncaughtException', fail);
  target.on('unhandledRejection', fail);
  target.removeAllListeners('warning');
  target.on('warning', (warning) => printError(describeWarning(warning)));
  return fail;
}

/** A Postgres error's SQLSTATE, five letters or digits, which names nothing. */
function sqlStateOf(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
  }
  return null;
}
