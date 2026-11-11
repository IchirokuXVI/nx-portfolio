import { normalizeName } from './matching';

/**
 * The street words people shorten, after {@link normalizeName}, and the word
 * each one stands for (plan 0265, section 1).
 *
 * **Closed on purpose.** A candidate on the address rung stops a hand import,
 * so the table holds only spellings that the shops and places of a slot
 * actually used, and nothing fuzzy. Plan 0265 also listed `paseo`, `ronda`,
 * `glorieta` and `travesia` shortened; no address on the slot or in production
 * wrote any of them short, so those rows were dropped as the plan asks.
 *
 * Each key here is two letters or more and is read as a word anywhere. The
 * one letter keys are in {@link FIRST_WORD} and {@link BEFORE_NUMBER}, because
 * a single letter elsewhere can be part of a name.
 */
const STREET_WORDS: Readonly<Record<string, string>> = {
  av: 'avenida',
  avda: 'avenida',
  avd: 'avenida',
  cl: 'calle',
  cll: 'calle',
  pza: 'plaza',
  pl: 'plaza',
  plza: 'plaza',
  ctra: 'carretera',
  urb: 'urbanizacion',
};

/** One letter keys read only as the first word of an address. */
const FIRST_WORD: Readonly<Record<string, string>> = {
  c: 'calle',
};

/** The marks of a house number, removed when a number follows them. */
const BEFORE_NUMBER: ReadonlySet<string> = new Set(['n', 'num', 'no']);

/** The small words a person drops or adds: `Avenida (de la) Constitución`. */
const SMALL_WORDS: ReadonlySet<string> = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
]);

/**
 * The token `s/n` (`sin número`) becomes. It is a house number of its own:
 * two shops at `s/n` on one street are not the same shop by that alone.
 */
export const NO_NUMBER = 'sn';

function isNumber(token: string | undefined): boolean {
  return token !== undefined && /^[0-9]/.test(token);
}

/**
 * An address as a key that two spellings of the same street share (plan 0265).
 *
 * {@link normalizeName} first, then the street words of the table spelled out,
 * the mark of a house number dropped, everything after the first number cut
 * (`local 3`, `bajo`, `esquina ...`), and the small words removed. The house
 * number stays in the key, so `Calle Mayor 5` and `Calle Mayor 7` stay apart.
 *
 * Pure and framework free. It never changes {@link normalizeName}, which is
 * also half the identity of a product row.
 */
export function streetKey(value: string): string {
  const tokens = normalizeName(value).split(' ').filter(Boolean);
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 's' && tokens[i + 1] === 'n') {
      words.push(NO_NUMBER);
      break;
    }
    if (BEFORE_NUMBER.has(token) && isNumber(tokens[i + 1])) {
      continue;
    }
    if (isNumber(token)) {
      words.push(token);
      break;
    }
    words.push(
      STREET_WORDS[token] ?? (i === 0 ? FIRST_WORD[token] : undefined) ?? token
    );
  }
  return words.filter((word) => !SMALL_WORDS.has(word)).join(' ');
}

/**
 * Whether a {@link streetKey} ends on a house number that tells one shop of
 * the street from another: a number, and neither `s/n` nor none at all.
 */
export function hasHouseNumber(key: string): boolean {
  return isNumber(key.split(' ').pop());
}
