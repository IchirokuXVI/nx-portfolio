import type { CountedExtra, LineUnit } from '@portfolio/velista/models';
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { extraAskWords, type ExtraAskTranslate } from './extra-ask-words';

/**
 * The words of the question about the extra already bought (velista `0207`, specs
 * 6, 7 and 17), against the shipped words of both languages, character for
 * character as the board `compact-reel/OverBought.dc.html` writes them, non
 * breaking spaces included.
 */

const NB = ' ';

/** The table's words, with i18next's `_one` and `_other` for a count. */
function translatorOf(table: Record<string, unknown>): ExtraAskTranslate {
  const find = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        table
      );
  return (key, args) => {
    const count = args?.['count'];
    const plural =
      typeof count === 'number'
        ? find(`${key}_${count === 1 ? 'one' : 'other'}`)
        : undefined;
    const found = typeof plural === 'string' ? plural : find(key);
    if (typeof found !== 'string') {
      return key;
    }
    return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(args?.[name] ?? '')
    );
  };
}

const NAMES: Record<string, string> = { 'u-marta': 'Marta', 'u-luis': 'Luis' };
const READER = 'u-me';

function words(
  locale: 'en' | 'es',
  extra: CountedExtra,
  left: number,
  unit: LineUnit = 'UNIT'
) {
  return extraAskWords({
    extra,
    left,
    unit,
    locale,
    readerId: READER,
    nameOf: (userId) => NAMES[userId] ?? null,
    t: translatorOf(locale === 'en' ? en : es),
  });
}

const marta = { userId: 'u-marta' };
const luis = { userId: 'u-luis' };
const me = { userId: READER };
const nobody = { userId: null };
/** Somebody this build has no name for, by an id it was told. */
const unnamed = { userId: 'u-gone' };

