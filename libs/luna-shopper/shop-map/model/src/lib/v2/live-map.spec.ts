import { elJamonLive, replayElJamon } from '../__fixtures__/el-jamon-live';
import { createLiveMap, SECTION_REACH_METRES } from './live-map';
import type { LiveMapHandle, LiveSnapshot } from './live-types';
import { area, doc, mark } from './testing';
import type { MapArea, ShopMapDocumentV2, WalkEvent } from './types';
import { validateShopMapV2 } from './validate';

function live(
  document: ShopMapDocumentV2 = doc(),
  walkingAcrossMakesPath?: boolean
): LiveMapHandle {
  return createLiveMap({
    document,
    settings: { idPrefix: 'a', idSeed: 1, walkingAcrossMakesPath },
  });
}

let clock = 0;
/** Walks a straight line in steps of 0.25 m. */
function walk(
  map: LiveMapHandle,
  from: [number, number],
  to: [number, number]
): void {
  const n = Math.max(
    1,
    Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.25)
  );
  for (let k = 0; k <= n; k++) {
    clock += 250;
    map.push({
      logMs: clock,
      x: from[0] + ((to[0] - from[0]) * k) / n,
      y: from[1] + ((to[1] - from[1]) * k) / n,
    });
  }
}

/** Two aisles along x from 0 to `length`, `apart` metres apart. */
function aisles(map: LiveMapHandle, apart: number, length = 6): void {
  walk(map, [0, 0], [length, 0]);
  map.setTracking('lost');
  map.setTracking('good');
  walk(map, [length, apart], [0, apart]);
}

const puts = (events: WalkEvent[]): MapArea[] =>
  events.flatMap((e) => (e.type === 'area-put' ? [e.area] : []));

/** The areas the events leave, by id. */
function areasOf(events: WalkEvent[]): Map<string, MapArea> {
  const out = new Map<string, MapArea>();
  for (const e of events) {
    if (e.type === 'area-put') out.set(e.area.id, e.area);
    if (e.type === 'area-removed') out.delete(e.id);
  }
  return out;
}

