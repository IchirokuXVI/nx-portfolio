import {
  isMeasured,
  type AbsorbedExtra,
  type LineUnit,
} from '@portfolio/velista/models';
import { formatAmount, shortAmount } from '@portfolio/velista/platform';

/** A key and its arguments, read in the page's language. */
export type ExtraAskTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

/** One answer of the question: its words, and the amount it leaves, or none. */
export interface ExtraAskAnswer {
  readonly words: string;
  readonly amount: string | null;
}

/** What the question about the extra already bought says (velista `0207`). */
export interface ExtraAskWords {
  /** Both sentences, the popover's title. */
  readonly question: string;
  /** "Still need", with the amount the person set. */
  readonly stillNeed: ExtraAskAnswer;
  /** "Count the extra" with what is left, or "That's enough" with no amount. */
  readonly keep: ExtraAskAnswer;
}

/** Who bought the extra, as the sentence can name them. */
type Buyer =
  | { readonly kind: 'you' }
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'unknown' };

const NBSP = ' ';

/**
 * An amount in a sentence (target state 5): a count is its bare number, a weight or
 * a volume its short form joined to its unit by a non breaking space ("500 g",
 * "1,5 kg").
 */
export function extraAmountText(
  quantity: number,
  unit: LineUnit,
  locale: string
): string {
  if (!isMeasured(unit)) {
    return formatAmount(quantity, unit, locale);
  }
  const words = shortAmount(quantity, unit, locale);
  return words.symbol === ''
    ? words.figure
    : `${words.figure}${NBSP}${words.symbol}`;
}

/**
 * An answer's amount: a count with its word ("1 unit", "2 uds"), or a weight's short
 * form ("1,5 kg").
 */
function answerAmount(
  quantity: number,
  unit: LineUnit,
  locale: string,
  t: ExtraAskTranslate
): string {
  return isMeasured(unit)
    ? extraAmountText(quantity, unit, locale)
    : t('list.extra.units', { count: quantity });
}

/**
 * The first sentence, naming who bought the extra (target state 6).
 *
 * A buyer the reader cannot be told about arrives as a null id, and every such
 * buyer is one null entry (backend `0275` after its review), so the number of
 * unknown people is never known: no sentence counts them. "Someone" stands for them
 * alone, and "someone else" beside one person who is named. Three entries or more
 * with an unknown among them name up to two of the people who are named, in the
 * order of `buyers`, and "others" for the rest ("Marta, Luis and others"), since "3
 * people" could be too few; with nobody named they say "Someone". The reader is not
 * named there: "You, Luis and others" would need a sentence of its own, so the
 * reader is one of the others. A known id whose name does not resolve is one
 * unknown person.
 */
function boughtSentence(
  buyers: readonly Buyer[],
  hasNull: boolean,
  amount: string,
  t: ExtraAskTranslate
): string {
  if (buyers.length >= 3) {
    if (!hasNull) {
      return t('list.extra.boughtByMany', { count: buyers.length, amount });
    }
    const named = buyers
      .filter(
        (buyer): buyer is Extract<Buyer, { kind: 'named' }> =>
          buyer.kind === 'named'
      )
      .slice(0, 2);
    return named.length === 0
      ? t('list.extra.boughtBySomeone', { amount })
      : t('list.extra.boughtByNamedAndOthers', {
          names: named.map((buyer) => buyer.name).join(', '),
          amount,
        });
  }
  if (buyers.length === 2) {
    const you = buyers.some((buyer) => buyer.kind === 'you');
    const named = buyers.filter(
      (buyer): buyer is Extract<Buyer, { kind: 'named' }> =>
        buyer.kind === 'named'
    );
    if (you && named.length === 1) {
      return t('list.extra.boughtByYouAndOne', {
        name: named[0].name,
        amount,
      });
    }
    if (you) {
      return t('list.extra.boughtByYouAndSomeone', { amount });
    }
    if (named.length === 2) {
      return t('list.extra.boughtByTwo', {
        first: named[0].name,
        second: named[1].name,
        amount,
      });
    }
    if (named.length === 1) {
      return t('list.extra.boughtByOneAndSomeone', {
        name: named[0].name,
        amount,
      });
    }
    return t('list.extra.boughtBySomeone', { amount });
  }
  const only = buyers[0];
  if (only?.kind === 'you') {
    return t('list.extra.boughtByYou', { amount });
  }
  if (only?.kind === 'named') {
    return t('list.extra.boughtBy', { name: only.name, amount });
  }
  return t('list.extra.boughtBySomeone', { amount });
}

/**
 * The question a raise asks when it took units bought above the ask into the ask
 * (velista `0207`, target states 4 to 6; velista `0208`, target state 3).
 *
 * `shown` (Y) is the number the control shows after "Still need", which is also
 * what it shows with no answer; `after` (Z) is the number it shows after "Count the
 * extra". Both come from the answer and not from the run, so a write of somebody
 * else's that landed in between stands. `extra.above` (X) is the extra the raise
 * took in. Nothing ever prints 0: with nothing left after the count the question
 * asks whether that is enough.
 */
export function extraAskWords(input: {
  readonly extra: AbsorbedExtra;
  readonly shown: number;
  readonly after: number;
  readonly unit: LineUnit;
  readonly locale: string;
  readonly readerId: string | null;
  readonly nameOf: (userId: string) => string | null;
  readonly t: ExtraAskTranslate;
}): ExtraAskWords {
  const { extra, unit, locale, readerId, nameOf, t } = input;
  const asked = input.shown;
  const left = input.after;

  const buyers = extra.buyers.map((buyer): Buyer => {
    if (buyer.userId !== null && buyer.userId === readerId) {
      return { kind: 'you' };
    }
    const name = buyer.userId === null ? null : nameOf(buyer.userId);
    return name === null ? { kind: 'unknown' } : { kind: 'named', name };
  });
  const hasNull = extra.buyers.some((buyer) => buyer.userId === null);

  const first = boughtSentence(
    buyers,
    hasNull,
    extraAmountText(extra.above, unit, locale),
    t
  );
  const askedText = extraAmountText(asked, unit, locale);
  const second =
    left > 0
      ? t('list.extra.ask', {
          asked: askedText,
          left: extraAmountText(left, unit, locale),
        })
      : t('list.extra.askEnough', { asked: askedText });

  return {
    question: `${first} ${second}`,
    stillNeed: {
      words: t('list.extra.stillNeed'),
      amount: answerAmount(asked, unit, locale, t),
    },
    keep:
      left > 0
        ? {
            words: t('list.extra.count'),
            amount: answerAmount(left, unit, locale, t),
          }
        : { words: t('list.extra.enough'), amount: null },
  };
}