describe('extraAskWords (velista 0207)', () => {
  describe('one buyer, something left', () => {
    const extra = { above: 1, counted: 1, buyers: [marta] };

    it('names the buyer and asks about the amount set and what is left', () => {
      expect(words('es', extra, 1).question).toBe(
        `Marta ya compró 1 de más. ¿Sigues necesitando 2 o solo${NB}1?`
      );
      expect(words('en', extra, 1).question).toBe(
        `Marta already bought 1 extra. Do you still need 2, or just${NB}1?`
      );
    });

    it('draws "Still need" with the amount set and "Count the extra" with what is left', () => {
      expect(words('es', extra, 1).stillNeed).toEqual({
        words: 'Sigo necesitando',
        amount: `2${NB}uds`,
      });
      expect(words('es', extra, 1).keep).toEqual({
        words: 'Contar lo comprado de más',
        amount: `1${NB}ud`,
      });
      expect(words('en', extra, 1).stillNeed).toEqual({
        words: 'Still need',
        amount: `2${NB}units`,
      });
      expect(words('en', extra, 1).keep).toEqual({
        words: 'Count the extra',
        amount: `1${NB}unit`,
      });
    });
  });

  describe('the extra covers the raise', () => {
    const extra = { above: 1, counted: 1, buyers: [marta] };

    it('never prints 0: it asks whether that is enough', () => {
      expect(words('es', extra, 0).question).toBe(
        'Marta ya compró 1 de más. ¿Sigues necesitando 1 o con eso basta?'
      );
      expect(words('en', extra, 0).question).toBe(
        'Marta already bought 1 extra. Do you still need 1, or is that enough?'
      );
    });

    it('draws "That\'s enough" with no amount', () => {
      expect(words('es', extra, 0).keep).toEqual({
        words: 'Con eso basta',
        amount: null,
      });
      expect(words('en', extra, 0).keep).toEqual({
        words: "That's enough",
        amount: null,
      });
      expect(words('en', extra, 0).stillNeed.amount).toBe(`1${NB}unit`);
      expect(words('es', extra, 0).stillNeed.amount).toBe(`1${NB}ud`);
    });
  });

  describe('a weight', () => {
    const extra = { above: 500, counted: 500, buyers: [marta] };

    it('carries its unit everywhere, in its short form', () => {
      const spanish = words('es', extra, 1000, 'GRAM');
      expect(spanish.question).toBe(
        `Marta ya compró 500${NB}g de más. ¿Sigues necesitando 1,5${NB}kg o solo${NB}1${NB}kg?`
      );
      expect(spanish.stillNeed.amount).toBe(`1,5${NB}kg`);
      expect(spanish.keep.amount).toBe(`1${NB}kg`);

      const english = words('en', extra, 1000, 'GRAM');
      expect(english.question).toBe(
        `Marta already bought 500${NB}g extra. Do you still need 1.5${NB}kg, or just${NB}1${NB}kg?`
      );
      expect(english.stillNeed.amount).toBe(`1.5${NB}kg`);
      expect(english.keep.amount).toBe(`1${NB}kg`);
    });
  });

  describe('who is named', () => {
    const sentence = (
      locale: 'en' | 'es',
      buyers: CountedExtra['buyers'],
      above = 2
    ) =>
      words(locale, { above, counted: 1, buyers }, 1).question.split(
        /(?<=\.) /
      )[0];

    it('says "You" for the reader', () => {
      expect(sentence('es', [me], 1)).toBe('Ya compraste 1 de más.');
      expect(sentence('en', [me], 1)).toBe('You already bought 1 extra.');
    });

    it('says "Someone" for a buyer this reader cannot be told about, or whose name is unknown', () => {
      for (const buyer of [nobody, unnamed]) {
        expect(sentence('es', [buyer], 1)).toBe('Alguien ya compró 1 de más.');
        expect(sentence('en', [buyer], 1)).toBe(
          'Someone already bought 1 extra.'
        );
      }
    });

    it('names two buyers in the order of the answer', () => {
      expect(sentence('es', [marta, luis])).toBe(
        'Marta y Luis ya compraron 2 de más.'
      );
      expect(sentence('en', [marta, luis])).toBe(
        'Marta and Luis already bought 2 extra.'
      );
      expect(sentence('en', [luis, marta])).toBe(
        'Luis and Marta already bought 2 extra.'
      );
    });

    it('puts the reader first beside a named buyer (spec 17)', () => {
      for (const buyers of [
        [me, luis],
        [luis, me],
      ]) {
        expect(sentence('es', buyers)).toBe(
          'Tú y Luis ya comprasteis 2 de más.'
        );
        expect(sentence('en', buyers)).toBe(
          'You and Luis already bought 2 extra.'
        );
      }
    });

    it('puts the named buyer first beside one who has no name (spec 17)', () => {
      for (const buyers of [
        [luis, nobody],
        [nobody, luis],
        [unnamed, luis],
      ]) {
        expect(sentence('es', buyers)).toBe(
          'Luis y otra persona ya compraron 2 de más.'
        );
        expect(sentence('en', buyers)).toBe(
          'Luis and someone else already bought 2 extra.'
        );
      }
    });

    it('says "You and someone else" beside a buyer who has no name', () => {
      for (const buyers of [
        [me, nobody],
        [nobody, me],
      ]) {
        expect(sentence('es', buyers)).toBe(
          'Tú y otra persona ya comprasteis 2 de más.'
        );
        expect(sentence('en', buyers)).toBe(
          'You and someone else already bought 2 extra.'
        );
      }
    });

    it('says "Someone" for two buyers neither of whom can be named', () => {
      expect(sentence('es', [unnamed, nobody])).toBe(
        'Alguien ya compró 2 de más.'
      );
      expect(sentence('en', [unnamed, nobody])).toBe(
        'Someone already bought 2 extra.'
      );
    });

    it('counts three buyers or more, every one of them known', () => {
      const three = words(
        'es',
        { above: 2, counted: 2, buyers: [marta, luis, me] },
        1
      );
      expect(three.question).toBe(
        `3 personas ya compraron 2 de más. ¿Sigues necesitando 3 o solo${NB}1?`
      );
      expect(
        words('en', { above: 2, counted: 2, buyers: [marta, luis, unnamed] }, 1)
          .question
      ).toBe(
        `3 people already bought 2 extra. Do you still need 3, or just${NB}1?`
      );
    });

    it('never counts people it cannot count: with an unknown among three entries it names up to two and "others"', () => {
      expect(sentence('es', [marta, luis, nobody])).toBe(
        'Marta, Luis y otras personas ya compraron 2 de más.'
      );
      expect(sentence('en', [marta, luis, nobody])).toBe(
        'Marta, Luis and others already bought 2 extra.'
      );
      // One named, in the order of the buyers.
      expect(sentence('es', [unnamed, luis, nobody])).toBe(
        'Luis y otras personas ya compraron 2 de más.'
      );
      expect(sentence('en', [nobody, luis, unnamed])).toBe(
        'Luis and others already bought 2 extra.'
      );
      // Never more than two names; the reader is one of the others.
      expect(
        sentence('en', [{ userId: 'u-ana' }, marta, me, luis, nobody])
      ).toBe('Marta, Luis and others already bought 2 extra.');
    });

    it('says "Someone" for three entries or more with an unknown and nobody named', () => {
      expect(sentence('es', [unnamed, me, nobody])).toBe(
        'Alguien ya compró 2 de más.'
      );
      expect(sentence('en', [unnamed, me, nobody])).toBe(
        'Someone already bought 2 extra.'
      );
    });
  });
});
