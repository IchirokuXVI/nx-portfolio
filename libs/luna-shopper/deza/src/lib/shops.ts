/**
 * DEZA's own shop list (plan 0222, section 2): the map of `/centros/` and the
 * page of each shop behind it.
 *
 * Two pure parsers and one pure rule. Nothing here fetches. The directory is
 * third party markup, so everything read from it is data: a link it names is
 * reported, and only the client decides whether it is fetched.
 */
import { decodeText, sliceContainer, textOf } from './html';
import type {
  DezaCodeOutcome,
  DezaDirectory,
  DezaDirectoryEntry,
  DezaShopPage,
} from './types';

/** Where the pins start: the inline script of the map plugin. */
const MARKERS_MARK = 'markers : ';

/** A category slug that is a shop code: `t1`, `c1`, `z1`. */
const CODE_SLUG = /^[tcz][0-9]+$/i;

/** The start of a photo file name that is a shop code: `T1`, `C2`, `Z1`. */
const PHOTO_CODE = /^[TCZ][0-9]+$/;

/** The line of a shop page that states the postal code and the city. */
const POSTAL_LINE = /^(\d{5})\s*-\s*(.+)$/;

/** The link text that marks a pin as a shop, not a warehouse or a bakery. */
export const DEZA_SHOP_LINK_TEXT = 'Ver Tienda';

/**
 * The pins of the map on `/centros/`, and the titles of the `Centros` menu.
 *
 * A page with no `markers : ` text is an error that names the page, because a
 * directory with no pins is a changed page and not an empty chain.
 */
export function parseShopDirectory(
  html: string,
  page = '/centros/'
): DezaDirectory {
  const start = html.indexOf(MARKERS_MARK);
  if (start === -1) {
    throw new Error(
      `The DEZA page ${page} has no "${MARKERS_MARK.trim()}" array, so its map ` +
        'changed and no shop can be read from it.'
    );
  }
  const raw = readJsonArray(html, html.indexOf('[', start), page);

  const entries: DezaDirectoryEntry[] = [];
  const withoutCoordinates: string[] = [];
  for (const element of raw) {
    if (!element || typeof element !== 'object') {
      continue;
    }
    const pin = element as Record<string, unknown>;
    const title =
      typeof pin['title'] === 'string' ? decodeText(pin['title']) : '';
    const latitude = readNumber(pin['latitude']);
    const longitude = readNumber(pin['longitude']);
    if (latitude === null || longitude === null) {
      withoutCoordinates.push(title);
      continue;
    }
    const details = typeof pin['details'] === 'string' ? pin['details'] : '';
    const links = linksOf(details);
    const shopLink = links.find((link) =>
      link.text.startsWith(DEZA_SHOP_LINK_TEXT)
    );
    entries.push({
      postId: String(pin['id'] ?? ''),
      title,
      latitude,
      longitude,
      mapAddress: labelledLine(details, 'Dir:'),
      phone: labelledLine(details, 'Teléfono:'),
      shopPageUrl: shopLink?.href ?? null,
      linkText: links[0]?.text ?? null,
      categoryCode: categoryCodeOf(pin['categories']),
    });
  }

  return { entries, withoutCoordinates, menuTitles: menuTitlesOf(html) };
}

/**
 * What one `/centros/<slug>/` page states about its shop.
 *
 * The facts sit in `<div id="datos-centro">`, one per `<br />` line: the
 * street lines, then `<postal code> - <city>`, then the phone in a `<strong>`.
 * A page with no such container answers every field null and is not an error.
 */
export function parseShopPage(html: string): DezaShopPage {
  const title = titleOf(html);
  const container = sliceContainer(html, 'id="datos-centro"');
  if (container === null) {
    return {
      title,
      street: null,
      postalCode: null,
      city: null,
      phone: null,
      photoCode: null,
    };
  }

  const chunks = container.split(/<br\s*\/?>/i);
  const lines = chunks.map((chunk) => textOf(chunk));
  const postalAt = lines.findIndex((line) => POSTAL_LINE.test(line));
  let street: string | null = null;
  let postalCode: string | null = null;
  let city: string | null = null;
  let phone: string | null = null;
  if (postalAt !== -1) {
    const match = POSTAL_LINE.exec(lines[postalAt]) as RegExpExecArray;
    postalCode = match[1];
    city = match[2].trim() || null;
    const above = lines.slice(0, postalAt).filter((line) => line !== '');
    street = above.length > 0 ? above.join(' ') : null;
    const after = chunks.slice(postalAt + 1).join('<br />');
    const strong = /<strong[^>]*>([\s\S]*?)<\/strong>/i.exec(after);
    phone = strong ? textOf(strong[1]) || null : null;
  }

  return {
    title,
    street,
    postalCode,
    city,
    phone,
    photoCode: photoCodeOf(html),
  };
}

