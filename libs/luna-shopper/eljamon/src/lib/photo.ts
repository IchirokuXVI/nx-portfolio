/**
 * The address of the photo El Jamón prints for a product (plan 0198, section
 * 2). Pure: it reads a string and answers a string, and nothing here or
 * anywhere else in the workspace opens the address.
 *
 * **The address is stored as the source printed it.** No size or query is
 * added, removed or guessed.
 */

/**
 * The hosts El Jamón serves a product photo from.
 *
 * An address on any other host is refused, which is what stops a changed page
 * from making a client load an arbitrary host. The JSON-LD of the product
 * page and the tiles of a category listing both print this one.
 */
export const PHOTO_HOSTS: readonly string[] = ['www.supermercadoseljamon.com'];

/** What `source_catalog_entries.imageUrl` holds, a `varchar(500)`. */
const MAX_LENGTH = 500;

/**
 * The field the address is read from. The JSON-LD `Product` of a product page
 * and an `ElJamonProduct` both satisfy it.
 */
export interface PhotoFields {
  image?: unknown;
}

/** One read of the photo field, which keeps a refusal apart from an absence. */
export interface PhotoRead {
  /** The address to store, or null. */
  url: string | null;
  /**
   * What the source printed when it printed an address that was refused, so
   * the caller can warn. Null when the source printed none, and null beside a
   * `url`.
   */
  refused: string | null;
}

/**
 * The one address the chain prints for the product: `image` of the JSON-LD
 * on the product page, which is the large picture (`<code>_G.jpg`).
 *
 * The JSON-LD prints an absolute address. A relative one is refused and not
 * resolved, because the page prints none and a guess is not a reading.
 */
export function photoAddressRead(
  raw: PhotoFields | null | undefined
): PhotoRead {
  const printed = textOf(raw?.image);
  if (printed === null) {
    return { url: null, refused: null };
  }
  return isAllowed(printed)
    ? { url: printed, refused: null }
    : { url: null, refused: printed };
}

/**
 * The address to store, or null: the source printed none, or it printed one
 * that is not `https`, is longer than 500 characters, or is on a host outside
 * {@link PHOTO_HOSTS}. {@link photoAddressRead} tells the two apart.
 */
export function photoAddress(
  raw: PhotoFields | null | undefined
): string | null {
  return photoAddressRead(raw).url;
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The address is parsed to be checked and never to be rewritten: what is
 * answered is the string that was read, not `URL.href`.
 */
function isAllowed(address: string): boolean {
  if (
    address.length > MAX_LENGTH ||
    !/^https:\/\//i.test(address) ||
    /\s/.test(address)
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  // `host` and not `hostname`, so an address on another port is refused too.
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    PHOTO_HOSTS.includes(url.host.toLowerCase())
  );
}
