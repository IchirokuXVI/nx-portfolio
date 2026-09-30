import { decodeEntities, textOf } from './html';
import type { ElJamonProduct } from './types';

/**
 * One product page, read (plan 0169, section 2.3): the schema.org `Product` in
 * `application/ld+json`, and the category breadcrumb.
 *
 * **The JSON-LD `availability` is not read.** It is `'InStock'` on every page,
 * written in single quotes inside the JSON, so it is a template literal and not
 * data. Those single quotes are also why the block is not valid JSON as sent,
 * and a single quoted value is rewritten to a double quoted one before parsing.
 *
 * A page with no JSON-LD answers null rather than throwing, so one odd page
 * costs one product and not the run.
 */
export function parseProductPage(html: string): ElJamonProduct | null {
  const ld = readJsonLd(html);
  if (!ld) {
    return null;
  }
  const offers = (ld['offers'] ?? {}) as Record<string, unknown>;
  const brand = (ld['brand'] ?? {}) as Record<string, unknown>;
  const url = typeof ld['url'] === 'string' ? ld['url'] : '';
  const code = stringOf(ld['sku']) ?? /\/(\d+)\/?$/.exec(url)?.[1] ?? null;
  const name = stringOf(ld['name']);
  if (!code || !name) {
    return null;
  }
  const price = Number(stringOf(offers['price']));
  return {
    code,
    name,
    brand: stringOf(brand['name']),
    price:
      stringOf(offers['price']) !== null && Number.isFinite(price)
        ? price
        : null,
    image: stringOf(ld['image']),
    categoryPath: parseBreadcrumb(html),
  };
}

/**
 * The breadcrumb, top level first, without `Inicio` and without the product
 * itself, which are its first and last items.
 */
export function parseBreadcrumb(html: string): string[] {
  const list =
    /<ul class="breadcrumbs[^"]*migas-custom[^"]*">([\s\S]*?)<\/ul>/.exec(html);
  if (!list) {
    return [];
  }
  const path: string[] = [];
  for (const item of list[1].matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)) {
    if (/class="(?:first|last)"/.test(item[1])) {
      continue;
    }
    const text = textOf(item[2]).replace(/\s*\.$/, '');
    if (text) {
      path.push(text);
    }
  }
  return path;
}

function readJsonLd(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  )) {
    try {
      const parsed = JSON.parse(doubleQuoted(match[1])) as Record<
        string,
        unknown
      >;
      if (parsed['@type'] === 'Product') {
        return parsed;
      }
    } catch {
      // A block that does not parse is not the product; keep looking.
    }
  }
  return null;
}

/**
 * The JSON-LD with every single quoted string rewritten as a JSON string. The
 * shop's template single quotes its `availability`, which `JSON.parse` refuses.
 *
 * **A double quoted string is copied as it is**, escapes included, so an
 * apostrophe or a `: '` inside a product's name is never taken for a quote.
 */
export function doubleQuoted(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const end = endOfString(source, index, '"');
      out += source.slice(index, end);
      index = end;
    } else if (char === "'") {
      const end = endOfString(source, index, "'");
      out += '"';
      for (let at = index + 1; at < end - 1; at += 1) {
        if (source[at] === '\\' && at + 1 < end - 1) {
          // `\'` means nothing to JSON; every other escape is the same.
          at += 1;
          out += source[at] === "'" ? "'" : `\\${source[at]}`;
        } else {
          out += source[at] === '"' ? '\\"' : source[at];
        }
      }
      out += '"';
      index = end;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** The index just past the quote that closes the string opened at `start`. */
function endOfString(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
    } else if (source[index] === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return source.length;
}

function stringOf(value: unknown): string | null {
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = decodeEntities(value).trim();
  return text === '' ? null : text;
}
