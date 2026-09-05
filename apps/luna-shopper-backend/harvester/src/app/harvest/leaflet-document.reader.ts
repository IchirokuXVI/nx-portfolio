import {
  validateLeafletDocument,
  type LeafletDocument,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';

/**
 * Read an uploaded leaflet, or say exactly why it cannot be read (plan 0081,
 * section 4).
 *
 * **This is the harvester's half of the two validations.** The gateway runs the
 * same `validateLeafletDocument` before the document crosses the broker and
 * answers a 400 listing every failure by JSON path; this runs at spawn and again
 * at run start, because the harvester owns the schema version and a broker
 * message is not a trusted input.
 *
 * The turn from failures into an exception is here rather than in the contracts
 * library, because a `ValidationException` is a Nest shaped answer and the
 * library only knows what the schema says.
 */

/** How many failures a message lists before it stops being readable. */
const MAX_LISTED = 10;

/**
 * The document, or a `ValidationException` naming the paths that failed.
 *
 * Used at spawn, where the caller is a person uploading a file, and again when
 * a run or an accept reads a stored document back. The second case means
 * something already validated has since become unreadable, which is worth
 * stating loudly rather than skipping past.
 */
export function readLeafletDocument(value: unknown): LeafletDocument {
  const { valid, failures } = validateLeafletDocument(value);
  if (!valid) {
    const listed = failures
      .slice(0, MAX_LISTED)
      .map((failure) => `${failure.path || '/'} ${failure.message}`)
      .join('; ');
    const more =
      failures.length > MAX_LISTED
        ? ` (and ${failures.length - MAX_LISTED} more)`
        : '';
    throw new ValidationException(
      `That leaflet document does not match its schema: ${listed}${more}`,
      { details: { document: failures.slice(0, MAX_LISTED) } }
    );
  }
  return value as LeafletDocument;
}
