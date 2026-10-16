/**
 * The address of the photo LIDL prints for a product (plan 0198, section 2).
 * Pure: it reads a string and answers a string, and nothing here or anywhere
 * else in the workspace opens the address.
 *
 * **The address is stored as the source printed it.** No size or query is
 * added, removed or guessed.
 */

/**
 * The hosts LIDL serves a product photo from.
 *
 * An address on any other host is refused, which is what stops a changed
 * payload from making a client load an arbitrary host. Every `image` and
 * every entry of `imageList` in the index fixture is on this one.
 */
export const PHOTO_HOSTS: readonly string[] = ['www.lidl.es'];

/** What `source_catalog_entries.imageUrl` holds, a `varchar(500)`. */
const MAX_LENGTH = 500;

/**
 * The fields the address is read from. The `gridbox.data` of a raw index row,
 * a `LidlListRow` and a `LidlProduct` all satisfy it.
 */
export interface PhotoFields {
  image?: unknown;
  imageList?: unknown;
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
 * The one address the chain prints for the product: `image` of the index row,
 * else the first entry of `imageList`.
 *
 * **Else means absent.** An `image` that is printed and refused does not fall
 * through to the list: the row printed its one address, and it was not one to
 * keep. The other entries of the list are further angles and are not read:
 * one address for each source row (plan 0198, section 6).
 *
 * The index prints an absolute address. A relative one is refused and not
 * resolved, because the row prints none and a guess is not a reading.
 */
export function photoAddressRead(
  raw: PhotoFields | null | undefined
): PhotoRead {
  const list = raw?.imageList;
  const printed =
    textOf(raw?.image) ?? (Array.isArray(list) ? textOf(list[0]) : null);
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
