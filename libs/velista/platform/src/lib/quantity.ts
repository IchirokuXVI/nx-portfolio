import {
  isMeasured,
  LINE_MEASURED_QUANTITY_MAX,
  lineQuantityMax,
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
 * `0182`), so the words always say the exact amount: 1250 g is a value the reel
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
 * A weight or a volume is read after the turns of {@link followTyped}, the owner's
 * rule of 2026-11-17: the digits are read in the unit the field shows, so "750"
 * under "kg" is 750 g, because three whole digits under kg turn the field back into
 * grams. A count keeps its rule: a number with no separator is read in the name of
 * `shown`, and with one in the top name. Rounded half up to a whole base unit, in
 * integers, and held to `[min, max]`, a weight or a volume also to
 * {@link LINE_MEASURED_QUANTITY_MAX}.
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
    : { text, symbol: shown.symbol };
  const typed = readTyped(followed.text);
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
  return Math.min(lineQuantityMax(unit, max), Math.max(min, amount));
}

/** The text a sheet's field holds after a keystroke, and the unit it is read in. */
export interface TypedText {
  /** What the field holds: the typed text, or the same amount in the other unit. */
  readonly text: string;
  /** The symbol the text is read in: "g" or "kg", "ml" or "l", "" or "K". */
  readonly symbol: string;
  /** True when this keystroke turned the field from one unit into the other. */
  readonly turned: boolean;
}

/**
 * Where typed text for a weight or a volume turns (the owner, 2026-11-17, velista
 * `0188` decision K). `symbol` is the unit the field read in before this keystroke.
 *
 * - Under grams, a whole number of 1000 or more turns into kilos showing the same
 *   amount ("1000" g is "1" kg, "1250" g is "1,25" kg), held to 99 kg.
 * - Under grams, a separator turns into kilos with the digits as typed ("1," is
 *   read in kilos and the decimals follow), because a gram has no decimals.
 * - Under kilos, three whole digits turn back into grams with the whole digits as
 *   typed ("100" kg is "100" g, "150,5" kg is "150" g). "99,5" kg stays in kilos and
 *   is held to 99 kg when it is read.
 * - An empty field reads in grams. Text that is not a number does not turn.
 *
 * The same for millilitres and litres. A count does not turn: it reads in its top
 * name once a separator is typed and in `symbol` otherwise, as before.
 */
export function followTyped(
  text: string,
  symbol: string,
  unit: LineUnit,
  locale: string
): TypedText {
  if (!isMeasured(unit)) {
    return {
      text,
      symbol: /[.,]/.test(text) ? topSymbol(unit, locale) : symbol,
      turned: false,
    };
  }
  const startsLarge = isTopSymbol(symbol);
  if (text.replace(/\s+/g, '') === '') {
    return { text, symbol: baseSymbol(unit), turned: startsLarge };
  }
  let large = startsLarge;
  let current = text;
  // Each pass turns at most once, and three settle every text: grams to kilos lands
  // at 99 kg or under, and kilos to grams keeps the whole digits only.
  for (let pass = 0; pass < 3; pass++) {
    const typed = readTyped(current);
    if (typed === null) {
      break;
    }
    const whole = Number(typed.whole || '0');
    if (!large && whole >= QUANTITY_COARSE_FROM) {
      large = true;
      const amount = Math.min(LINE_MEASURED_QUANTITY_MAX, whole);
      current = plainFigure(amount / 1000, 3, locale);
    } else if (!large && typed.fraction !== null) {
      large = true;
    } else if (large && whole > TYPED_LARGE_WHOLE_MAX) {
      large = false;
      current = typed.whole;
    } else {
      break;
    }
  }
  return {
    text: current,
    symbol: large ? topSymbol(unit, locale) : baseSymbol(unit),
    turned: large !== startsLarge,
  };
}

/**
 * The symbol a typed text will be read in when the typing started under `shown`
 * (velista `0188`, decision K): {@link followTyped}'s symbol for that text.
 */
export function typedSymbol(
  text: string,
  shown: AmountWords,
  unit: LineUnit,
  locale: string
): string {
  return followTyped(text, shown.symbol, unit, locale).symbol;
}

/** The most whole kilos or litres the field holds before it turns back: 99. */
const TYPED_LARGE_WHOLE_MAX = LINE_MEASURED_QUANTITY_MAX / 1000;

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
