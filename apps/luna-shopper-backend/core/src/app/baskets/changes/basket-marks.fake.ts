import { NO_BASKET_MARKS, type BasketMarksReader } from './basket-marks.reader';

/**
 * A marks reader that answers "nothing has changed" (plan 0138).
 *
 * The basket read asks it on every participant read, and most specs of that read
 * are about a row's arithmetic rather than about what moved since somebody looked.
 * A stand in keeps those specs off the change table entirely, and the reads that
 * are about the marks use the real one against Postgres, which is the only thing
 * that can answer a comparison of four database times.
 */
export function fakeBasketMarks(): BasketMarksReader {
  return {
    marksFor: async () => NO_BASKET_MARKS,
    countFor: async () => 0,
    markWindow: 10 * 60 * 1000,
    retention: 30 * 24 * 60 * 60 * 1000,
  } as unknown as BasketMarksReader;
}
