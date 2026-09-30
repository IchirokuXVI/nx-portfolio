/**
 * The little bit of HTML handling this library needs, written by hand.
 *
 * **Why no parser dependency.** `@portfolio/luna-shopper/eljamon` is framework
 * free by hard constraint (plan 0169, section 6), as `deza` is. What the parsers
 * read is machine generated Liferay portlet markup and one WordPress plugin
 * answer, both with stable class names, so scoped regular expressions over the
 * exact containers are enough, and the checked in fixtures are what proves it
 * still is.
 *
 * Every link on the site escapes its slashes as `&#x2f;`, so hexadecimal
 * references are undone as well as decimal and named ones.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  euro: '€',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  uuml: 'ü',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  ccedil: 'ç',
};

/** Undo character references and nothing else. Whitespace is left as it was. */
export function decodeEntities(value: string): string {
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
    );
}

/**
 * Undo character references and collapse whitespace to single spaces.
 *
 * A non breaking space counts as whitespace here: the site puts one before
 * every `€`, and a text value is compared and stored with plain spaces.
 */
export function decodeText(value: string): string {
  return decodeEntities(value)
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/** Strip tags, then decode. For a container whose text is all that matters. */
export function textOf(html: string): string {
  return decodeText(html.replace(/<[^>]*>/g, ' '));
}

/**
 * The JSON object literal that starts at the first `{` at or after `from`,
 * found by counting braces outside strings, or null when it never closes.
 *
 * Written as a scan because the locator's `var locations = {…};` holds HTML in
 * its strings, braces and semicolons included, so no regular expression can say
 * where the object ends.
 */
export function sliceJsonObject(text: string, from: number): string | null {
  const start = text.indexOf('{', from);
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}
