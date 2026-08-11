import { InfoFact } from '@portfolio/landing-v2/models';

/**
 * Structural rows for the hero's "facts" table. Localized label/value/note
 * live in {@link ./static-info-facts-translation-data} and are joined in by
 * {@link ./info-facts-memory}, the same convention as the project domain.
 */
export const INFO_FACTS: readonly InfoFact[] = [
  { id: '1', order: 1 },
  { id: '2', order: 2 },
  { id: '3', order: 3 },
  { id: '4', order: 4 },
];
