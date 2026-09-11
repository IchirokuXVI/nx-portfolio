import {
  adapterCapabilities,
  type ContentLocale,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';

/**
 * The name a queued row is accepted under (plan 0111, section 6).
 *
 * One function for both accept routes, because they have drifted once already.
 * The one at a time route required Spanish and the batch route required Spanish
 * without saying so, and the only difference between them that was ever meant
 * to exist is the English fetch, which the batch route does not pay for.
 */

/**
 * The languages the operator actually filled in.
 *
 * A key whose value is blank or whitespace is not a name in that language, and
 * it is dropped rather than stored: `{ en: '  ' }` would satisfy every "at
 * least one language" check and show an empty string on every screen.
 */
export function presentLocalizedText(
  name: LocalizedText | null | undefined
): LocalizedText {
  const present: LocalizedText = {};
  for (const [locale, value] of Object.entries(name ?? {})) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      present[locale as ContentLocale] = trimmed;
    }
  }
  return present;
}

/**
 * The string the chain printed, filed under the language that chain prints in.
 *
 * `{}` when there is nothing printed, and also when the adapter does not say
 * what language it prints in: a string of unknown language is not a name in any
 * particular one, and guessing is how the catalog filled up with Spanish keys
 * holding English words. The accept then asks the operator instead.
 */
export function printedName(
  printed: string | null | undefined,
  adapterKey: string | null | undefined
): LocalizedText {
  const trimmed = printed?.trim();
  const locale = adapterCapabilities(adapterKey).printedLocale;
  return trimmed && locale ? { [locale]: trimmed } : {};
}

/**
 * {@link printedName}, as a nullable column wants it.
 *
 * `{}` is not a name: the gateway refuses it and plan 0079 says so. A field that
 * is allowed to hold no name at all therefore holds `null`, not an empty
 * object, and the two callers that write one go through this rather than
 * repeating the test.
 */
export function printedNameOrNull(
  printed: string | null | undefined,
  adapterKey: string | null | undefined
): LocalizedText | null {
  const name = printedName(printed, adapterKey);
  return Object.keys(name).length > 0 ? name : null;
}

/**
 * What the operator gave, or else what the chain printed, or else a refusal.
 *
 * Nothing is copied between languages and nothing is substituted for another.
 * An operator who fills English and leaves Spanish blank gets a product with an
 * `en` key and no `es` key, which is the regression this exists for: the old
 * rule read the request's `es` alone, so an English only accept either failed
 * for a field that was not asked about or silently stored the chain's Spanish
 * string beside the typed English, and the operator who wrote one name got a
 * product holding two.
 *
 * The refusal message is now true. It offered a choice the code did not honour.
 */
export function acceptedName(
  requested: LocalizedText | null | undefined,
  printed: string | null | undefined,
  adapterKey: string | null | undefined
): LocalizedText {
  const given = presentLocalizedText(requested);
  const name =
    Object.keys(given).length > 0 ? given : printedName(printed, adapterKey);
  if (Object.keys(name).length === 0) {
    throw new ValidationException(
      'A product needs a name in at least one language.',
      { details: { name: 'give at least one of es or en' } }
    );
  }
  return name;
}
