import { appendPage } from './resource-pagination';

interface Row {
  id: string;
  name: string;
}

const idOf = (row: Row) => row.id;

describe('appendPage', () => {
  /**
   * The defect this exists for (plan 0004, section 4): a cursor timestamp loses
   * microseconds, so a row can come back on both sides of a page boundary.
   */
  it('shows a row that repeats across a page boundary once', () => {
    const first: Row[] = [
      { id: 'a', name: 'Aldi' },
      { id: 'b', name: 'Bonpreu' },
    ];
    const second: Row[] = [
      { id: 'b', name: 'Bonpreu' },
      { id: 'c', name: 'Consum' },
    ];

    expect(appendPage(first, second, idOf).map(idOf)).toEqual(['a', 'b', 'c']);
  });

  /**
   * The copy already on screen wins, so a row the operator is looking at does
   * not move or redraw when the next page lands under it.
   */
  it('keeps the copy already shown', () => {
    const shown: Row[] = [{ id: 'b', name: 'Bonpreu' }];
    const page: Row[] = [{ id: 'b', name: 'Bonpreu, renamed' }];

    expect(appendPage(shown, page, idOf)).toEqual([
      { id: 'b', name: 'Bonpreu' },
    ]);
  });

  it('drops a row with no id, which nothing could open anyway', () => {
    const page: Row[] = [
      { id: '', name: 'nameless' },
      { id: 'c', name: 'Consum' },
    ];

    expect(appendPage([], page, idOf).map(idOf)).toEqual(['c']);
  });

  it('leaves the shown rows alone', () => {
    const shown: Row[] = [{ id: 'a', name: 'Aldi' }];
    appendPage(shown, [{ id: 'b', name: 'Bonpreu' }], idOf);

    expect(shown).toHaveLength(1);
  });
});
