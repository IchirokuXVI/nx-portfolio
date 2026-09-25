/**
 * `--check-page N`: one hand written page, read back and checked as it lands
 * (plan 0003).
 *
 * Manual mode used to find out what was wrong with a page at the end, when the
 * builder ran over all of them, and it said so without a line number. This
 * reads one `page_NN.json` and answers three things, each with the line of the
 * file it is about:
 *
 * 1. Whether it parses as a JSON array, which is what `parseReading` asks.
 * 2. Whether every row has the shape every chain prompt asks for (plan 0002):
 *    every key present, each of the right type, the enums the prompts name,
 *    `rawText` on every promotion, and no key of the flat shape that plan
 *    retired or of no shape at all.
 * 3. What the sanity pass would name on it, which is a place to look and not a
 *    refusal, exactly as it is in a whole run.
 *
 * **It never edits the file.** It is the same rule manual mode keeps everywhere:
 * a tool that repaired a reading would be deciding what the page said.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { checkPageCommand } from './commands.mjs';
import { formatWarning, readingPath } from './read-pages.mjs';
import { readRow, unknownKeys } from './reading.mjs';
import { sanityPass } from './sanity.mjs';

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The values every chain prompt allows, where it names a list. */
const SIZE_FORMATS = ['kg', 'g', 'l', 'ml', 'ud', 'm'];
const BASES = ['unit', 'pack', 'kg', 'l'];
const CATEGORIES = [
  'PRODUCE',
  'DAIRY',
  'BAKERY',
  'MEAT',
  'SEAFOOD',
  'FROZEN',
  'BEVERAGES',
  'SNACKS',
  'PANTRY',
  'HOUSEHOLD',
  'PERSONAL_CARE',
  'OTHER',
];
const PROMOTION_TYPES = [
  'price_drop',
  'second_unit_discount',
  'multibuy_unit_price',
  'multibuy_total',
  'n_for_m',
  'buy_n_get_free',
  'pack_bonus',
];

/**
 * Every key a row carries, with what it may hold. `name` is the one that may
 * not be null, because a row with no name is not a product.
 */
const ROW_FIELDS = [
  ['name', 'text'],
  ['brand', 'text?'],
  ['unitSize', 'number?'],
  ['sizeFormat', SIZE_FORMATS],
  ['price', 'number?'],
  ['unitPrice', 'number?'],
  ['unitPriceLabel', 'text?'],
  ['category', CATEGORIES],
  ['categoryPath', 'texts'],
  ['leaflet', 'object'],
];

const LEAFLET_FIELDS = [
  ['format', 'text?'],
  ['basis', BASES],
  ['wasPrice', 'number?'],
  ['loyalty', 'boolean'],
  ['validUntil', 'day?'],
  ['validityText', 'text?'],
  ['promotion', 'object?'],
];

const PROMOTION_FIELDS = [
  ['type', PROMOTION_TYPES],
  ['rawText', 'text'],
  ['requiredQuantity', 'number?'],
  ['effectiveUnitPrice', 'number?'],
  ['totalPrice', 'number?'],
  ['singleUnitPrice', 'number?'],
];

/** The flat shape's keys, and where plan 0002 moved each one. */
const RETIRED = {
  format: 'leaflet.format',
  basis: 'leaflet.basis',
  was_price: 'leaflet.wasPrice',
  unit_price: 'unitPrice',
  unit_price_per: 'unitPriceLabel, with the printed wording',
  loyalty: 'leaflet.loyalty',
  promotion: 'leaflet.promotion',
  raw_text: 'rawText',
  required_quantity: 'requiredQuantity',
  effective_unit_price: 'effectiveUnitPrice',
  total_price: 'totalPrice',
  single_unit_price: 'singleUnitPrice',
};

const describe = (value) =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;