describe('createLiveMap', () => {
  describe('walked cells', () => {
    it('are every cell within 0.5 m of a good point', () => {
      const map = live();
      map.push({ logMs: 0, x: 1, y: 1 });
      const cells = map.snapshot().walkedCells;
      // Centres within 0.5 m of (1, 1): the four cells around it.
      expect(cells).toEqual([
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ]);
    });

    it('follow the step between two good points up to 2 m apart', () => {
      const row = (to: number) => {
        const map = live();
        map.push({ logMs: 0, x: 0.25, y: 0.25 });
        map.push({ logMs: 1000, x: to, y: 0.25 });
        return map
          .snapshot()
          .walkedCells.filter((c) => c.y === 0)
          .map((c) => c.x);
      };
      expect(row(2.25)).toEqual([-1, 0, 1, 2, 3, 4, 5]);
      // A jump is not a step: the cells between stay unwalked.
      expect(row(2.75)).toEqual([-1, 0, 1, 4, 5, 6]);
    });

    it('are painted only while tracking is good', () => {
      const map = live();
      map.setTracking('lost');
      map.push({ logMs: 0, x: 1, y: 1 });
      map.setTracking('suspect');
      map.push({ logMs: 1, x: 5, y: 5 });
      expect(map.snapshot().walkedCells).toEqual([]);
    });

    it('start from the path of the document', () => {
      const map = live(
        doc({
          path: [
            {
              points: [
                [0.25, 0.25],
                [1.25, 0.25],
              ],
            },
          ],
        })
      );
      expect(map.snapshot().walkedCells.length).toBeGreaterThan(2);
    });
  });

  describe('suggestions', () => {
    it('offer the strip between two walked aisles, snapped to cells', () => {
      const map = live();
      aisles(map, 1.5);
      const { suggestions } = map.snapshot();
      expect(suggestions).toEqual([
        { id: 'suggestion:-1,1,12,1', x: -0.5, y: 0.5, w: 7, h: 0.5 },
      ]);
    });

    it('offer a strip up to 2 m across and no wider', () => {
      const wide = live();
      aisles(wide, 3);
      expect(wide.snapshot().suggestions.map((s) => s.h)).toEqual([2]);
      const wider = live();
      aisles(wider, 3.5);
      expect(wider.snapshot().suggestions).toEqual([]);
    });

    it('need a strip at least 2 m long', () => {
      const long = live();
      aisles(long, 1.5, 1);
      expect(long.snapshot().suggestions.map((s) => s.w)).toEqual([2]);
      const short = live();
      aisles(short, 1.5, 0.5);
      expect(short.snapshot().suggestions).toEqual([]);
    });

    it('never cover an area', () => {
      const map = live(
        doc({ areas: [area('drawn', { x: -1, y: 0.5, w: 8, h: 0.5 })] })
      );
      aisles(map, 1.5);
      expect(map.snapshot().suggestions).toEqual([]);
    });

    it('keep their id between snapshots, and a dismissed one stays hidden', () => {
      const map = live();
      aisles(map, 1.5);
      const [s] = map.snapshot().suggestions;
      expect(map.snapshot().suggestions[0].id).toBe(s.id);
      map.dismissSuggestion(s.id);
      expect(map.snapshot().suggestions).toEqual([]);
    });

    it('become a shelf only when tapped', () => {
      const map = live();
      aisles(map, 1.5);
      expect(puts(map.snapshot().events)).toEqual([]);
      const [s] = map.snapshot().suggestions;
      map.acceptSuggestion(s.id);
      map.acceptSuggestion('nothing');
      const snap = map.snapshot();
      expect(snap.events).toEqual([
        {
          type: 'area-put',
          area: {
            id: 'a1',
            kind: 'shelf',
            x: -0.5,
            y: 0.5,
            w: 7,
            h: 0.5,
            colour: { mode: 'default' },
            origin: 'suggested',
          },
        },
      ]);
      expect(snap.suggestions).toEqual([]);
    });
  });

  describe('walking across a suggested shelf', () => {
    function acrossTheShelf(makesPath?: boolean): LiveSnapshot {
      const map = live(doc(), makesPath);
      aisles(map, 1.5);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.snapshot();
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [3, 0], [3, 1.5]);
      return map.snapshot();
    }

    it('turns the part walked over into path', () => {
      const areas = [...areasOf(acrossTheShelf().events).values()];
      expect(areas.map((a) => [a.id, a.kind, a.x, a.w])).toEqual([
        ['a1', 'shelf', -0.5, 3],
        ['a2', 'shelf', 3.5, 3],
        ['a3', 'path', 2.5, 1],
      ]);
      expect(areas.every((a) => a.origin === 'suggested')).toBe(true);
    });

    it('cuts one column when a walk clips the end of a long strip', () => {
      const map = live();
      aisles(map, 2.5, 9);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.snapshot();
      map.setTracking('lost');
      map.setTracking('good');
      // Round the end at x = 10, one point dipping into the strip.
      walk(map, [9, 0], [10, 0]);
      walk(map, [10, 0], [9.3, 1.25]);
      walk(map, [9.3, 1.25], [10, 2.5]);
      const areas = [...areasOf(map.snapshot().events).values()];
      expect(areas.map((a) => [a.kind, a.x, a.w, a.h])).toEqual([
        ['shelf', -0.5, 9.5, 1.5],
        ['path', 9, 0.5, 1.5],
      ]);
    });

    it('changes nothing when the setting is off', () => {
      expect(acrossTheShelf(false).events).toEqual([]);
    });

    it('never changes a shelf drawn by hand', () => {
      const map = live(
        doc({ areas: [area('drawn', { x: 2, y: 0.5, w: 2, h: 0.5 })] })
      );
      walk(map, [3, 0], [3, 1.5]);
      expect(map.snapshot().events).toEqual([]);
    });
  });

  describe('section runs', () => {
    /** Walks along y = 0 to x = 2 and marks a section facing +y. */
    function started(): LiveMapHandle {
      const map = live();
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m1', clock, { x: 2, y: 0, heading: 0, text: 'Lácteos' }));
      return map;
    }
    const runArea = (map: LiveMapHandle) => {
      const areas = areasOf(map.snapshot().events);
      return [...areas.values()].find((a) => a.origin === 'section-run');
    };

    it('start on the side the phone faced and name the shelf', () => {
      const map = started();
      const snap = map.snapshot();
      expect(snap.sectionRun).toEqual({ section: 'Lácteos', areaId: 'a1' });
      expect(snap.events[0].type).toBe('mark-put');
      expect(puts(snap.events)).toEqual([
        {
          id: 'a1',
          kind: 'shelf',
          x: 2,
          y: 0.5,
          w: 0.5,
          h: 1,
          section: 'Lácteos',
          colour: { mode: 'default' },
          origin: 'section-run',
        },
      ]);
    });

    it('extend as the person walks along, and shorten when they walk back', () => {
      const map = started();
      walk(map, [2, 0], [4, 0]);
      expect(runArea(map)).toMatchObject({ x: 2, w: 2.5 });
      walk(map, [4, 0], [3, 0]);
      expect(runArea(map)).toMatchObject({ x: 2, w: 1.5 });
      expect(map.snapshot().sectionRun?.areaId).toBe('a1');
    });

    it('end on a turn held for 2 m, keeping the shelf', () => {
      const map = started();
      walk(map, [2, 0], [3, 0]);
      map.snapshot();
      walk(map, [3, 0], [3, -1.5]);
      expect(map.snapshot().sectionRun).not.toBeNull();
      walk(map, [3, -1.5], [3, -3]);
      const snap = map.snapshot();
      expect(snap.sectionRun).toBeNull();
      expect(snap.events.some((e) => e.type === 'area-removed')).toBe(false);
    });

    it('end on Section left, with a section-left event', () => {
      const map = started();
      map.snapshot();
      map.sectionLeft();
      const snap = map.snapshot();
      expect(snap.sectionRun).toBeNull();
      expect(snap.events).toEqual([{ type: 'section-left', logMs: clock }]);
    });

    it('end on another section mark, which starts its own', () => {
      const map = started();
      walk(map, [2, 0], [3, 0]);
      map.mark(mark('m2', clock, { x: 3, y: 0, heading: 180, text: 'Pan' }));
      const snap = map.snapshot();
      expect(snap.sectionRun).toEqual({ section: 'Pan', areaId: 'a2' });
      // Facing -y this time: the shelf is below the aisle.
      expect(areasOf(snap.events).get('a2')).toMatchObject({ y: -1.5, h: 1 });
    });

    it('fill half of a shelf between two aisles', () => {
      const map = live();
      aisles(map, 2.5);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      // Open cells j = 1 to 3 between the aisles: the run takes one of three.
      expect(areasOf(map.snapshot().events).get('a1')).toMatchObject({
        y: 0.5,
        h: 0.5,
      });
    });

    it('need shelf cells within 1.5 m', () => {
      const map = live(
        doc({ areas: [area('drawn', { x: 0, y: 0.5, w: 4, h: 3 })] })
      );
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      const snap = map.snapshot();
      expect(snap.sectionRun).toBeNull();
      expect(puts(snap.events)).toEqual([]);
    });

    it('never start or move while tracking is not good', () => {
      const map = live();
      walk(map, [0, 0], [2, 0]);
      map.setTracking('suspect');
      map.mark(mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      const snap = map.snapshot();
      expect(snap.sectionRun).toBeNull();
      expect(snap.events.map((e) => e.type)).toEqual(['mark-put']);
    });
  });

  describe('a section mark facing a shelf that is already an area', () => {
    /** Two aisles with the strip between them tapped as a shelf (id a1). */
    function tapped(): LiveMapHandle {
      const map = live();
      aisles(map, 1.5);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.snapshot();
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [2, 0]);
      return map;
    }

    it('names a tapped shelf and runs along it', () => {
      const map = tapped();
      map.mark(
        mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Congelados' })
      );
      const snap = map.snapshot();
      expect(snap.sectionRun).toEqual({ section: 'Congelados', areaId: 'a1' });
      expect(puts(snap.events)).toEqual([
        {
          id: 'a1',
          kind: 'shelf',
          x: -0.5,
          y: 0.5,
          w: 7,
          h: 0.5,
          section: 'Congelados',
          colour: { mode: 'default' },
          origin: 'suggested',
        },
      ]);
    });

    it('grows the named shelf past its end, and never shrinks it', () => {
      const map = tapped();
      map.mark(
        mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Congelados' })
      );
      walk(map, [2, 0], [8, 0]);
      expect(areasOf(map.snapshot().events).get('a1')).toMatchObject({
        x: -0.5,
        w: 9,
      });
      walk(map, [8, 0], [1, 0]);
      expect(areasOf(map.snapshot().events).get('a1')).toMatchObject({
        x: -0.5,
        w: 7,
      });
    });

    it('adds to a run of the same section instead of making another', () => {
      const map = live();
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m1', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      walk(map, [2, 0], [4, 0]);
      map.sectionLeft();
      walk(map, [4, 0], [3, 0]);
      map.mark(mark('m2', clock, { x: 3, y: 0, heading: 0, text: ' pan ' }));
      const snap = map.snapshot();
      expect(snap.sectionRun?.areaId).toBe('a1');
      expect([...areasOf(snap.events).keys()]).toEqual(['a1']);
    });

    it('cuts the run just ended where the next section starts', () => {
      const map = live();
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m1', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      walk(map, [2, 0], [5, 0]);
      map.mark(mark('m2', clock, { x: 4, y: 0, heading: 0, text: 'Leche' }));
      const areas = areasOf(map.snapshot().events);
      expect(areas.get('a1')).toMatchObject({ section: 'Pan', x: 2, w: 2 });
      expect(areas.get('a2')).toMatchObject({ section: 'Leche', x: 4 });
      expect(map.snapshot().sectionRun).toEqual({
        section: 'Leche',
        areaId: 'a2',
      });
    });

    it('never names a shelf drawn by hand', () => {
      const drawn = area('drawn', { x: 0, y: 0.5, w: 4, h: 1 });
      const map = live(doc({ areas: [drawn] }));
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      const snap = map.snapshot();
      expect(snap.sectionRun).toBeNull();
      expect(snap.events.map((e) => e.type)).toEqual(['mark-put']);
    });
  });

  describe('two faces of one shelf', () => {
    /** Aisles 2.5 m apart, the strip between them tapped, one face marked from aisle one. */
    function lacteos(named: boolean): LiveMapHandle {
      // Named: an earlier session's mark, so the tapped shelf takes its section.
      const map = live(
        named
          ? doc({ marks: [mark('m0', 0, { x: 2, y: 0, text: 'Lacteos' })] })
          : doc()
      );
      aisles(map, 2.5);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [2, 0]);
      if (!named) {
        map.mark(
          mark('m1', clock, { x: 2, y: 0, heading: 0, text: 'Lacteos' })
        );
      }
      map.sectionLeft();
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 2.5], [2, 2.5]);
      map.mark(
        mark('m2', clock, { x: 2, y: 2.5, heading: 180, text: 'Yogures' })
      );
      return map;
    }

    /** The strip's pieces as section, top and depth. */
    const faces = (map: LiveMapHandle) =>
      [...areasOf(map.snapshot().events).values()].map((a) => [
        a.section,
        a.y,
        a.h,
      ]);

    it('splits a tapped shelf a mark named, and names the half facing the other aisle', () => {
      const map = lacteos(false);
      expect(faces(map)).toEqual([
        ['Lacteos', 0.5, 1],
        ['Yogures', 1.5, 0.5],
      ]);
    });

    it('splits a tapped shelf that took a section when tapped', () => {
      const map = lacteos(true);
      const snap = map.snapshot();
      expect(snap.sectionRun).toEqual({ section: 'Yogures', areaId: 'a2' });
      const areas = areasOf(snap.events);
      expect(areas.get('a1')).toMatchObject({ section: 'Lacteos', h: 1 });
      expect(areas.get('a2')).toMatchObject({ section: 'Yogures', y: 1.5 });
      expect(
        validateShopMapV2({
          version: 2,
          areas: [...areas.values()],
          marks: [],
          path: [],
        })
      ).toEqual([]);
    });

    it('leaves a second section along the same face without a shelf', () => {
      const map = live();
      aisles(map, 2.5, 9);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [1, 0]);
      map.mark(mark('m1', clock, { x: 1, y: 0, heading: 0, text: 'Lacteos' }));
      map.sectionLeft();
      walk(map, [1, 0], [5, 0]);
      map.mark(mark('m2', clock, { x: 5, y: 0, heading: 0, text: 'Yogures' }));
      const snap = map.snapshot();
      expect(snap.sectionRun).toBeNull();
      expect([...areasOf(snap.events).values()].map((a) => a.section)).toEqual([
        'Lacteos',
      ]);
    });

    it('never takes a mark of the same name elsewhere as the side that named it', () => {
      const map = live();
      aisles(map, 2.5, 9);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [1, 0]);
      map.mark(mark('m1', clock, { x: 1, y: 0, heading: 0, text: 'Lacteos' }));
      map.sectionLeft();
      // The same name again, on a shelf of its own far away.
      map.mark(
        mark('m2', clock, { x: 22, y: 20, heading: 0, text: 'Lacteos' })
      );
      walk(map, [1, 0], [5, 0]);
      map.mark(mark('m3', clock, { x: 5, y: 0, heading: 0, text: 'Yogures' }));
      const areas = areasOf(map.snapshot().events);
      expect(areas.get('a1')).toMatchObject({ section: 'Lacteos', h: 1.5 });
      expect(
        [...areas.values()].filter((a) => a.section === 'Yogures')
      ).toEqual([]);
    });

    it('splits a piece left by a crossing across the run, not across the aisle', () => {
      const map = live();
      aisles(map, 2.5, 4);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [3.75, 0]);
      map.mark(
        mark('m1', clock, { x: 3.75, y: 0, heading: 0, text: 'Lacteos' })
      );
      walk(map, [3.75, 0], [3, 0]);
      walk(map, [3, 0], [3, 2.5]);
      walk(map, [3, 2.5], [4.25, 2.5]);
      map.mark(
        mark('m2', clock, { x: 4.25, y: 2.5, heading: 180, text: 'Yogures' })
      );
      const areas = [...areasOf(map.snapshot().events).values()];
      const piece = (section: string) =>
        areas
          .filter((a) => a.section === section && a.x === 3.5)
          .map((a) => [a.y, a.h]);
      expect(piece('Lacteos')).toEqual([[0.5, 1]]);
      expect(piece('Yogures')).toEqual([[1.5, 0.5]]);
      expect(
        validateShopMapV2({ version: 2, areas, marks: [], path: [] })
      ).toEqual([]);
    });

    it('still names the other face after a crossing cut the strip short', () => {
      const map = live();
      aisles(map, 2.5, 9);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [1, 0]);
      map.mark(mark('m1', clock, { x: 1, y: 0, heading: 0, text: 'Lacteos' }));
      map.sectionLeft();
      walk(map, [1, 0], [3, 0]);
      walk(map, [3, 0], [3, 2.5]);
      walk(map, [3, 2.5], [6, 2.5]);
      map.mark(
        mark('m2', clock, { x: 6, y: 2.5, heading: 180, text: 'Yogures' })
      );
      const areas = [...areasOf(map.snapshot().events).values()];
      const piece = (section: string) =>
        areas
          .filter((a) => a.section === section && a.x === 3.5)
          .map((a) => [a.y, a.h]);
      expect(piece('Lacteos')).toEqual([[0.5, 1]]);
      expect(piece('Yogures')).toEqual([[1.5, 0.5]]);
    });

    it('never takes a mark of the same name past the ends of the strip as its namer', () => {
      const map = live();
      aisles(map, 2.5, 9);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 2.5], [1, 2.5]);
      map.mark(
        mark('m1', clock, { x: 1, y: 2.5, heading: 180, text: 'Lacteos' })
      );
      map.sectionLeft();
      // The same name on the same row line, 21 m past the strip's end.
      map.mark(mark('m2', clock, { x: 30, y: 0, heading: 0, text: 'Lacteos' }));
      walk(map, [1, 2.5], [5, 2.5]);
      map.mark(
        mark('m3', clock, { x: 5, y: 2.5, heading: 180, text: 'Yogures' })
      );
      const areas = areasOf(map.snapshot().events);
      expect(areas.get('a1')).toMatchObject({ section: 'Lacteos', h: 1.5 });
      expect(
        [...areas.values()].filter((a) => a.section === 'Yogures')
      ).toEqual([]);
    });

    it('takes a namer within the section reach past the strip end, and not beyond it', () => {
      /** Whether the other face splits off when its namer stood `past` metres beyond the strip's end. */
      function splitsWithNamerPast(past: number): boolean {
        const map = live();
        aisles(map, 2.5, 9);
        map.acceptSuggestion(map.snapshot().suggestions[0].id);
        const strip = areasOf(map.snapshot().events).get('a1');
        if (!strip) throw new Error('no tapped strip');
        map.setTracking('lost');
        map.setTracking('good');
        walk(map, [0, 2.5], [1, 2.5]);
        map.mark(
          mark('m1', clock, { x: 1, y: 2.5, heading: 180, text: 'Lacteos' })
        );
        map.sectionLeft();
        // The same name on the other aisle, `past` metres beyond the strip's end.
        const end = strip.x + strip.w;
        map.mark(
          mark('m2', clock, {
            x: end + past,
            y: 0,
            heading: 0,
            text: 'Lacteos',
          })
        );
        map.sectionLeft();
        walk(map, [1, 2.5], [5, 2.5]);
        map.mark(
          mark('m3', clock, { x: 5, y: 2.5, heading: 180, text: 'Yogures' })
        );
        return [...areasOf(map.snapshot().events).values()].some(
          (a) => a.section === 'Yogures'
        );
      }
      expect(SECTION_REACH_METRES).toBe(1.5);
      expect(splitsWithNamerPast(1)).toBe(true);
      expect(splitsWithNamerPast(2)).toBe(false);
    });

    it('keeps the spelling of a shelf already named the same', () => {
      const map = live();
      aisles(map, 1.5);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m1', clock, { x: 2, y: 0, heading: 0, text: 'Lacteos' }));
      map.sectionLeft();
      map.mark(
        mark('m2', clock, { x: 2, y: 0, heading: 0, text: ' lacteos ' })
      );
      const snap = map.snapshot();
      expect(snap.sectionRun).toEqual({ section: 'Lacteos', areaId: 'a1' });
      expect(areasOf(snap.events).get('a1')?.section).toBe('Lacteos');
    });
  });

  it('names a tapped shelf only from a run or a mark that faced it', () => {
    const map = live();
    // Aisles at y = 0, 2.5 and 5, walked along x.
    walk(map, [0, 0], [6, 0]);
    map.setTracking('lost');
    map.setTracking('good');
    walk(map, [6, 5], [0, 5]);
    map.setTracking('lost');
    map.setTracking('good');
    walk(map, [0, 2.5], [2, 2.5]);
    // Pan faces +y: its run starts on the strip between y = 2.5 and 5.
    map.mark(mark('p', clock, { x: 2, y: 2.5, heading: 0, text: 'Pan' }));
    walk(map, [2, 2.5], [6, 2.5]);
    expect(map.snapshot().sectionRun?.section).toBe('Pan');
    const lower = map.snapshot().suggestions.find((x) => x.y === 0.5);
    expect(lower).toBeDefined();
    map.acceptSuggestion(lower?.id ?? '');
    const tappedShelf = puts(map.snapshot().events).find(
      (a) => a.origin === 'suggested'
    );
    expect(tappedShelf && 'section' in tappedShelf).toBe(false);
    // Leche faces -y, across the aisle from Pan: it names the tapped strip.
    walk(map, [6, 2.5], [3, 2.5]);
    map.mark(mark('l', clock, { x: 3, y: 2.5, heading: 180, text: 'Leche' }));
    const snap = map.snapshot();
    expect(snap.sectionRun).toEqual({
      section: 'Leche',
      areaId: tappedShelf?.id,
    });
  });

  it('ends the run when the person crosses the shelf it fills, and the map stays valid', () => {
    const map = live();
    aisles(map, 1.5);
    map.acceptSuggestion(map.snapshot().suggestions[0].id);
    map.setTracking('lost');
    map.setTracking('good');
    walk(map, [6, 0], [5, 0]);
    map.mark(mark('m', clock, { x: 5, y: 0, heading: 0, text: 'Pan' }));
    walk(map, [5, 0], [3, 0]);
    expect(map.snapshot().sectionRun?.areaId).toBe('a1');
    walk(map, [3, 0], [3, 0.75]);
    walk(map, [3, 0.75], [3, 0]);
    walk(map, [3, 0], [-3, 0]);
    const snap = map.snapshot();
    expect(snap.sectionRun).toBeNull();
    const areas = [...areasOf(snap.events).values()];
    expect(
      validateShopMapV2({ version: 2, areas, marks: [], path: [] })
    ).toEqual([]);
    expect(areas.map((a) => [a.kind, a.section ?? null])).toEqual([
      ['shelf', 'Pan'],
      ['shelf', 'Pan'],
      ['path', null],
    ]);
  });

  it('looks past floor drawn by hand for the shelf', () => {
    const floor = area('floor', { kind: 'path', x: 0, y: 0.5, w: 4, h: 0.5 });
    const map = live(doc({ areas: [floor] }));
    walk(map, [0, 0], [2, 0]);
    map.mark(mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
    const snap = map.snapshot();
    expect(snap.sectionRun).toEqual({ section: 'Pan', areaId: 'a1' });
    expect(areasOf(snap.events).get('a1')).toMatchObject({ y: 1 });
  });

  it('never names a tapped shelf from a mark saved while tracking was not good', () => {
    const map = live();
    aisles(map, 1.5);
    map.setTracking('suspect');
    map.mark(
      mark('m', clock, {
        x: 5,
        y: 1.5,
        heading: 180,
        text: 'Pan',
        kind: 'section',
      })
    );
    map.setTracking('good');
    map.acceptSuggestion(map.snapshot().suggestions[0].id);
    expect('section' in puts(map.snapshot().events)[0]).toBe(false);
  });

  describe('a tapped suggestion', () => {
    it('takes the section of a mark within 1.5 m', () => {
      const map = live();
      aisles(map, 1.5);
      map.mark(
        mark('m', clock, {
          x: 5,
          y: 1.5,
          heading: 180,
          text: 'Pan',
          kind: 'section',
        })
      );
      map.snapshot();
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      expect(puts(map.snapshot().events)[0].section).toBe('Pan');
    });

    it('takes the section of the run in progress on its side', () => {
      // One strip along y = 0.5 to 1, cut in two by a pillar at x = 4 to 5.
      const pillar = area('pillar', {
        kind: 'blocked',
        x: 4,
        y: 0.5,
        w: 1,
        h: 0.5,
      });
      const map = live(doc({ areas: [pillar] }));
      aisles(map, 1.5, 12);
      map.setTracking('lost');
      map.setTracking('good');
      walk(map, [0, 0], [1, 0]);
      map.mark(mark('m', clock, { x: 1, y: 0, heading: 0, text: 'Leche' }));
      walk(map, [1, 0], [4, 0]);
      map.snapshot();
      const beyond = map.snapshot().suggestions.find((x) => x.x >= 5);
      expect(beyond).toBeDefined();
      map.acceptSuggestion(beyond?.id ?? '');
      const tappedShelf = puts(map.snapshot().events).find(
        (a) => a.origin === 'suggested'
      );
      expect(tappedShelf?.section).toBe('Leche');
    });

    it('stays unnamed with no section near', () => {
      const map = live();
      aisles(map, 1.5);
      map.acceptSuggestion(map.snapshot().suggestions[0].id);
      expect('section' in puts(map.snapshot().events)[0]).toBe(false);
    });
  });

  describe('the turn rule', () => {
    it('reads the last metre of walking, so jitter on dense points ends nothing', () => {
      const map = live();
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      // Every 5 cm, 10 cm to one side and back: each step turns 63 degrees.
      for (let k = 1; k <= 80; k++) {
        clock += 50;
        map.push({ logMs: clock, x: 2 + k * 0.05, y: k % 2 === 0 ? 0 : 0.1 });
      }
      const snap = map.snapshot();
      expect(snap.sectionRun).toEqual({ section: 'Pan', areaId: 'a1' });
      expect(areasOf(snap.events).get('a1')).toMatchObject({ x: 2, w: 4.5 });
    });
  });

  describe('counter marks', () => {
    it('place a 2 by 1 m counter 0.5 m away, its long side facing the person', () => {
      const map = live();
      map.mark(
        mark('c', 0, { kind: 'counter', x: 0, y: 0, heading: 0, text: 'Carne' })
      );
      map.mark(
        mark('d', 0, { kind: 'counter', x: 10, y: 0, heading: 90, text: '' })
      );
      const areas = puts(map.snapshot().events);
      expect(areas).toEqual([
        {
          id: 'a1',
          kind: 'counter',
          x: -1,
          y: 0.5,
          w: 2,
          h: 1,
          section: 'Carne',
          colour: { mode: 'default' },
          origin: 'counter-mark',
        },
        {
          id: 'a2',
          kind: 'counter',
          x: 8.5,
          y: -1,
          w: 1,
          h: 2,
          colour: { mode: 'default' },
          origin: 'counter-mark',
        },
      ]);
    });

    it('place nothing over another area', () => {
      const map = live(
        doc({ areas: [area('drawn', { x: -1, y: 0.5, w: 2, h: 1 })] })
      );
      map.mark(mark('c', 0, { kind: 'counter', heading: 0, text: 'Carne' }));
      expect(puts(map.snapshot().events)).toEqual([]);
    });
  });

  describe('snapshots', () => {
    it('hand over the events once, one put per area change', () => {
      const map = live();
      walk(map, [0, 0], [2, 0]);
      map.mark(mark('m1', clock, { x: 2, y: 0, heading: 0, text: 'Pan' }));
      walk(map, [2, 0], [5, 0]);
      const first = map.snapshot();
      expect(first.events.map((e) => e.type)).toEqual(['mark-put', 'area-put']);
      expect(map.snapshot().events).toEqual([]);
    });

    it('take ids from the seed the caller gives', () => {
      const map = createLiveMap({
        document: doc(),
        settings: { idPrefix: 'walk7-', idSeed: 40 },
      });
      map.mark(mark('c', 0, { kind: 'counter', text: 'Carne' }));
      expect(puts(map.snapshot().events)[0].id).toBe('walk7-40');
    });
  });

  describe('the El Jamón replay', () => {
    const replay = replayElJamon();

    it('answers the suggestions and section runs checked on the plot', () => {
      expect(replay).toEqual(elJamonLive);
    });

    it('offers suggestions and makes section runs, counters and a crossing', () => {
      expect(replay.atTap.suggestions.length).toBeGreaterThan(0);
      const origins = new Set(
        replay.map.areas.map((a) => `${a.kind} ${a.origin}`)
      );
      expect([...origins].sort()).toEqual([
        'counter counter-mark',
        'path suggested',
        'shelf section-run',
        'shelf suggested',
      ]);
      expect(replay.map.marks).toHaveLength(52);
    });

    it('makes a valid map', () => {
      expect(
        validateShopMapV2({ version: 2, ...replay.map, path: [] })
      ).toEqual([]);
    });

    it('paints nothing from the turned frame', () => {
      const turned = ['Pastas'];
      expect(
        replay.map.areas.filter((a) => turned.includes(a.section ?? ''))
      ).toEqual([]);
    });
  });
});
