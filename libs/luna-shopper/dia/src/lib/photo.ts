import { DIA_BASE_URL } from './dia.client';

/**
 * The address of the photo DIA prints for a product (plan 0198, section 2).
 * Pure: it reads a string and answers a string, and nothing here or anywhere
 * else in the workspace opens the address.
 *
 * **The address is stored as the source printed it**, once it is absolute. No
 * size or query is added, removed or guessed.
 */

/**
 * The hosts DIA serves a product photo from.
 *
 * An address on any other host is refused, which is what stops a changed
 * payload from making a client load an arbitrary host. A listing row prints a
 * path, and the `product_marking` block of the same page prints that path
 * under this host.
 */
export const PHOTO_HOSTS: readonly string[] = ['www.dia.es'];

/** What `source_catalog_entries.imageUrl` holds, a `varchar(500)`. */
const MAX_LENGTH = 500;

/**
 * The field the address is read from. A raw row of `plp_items` and a
 * `DiaListingRow` both satisfy it.
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
 * The one address the chain prints for the product: `image`.
 *
 * **A row prints a path**, `/product_images/65/65_ISO_0_ES.jpg`, and it is
 * made absolute against {@link DIA_BASE_URL}, as the catalog runner did when
 * it kept the address in `extra`. An address that is already absolute is left
 * as it is. One that starts with `//` names a host of its own with no scheme,
 * and it is refused and not resolved.
 */
export function photoAddressRead(
  raw: PhotoFields | null | undefined
): PhotoRead {
  const printed = textOf(raw?.image);
  if (printed === null) {
    return { url: null, refused: null };
  }
  const address = absolute(printed);
  return address !== null && isAllowed(address)
    ? { url: address, refused: null }
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

function absolute(printed: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(printed)) {
    return printed;
  }
  if (printed.startsWith('//')) {
    return null;
  }
  return `${DIA_BASE_URL}${printed.startsWith('/') ? '' : '/'}${printed}`;
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
