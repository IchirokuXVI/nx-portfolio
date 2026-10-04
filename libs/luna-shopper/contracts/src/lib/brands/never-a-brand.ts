import { brandKey } from './brand-key';

/**
 * Printed words that are never a brand (plan 0178).
 *
 * A chain prints a protected origin or a season where a brand would go, and a
 * reader that takes it for one hands the curation gate a brand to hold every
 * product of that kind to. `D.O.` is Denominación de Origen, a wine region, and
 * 92 DEZA wines carried it as their brand. `HALLOWEEN` is what LIDL writes in
 * the brand field of a seasonal product.
 *
 * **The list is closed.** It grows only from evidence in a committed fixture,
 * named in the pull request that adds the word. A word that is merely unlikely
 * to be a brand does not belong here: an unregistered brand already costs
 * nothing but a row a person looks at, and a word wrongly listed erases a real
 * brand from every chain at once.
 *
 * It must stay **browser reachable**, as the brand key is: this file names no
 * `process` and imports nothing from Node.
 */
export const NEVER_A_BRAND: readonly string[] = [
  'D.O.',
  'D.O',
  'DO',
  'D.O.P.',
  'DOP',
  'D.O.Ca.',
  'DOCa',
  'I.G.P.',
  'IGP',
  'V.T.',
  'VINO DE LA TIERRA',
  'HALLOWEEN',
  'NAVIDAD',
];

/**
 * The list as the keys it is compared by.
 *
 * `brandKey` is how every spelling of one printed text meets, so `D.O.`, `D.O`
 * and `d.o` are one entry here and a chain that changes its punctuation does
 * not get past the list.
 */
const NEVER_A_BRAND_KEYS: ReadonlySet<string> = new Set(
  NEVER_A_BRAND.map((word) => brandKey(word)).filter(
    (key): key is string => key !== null
  )
);

/** True when the printed text is a listed word and nothing else. */
export function isNeverABrand(text: string | null | undefined): boolean {
  const key = brandKey(text);
  return key !== null && NEVER_A_BRAND_KEYS.has(key);
}