/** What is wrong with one value against one rule, or null. */
function fault(value, rule) {
  const nullable = typeof rule === 'string' && rule.endsWith('?');
  const kind = typeof rule === 'string' ? rule.replace(/\?$/, '') : 'enum';
  if (value === null && (nullable || kind === 'enum')) {
    return null;
  }
  switch (kind) {
    case 'text':
      return typeof value === 'string' && value.trim() !== ''
        ? null
        : `is ${describe(value)}, and it has to be text${nullable ? ' or null' : ''}`;
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return null;
      }
      return typeof value === 'string'
        ? `is the text "${value}", and it has to be a number: 2,59 is written 2.59`
        : `is ${describe(value)}, and it has to be a number or null`;
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `is ${describe(value)}, and it has to be true or false`;
    case 'day':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : `is ${JSON.stringify(value)}, and it has to be a day as YYYY-MM-DD or null`;
    case 'texts':
      return Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
        ? null
        : `is ${describe(value)}, and it has to be an array of text, empty when the page prints no heading`;
    case 'object':
      return isObject(value)
        ? null
        : `is ${describe(value)}, and it has to be an object${nullable ? ' or null' : ''}`;
    default:
      return rule.includes(value)
        ? null
        : `is ${JSON.stringify(value)}, and it has to be one of ${rule.join(', ')}${kind === 'enum' ? ', or null' : ''}`;
  }
}

/** Each field of one object against its rules, as `{ path, message }`. */
function checkFields(bag, fields, prefix) {
  const out = [];
  for (const [key, rule] of fields) {
    if (!(key in bag)) {
      out.push({
        path: prefix.replace(/\.$/, ''),
        message: `${prefix}${key} is missing. Every row carries every key, and null says the page printed none`,
      });
      continue;
    }
    const wrong = fault(bag[key], rule);
    if (wrong) {
      out.push({
        path: `${prefix}${key}`,
        message: `${prefix}${key} ${wrong}`,
      });
    }
  }
  return out;
}

/** The keys of one row that plan 0002 retired, each with where it went. */
function retiredKeys(row) {
  const out = [];
  const walk = (bag, keys, prefix) => {
    for (const key of Object.keys(bag)) {
      if (keys.includes(key)) {
        out.push({
          path: `${prefix}${key}`,
          message: `${prefix}${key} is the flat shape plan 0002 retired. Write it as ${RETIRED[key]}`,
        });
      }
    }
  };
  walk(
    row,
    [
      'format',
      'basis',
      'was_price',
      'unit_price',
      'unit_price_per',
      'loyalty',
      'promotion',
    ],
    ''
  );
  const promotionKeys = [
    'raw_text',
    'required_quantity',
    'effective_unit_price',
    'total_price',
    'single_unit_price',
  ];
  if (isObject(row.leaflet?.promotion)) {
    walk(row.leaflet.promotion, promotionKeys, 'leaflet.promotion.');
  }
  if (isObject(row.promotion)) {
    walk(row.promotion, promotionKeys, 'promotion.');
  }
  return out;
}

/**
 * Everything wrong with the shape of one row, each as a path inside the row and
 * a sentence. The paths are what `jsonLines` answers a line for.
 */
export function rowProblems(row) {
  if (!isObject(row)) {
    return [
      {
        path: '',
        message: `the row is ${describe(row)}, and it has to be an object`,
      },
    ];
  }
  const retired = retiredKeys(row);
  const retiredPaths = new Set(retired.map((entry) => entry.path));
  const out = [
    ...retired,
    ...unknownKeys(row)
      .filter((path) => !retiredPaths.has(path))
      .map((path) => ({
        path,
        message: `${path} is a key no reading shape names, so nothing reads it`,
      })),
    ...checkFields(row, ROW_FIELDS, ''),
  ];
  if (isObject(row.leaflet)) {
    out.push(...checkFields(row.leaflet, LEAFLET_FIELDS, 'leaflet.'));
    if (isObject(row.leaflet.promotion)) {
      out.push(
        ...checkFields(
          row.leaflet.promotion,
          PROMOTION_FIELDS,
          'leaflet.promotion.'
        )
      );
    }
  }
  return out;
}

/**
 * The line each value of a JSON text starts on, keyed by its path: `''` for the
 * whole, `'2'` for the third row, `'2.leaflet.promotion.type'` for a key inside
 * it. A key's path answers the line the key is written on.
 *
 * It reads a text `JSON.parse` has already accepted, so it only keeps count and
 * never judges.
 */
