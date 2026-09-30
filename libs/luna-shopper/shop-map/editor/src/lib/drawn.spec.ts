import {
  drawingOf,
  inkOn,
  isProduceSection,
  onWalkway,
  openLongSides,
  servedSide,
} from './drawn';

/** A walkway ring around a box, clockwise as drawn. */
const ring = (x: number, y: number, w: number, h: number) => [
  [x, y] as [number, number],
  [x + w, y] as [number, number],
  [x + w, y + h] as [number, number],
  [x, y + h] as [number, number],
];

/** Velista plan 0128: what the drawn look draws, and where. */
describe('the drawn shopper look', () => {
  describe('isProduceSection', () => {
    it.each([
      'Frutería',
      'fruteria',
      'Fruta y verdura',
      'Frutas y verduras',
      'Verdulería',
      'Fruit and vegetables',
      'Produce',
      '  FRUTA ',
    ])('takes %p for fruit and vegetables', (name) => {
      expect(isProduceSection(name)).toBe(true);
    });

    it.each(['Zumos de fruta', 'Frutos secos', 'Lácteos', '', undefined])(
      'does not take %p',
      (name) => {
        expect(isProduceSection(name)).toBe(false);
      }
    );
  });

  describe('drawingOf', () => {
    it('draws from the kind', () => {
      expect(drawingOf({ kind: 'shelf' })).toBe('shelf');
      expect(drawingOf({ kind: 'counter' })).toBe('counter');
      expect(drawingOf({ kind: 'checkout' })).toBe('till');
      expect(drawingOf({ kind: 'entrance' })).toBe('door');
      expect(drawingOf({ kind: 'blocked' })).toBeNull();
    });

    it('draws a crate for a fruit and vegetables section, shelf or counter', () => {
      expect(drawingOf({ kind: 'shelf', section: 'Frutería' })).toBe('crate');
      expect(drawingOf({ kind: 'counter', section: 'Fruta' })).toBe('crate');
      expect(drawingOf({ kind: 'shelf', section: 'Lácteos' })).toBe('shelf');
    });
  });

  describe('where on the area', () => {
    const shelf = { x: 1, y: 2, w: 6, h: 1 };

    it('knows the walkway by the even odd rule, holes included', () => {
      const walkway = [ring(0, 0, 10, 10), ring(1, 2, 6, 1).reverse()];
      expect(onWalkway(walkway, 0.5, 0.5)).toBe(true);
      expect(onWalkway(walkway, 3, 2.5)).toBe(false);
      expect(onWalkway(walkway, 11, 5)).toBe(false);
    });

    it('draws products on both long sides of a shelf in the middle of the floor', () => {
      expect(openLongSides(shelf, [ring(0, 0, 10, 10)])).toEqual([
        'top',
        'bottom',
      ]);
    });

    it('draws products on the aisle side only of a wall shelf', () => {
      // The walkway runs below the shelf only.
      expect(openLongSides(shelf, [ring(0, 3, 10, 7)])).toEqual(['bottom']);
      expect(
        openLongSides({ x: 0, y: 1, w: 1, h: 5 }, [ring(1, 0, 9, 9)])
      ).toEqual(['right']);
    });

    it('puts a counter’s glass on the side the walkway runs along', () => {
      const bounds = { x: 0, y: 0, w: 10, h: 10 };
      expect(servedSide(shelf, bounds, [ring(0, 3, 10, 7)])).toBe('bottom');
      expect(servedSide(shelf, bounds, [ring(0, 0, 10, 2)])).toBe('top');
      // Walkway on both sides: the side farther from the shop's edge.
      expect(
        servedSide({ x: 1, y: 8, w: 4, h: 1 }, bounds, [ring(0, 0, 10, 10)])
      ).toBe('top');
    });
  });

  describe('inkOn', () => {
    it('writes light on a dark colour and dark on a light one', () => {
      expect(inkOn('#c0392b')).toBe('light');
      expect(inkOn('#1d3d63')).toBe('light');
      expect(inkOn('#f1e4cb')).toBe('dark');
      expect(inkOn('#ffe066')).toBe('dark');
    });
  });
});