/**
 * The code of a shop, from the map category and the photo file name (section
 * 2.3). Two signals that disagree give no code rather than a pick, because
 * the photo name is an accident of how the chain names its uploads.
 */
export function readShopCode(
  entry: DezaDirectoryEntry,
  page: DezaShopPage | null
): DezaCodeOutcome {
  const map = entry.categoryCode;
  const photo = page?.photoCode ?? null;
  if (map && photo) {
    return map === photo
      ? { code: map, basis: 'BOTH' }
      : { code: null, reason: 'CODES_DISAGREE' };
  }
  if (map) {
    return { code: map, basis: 'MAP' };
  }
  if (photo) {
    return { code: photo, basis: 'PHOTO' };
  }
  return { code: null, reason: 'NO_CODE' };
}

/**
 * One JSON array read from `from`, which must be its `[`. The scan stops at
 * the bracket that closes it, so the script around the array is never parsed.
 */
function readJsonArray(html: string, from: number, page: string): unknown[] {
  if (from === -1) {
    throw new Error(`The DEZA page ${page} names its map but holds no pins.`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '[' || char === '{') {
      depth += 1;
    } else if (char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed: unknown = JSON.parse(html.slice(from, index + 1));
        if (!Array.isArray(parsed)) {
          break;
        }
        return parsed;
      }
    }
  }
  throw new Error(`The DEZA page ${page} has a map array that never closes.`);
}

/** A coordinate the plugin prints as a string or a number, or null. */
function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The text after a `<strong>Label</strong>` line of a pin, verbatim, or null. */
function labelledLine(details: string, label: string): string | null {
  for (const chunk of details.split(/<br\s*\/?>|<\/p>/i)) {
    const line = textOf(chunk);
    if (line.startsWith(label)) {
      return line.slice(label.length).trim() || null;
    }
  }
  return null;
}

/** Every `ver-tienda` link of a pin, in order. */
function linksOf(details: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of details.matchAll(anchor)) {
    const attributes = match[1];
    if (!/class\s*=\s*["'][^"']*\bver-tienda\b/i.test(attributes)) {
      continue;
    }
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(attributes);
    links.push({
      href: href ? decodeText(href[1]) : '',
      text: textOf(match[2]),
    });
  }
  return links.filter((link) => link.href !== '');
}

/** The first category slug that is a code, upper cased. `tiendas` is not one. */
function categoryCodeOf(categories: unknown): string | null {
  if (!Array.isArray(categories)) {
    return null;
  }
  for (const category of categories) {
    const slug = (category as { slug?: unknown } | null)?.slug;
    if (typeof slug === 'string' && CODE_SLUG.test(slug)) {
      return slug.toUpperCase();
    }
  }
  return null;
}

/**
 * The link text of each page under the `Centros` menu, by URL. The first
 * menu wins: the page renders the same menu a second time for phones.
 */
function menuTitlesOf(html: string): Map<string, string> {
  const titles = new Map<string, string>();
  const item =
    /<li\b[^>]*class="[^"]*\bmenu-item-object-page\b[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]*\/centros\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(item)) {
    const url = decodeText(match[1]);
    if (!titles.has(url)) {
      titles.set(url, textOf(match[2]));
    }
  }
  return titles;
}

/** The `<title>` with the site suffix removed. */
function titleOf(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) {
    return '';
  }
  return textOf(match[1])
    .replace(/\s+-\s+Deza Calidad\b.*$/i, '')
    .trim();
}

/** The code at the start of the main photo's file name, e.g. `C2`. */
function photoCodeOf(html: string): string | null {
  const image = /<img\b[^>]*\bid="foto-principal"[^>]*>/i.exec(html);
  if (!image) {
    return null;
  }
  const src = /\bsrc="([^"]*)"/i.exec(image[0]);
  if (!src) {
    return null;
  }
  const file = src[1].split('?')[0].split('/').pop() ?? '';
  const head = file.split('_')[0];
  return PHOTO_CODE.test(head) ? head : null;
}
