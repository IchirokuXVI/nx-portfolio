import {
  normalizeHarvestDocument,
  validateHarvestDocument,
  type HarvestDocument,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';

/**
 * Read an uploaded file, or say exactly why it cannot be read (plan 0086,
 * section 6.2).
 *
 * **This is the harvester's half of the two validations.** The gateway runs the
 * same `validateHarvestDocument` before the document crosses the broker and
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
 * The document in the version 2 shape, or a `ValidationException` naming the
 * paths that failed.
 *
 * Used at spawn, where the caller is a person uploading a file, and again when a
 * run reads a stored document back. The second case means something already
 * validated has since become unreadable, which is worth stating loudly rather
 * than skipping past.
 *
 * **It normalizes on the way out** (plan 0103, D7). A version 1 document is
 * validated against version 1 and answered in the version 2 shape, so nothing
 * past here branches on the version and every file ever exported or extracted
 * still imports.
 */
export function readHarvestDocument(value: unknown): HarvestDocument {
  const { valid, failures } = validateHarvestDocument(value);
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
      `That document does not match its schema: ${listed}${more}`,
      { details: { document: failures.slice(0, MAX_LISTED) } }
    );
  }
  return normalizeHarvestDocument(value as HarvestDocument);
}
