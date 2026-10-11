/**
 * The address of the photo Mercadona prints for a product (plan 0198, section
 * 2). Pure: it reads a string and answers a string, and nothing here or
 * anywhere else in the workspace opens the address.
 *
 * **The address is stored as the source printed it.** A listing prints
 * `?fit=crop&h=300&w=300` and an old detail prints no query at all, and each
 * is answered as read. No size is added, removed or guessed.
 */

/**
 * The hosts Mercadona serves a product photo from.
 *
 * An address on any other host is refused, which is what stops a changed
 * payload from making a client load an arbitrary host. Every `thumbnail` and
 * every entry of `photos` in the fixtures is on this one.
 */
export const PHOTO_HOSTS: readonly string[] = ['prod-mercadona.imgix.net'];

/** What `source_catalog_entries.imageUrl` holds, a `varchar(500)`. */
const MAX_LENGTH = 500;

/**
 * The field the address is read from. A raw product of the detail endpoint, a
 * raw product of a category listing, a `MercadonaProduct` and a
 * `MercadonaListProduct` all satisfy it.
 */
export interface PhotoFields {
  thumbnail?: unknown;
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
 * The one address the chain prints for the product: `thumbnail`.
 *
 * `photos[]` holds the same picture in three sizes and further angles, and it
 * is not read: one address for each source row (plan 0198, section 6).
 *
 * The source prints an absolute address. A relative one is refused and not
 * resolved, because nothing in a payload says which host it would be under.
 */
export function photoAddressRead(
  raw: PhotoFields | null | undefined
): PhotoRead {
  const printed = textOf(raw?.thumbnail);
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
