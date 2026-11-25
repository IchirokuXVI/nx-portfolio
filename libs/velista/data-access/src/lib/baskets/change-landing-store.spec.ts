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
