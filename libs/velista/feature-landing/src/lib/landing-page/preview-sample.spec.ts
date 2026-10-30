import { PREVIEW_SAMPLE, previewTallies } from './preview-sample';

/** Velista 0175, targets 5 and 6: the count describes the rows drawn. */
describe('previewTallies', () => {
  it('says 3 of 4 for the full card, 2 of 3 and 1 of 2 as rows give way', () => {
    expect(
      previewTallies(PREVIEW_SAMPLE).map(({ givenWay, rows, pending }) => [
        givenWay,
        rows,
        pending,
      ])
    ).toEqual([
      [0, 4, 3],
      [1, 3, 2],
      [2, 2, 1],
    ]);
  });

  it('totals only the pending rows that are drawn', () => {
    expect(previewTallies(PREVIEW_SAMPLE).map((tally) => tally.total)).toEqual([
      14.88, 11.3, 8.95,
    ]);
  });

  it('fills the bar to the share of drawn rows that are settled', () => {
    expect(
      previewTallies(PREVIEW_SAMPLE).map((tally) => tally.settledShare)
    ).toEqual([1 / 4, 1 / 3, 1 / 2]);
  });

  it('keeps the bought row and the one the shop did not have to the end', () => {
    const staying = PREVIEW_SAMPLE.filter((line) => line.givesWay === null);

    expect(staying.map((line) => line.indicator)).toEqual([
      'bought',
      'notAvailable',
    ]);
  });
});
