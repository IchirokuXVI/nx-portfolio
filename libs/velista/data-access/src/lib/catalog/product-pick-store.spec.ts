import {
  ProductPickStore,
  type ProductPickRequest,
} from './product-pick-store';

const REQUEST: ProductPickRequest = {
  kind: 'one',
  lineId: 'zl-1',
  forLabel: 'For Cocina',
  forDetail: 'Leche para el café',
  chosenId: 'milk',
  returnUrl: '/en/shopping-lists/live/sheet/rows/zl-1/change/zl-1',
  returnDepth: 2,
  callerState: { keep: false },
};

describe('ProductPickStore', () => {
  it('opens with the product the caller had chosen', () => {
    const store = new ProductPickStore();

    store.open(REQUEST);

    expect(store.request()).toBe(REQUEST);
    expect(store.chosen()).toBe('milk');
  });

  it('keeps the product chosen so far until it is used', () => {
    const store = new ProductPickStore();
    store.open(REQUEST);

    store.choose('oat');
    expect(store.chosen()).toBe('oat');

    expect(store.use()).toBe(true);
    expect(store.request()).toBeNull();
    expect(store.takeAnswer('zl-1')).toEqual({
      lineId: 'zl-1',
      itemId: 'oat',
      callerState: { keep: false },
    });
  });

  it('answers once, and only for its line', () => {
    const store = new ProductPickStore();
    store.open(REQUEST);
    store.use();

    expect(store.takeAnswer('zl-2')).toBeNull();
    expect(store.takeAnswer('zl-1')).not.toBeNull();
    expect(store.takeAnswer('zl-1')).toBeNull();
  });

  it('answers a close with no product and the caller state as it was', () => {
    const store = new ProductPickStore();
    store.open(REQUEST);
    store.choose('oat');

    store.cancel();

    expect(store.request()).toBeNull();
    expect(store.takeAnswer('zl-1')).toEqual({
      lineId: 'zl-1',
      itemId: null,
      callerState: { keep: false },
    });
  });

  it('cannot use a choice with no request or nothing chosen', () => {
    const store = new ProductPickStore();
    expect(store.use()).toBe(false);

    store.open({ ...REQUEST, chosenId: null });
    expect(store.use()).toBe(false);
    expect(store.request()).not.toBeNull();
  });

  describe('the kind that chooses the set of a line (velista 0146)', () => {
    const SET: ProductPickRequest = {
      ...REQUEST,
      kind: 'set',
      chosenId: null,
      chosenIds: ['oat', 'soy'],
    };

    it('opens with the products of the line ticked', () => {
      const store = new ProductPickStore();

      store.open(SET);

      expect(store.ticked()).toEqual(['oat', 'soy']);
    });

    it('keeps the set ticked so far until it ends, with no answer', () => {
      const store = new ProductPickStore();
      store.open(SET);

      store.tick(['soy', 'rice']);
      expect(store.ticked()).toEqual(['soy', 'rice']);

      store.end();
      expect(store.request()).toBeNull();
      expect(store.ticked()).toEqual([]);
      expect(store.takeAnswer('zl-1')).toBeNull();
    });

    it('opens the kind one with nothing ticked', () => {
      const store = new ProductPickStore();
      store.open(SET);

      store.open(REQUEST);

      expect(store.ticked()).toEqual([]);
    });
  });
});
