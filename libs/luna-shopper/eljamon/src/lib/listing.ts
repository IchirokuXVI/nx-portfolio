import { isNeverABrand } from '@portfolio/luna-shopper/contracts';
import { decodeEntities, decodeText, textOf } from './html';
import { parseSpanishPrice, parseUnitPrice } from './price';
import type {
  ElJamonCategory,
  ElJamonListingPage,
  ElJamonListingRow,
} from './types';

/** Rows per listing page. Fixed by the site: a larger `pageSize` is ignored. */
export const ELJAMON_PAGE_SIZE = 20;

/**
 * One listing page, read (plan 0169, sections 2.2 and 5.1).
 *
 * The rows are the `<div id="…_articulo_<code>" class="articulo">` blocks of
 * the result list. A page with none parses as zero rows rather than raising,
 * because a page past the end is an ordinary answer.
 */
export function parseListingPage(html: string): ElJamonListingPage {
  return {
    articleCount: parseArticleCount(html),
    filters: parseFilters(html),
    rows: parseRows(html),
  };
}

/** How many pages a category holds, from what its first page printed. */
export function pageCountOf(articleCount: number | null): number {
  return articleCount === null || articleCount <= 0
    ? 1
    : Math.ceil(articleCount / ELJAMON_PAGE_SIZE);
}

/**
 * The top level categories, from the category menu of `/` (section 5.1).
 *
 * Only the two digit codes: the second level ones sum to fewer products than
 * the top level, so thirteen products are reachable from their top level
 * category alone.
 */
export function parseTopCategories(html: string): ElJamonCategory[] {
  const categories = new Map<string, ElJamonCategory>();
  const link =
    /<a\s+href="(?:https?:\/\/[^"/]+)?\/categorias\/([a-z0-9-]+)\/(\d{2})"[^>]*?title="([^"]*)"/gi;
  for (const match of html.matchAll(link)) {
    const [, slug, code, title] = match;
    if (!categories.has(code)) {
      categories.set(code, {
        code,
        slug,
        name: decodeText(title),
        path: `/categorias/${slug}/${code}`,
      });
    }
  }
  return [...categories.values()].sort((a, b) => a.code.localeCompare(b.code));
}

const ARTICLE_COUNT = /(\d[\d.]*)\s*Art(?:í|&iacute;|&#237;)culos/;

function parseArticleCount(html: string): number | null {
  const match = ARTICLE_COUNT.exec(html);
  return match ? Number(match[1].replace(/\./g, '')) : null;
}

function parseFilters(html: string): string | null {
  const match = /<input[^>]*\bname="filters"[^>]*\bvalue="([^"]*)"/.exec(html);
  return match ? decodeEntities(match[1]) : null;
}

const ROW_START = /<div id="[^"]*_articulo_(\d+)" class="articulo">/g;

function parseRows(html: string): ElJamonListingRow[] {
  const starts = [...html.matchAll(ROW_START)];
  const rows: ElJamonListingRow[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1]?.index ?? html.length;
    const row = parseRow(start[1], html.slice(start.index, end));
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

function parseRow(code: string, block: string): ElJamonListingRow | null {
  const nameLink =
    /<p class="nombre">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
  if (!nameLink) {
    return null;
  }
  const brand = /<p class="marca">([\s\S]*?)<\/p>/.exec(block);
  const priceBlock = /<p class="precio">([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '';
  // The struck through price is the one before the offer; the current price is
  // the last plain `<span>`, which is the only one when there is no offer.
  const previous = /<span class="tachado">([\s\S]*?)<\/span>/.exec(priceBlock);
  const plain = [...priceBlock.matchAll(/<span>([\s\S]*?)<\/span>/g)];
  const current = plain[plain.length - 1];
  const unit = parseUnitPrice(
    /<div class="texto-porKilo">([\s\S]*?)<\/div>/.exec(block)?.[1]
  );

  return {
    code,
    description: textOf(nameLink[2]),
    brand: brand ? brandOf(textOf(brand[1])) : null,
    url: decodeEntities(nameLink[1]),
    price: current ? parseSpanishPrice(current[1]) : null,
    previousPrice: previous ? parseSpanishPrice(previous[1]) : null,
    unitPrice: unit?.unitPrice ?? null,
    unitPriceLabel: unit?.unitPriceLabel ?? null,
  };
}

/**
 * The printed brand, or null when the chain printed something that is not one
 * (plan 0178). `p.marca` is a free text field: beside real brands it carries a
 * protected origin, and a word `NEVER_A_BRAND` lists reads as no brand at all.
 */
function brandOf(printed: string): string | null {
  return printed === '' || isNeverABrand(printed) ? null : printed;
}
