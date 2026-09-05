/**
 * The little bit of HTML handling this library needs, written by hand.
 *
 * **Why no parser dependency.** `@portfolio/luna-shopper/deza` is framework free
 * by hard constraint (plan 0085, section 5), and the same constraint that kept
 * an HTTP client out of `mercadona` keeps a DOM out of this one. What the parser
 * reads is machine generated WordPress plugin markup with stable class names, so
 * scoped regular expressions over the exact containers are enough, and the
 * checked in fixtures are what proves it still is.
 *
 * The page declares UTF-8 and is UTF-8, so there is no encoding workaround here.
 * Only named and numeric character references have to be undone.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  deg: '°',
  eacute: 'é',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
};

/** Undo character references and collapse whitespace to single spaces. */
export function decodeText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(
      /&([a-zA-Z][a-zA-Z0-9]*);/g,
      (whole, name: string) => NAMED_ENTITIES[name] ?? whole
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tags, then decode. For a container whose text is all that matters. */
export function textOf(html: string): string {
  return decodeText(html.replace(/<[^>]*>/g, ' '));
}

/**
 * The inner HTML of the first element carrying `class='<className>'`, matched by
 * counting `<div>` opens and closes from that point.
 *
 * Written as a scan rather than a lazy `[\s\S]*?` because the containers this
 * reads (the section tree, the product grid) hold nested divs, and a lazy match
 * stops at the first `</div>` inside them.
 */
export function sliceContainer(
  html: string,
  attribute: string,
  tag = 'div'
): string | null {
  const start = html.indexOf(attribute);
  if (start === -1) {
    return null;
  }
  const open = html.indexOf('>', start);
  if (open === -1) {
    return null;
  }
  const openTag = new RegExp(`<${tag}[\\s>]`, 'g');
  const closeTag = new RegExp(`</${tag}>`, 'g');
  let depth = 1;
  let cursor = open + 1;
  for (;;) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(html);
    const nextClose = closeTag.exec(html);
    if (!nextClose) {
      return html.slice(open + 1);
    }
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return html.slice(open + 1, nextClose.index);
    }
    cursor = nextClose.index + 1;
  }
}
