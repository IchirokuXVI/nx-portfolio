import type { CatalogSynonyms, LocalizedName } from '@portfolio/velista/models';

/**
 * The synonym that made a group match a query, or null when its name did
 * (velista `0108`, target 4).
 *
 * "alg" offers "Discos desmaquillantes" because one of the group's Spanish
 * words is "algodón", and a card that does not say so reads as a wrong answer.
 * The server does not say which word matched, so this works it out with the
 * **server's own literal rule** (`search-term.ts` in catalog, `literalMatchSql`):
 *
 * - the query is split into words on anything that is not a letter or a digit;
 * - both sides are lower cased and stripped of accents and apostrophes, which is
 *   what `catalog_norm` does;
 * - a word matches where it starts a word of the text, or, from five letters,
 *   where its stem with one of the gender and number endings is a whole word.
 *
 * The name is asked first, in both languages together, because that is the
 * text the server matches against. Only when it does not account for every
 * word is a synonym named: the first, in the reader's language before the other,
 * that accounts for all the words the name left over, or failing that the first
 * that accounts for any. A group reached only through the trigram branch, a
 * misspelling, has no synonym to name and gets null, which is honest: nothing
 * on the card says anything new.
 *
 * It never decides **whether** a group matched. That is the server's answer and
 * this only explains it.
 */
export function matchedSynonym(
  name: LocalizedName,
  synonyms: CatalogSynonyms,
  query: string,
  locale: string
): string | null {
  const words = query.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
  if (words.length === 0) {
    return null;
  }

  const nameText = `${name.es} ${name.en}`;
  const left = words.filter((word) => !startsAWord(nameText, word));
  if (left.length === 0) {
    return null;
  }

  const spanishFirst = locale.startsWith('es');
  const ordered = spanishFirst
    ? [...synonyms.es, ...synonyms.en]
    : [...synonyms.en, ...synonyms.es];

  return (
    ordered.find((synonym) =>
      left.every((word) => startsAWord(synonym, word))
    ) ??
    ordered.find((synonym) =>
      left.some((word) => startsAWord(synonym, word))
    ) ??
    null
  );
}

/** Lower cased, without accents or apostrophes: `catalog_norm`, in the client. */
export function catalogNorm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ø/g, 'o')
    .replace(/['’`]/g, '');
}

/** The endings Spanish marks gender and number with, longest first. */
const GENDER_NUMBER_ENDING = /(os|as|o|a)$/;

/** The shortest typed word whose ending is cut, as on the server. */
const MIN_VARIANT_LENGTH = 5;

/** A letter, a digit or an underscore: what Postgres counts as inside a word. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

function startsAWord(text: string, word: string): boolean {
  const haystack = catalogNorm(text);
  const typed = catalogNorm(word);
  if (typed === '') {
    return false;
  }
  if (new RegExp(`(?<!${WORD_CHAR})${escape(typed)}`, 'u').test(haystack)) {
    return true;
  }
  const lower = word.toLowerCase();
  if ([...lower].length < MIN_VARIANT_LENGTH) {
    return false;
  }
  const ending = GENDER_NUMBER_ENDING.exec(lower);
  if (ending === null) {
    return false;
  }
  const stem = catalogNorm(lower.slice(0, -ending[0].length));
  return new RegExp(
    `(?<!${WORD_CHAR})${escape(stem)}(os|as|o|a)(?!${WORD_CHAR})`,
    'u'
  ).test(haystack);
}

/** The words are letters and digits only, but a pattern built from text is escaped anyway. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