export function jsonLines(text) {
  const lines = new Map();
  let at = 0;
  let line = 1;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) {
      if (text[at] === '\n') {
        line += 1;
      }
      at += 1;
    }
  };
  const string = () => {
    let out = '';
    at += 1;
    while (at < text.length && text[at] !== '"') {
      if (text[at] === '\\') {
        out += text[at + 1];
        at += 2;
        continue;
      }
      out += text[at];
      at += 1;
    }
    at += 1;
    return out;
  };
  const join = (path, key) => (path === '' ? String(key) : `${path}.${key}`);
  const value = (path) => {
    space();
    if (!lines.has(path)) {
      lines.set(path, line);
    }
    const char = text[at];
    if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']';
      at += 1;
      space();
      if (text[at] === close) {
        at += 1;
        return;
      }
      let index = 0;
      for (;;) {
        space();
        if (char === '{') {
          const keyLine = line;
          const key = string();
          lines.set(join(path, key), keyLine);
          space();
          at += 1;
          value(join(path, key));
        } else {
          value(join(path, index));
          index += 1;
        }
        space();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        at += 1;
        return;
      }
    }
    if (char === '"') {
      string();
      return;
    }
    while (at < text.length && !/[\s,\]}]/.test(text[at])) {
      at += 1;
    }
  };
  value('');
  return lines;
}

/** The line a parse error points at, when the engine's message says where. */
function parseErrorLine(error, text) {
  const position = /position (\d+)/.exec(String(error?.message ?? ''));
  if (!position) {
    return null;
  }
  return text.slice(0, Number(position[1])).split('\n').length;
}

/**
 * One page, checked. Answers `{ ok, lines }`, where `lines` is what to print,
 * and `ok` is false when the page does not parse or a row has the wrong shape.
 * Sanity warnings are printed and leave `ok` alone.
 */
export function checkPage({
  page,
  importDir,
  outDir,
  stripFence,
  exists = existsSync,
  readFile = readFileSync,
}) {
  const path = readingPath(importDir, page);
  const again = checkPageCommand({ outDir, page });
  if (!exists(path)) {
    return {
      ok: false,
      lines: [
        `page ${page}: there is no ${path} yet. Write the page's JSON array there, then check it with:`,
        `  ${again}`,
      ],
    };
  }

  const raw = String(readFile(path, 'utf8'));
  const body = stripFence(raw);
  // A fenced answer is read as the model engines library reads it, and every
  // line number below still counts from the top of the file itself.
  const offset = Math.max(0, raw.indexOf(body));
  const before = raw.slice(0, offset).split('\n').length - 1;

  let rows;
  try {
    rows = JSON.parse(body);
  } catch (error) {
    const at = parseErrorLine(error, body);
    return {
      ok: false,
      lines: [
        `page ${page}: ${path}`,
        `  ${at ? `line ${at + before}: ` : ''}not JSON: ${error.message}`,
        `Fix the file and check it again with:\n  ${again}`,
      ],
    };
  }
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      lines: [
        `page ${page}: ${path}`,
        `  line ${1 + before}: the file holds ${describe(rows)}, and it has to be one JSON array of rows, [] for a page with no priced product`,
        `Fix the file and check it again with:\n  ${again}`,
      ],
    };
  }

  const where = jsonLines(body);
  const lineOf = (path) => {
    const line = where.get(path);
    return line === undefined ? '?' : line + before;
  };
  const rowName = (row, index) => readRow(row).name ?? `row ${index + 1}`;

  const problems = [];
  rows.forEach((row, index) => {
    for (const problem of rowProblems(row)) {
      const path =
        problem.path === '' ? String(index) : `${index}.${problem.path}`;
      problems.push(
        `  line ${lineOf(path)}, row ${index + 1} (${rowName(row, index)}): ${problem.message}`
      );
    }
  });

  // The sanity pass names a row by its name, or `row N` when it has none, so
  // the line is found the same way back.
  const warnings = sanityPass(new Map([[page, rows]]));
  const warningLines = warnings.map((entry) => {
    const byNumber = /^row (\d+)$/.exec(entry.product ?? '');
    const index = byNumber
      ? Number(byNumber[1]) - 1
      : rows.findIndex((row) => readRow(row).name === entry.product);
    return `  line ${index >= 0 ? lineOf(String(index)) : '?'}:${formatWarning(entry).slice(1)}`;
  });

  const lines = [`page ${page}: ${path}, ${rows.length} row(s)`];
  if (problems.length === 0) {
    lines.push(
      '  the shape is right: every row carries every key, each of the right type.'
    );
  } else {
    lines.push(...problems);
  }
  if (warningLines.length > 0) {
    lines.push(
      `Sanity pass, ${warningLines.length} row(s) to look at against the page. These are not refusals:`,
      ...warningLines
    );
  }
  if (problems.length > 0) {
    lines.push(
      `${problems.length} problem(s). Fix the file and check it again with:`,
      `  ${again}`
    );
  }
  return { ok: problems.length === 0, lines };
}
