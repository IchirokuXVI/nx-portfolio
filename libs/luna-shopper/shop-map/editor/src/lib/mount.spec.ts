import type {
  MapArea,
  ShopMapDocumentV2,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import { LONG_PRESS_MS, mountShopMap } from './mount';
import type { ShopMapHandle } from './types';
import { fitView, toScreen, type View } from './viewport';

const SIZE = 400;

function area(id: string, extra: Partial<MapArea> = {}): MapArea {
  return {
    id,
    kind: 'shelf',
    x: 0,
    y: 0,
    w: 1,
    h: 4,
    colour: { mode: 'default' },
    origin: 'drawn',
    ...extra,
  };
}

/** Two shelves, a counter with a custom colour, an entrance and a walked aisle, 10 by 10 m. */
const doc: ShopMapDocumentV2 = {
  version: 2,
  areas: [
    area('a1', { x: 1, y: 2, section: 'Lácteos' }),
    area('a2', { x: 6, y: 2, section: 'Congelados' }),
    area('a3', {
      kind: 'counter',
      x: 0,
      y: 8,
      w: 2,
      h: 1,
      section: 'Horno',
      colour: { mode: 'custom', value: '#c0392b' },
    }),
    area('a4', { kind: 'entrance', x: 8, y: 9, w: 2, h: 1, label: 'Way in' }),
    area('p1', { kind: 'path', x: 0, y: 0, w: 10, h: 10 }),
  ],
  marks: [
    {
      id: 'm1',
      kind: 'section',
      x: 3,
      y: 3,
      heading: 90,
      text: 'Lácteos',
      logMs: 1000,
    },
    {
      id: 'm2',
      kind: 'note',
      x: 4,
      y: 7,
      heading: 0,
      text: 'Bread',
      logMs: 5000,
    },
  ],
  path: [
    {
      points: [
        [3.5, 1],
        [3.5, 9],
      ],
    },
  ],
};

let host: HTMLElement;
let handle: ShopMapHandle | null = null;

beforeAll(() => {
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    right: SIZE,
    bottom: SIZE,
    toJSON: () => ({}),
  } as DOMRect);
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  host.remove();
  jest.useRealTimers();
});

/** The view a fresh mount of `doc` in the mapper look fits to. */
const mapperView = (): View =>
  fitView({ x: 0, y: 0, w: 10, h: 10 }, SIZE, SIZE);

const canvas = () => host.querySelector('svg') as SVGSVGElement;

function pointer(
  type: string,
  [x, y]: [number, number],
  id = 1,
  pointerType = 'touch'
) {
  const e = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    button: 0,
  });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  canvas().dispatchEvent(e);
}

/** A metre point in css pixels, under the mapper look's fitted view. */
const at = (x: number, y: number) => toScreen(mapperView(), x, y);

