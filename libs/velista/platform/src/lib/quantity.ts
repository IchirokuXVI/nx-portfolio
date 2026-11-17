import {
  isMeasured,
  QUANTITY_COARSE_FROM,
  shortHundredths,
  type LineUnit,
} from '@portfolio/velista/models';

/**
 * A line's quantity as a caption or a pill draws it (velista `0182`, section 3;
 * velista `0070`, section 2): "×2" for a count, "750 g" below a thousand grams,
 * "1 kg" and "1,5 kg" from a thousand, and the same for millilitres and litres.
 *
 * The one place a kilo or a litre exists in velista: the wire carries base units
 * only, so 1500 is 1500 g and this is what turns it into "1,5 kg". Through
 * `Intl.NumberFormat` with `style: 'unit'` in the reader's language, and never a
 * translation key with a number in it, for the reason {@link formatMoney} gives.
 *
 * **Up to three decimals, where the plan says one** (builder decision of velista
 * `0182`), so the words always say the exact amount: 1250 g is a value the stepper
 * lands on and reads "1,25 kg", and 975 g added twice sums to 1975 on the server
 * and reads "1,975 kg", not "1,98 kg". A value that needs one decimal or none
 * draws as the plan's examples do.
 */
export function formatQuantity(
  quantity: number,
  unit: LineUnit,
  locale: string
): string {
  return isMeasured(unit)
    ? formatAmount(quantity, unit, locale)
    : `×${formatNumber(quantity, locale)}`;
}

/**
 * A quantity as a sentence says it: the bare number for a count ("You bought
 * 3"), and the words of {@link formatQuantity} for a weight or a volume ("You
 * bought 750 g"). A sentence already says what a count counts, and "×3" inside
 * one reads as a sign.
 */
export function formatAmount(
  quantity: number,
  unit: LineUnit,
  locale: string
): string {
  if (!isMeasured(unit)) {
    return formatNumber(quantity, locale);
  }
  const coarse = quantity >= QUANTITY_COARSE_FROM;
  const name =
    unit === 'GRAM'
      ? coarse
        ? 'kilogram'
        : 'gram'
      : coarse
        ? 'liter'
        : 'milliliter';
  const value = coarse ? quantity / 1000 : quantity;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      maximumFractionDigits: 3,
    }).format(value);
  } catch {
    // An unrecognised locale tag, which `Intl` throws for. The English symbols
    // are ugly and correct, and a pill with no number would be worse.
    const symbol =
      unit === 'GRAM' ? (coarse ? 'kg' : 'g') : coarse ? 'l' : 'ml';
    return `${Number(value.toFixed(3))} ${symbol}`;
  }
}

/**
 * A signed change to a quantity, as a note about it says it: "+2" or "-1" for a
 * count, "+250 g" or "-1,5 kg" for a weight or a volume (velista `0182`). The
 * number after the sign is {@link formatAmount}'s, so a change reads in the unit
 * the line counts in and never as a bare number of grams.
 */
export function formatQuantityChange(
  delta: number,
  unit: LineUnit,
  locale: string
): string {
  const sign = delta < 0 ? '-' : '+';
  return `${sign}${formatAmount(Math.abs(delta), unit, locale)}`;
}

/** An amount as a figure draws it: the number, and the symbol under it (velista `0188`). */
export interface AmountWords {
  /** "750", "1,25", "999,99", "2". */
  readonly figure: string;
  /** "g", "kg", "ml", "l", "K" or "k", or "" for a count under a thousand. */
  readonly symbol: string;
  /** True when a short figure has six characters, which draw one step smaller (S4). */
  readonly long: boolean;
  /** The exact amount for a screen reader: "750 gramos", "1,275 kilogramos", "12". */
  readonly spoken: string;
}

/**
 * The short form of an amount (velista `0188`, S4): rows, cards, tables and the
 * shopping list's cell. At most three whole digits and two decimals. Below 1000 it
 * reads in the base unit; from 1000 it reads hundredths of the top name, rounded
 * half up for the display only, and never 1000 of the top name: 999 995 to 999 999
 * read "999,99". The spoken words are always the exact amount.
 */
export function shortAmount(
  quantity: number,
  unit: LineUnit,
  locale: string
): AmountWords {
  const amount = Math.max(0, Math.round(quantity));
  const spoken = spokenAmount(amount, unit, locale);
  if (amount < QUANTITY_COARSE_FROM) {
    const figure = plainFigure(amount, 0, locale);
    return { figure, symbol: baseSymbol(unit), long: false, spoken };
  }
  const figure = plainFigure(shortHundredths(amount) / 100, 2, locale);
  return {
    figure,
    symbol: topSymbol(unit, locale),
    long: figure.length >= 6,
    spoken,
  };
}

