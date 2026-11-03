import { PREVIEW_SAMPLE, previewTallies } from './preview-sample';

/** Velista 0175, targets 5 and 6: the count describes the rows drawn. */
describe('previewTallies', () => {
  it('says 4 of 5 for the full card, then 3 of 4, 2 of 3 and 1 of 2 as rows give way', () => {
    expect(
      previewTallies(PREVIEW_SAMPLE).map(({ givenWay, rows, pending }) => [
        givenWay,
        rows,
        pending,
      ])
    ).toEqual([
      [0, 5, 4],
      [1, 4, 3],
      [2, 3, 2],
      [3, 2, 1],
    ]);
  });

  it('totals only the pending rows that are drawn', () => {
    expect(previewTallies(PREVIEW_SAMPLE).map((tally) => tally.total)).toEqual([
      30.33, 22.84, 16.35, 9.95,
    ]);
  });

  it('fills the bar to the share of drawn rows that are settled', () => {
    expect(
      previewTallies(PREVIEW_SAMPLE).map((tally) => tally.settledShare)
    ).toEqual([1 / 5, 1 / 4, 1 / 3, 1 / 2]);
  });

  it('gives way from the last row back, so the drawn rows are always the first ones', () => {
    const steps = PREVIEW_SAMPLE.map((line) => line.givesWay ?? Infinity);

    expect([...steps].sort((a, b) => b - a)).toEqual(steps);
  });

  it('keeps a pending row and the bought row to the end', () => {
    const staying = PREVIEW_SAMPLE.filter((line) => line.givesWay === null);

    expect(staying.map((line) => line.indicator)).toEqual([null, 'bought']);
  });
});