function drag(from: [number, number], to: [number, number]) {
  pointer('pointerdown', from);
  pointer('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  pointer('pointermove', to);
  pointer('pointerup', to);
}

describe('mountShopMap, drawing', () => {
  it('draws the mapper look: ground, grid, walked floor, areas, labels and pins', () => {
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    expect(host.querySelector('.sm-root')).not.toBeNull();
    expect(host.querySelectorAll('rect.sm-area')).toHaveLength(4);
    expect(host.querySelector('rect.sm-ground')?.getAttribute('display')).toBe(
      'inline'
    );
    expect(host.querySelector('path.sm-walked')?.getAttribute('d')).not.toBe(
      ''
    );
    expect(
      [...host.querySelectorAll('text.sm-label')].map((t) => t.textContent)
    ).toEqual(['Lácteos', 'Congelados', 'Horno']);
    expect(host.querySelectorAll('circle.sm-pin')).toHaveLength(1);
    expect(host.querySelectorAll('rect.sm-note')).toHaveLength(1);
    expect(document.getElementById('shop-map-editor-styles')).not.toBeNull();
  });

  it('draws a custom colour as the fill with a border 40 percent darker', () => {
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    const counter = host.querySelector('rect.sm-counter') as SVGRectElement;
    expect(counter.getAttribute('style')).toBe('fill:#c0392b;stroke:#73221a');
  });

  it('draws the shopper look with no grid, rounded areas, badges and the entrance chip', () => {
    handle = mountShopMap(host, {
      document: doc,
      look: 'shopper',
      labelOf: (a) => (a.kind === 'entrance' ? 'Entrance' : (a.section ?? '')),
    });
    handle.setBadges({
      Lácteos: { count: 2, done: false },
      Congelados: { count: 1, done: true },
    });
    expect(host.querySelector('rect.sm-ground')?.getAttribute('display')).toBe(
      'none'
    );
    expect(host.querySelectorAll('rect.sm-area')).toHaveLength(3);
    expect(host.querySelector('rect.sm-area')?.getAttribute('rx')).toBe('6');
    expect(host.querySelectorAll('rect.sm-badge')).toHaveLength(2);
    expect(host.querySelectorAll('rect.sm-badge.sm-done')).toHaveLength(1);
    expect(host.querySelector('path.sm-badge-tick')).not.toBeNull();
    expect(host.querySelector('text.sm-entrance-text')?.textContent).toBe(
      'Entrance'
    );
    const walkway = host.querySelector('path[fill-rule="evenodd"]');
    expect(walkway?.getAttribute('fill')).toMatch(/^url\(#sm\d+-dots\)$/);
    // Horno has no badge while others do, so its label is dimmed.
    const dim = [...host.querySelectorAll('text.sm-dim')].map(
      (t) => t.textContent
    );
    expect(dim).toEqual(['Horno']);
  });

  it('switches looks and fits again', () => {
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    handle.setLook('shopper');
    expect(host.querySelectorAll('circle.sm-pin')).toHaveLength(0);
    handle.setLook('mapper');
    expect(host.querySelectorAll('circle.sm-pin')).toHaveLength(1);
  });

  it('draws live walking: suggestions, the person and the unconfirmed path', () => {
    handle = mountShopMap(host, {
      document: doc,
      look: 'mapper',
      suggestionLabel: 'Estante?',
    });
    handle.setLive({
      snapshot: {
        walkedCells: [{ x: 18, y: 18 }],
        suggestions: [{ id: 'sg1', x: 4, y: 2, w: 1, h: 4 }],
        sectionRun: null,
        events: [],
      },
      person: { x: 3.5, y: 5, heading: 180 },
      unconfirmed: [
        [3.5, 5],
        [3.5, 8],
      ],
    });
    expect(host.querySelectorAll('rect.sm-sug')).toHaveLength(1);
    expect(host.querySelector('text.sm-sug-label')?.textContent).toBe(
      'Estante?'
    );
    expect(host.querySelector('circle.sm-person')).not.toBeNull();
    expect(host.querySelector('path.sm-unconfirmed')?.getAttribute('d')).toBe(
      'M3.5 5L3.5 8'
    );
    handle.setLive(null);
    expect(host.querySelector('circle.sm-person')).toBeNull();
  });

  it('fades the marks after a rewind point', () => {
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    handle.setFadedAfter(2000);
    expect(host.querySelectorAll('g.sm-faded')).toHaveLength(1);
    handle.setFadedAfter(null);
    expect(host.querySelectorAll('g.sm-faded')).toHaveLength(0);
  });

  it('fades areas and floor the log does not hold yet', () => {
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    const log = [
      {
        id: 'e1',
        seq: 1,
        kind: 'started' as const,
        at: '2026-09-29T10:00:00Z',
        logFrom: 0,
        logTo: 2000,
        events: [
          {
            type: 'path' as const,
            points: [
              [0, 3.5, 1],
              [2000, 3.5, 5],
            ] as [number, number, number][],
          },
          { type: 'area-put' as const, area: doc.areas[0] },
        ],
      },
    ];
    handle.setFadedAfter(2500, log);
    const fadedAreas = [...host.querySelectorAll('rect.sm-area.sm-faded')];
    expect(fadedAreas).toHaveLength(3);
    expect(host.querySelectorAll('g.sm-faded path.sm-walked')).toHaveLength(1);
  });

  it('shows handles and the size of a selected area', () => {
    handle = mountShopMap(host, {
      document: doc,
      look: 'mapper',
      sizeLabel: (w, h) => `${w} x ${h}`,
    });
    handle.setSelected('a1');
    expect(host.querySelectorAll('rect.sm-handle')).toHaveLength(4);
    expect(host.querySelector('text.sm-tag-text')?.textContent).toBe('1 x 4');
    handle.setSelected(null);
    expect(host.querySelectorAll('rect.sm-handle')).toHaveLength(0);
  });

  it('takes the theme from the closest data-theme, and follows it when it changes', async () => {
    const page = document.createElement('div');
    page.dataset['theme'] = 'night';
    document.body.appendChild(page);
    page.appendChild(host);
    host.dataset['theme'] = 'day';
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    const root = host.querySelector('.sm-root') as HTMLElement;
    expect(root.dataset['smTheme']).toBe('day');
    delete host.dataset['theme'];
    await Promise.resolve();
    expect(root.dataset['smTheme']).toBe('night');
    delete page.dataset['theme'];
    handle.setLook('mapper');
    expect(root.dataset['smTheme']).toBeUndefined();
    // A host moved under another theme catches up on its next document.
    const day = document.createElement('div');
    day.dataset['theme'] = 'day';
    document.body.appendChild(day);
    day.appendChild(host);
    handle.setDocument(doc);
    expect(root.dataset['smTheme']).toBe('day');
    day.remove();
    const css = document.getElementById('shop-map-editor-styles')?.textContent;
    expect(css).toContain('.sm-root[data-sm-theme="day"]{');
    expect(css).not.toContain('[data-theme="night"] .sm-root');
    handle.destroy();
    handle = null;
    page.remove();
  });

  it('cleans up on destroy', () => {
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    handle.destroy();
    handle = null;
    expect(host.children).toHaveLength(0);
    expect(document.getElementById('shop-map-editor-styles')).toBeNull();
  });
});

describe('mountShopMap, the mapper gestures', () => {
  it('draws a rectangle of the chosen kind with a tap and drag on the floor', () => {
    const onChange = jest.fn<void, [WalkEvent[]]>();
    const onSelect = jest.fn();
    handle = mountShopMap(host, {
      document: doc,
      look: 'mapper',
      onChange,
      onSelect,
      createId: () => 'new1',
    });
    handle.setDrawKind('blocked');
    handle.setSnap(true);
    drag(at(2.6, 0.4), at(4.4, 1.6));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [event] = onChange.mock.calls[0][0];
    expect(event).toEqual({
      type: 'area-put',
      area: {
        id: 'new1',
        kind: 'blocked',
        x: 2.5,
        y: 0.5,
        w: 2,
        h: 1,
        colour: { mode: 'default' },
        origin: 'drawn',
      },
    });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new1' })
    );
    expect(host.querySelectorAll('rect.sm-handle')).toHaveLength(4);
  });

  it('selects an area with a tap, and clears the selection with a tap on the floor', () => {
    const onSelect = jest.fn();
    handle = mountShopMap(host, { document: doc, look: 'mapper', onSelect });
    pointer('pointerdown', at(1.5, 3));
    pointer('pointerup', at(1.5, 3));
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'a1' })
    );
    pointer('pointerdown', at(4.5, 0.5), 1);
    pointer('pointerup', at(4.5, 0.5), 1);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('resizes by a corner handle, snapped when the switch is on', () => {
    const onChange = jest.fn<void, [WalkEvent[]]>();
    // Three metres wide, so its handles are big enough on screen to grab.
    const wide = area('a1', { x: 1, y: 2, w: 3, section: 'Lácteos' });
    handle = mountShopMap(host, {
      document: { ...doc, areas: [wide, ...doc.areas.slice(1)] },
      look: 'mapper',
      onChange,
    });
    handle.setSelected('a1');
    handle.setSnap(true);
    // The bottom right corner is (4, 6); drag it to (4.9, 7.1).
    drag(at(4, 6), at(4.9, 7.1));
    const put = onChange.mock.calls[0][0][0];
    expect(put).toEqual({
      type: 'area-put',
      area: { ...wide, x: 1, y: 2, w: 4, h: 5 },
    });
  });

  describe('a small area (a1 is one metre wide, under 40 css pixels)', () => {
    const corner = () => at(2, 6);

    it('moves from a press inside it, even near a corner', () => {
      const onChange = jest.fn<void, [WalkEvent[]]>();
      handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
      handle.setSelected('a1');
      // Inside the corner's touch target, outside its drawn square.
      const from: [number, number] = [corner()[0] - 12, corner()[1] - 12];
      const s = mapperView().s;
      drag(from, [from[0] + s, from[1] + s / 2]);
      expect(onChange.mock.calls[0][0][0]).toEqual({
        type: 'area-put',
        area: { ...doc.areas[0], x: 2, y: 2.5 },
      });
    });

    it('resizes from a press just outside its corner', () => {
      const onChange = jest.fn<void, [WalkEvent[]]>();
      handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
      handle.setSelected('a1');
      handle.setSnap(true);
      drag([corner()[0] + 12, corner()[1] + 12], at(2.9, 7.1));
      expect(onChange.mock.calls[0][0][0]).toEqual({
        type: 'area-put',
        area: { ...doc.areas[0], x: 1, y: 2, w: 2, h: 5 },
      });
    });

    it('resizes from a press on the drawn handle inside it', () => {
      const onChange = jest.fn<void, [WalkEvent[]]>();
      handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
      handle.setSelected('a1');
      handle.setSnap(true);
      drag([corner()[0] - 5, corner()[1] - 5], at(2.9, 7.1));
      expect(onChange.mock.calls[0][0][0]).toEqual({
        type: 'area-put',
        area: { ...doc.areas[0], x: 1, y: 2, w: 2, h: 5 },
      });
    });
  });

  it('moves a selected area', () => {
    const onChange = jest.fn<void, [WalkEvent[]]>();
    handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
    handle.setSelected('a2');
    drag(at(6.5, 3), at(7.5, 3.5));
    expect(onChange.mock.calls[0][0][0]).toEqual({
      type: 'area-put',
      area: { ...doc.areas[1], x: 7, y: 2.5 },
    });
  });

  it('refuses a draw that overlaps a shelf and commits nothing', () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
    drag(at(0.2, 0.2), at(2.5, 4));
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('rect.sm-refused')).not.toBeNull();
    jest.advanceTimersByTime(1000);
    expect(host.querySelector('rect.sm-refused')).toBeNull();
  });

  it('clears a refused draw at once when the floor is touched again', () => {
    jest.useFakeTimers();
    handle = mountShopMap(host, { document: doc, look: 'mapper' });
    drag(at(0.2, 0.2), at(2.5, 4));
    expect(host.querySelector('rect.sm-refused')).not.toBeNull();
    jest.advanceTimersByTime(300);
    pointer('pointerdown', at(4.5, 0.5));
    expect(host.querySelector('rect.sm-refused')).toBeNull();
    expect(host.querySelectorAll('rect.sm-handle')).toHaveLength(0);
    pointer('pointerup', at(4.5, 0.5));
  });

  it('draws the area back at once when a refused move is followed by a touch', () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
    handle.setSelected('a2');
    // Onto a1, which refuses.
    drag(at(6.5, 3), at(1.5, 3));
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('rect.sm-refused')).not.toBeNull();
    const drawnAreas = () =>
      [...host.querySelectorAll('rect.sm-area.sm-shelf')].filter(
        (r) => !r.classList.contains('sm-refused')
      );
    expect(drawnAreas()).toHaveLength(1);
    jest.advanceTimersByTime(300);
    pointer('pointerdown', at(4.5, 0.5));
    expect(host.querySelector('rect.sm-refused')).toBeNull();
    expect(drawnAreas()).toHaveLength(2);
    pointer('pointerup', at(4.5, 0.5));
  });

  it('calls onSuggestion for a tapped suggestion', () => {
    const onSuggestion = jest.fn();
    handle = mountShopMap(host, {
      document: doc,
      look: 'mapper',
      onSuggestion,
    });
    handle.setLive({
      snapshot: {
        walkedCells: [],
        suggestions: [{ id: 'sg1', x: 4, y: 2, w: 1, h: 4 }],
        sectionRun: null,
        events: [],
      },
    });
    pointer('pointerdown', at(4.5, 4));
    pointer('pointerup', at(4.5, 4));
    expect(onSuggestion).toHaveBeenCalledWith('sg1');
  });

  it('asks the host for a menu after a long press, with what is under the finger', () => {
    jest.useFakeTimers();
    const onLongPress = jest.fn();
    const onChange = jest.fn();
    handle = mountShopMap(host, {
      document: doc,
      look: 'mapper',
      onLongPress,
      onChange,
    });
    const p = at(6.5, 3);
    pointer('pointerdown', p);
    jest.advanceTimersByTime(LONG_PRESS_MS - 10);
    expect(onLongPress).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20);
    expect(onLongPress).toHaveBeenCalledWith(
      { x: 6.5, y: 3 },
      expect.objectContaining({ id: 'a2' }),
      { x: p[0], y: p[1] }
    );
    pointer('pointermove', [p[0] + 40, p[1]]);
    pointer('pointerup', [p[0] + 40, p[1]]);
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('rect.sm-held')).not.toBeNull();
  });

  describe('the held square after a long press', () => {
    function longPress() {
      jest.useFakeTimers();
      handle = mountShopMap(host, { document: doc, look: 'mapper' });
      const p = at(6.5, 3);
      pointer('pointerdown', p);
      jest.advanceTimersByTime(LONG_PRESS_MS + 10);
      pointer('pointerup', p);
      expect(host.querySelector('rect.sm-held')).not.toBeNull();
      return handle;
    }

    it('goes when the host applies an action with setDocument', () => {
      longPress().setDocument({ ...doc, areas: doc.areas.slice(0, 1) });
      expect(host.querySelector('rect.sm-held')).toBeNull();
    });

    it('goes when the host selects a different area', () => {
      longPress().setSelected('a1');
      expect(host.querySelector('rect.sm-held')).toBeNull();
    });

    it('stays when the host selects the area that is already selected', () => {
      jest.useFakeTimers();
      handle = mountShopMap(host, { document: doc, look: 'mapper' });
      handle.setSelected('a2');
      const p = at(6.5, 3);
      pointer('pointerdown', p);
      jest.advanceTimersByTime(LONG_PRESS_MS + 10);
      pointer('pointerup', p);
      handle.setSelected('a2');
      expect(host.querySelector('rect.sm-held')).not.toBeNull();
    });

    it('goes when the host dismisses its menu with clearHeld', () => {
      longPress().clearHeld();
      expect(host.querySelector('rect.sm-held')).toBeNull();
    });
  });

  it('never edits with two fingers', () => {
    const onChange = jest.fn();
    handle = mountShopMap(host, { document: doc, look: 'mapper', onChange });
    const a = at(4.5, 0.5);
    const b = at(4.5, 1.5);
    pointer('pointerdown', a, 1);
    pointer('pointerdown', b, 2);
    pointer('pointermove', [a[0] - 30, a[1]], 1);
    pointer('pointermove', [b[0] + 30, b[1]], 2);
    pointer('pointerup', a, 1);
    pointer('pointerup', b, 2);
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('rect.sm-refused')).toBeNull();
  });
});

describe('mountShopMap, the shopper look', () => {
  it('calls onSection for a tapped area with a section', () => {
    const onSection = jest.fn();
    handle = mountShopMap(host, { document: doc, look: 'shopper', onSection });
    const v = (host.querySelector('g[transform]') as SVGGElement).getAttribute(
      'transform'
    ) as string;
    const [s, , , , tx, ty] =
      /matrix\(([^)]+)\)/.exec(v)?.[1].split(' ').map(Number) ?? [];
    const p: [number, number] = [6.5 * s + tx, 3 * s + ty];
    pointer('pointerdown', p);
    pointer('pointerup', p);
    expect(onSection).toHaveBeenCalledWith('Congelados');
  });
});
