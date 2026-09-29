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
    const source = match[1].replace(
      /:\s*'([^'"\\]*)'/g,
      (_, value: string) => `: "${value}"`
    );
    try {
      const parsed = JSON.parse(source) as Record<string, unknown>;
      if (parsed['@type'] === 'Product') {
        return parsed;
      }
    } catch {
      // A block that does not parse is not the product; keep looking.
    }
  }
  return null;
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