/**
 * The exact form of an amount (velista `0188`, S5): the two line sheets only. A
 * weight or a volume reads in the base unit below 1000 and in the top name with up
 * to three decimals from it ("1,275 kg"). A count is plain under 100 000 and reads in
 * thousands with three decimals from there ("123,456"). `long` is always false: the
 * sheets' cells are measured for the longest exact figure at full size.
 */
export function exactAmount(
  quantity: number,
  unit: LineUnit,
  locale: string
): AmountWords {
  const amount = Math.max(0, Math.round(quantity));
  const spoken = spokenAmount(amount, unit, locale);
  const coarseFrom = isMeasured(unit)
    ? QUANTITY_COARSE_FROM
    : COUNT_EXACT_THOUSANDS_FROM;
  if (amount < coarseFrom) {
    return {
      figure: plainFigure(amount, 0, locale),
      symbol: baseSymbol(unit),
      long: false,
      spoken,
    };
  }
  return {
    figure: plainFigure(amount / 1000, 3, locale),
    symbol: topSymbol(unit, locale),
    long: false,
    spoken,
  };
}

/**
 * What a person typed into a sheet's field, in base units, or null for text that is
 * not a number (velista `0188`, S10 and decision K). Spaces are dropped; "," and "."
 * are both the decimal separator, and one at most is read.
 *
 * A weight or a volume is read in the unit {@link followTyped} leaves it under, the
 * owner's rule of 2026-11-17: the digits are read in the unit the field showed when
 * the edit started, so "25000" under "g" is 25 000 g, and a whole number over 99
 * under "kg" is read in grams ("500" is 500 g). Text the field does not accept (a
 * separator under "g", a sixth digit) is null. A count keeps its rule: a number
 * with no separator is read in the name of `shown`, and with one in the top name.
 * Rounded half up to a whole base unit, in integers, and held to `[min, max]`.
 */
export function parseTypedAmount(
  text: string,
  shown: AmountWords,
  unit: LineUnit,
  min: number,
  max: number
): number | null {
  const followed = isMeasured(unit)
    ? followTyped(text, shown.symbol, unit, 'en')
    : { symbol: shown.symbol, turned: false };
  if (followed === null) {
    return null;
  }
  const typed = readTyped(text);
  if (typed === null) {
    return null;
  }
  let amount: number;
  if (typed.fraction === null) {
    const whole = Number(typed.whole);
    amount = isTopSymbol(followed.symbol) ? whole * 1000 : whole;
  } else {
    const digits = typed.fraction.padEnd(4, '0');
    amount =
      Number(typed.whole || '0') * 1000 +
      Number(digits.slice(0, 3)) +
      (Number(digits[3]) >= 5 ? 1 : 0);
  }
  if (!Number.isFinite(amount)) {
    return null;
  }
  return Math.min(max, Math.max(min, amount));
}

/** The unit a sheet's field reads its text in after a keystroke. */
export interface TypedText {
  /** The symbol the text is read in: "g" or "kg", "ml" or "l", "" or "K". */
  readonly symbol: string;
  /** True when this keystroke turned the field from one unit into the other. */
  readonly turned: boolean;
}

/**
 * The unit typed text for a weight or a volume is read in, or null for a keystroke
 * the field does not accept (the owner, 2026-11-17, velista `0188` decision K).
 * `symbol` is the unit the field read in before this keystroke. The text itself is
 * never rewritten: what a person types stays as typed until the edit ends.
 *
 * - The unit the edit started under is held. Under grams "25000" stays 25000 g
 *   while it is typed, and the field rests as "25 kg" once the edit ends.
 * - Under kilos, a whole number over 99 turns into grams at once, with the digits
 *   as they are ("500" kg is "500" g), because only the label changes. The field
 *   then stays in grams.
 * - An empty field reads in grams.
 * - Not accepted: a separator under grams, because a gram has no decimals; a whole
 *   part over 99 with a separator under kilos, which would land in grams with
 *   decimals ("99,5" edited into "199,5"); a fourth decimal under kilos, which
 *   names less than a gram; a sixth digit, because the field holds at most 99 999
 *   base units ("99999" g, "99,999" kg).
 * - Text that is not a number does not turn, and is put back when the edit ends.
 *
 * The same for millilitres and litres. A count does not turn: it reads in its top
 * name once a separator is typed and in `symbol` otherwise, as before.
 */
