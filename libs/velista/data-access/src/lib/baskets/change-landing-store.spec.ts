import { ChangeLandingStore } from './change-landing-store';

describe('ChangeLandingStore (velista 0200)', () => {
  it('answers the landing held for its row and line, and keeps it until released', () => {
    const store = new ChangeLandingStore();
    const landing = { rowKey: 'zl-1', lineId: 'zl-1', depth: 2 };
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
    store.hold({ rowKey: 'zl-1', lineId: 'zl-1', depth: 2 });
    expect(store.landingFor(rowKey, lineId)).toBeNull();
  });

  it('keeps a landing held since for another sheet when an old one is released', () => {
    const store = new ChangeLandingStore();
    const old = { rowKey: 'zl-1', lineId: 'zl-1', depth: 2 };
    const next = { rowKey: 'zl-1', lineId: null, depth: 2 };
    store.hold(old);
    store.hold(next);

    store.release(old);
    expect(store.landingFor('zl-1', null)).toBe(next);
  });
});
