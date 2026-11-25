import { ChangeLandingStore } from './change-landing-store';

describe('ChangeLandingStore (velista 0200)', () => {
  it('answers the landing held for its row and line, and keeps it until released', () => {
    const store = new ChangeLandingStore();
    const landing = { rowKey: 'zl-1', lineId: 'zl-1', depth: 2, sheetDepth: 5 };
    store.hold(landing);

    expect(store.landingFor('zl-1', 'zl-1')).toBe(landing);
    // Read, not taken: the sheet reads it again back from the catalog.
    expect(store.landingFor('zl-1', 'zl-1')).toBe(landing);

    store.release(landing);
    expect(store.landingFor('zl-1', 'zl-1')).toBeNull();
  });

  it.each([
    ['another row', 'zl-9', 'zl-1'],
    ['another line', 'zl-1', 'zl-2'],
    ['all lists', 'zl-1', null],
  ])('answers null for %s', (_name, rowKey, lineId) => {
    const store = new ChangeLandingStore();
    store.hold({ rowKey: 'zl-1', lineId: 'zl-1', depth: 2, sheetDepth: 5 });
    expect(store.landingFor(rowKey, lineId)).toBeNull();
  });

  it('keeps a landing held since for another sheet when an old one is released', () => {
    const store = new ChangeLandingStore();
    const old = { rowKey: 'zl-1', lineId: 'zl-1', depth: 2, sheetDepth: 5 };
    const next = { rowKey: 'zl-1', lineId: null, depth: 2, sheetDepth: 5 };
    store.hold(old);
    store.hold(next);

    store.release(old);
    expect(store.landingFor('zl-1', null)).toBe(next);
  });

  describe('the basket page under a sheet (velista 0208)', () => {
    const BASKET = { basketId: 'b-1' } as const;
    const ROW = { rowKey: 'row-milk', entries: [{ lineId: 'zl-1' }] };

    it.each([
      ['warm', 2],
      ['cold, on the entry the document loaded on', -1],
    ])(
      'answers the page one entry below the view it pushed, %s',
      (_name, page) => {
        const store = new ChangeLandingStore();
        expect(store.pageBelow(BASKET, ROW, page + 1)).toBeNull();

        store.notePage(BASKET, ROW, page);
        expect(store.pageBelow(BASKET, ROW, page + 1)).toBe(page);
        // Read, not taken: asked again after a catalog round trip.
        expect(store.pageBelow(BASKET, ROW, page + 1)).toBe(page);
      }
    );

    it('answers the page two entries below the view the row sheet pushed', () => {
      const store = new ChangeLandingStore();
      store.notePage(BASKET, ROW, 0);
      // The row's sheet on 1, this view on 2.
      expect(store.pageBelow(BASKET, ROW, 2)).toBe(0);
    });

    it.each([
      ['on the page itself', 2],
      ['below the page', 1],
      ['three entries above it', 5],
    ])('answers null for a view %s', (_name, sheetDepth) => {
      const store = new ChangeLandingStore();
      store.notePage(BASKET, ROW, 2);
      expect(store.pageBelow(BASKET, ROW, sheetDepth)).toBeNull();
    });

    it.each([
      [
        'another row',
        BASKET,
        { rowKey: 'row-bread', entries: [{ lineId: 'zl-7' }] },
      ],
      ['another basket', { basketId: 'b-2' }, ROW],
      ['the live basket', 'live' as const, ROW],
      ['no basket read yet', null, ROW],
    ])('answers null for %s at the same depths', (_name, address, asking) => {
      const store = new ChangeLandingStore();
      store.notePage(BASKET, ROW, 2);
      expect(store.pageBelow(address, asking, 3)).toBeNull();
      expect(store.pageBelow(address, asking, 4)).toBeNull();
    });

    it('answers for the row whose key moved, by a line of it', () => {
      const store = new ChangeLandingStore();
      store.notePage(BASKET, ROW, 2);
      expect(
        store.pageBelow(
          BASKET,
          { rowKey: 'row-milk-2', entries: [{ lineId: 'zl-1' }] },
          3
        )
      ).toBe(2);
    });

    it('keeps the notes of entries below a later push, and drops those above it', () => {
      const store = new ChangeLandingStore();
      const bread = { rowKey: 'row-bread', entries: [{ lineId: 'zl-7' }] };
      // The page on 0 opened milk's view on 1; back on the page, the person
      // walks on and the basket page is pushed again on 4, which opens bread's.
      store.notePage(BASKET, ROW, 0);
      store.notePage(BASKET, bread, 4);
      expect(store.pageBelow(BASKET, ROW, 1)).toBe(0);
      expect(store.pageBelow(BASKET, bread, 5)).toBe(4);

      // A push from the page on 0 again replaces every entry above it.
      store.notePage(BASKET, bread, 0);
      expect(store.pageBelow(BASKET, ROW, 1)).toBeNull();
      expect(store.pageBelow(BASKET, bread, 5)).toBeNull();
      expect(store.pageBelow(BASKET, bread, 1)).toBe(0);
    });

    it('a reload starts with no note', () => {
      expect(new ChangeLandingStore().pageBelow(BASKET, ROW, 0)).toBeNull();
    });
  });

  describe('claim', () => {
    // The basket page at 0, the row's sheet 1, the view 2: the sheet goes on 3.
    const LANDING = { rowKey: 'zl-1', lineId: null, depth: 0, sheetDepth: 3 };

    it('gives the landing to the sheet on the entry it was held for, and keeps it', () => {
      const store = new ChangeLandingStore();
      store.hold(LANDING);
      // Pushed there from the view, or popped back onto it from the catalog.
      expect(store.claim('zl-1', null, 3)).toBe(LANDING);
      expect(store.landingFor('zl-1', null)).toBe(LANDING);
    });

    it.each([
      [
        'opened by the basket page after the catalog was left by its tab bar',
        7,
      ],
      ['popped onto an entry under the one held', 2],
      ['that replaced the catalog one entry above', 4],
    ])('lets the landing go for a sheet %s', (_name, sheetDepth) => {
      const store = new ChangeLandingStore();
      store.hold(LANDING);
      expect(store.claim('zl-1', null, sheetDepth)).toBeNull();
      expect(store.landingFor('zl-1', null)).toBeNull();
    });

    it('answers null and keeps the landing of another line', () => {
      const store = new ChangeLandingStore();
      store.hold(LANDING);
      expect(store.claim('zl-1', 'zl-1', 3)).toBeNull();
      expect(store.landingFor('zl-1', null)).toBe(LANDING);
    });
  });
});