export function followTyped(
  text: string,
  symbol: string,
  unit: LineUnit,
  locale: string
): TypedText | null {
  if (!isMeasured(unit)) {
    return {
      symbol: /[.,]/.test(text) ? topSymbol(unit, locale) : symbol,
      turned: false,
    };
  }
  const large = isTopSymbol(symbol);
  const compact = text.replace(/\s+/g, '');
  if (compact === '') {
    return { symbol: baseSymbol(unit), turned: large };
  }
  if ((compact.match(/\d/g) ?? []).length > TYPED_DIGITS_MAX) {
    return null;
  }
  const separated = /[.,]/.test(compact);
  if (!large) {
    return separated ? null : { symbol, turned: false };
  }
  const typed = readTyped(compact);
  if (typed === null) {
    return { symbol, turned: false };
  }
  if (typed.fraction !== null && typed.fraction.length > TYPED_DECIMALS_MAX) {
    return null;
  }
  if (Number(typed.whole || '0') <= TYPED_LARGE_WHOLE_MAX) {
    return { symbol, turned: false };
  }
  return typed.fraction === null
    ? { symbol: baseSymbol(unit), turned: true }
    : null;
}

/**
 * The symbol a typed text will be read in when the typing started under `shown`
 * (velista `0188`, decision K): {@link followTyped}'s symbol for that text, or the
 * shown symbol for text the field does not accept.
 */
export function typedSymbol(
  text: string,
  shown: AmountWords,
  unit: LineUnit,
  locale: string
): string {
  return followTyped(text, shown.symbol, unit, locale)?.symbol ?? shown.symbol;
}

/** The most whole kilos or litres the field holds before it turns into grams: 99. */
const TYPED_LARGE_WHOLE_MAX = 99;

/** The most decimals under kilos or litres: three, a whole gram or millilitre. */
const TYPED_DECIMALS_MAX = 3;

/** The most digits the field of a weight or a volume holds: 99 999 base units. */
const TYPED_DIGITS_MAX = 5;

/** Where the exact form of a count starts to read in thousands (S5). */
const COUNT_EXACT_THOUSANDS_FROM = 100_000;

/** The symbols of the top names, in both languages ("k" and "K" for a count). */
const TOP_SYMBOLS: ReadonlySet<string> = new Set(['kg', 'l', 'k', 'K']);

function isTopSymbol(symbol: string): boolean {
  return TOP_SYMBOLS.has(symbol);
}

function baseSymbol(unit: LineUnit): string {
  return unit === 'GRAM' ? 'g' : unit === 'MILLILITER' ? 'ml' : '';
}

/**
 * A fixed table and not `Intl`'s unit names: `Intl` writes "L" for a litre in
 * English, and the owner asked for "l". The thousand of a count is "K" in Spanish
 * and "k" otherwise.
 */
function topSymbol(unit: LineUnit, locale: string): string {
  if (unit === 'GRAM') {
    return 'kg';
  }
  if (unit === 'MILLILITER') {
    return 'l';
  }
  return locale.toLowerCase().split(/[-_]/)[0] === 'es' ? 'K' : 'k';
}

function readTyped(
  text: string
): { readonly whole: string; readonly fraction: string | null } | null {
  const compact = text.replace(/\s+/g, '');
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(compact);
  if (match === null) {
    return null;
  }
  const whole = match[1];
  const fraction = match[2] ?? null;
  if (whole === '' && (fraction === null || fraction === '')) {
    return null;
  }
  return { whole, fraction };
}

/** A number with no grouping and up to `decimals` decimals, in the reader's language. */
function plainFigure(value: number, decimals: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: decimals,
      useGrouping: false,
    }).format(value);
  } catch {
    return String(Number(value.toFixed(decimals)));
  }
}

/** The exact amount, as a screen reader says it ("750 gramos", "12"). */
function spokenAmount(amount: number, unit: LineUnit, locale: string): string {
  if (!isMeasured(unit)) {
    return formatNumber(amount, locale);
  }
  const coarse = amount >= QUANTITY_COARSE_FROM;
  const name =
    unit === 'GRAM'
      ? coarse
        ? 'kilogram'
        : 'gram'
      : coarse
        ? 'liter'
        : 'milliliter';
  const value = coarse ? amount / 1000 : amount;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'long',
      maximumFractionDigits: 3,
    }).format(value);
  } catch {
    return formatAmount(amount, unit, 'en');
  }
}

function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
