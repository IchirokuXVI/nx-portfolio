import { replayRows } from './replay';

describe('replayRows', () => {
  it('merges every stream in t order, ties in stream order', () => {
    const seen: string[] = [];

    replayRows(
      {
        streams: {
          motion: [
            [0, 0, 0, 9.8, 0, 0, 0],
            [10, 0, 0, 9.8, 0, 0, 0],
            [20, 0, 0, 9.8, 0, 0, 0],
          ],
          game: [
            [10, 0, 0, 0, 1],
            [15, 0, 0, 0, 1],
          ],
          steps: [12],
          magnetic: [[1, 2, 3, 4]],
        },
      },
      (stream, row) =>
        seen.push(`${stream}@${typeof row === 'number' ? row : row[0]}`)
    );

    expect(seen).toEqual([
      'motion@0',
      'motion@10',
      'game@10',
      'steps@12',
      'game@15',
      'motion@20',
    ]);
  });

  it('does nothing for an empty walk', () => {
    const push = jest.fn();
    replayRows({ streams: {} }, push);
    expect(push).not.toHaveBeenCalled();
  });
});
