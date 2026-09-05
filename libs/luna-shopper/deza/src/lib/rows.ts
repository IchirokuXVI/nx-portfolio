import { extractBrand } from './brand';
import { decodeText, sliceContainer, textOf } from './html';
import { splitSize } from './size';
import type { DezaPage, DezaProductRow, DezaShop } from './types';

/**
 * The row parser (plan 0085, section 5): a rendered listing page in, products
 * out.
 *
 * **What it deliberately does not read.** Every shop in every popup carries a
 * `wpdz-precio-ok` and a `wpdz-precio-oculto` element, and both are blank on the
 * public site. They are the storefront's own hidden pricing, not a field waiting
 * to be read, and `DezaProductRow` therefore has no price of any kind: a parser
 * that treated a blank string as a price would write zeros into the one field
 * whose purpose is comparison (section 1).
 *
 * **Availability is by omission.** The popup lists only the shops that carry the
 * product, so a row naming two shops is a claim that the other eight do not
 * stock it. That negative is the whole value of this source and the reason plan
 * 0084 built a per shop availability write to receive it.
 */

/** The listing holds 15 rows a page, and every query stops after 20 pages. */
export const DEZA_PAGE_SIZE = 15;

/**
 * The pagination widget stops at 20 and page 21 is empty, for a leaf section
 * with a few hundred products and equally for a top level one with thousands
 * (section 2). So 300 is a ceiling on the result set, not the size of the
 * assortment, and no page size parameter moves it.
 */
export const DEZA_CEILING_PAGES = 20;

const ROW_MARKER = "<div class='wpdz-row'>";
const STRONG = /<strong([^>]*)>([\s\S]*?)<\/strong>/g;
const ATTRIBUTE_ID = /\bid='([^']*)'/;
const ATTRIBUTE_CLASS = /\bclass='([^']*)'/;
const ICON_TITLE = /<img[^>]*\btitle='([^']*)'/g;
const ICON_ALT = /<img[^>]*\balt='([^']*)'/g;
const PAGE_LINK = /class="[^"]*page-numbers[^"]*"[^>]*href="[^"]*paged=(\d+)/g;
const CURRENT_PAGE = /aria-current="page"[^>]*>\s*(\d+)\s*</;

export function parseProductPage(html: string): DezaPage {
  return { rows: parseRows(html), lastPage: parseLastPage(html) };
}

/**
 * Every product on the page, in the order the chain listed them.
 *
 * A page past the end of a query answers 200 with the grid container present and
 * no rows inside it, so an empty result is an empty array rather than an error.
 */
export function parseRows(html: string): DezaProductRow[] {
  const grid = sliceContainer(html, "class='wpdz-lista-arts'") ?? html;
  const rows: DezaProductRow[] = [];
  let cursor = grid.indexOf(ROW_MARKER);
  while (cursor !== -1) {
    const next = grid.indexOf(ROW_MARKER, cursor + ROW_MARKER.length);
    const limit = next === -1 ? grid.length : next;
    // The chain closes every row with a rule. Stopping at it keeps one row's
    // popup out of the next row when the markup nests differently than expected.
    const rule = grid.indexOf('<hr', cursor);
    const stop = rule !== -1 && rule < limit ? rule : limit;
    const row = parseRow(grid.slice(cursor + ROW_MARKER.length, stop));
    if (row) {
      rows.push(row);
    }
    cursor = next;
  }
  return rows;
}

function parseRow(html: string): DezaProductRow | null {
  const description = textOf(
    sliceContainer(html, "class='wpdz-row-col-desc'") ?? ''
  );
  if (!description) {
    return null;
  }
  const { name, sizeFormat } = splitSize(description);
  return {
    description,
    name,
    sizeFormat,
    brand: extractBrand(name),
    attributes: parseAttributes(
      sliceContainer(html, "class='wpdz-row-col-icons'") ?? ''
    ),
    shops: parseShops(
      sliceContainer(html, "class='pop-up-artic-tiendas'") ?? ''
    ),
  };
}

/**
 * The chain's attribute icons, `Andaluz`, `Ecológicos`, `Vegano/Vegetar.` and so
 * on. They are the only classification beyond the section that the page offers,
 * which is why section 8 puts them on `categoryPath` beside the section path
 * rather than dropping them.
 */
function parseAttributes(html: string): string[] {
  const found: string[] = [];
  for (const pattern of [ICON_TITLE, ICON_ALT]) {
    pattern.lastIndex = 0;
    for (const match of html.matchAll(pattern)) {
      const value = decodeText(match[1]);
      if (value && !found.includes(value)) {
        found.push(value);
      }
    }
  }
  return found;
}

/**
 * The shops named in one popup.
 *
 * The markup is a flat run of `<strong>` elements per shop: a hidden price, a
 * blank price, then the printed name. Pairing is done by walking them in order
 * rather than by one regular expression over the three, so a change in attribute
 * order upstream reorders nothing here.
 */
function parseShops(html: string): DezaShop[] {
  const shops: DezaShop[] = [];
  let pendingCode: string | null = null;
  STRONG.lastIndex = 0;
  for (const match of html.matchAll(STRONG)) {
    const attributes = match[1];
    const className = ATTRIBUTE_CLASS.exec(attributes)?.[1] ?? '';
    const id = ATTRIBUTE_ID.exec(attributes)?.[1] ?? '';
    if (className.includes('wpdz-precio-ok')) {
      pendingCode = id || null;
      continue;
    }
    if (className) {
      // `wpdz-precio-oculto`, the hidden one. Read for neither its id nor its
      // content: this parser exposes no price field at all.
      continue;
    }
    const printedName = decodeText(match[2]);
    if (pendingCode && printedName) {
      shops.push({ code: pendingCode, printedName });
    }
    pendingCode = null;
  }
  return shops;
}

/**
 * The highest page the widget offers, or 0 when it offers none.
 *
 * A query that fits on one page renders no widget, which is 0 rather than 1 and
 * is what tells the crawler there is nothing further to fetch. A query at
 * {@link DEZA_CEILING_PAGES} is at the source's 300 row ceiling and section 3
 * narrows it.
 */
export function parseLastPage(html: string): number {
  let highest = 0;
  PAGE_LINK.lastIndex = 0;
  for (const match of html.matchAll(PAGE_LINK)) {
    highest = Math.max(highest, Number(match[1]));
  }
  if (highest === 0) {
    return 0;
  }
  return Math.max(highest, Number(CURRENT_PAGE.exec(html)?.[1] ?? 0));
}
