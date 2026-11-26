import { photoAddressRead as carrefourPhoto } from '@portfolio/luna-shopper/carrefour';
import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import { photoAddressRead as diaPhoto } from '@portfolio/luna-shopper/dia';
import { photoAddressRead as eljamonPhoto } from '@portfolio/luna-shopper/eljamon';
import { photoAddressRead as lidlPhoto } from '@portfolio/luna-shopper/lidl';
import { photoAddressRead as mercadonaPhoto } from '@portfolio/luna-shopper/mercadona';
import { photoOf, type PhotoRead } from './photo-address';

/**
 * The photo address a document states, read through the rule a walk's
 * address passed (plan 0198, section 2).
 *
 * **The rule is the adapter library's own, and nothing here restates it.**
 * Each of the five libraries that read a photo answers an address through
 * its `photoAddressRead`: `https`, at most 500 characters, on a host of the
 * chain's `PHOTO_HOSTS`. A document's address is handed to the library of the
 * importing chain's adapter, in the one field that library reads, so a file
 * passes exactly the check the walk that produced it passed. A changed host
 * list in a library changes what a file may state in the same edit.
 *
 * The adapter is the importing chain's own row, never the document's hint:
 * the hint is what a producer claims, and a file must not choose the host
 * list it is checked against.
 */
const READERS: Partial<Record<AdapterKey, (address: string) => PhotoRead>> = {
  'mercadona-api': (address) => mercadonaPhoto({ thumbnail: address }),
  'dia-api': (address) => diaPhoto({ image: address }),
  'eljamon-web': (address) => eljamonPhoto({ image: address }),
  'carrefour-web': (address) =>
    carrefourPhoto({ images: { desktop: address } }),
  'lidl-api': (address) => lidlPhoto({ image: address }),
};

/**
 * The address to write for one product of a document, or undefined to leave
 * the stored one alone.
 *
 * - Absent: undefined. A file that states no photo says nothing about it.
 * - Null: null. The source states that it prints none, and the row loses its
 *   address as it would on a walk that saw none.
 * - An address the library keeps, verbatim: that address.
 * - An address it refuses, or rewrites (DIA makes a path absolute, which a
 *   file has no reason to need), or any address for a chain whose adapter
 *   reads no photo (DEZA, a chain with no source row): undefined, and the
 *   refusal is logged as a walk's is. **A refusal is not a statement that
 *   the chain prints none**, so the stored address stays.
 */
export function documentPhotoOf(
  stated: string | null | undefined,
  adapterKey: string | null,
  externalId: string
): string | null | undefined {
  if (stated === undefined || stated === null) {
    return stated;
  }
  const reader = adapterKey ? READERS[adapterKey as AdapterKey] : undefined;
  const read: PhotoRead = reader
    ? reader(stated)
    : { url: null, refused: stated };
  const kept = read.url === stated ? read.url : null;
  if (kept === null) {
    photoOf({ url: null, refused: stated }, externalId);
    return undefined;
  }
  return kept;
}
