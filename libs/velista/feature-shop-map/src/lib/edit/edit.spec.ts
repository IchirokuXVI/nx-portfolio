import { signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  MapArea,
  MapMark,
  ShopMapDocumentV2,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  GatewayError,
  MEMORY_SHOWN_WALK_ID,
} from '@portfolio/velista/data-access';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import {
  headerOf,
  settle,
  shopMapTesting,
  type ShopMapHarnessOptions,
} from '../shop-map.testing';
import { AreaSheet } from './area-sheet';
import { EditMapPage } from './edit-map-page';
import { HoldMenu, type HoldChoice } from './hold-menu';
import {
  changingEdits,
  heldSquare,
  holdActionsFor,
  holdEvents,
  MAP_EDIT_SESSION,
  renamedArea,
  retextedMark,
  type MapEditSession,
} from './map-edits';
import { MarkEditSheet } from './mark-edit-sheet';
import { ResizeControls } from './resize-controls';

const SHOP = 'loc-tejares';
const WALK = MEMORY_SHOWN_WALK_ID;
const EDIT = `/en/shops/${SHOP}/walks/${WALK}/edit`;

function area(overrides: Partial<MapArea> = {}): MapArea {
  return {
    id: 'a-1',
    kind: 'shelf',
    x: 2,
    y: 2,
    w: 1.4,
    h: 11,
    section: 'Lácteos',
    colour: { mode: 'default' },
    origin: 'drawn',
    ...overrides,
  };
}

function all(fixture: ComponentFixture<unknown>, selector: string): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

function click(fixture: ComponentFixture<unknown>, selector: string): void {
  const node = (
    fixture.nativeElement as HTMLElement
  ).querySelector<HTMLElement>(selector);
  if (node === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  node.click();
  fixture.detectChanges();
}

function mark(overrides: Partial<MapMark> = {}): MapMark {
  return {
    id: 'm-1',
    kind: 'section',
    x: 3,
    y: 4,
    heading: 90,
    text: 'Lácteos',
    logMs: 4_000,
    ...overrides,
  };
}

/** Velista `0129`, target 9: an edit that changes nothing is not an edit. */
describe('changingEdits', () => {
  const stored: ShopMapDocumentV2 = {
    version: 2,
    areas: [area()],
    marks: [mark()],
    path: [],
  };

  it('drops an area-put equal to the stored area, whatever order its keys are in', () => {
    const same: MapArea = {
      origin: 'drawn',
      colour: { mode: 'default' },
      section: 'Lácteos',
      h: 11,
      w: 1.4,
      y: 2,
      x: 2,
      kind: 'shelf',
      id: 'a-1',
    };

    expect(changingEdits(stored, [{ type: 'area-put', area: same }])).toEqual(
      []
    );
  });

  it('drops a mark-put equal to the stored mark', () => {
    expect(changingEdits(stored, [{ type: 'mark-put', mark: mark() }])).toEqual(
      []
    );
  });

  it('keeps a put that changes one thing, and a put of something new', () => {
    const moved: WalkEvent = { type: 'area-put', area: area({ x: 2.5 }) };
    const recoloured: WalkEvent = {
      type: 'area-put',
      area: area({ colour: { mode: 'custom', value: '#c9e6f5' } }),
    };
    const retexted: WalkEvent = {
      type: 'mark-put',
      mark: mark({ text: 'Huevos' }),
    };
    const drawn: WalkEvent = { type: 'area-put', area: area({ id: 'a-2' }) };

    for (const event of [moved, recoloured, retexted, drawn]) {
      expect(changingEdits(stored, [event])).toEqual([event]);
    }
  });

  it('drops the removal of something that is not there, and keeps a real one', () => {
    expect(
      changingEdits(stored, [
        { type: 'area-removed', id: 'gone' },
        { type: 'mark-removed', id: 'gone' },
        { type: 'mark-removed', id: 'm-1' },
      ])
    ).toEqual([{ type: 'mark-removed', id: 'm-1' }]);
  });

  it('reads each edit against the map as the ones before it left it', () => {
    const there: WalkEvent = { type: 'area-put', area: area({ x: 5 }) };
    const back: WalkEvent = { type: 'area-put', area: area() };

    // Moved and moved back is two changes, and the same put twice is one.
    expect(changingEdits(stored, [there, back])).toEqual([there, back]);
    expect(changingEdits(stored, [there, there])).toEqual([there]);
  });

  it('gives a mark new words and nothing else', () => {
    expect(retextedMark(mark(), '  Huevos ')).toEqual(mark({ text: 'Huevos' }));
  });
});

/** Velista `0123`: what the long press menu offers, and the events it makes. */
describe('the map edits', () => {
  it('offers only the actions that apply to what is under the finger', () => {
    expect(holdActionsFor(null)).toEqual([
      'shelf',
      'counter',
      'blocked',
      'path',
      'note',
    ]);
    expect(holdActionsFor(area())).toEqual([
      'counter',
      'blocked',
      'path',
      'note',
      'section',
      'erase',
    ]);
    expect(
      holdActionsFor(area({ kind: 'blocked', section: undefined }))
    ).toEqual(['shelf', 'counter', 'path', 'note', 'erase']);
  });

  it('draws the pressed square on the floor, and changes the kind of an area', () => {
    expect(heldSquare({ x: 14.74, y: 8.51 })).toEqual({ x: 14.5, y: 8.5 });
    expect(
      holdEvents(
        'counter',
        { at: { x: 14.74, y: 8.51 }, area: null },
        () => 'n'
      )
    ).toEqual([
      {
        type: 'area-put',
        area: {
          id: 'n',
          kind: 'counter',
          x: 14.5,
          y: 8.5,
          w: 0.5,
          h: 0.5,
          colour: { mode: 'default' },
          origin: 'drawn',
        },
      },
    ]);
    const [blocked] = holdEvents(
      'blocked',
      { at: { x: 2, y: 2 }, area: area() },
      () => 'n'
    );
    expect(blocked).toEqual({
      type: 'area-put',
      area: { ...area({ kind: 'blocked' }), section: undefined },
    });
    expect(blocked.type === 'area-put' && 'section' in blocked.area).toBe(
      false
    );
    expect(
      holdEvents('erase', { at: { x: 2, y: 2 }, area: area() }, () => 'n')
    ).toEqual([{ type: 'area-removed', id: 'a-1' }]);
  });

  it('renames a shelf by its section and anything else by its label', () => {
    expect(renamedArea(area(), '  Yogures ').section).toBe('Yogures');
    const pillar = renamedArea(
      area({ kind: 'blocked', section: undefined }),
      'Pillar'
    );
    expect(pillar.label).toBe('Pillar');
    expect('section' in pillar).toBe(false);
  });
});

async function renderPage(
  options: ShopMapHarnessOptions & { cold?: boolean } = {}
) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({
    params: { locationId: SHOP, walkId: WALK },
    ...options,
  });
  await TestBed.configureTestingModule({
    imports: [EditMapPage, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(EditMapPage);
  fixture.detectChanges();
  if (!options.cold) {
    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());
  }
  const view = () =>
    fixture.debugElement.query(By.directive(ShopMapView))
      .componentInstance as ShopMapView;
  const page = fixture.componentInstance as EditMapPage & {
    document: () => ShopMapDocumentV2 | null;
  };
  return { fixture, navigate, view, page, ...harness };
}

async function lastSeqOf(walks: ReturnType<typeof shopMapTesting>['walks']) {
  const read = await walks.walk(WALK);
  if (read.kind !== 'walk') {
    throw new Error('missing');
  }
  return {
    lastSeq: read.detail.walk.lastSeq,
    logTo: [...read.detail.timeline].sort((a, b) => b.seq - a.seq)[0].logTo,
  };
}

const counter: MapArea = {
  id: 'c-new',
  kind: 'counter',
  x: 12,
  y: 1,
  w: 2.8,
  h: 1.4,
  colour: { mode: 'default' },
  origin: 'drawn',
};

/** Velista `0123`, targets 1, 5 and 6: the edit page. */
describe('EditMapPage', () => {
  it('mounts the editor in the mapper look on the walk’s own document', async () => {
    const { fixture, view, page } = await renderPage();

    expect(view().look()).toBe('mapper');
    expect(view().snap()).toBe(false);
    expect(page.document()?.areas.some((one) => one.id === 'a-eggs')).toBe(
      true
    );
    expect(all(fixture, '.title')).toEqual(['Autumn layout']);
    expect(all(fixture, '.walking')).toEqual(['shopMapEdit.notWalking']);
  });

  // Velista 0130: one header, with the pill and Done as its actions.
  it('titles the header Walk until the walk arrives, with the pill and Done in every state', async () => {
    const { fixture } = await renderPage({ cold: true });

    expect(headerOf(fixture)).toEqual({
      lead: 'back',
      leadLabel: 'shopWalks.back',
      title: 'shopWalks.history.loadingTitle',
      actions: ['shopMapEdit.done'],
    });

    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());

    expect(headerOf(fixture)).toEqual({
      lead: 'back',
      leadLabel: 'shopWalks.back',
      title: 'Autumn layout',
      actions: ['shopMapEdit.done'],
    });
    // The pill is not a button: it sits in the actions, before Done.
    expect(all(fixture, 'lib-page-header span.walking')).toEqual([
      'shopMapEdit.notWalking',
    ]);
    expect(all(fixture, 'lib-page-header button.walking')).toEqual([]);
  });

  it('says what a save is doing on a polite line under the header', async () => {
    const { fixture, view } = await renderPage();

    view().changed.emit([{ type: 'area-put', area: counter }]);
    fixture.detectChanges();

    expect(all(fixture, 'lib-page-header .subtitle')).toEqual([]);
    expect(
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          'lib-page-header + .subtitle'
        )
      ).map((line) => line.getAttribute('aria-live'))
    ).toEqual(['polite']);
  });

  it('saves a drawn area as one edited entry on Done, at the log’s end', async () => {
    const { fixture, view, walks, pages } = await renderPage();
    const { lastSeq, logTo } = await lastSeqOf(walks);

    view().changed.emit([{ type: 'area-put', area: counter }]);
    view().areaSelected.emit(counter);
    fixture.detectChanges();

    // A drawn area shows its controls, not its sheet.
    expect(all(fixture, 'lib-resize-controls .hint')).toEqual([
      'shopMapEdit.resize.hintAlone',
    ]);
    click(fixture, '[libPageHeaderAction]');
    await settle(() => fixture.detectChanges());

    // Saved first, so the guard behind the pop has nothing to ask.
    expect(await fixture.componentInstance.canLeave()).toBe(true);
    expect(pages.back).toHaveBeenCalledWith(`/en/shops/${SHOP}/walks/${WALK}`);
    expect(walks.appended).toEqual([
      expect.objectContaining({
        baseSeq: lastSeq,
        kind: 'edited',
        logFrom: logTo,
        logTo,
        events: [{ type: 'area-put', area: counter }],
      }),
    ]);
  });

  // Velista 0129, target 9.
  it('saves nothing for an edit that leaves the map as it was', async () => {
    const { fixture, view, walks, page } = await renderPage();
    const eggs = page.document()?.areas.find((one) => one.id === 'a-eggs');
    if (eggs === undefined) {
      throw new Error('the memory walk must hold the eggs');
    }

    // The canvas reports an area dragged back to where it was, and a sheet
    // applies the area as it is.
    view().changed.emit([{ type: 'area-put', area: { ...eggs } }]);
    expect(page.apply([{ type: 'area-put', area: { ...eggs } }])).toBe(true);
    fixture.detectChanges();

    expect(all(fixture, '.subtitle')).toEqual([]);
    expect(await fixture.componentInstance.canLeave()).toBe(true);
    click(fixture, '[libPageHeaderAction]');
    await settle(() => fixture.detectChanges());
    expect(walks.appended).toEqual([]);
  });

  // Velista 0129, target 3.
  it('opens the sheet of a mark somebody tapped', async () => {
    const { view, navigate } = await renderPage();

    view().markTapped.emit(mark({ id: 'm-7' }));

    expect(navigate).toHaveBeenCalledWith(
      ['sheet', 'marks', 'm-7'],
      expect.objectContaining({})
    );
  });

  it('opens the sheet of an area somebody tapped', async () => {
    const { view, navigate, page } = await renderPage();
    const eggs = page.document()?.areas.find((one) => one.id === 'a-eggs');

    view().areaSelected.emit(eggs ?? null);

    expect(navigate).toHaveBeenCalledWith(
      ['sheet', 'areas', 'a-eggs'],
      expect.objectContaining({})
    );
  });

  it('draws a counter on the pressed square from the menu, selected for resizing', async () => {
    const { fixture, view, page } = await renderPage();

    view().longPressed.emit({
      at: { x: 30.2, y: 30.2 },
      area: null,
      client: { x: 100, y: 200 },
    });
    fixture.detectChanges();
    expect(all(fixture, 'lib-hold-menu .item')).toEqual([
      'shopMapEdit.hold.shelf',
      'shopMapEdit.hold.counter',
      'shopMapEdit.hold.blocked',
      'shopMapEdit.hold.path',
      'shopMapEdit.hold.note',
    ]);
    click(fixture, '[data-action="counter"]');

    const made = page
      .document()
      ?.areas.find(
        (one) => one.kind === 'counter' && one.x === 30 && one.y === 30
      );
    expect(made).toMatchObject({ w: 0.5, h: 0.5 });
    expect(all(fixture, 'lib-hold-menu')).toEqual([]);
    expect(all(fixture, 'lib-resize-controls .hint')).toHaveLength(1);
  });

  it('clears the pressed square when the menu is dismissed', async () => {
    const { fixture, view } = await renderPage();
    const clearHeld = jest.spyOn(view(), 'clearHeld');

    view().longPressed.emit({
      at: { x: 30, y: 30 },
      area: null,
      client: { x: 100, y: 200 },
    });
    fixture.detectChanges();
    click(fixture, 'lib-hold-menu .backdrop');

    expect(clearHeld).toHaveBeenCalled();
    expect(all(fixture, 'lib-hold-menu')).toEqual([]);
  });

  it('reads the walk again and says so when another phone saved first', async () => {
    const { fixture, view, walks, page } = await renderPage();
    walks.appendElsewhere(WALK);

    view().changed.emit([{ type: 'area-put', area: counter }]);
    const leave = await fixture.componentInstance.canLeave();
    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());

    expect(leave).toBe(false);
    expect(all(fixture, '.notice-text')).toEqual([
      'shopMapEdit.notice.changed',
    ]);
    expect(page.document()?.areas.some((one) => one.id === 'c-new')).toBe(
      false
    );
    // The next edit builds on the walk as read again.
    const { lastSeq } = await lastSeqOf(walks);
    view().changed.emit([{ type: 'area-removed', id: 'a-eggs' }]);
    await fixture.componentInstance.canLeave();
    expect(walks.appended[walks.appended.length - 1].baseSeq).toBe(lastSeq);
  });

  it('asks before leaving when the save did not arrive, and may leave without it', async () => {
    const { fixture, view, walks } = await renderPage();
    jest
      .spyOn(walks, 'append')
      .mockRejectedValue(
        new GatewayError({ code: 'internal', status: 0, correlationId: 'spec' })
      );

    view().changed.emit([{ type: 'area-put', area: counter }]);
    const leaving = fixture.componentInstance.canLeave();
    await settle(() => fixture.detectChanges());

    expect(all(fixture, 'lib-unsaved-dialog .title')).toEqual([
      'shopMapEdit.unsaved.title',
    ]);
    click(fixture, 'lib-unsaved-dialog .leave');
    expect(await leaving).toBe(true);
    expect(all(fixture, 'lib-unsaved-dialog')).toEqual([]);
  });

  it('asks before it pops: OK on the warning leaves the history alone', async () => {
    const { fixture, view, walks, pages } = await renderPage();
    jest
      .spyOn(walks, 'append')
      .mockRejectedValue(
        new GatewayError({ code: 'internal', status: 0, correlationId: 'spec' })
      );

    view().changed.emit([{ type: 'area-put', area: counter }]);
    click(fixture, '[libPageHeaderAction]');
    await settle(() => fixture.detectChanges());
    click(fixture, 'lib-unsaved-dialog .ok');
    await settle(() => fixture.detectChanges());

    expect(pages.back).not.toHaveBeenCalled();
    click(fixture, 'lib-page-header .lead');
    await settle(() => fixture.detectChanges());
    click(fixture, 'lib-unsaved-dialog .leave');
    await settle(() => fixture.detectChanges());
    expect(pages.back).toHaveBeenCalledTimes(1);
  });

  it('stays when OK is pressed on the warning', async () => {
    const { fixture, view, walks } = await renderPage();
    jest
      .spyOn(walks, 'append')
      .mockRejectedValue(
        new GatewayError({ code: 'internal', status: 0, correlationId: 'spec' })
      );

    view().changed.emit([{ type: 'area-put', area: counter }]);
    const leaving = fixture.componentInstance.canLeave();
    await settle(() => fixture.detectChanges());
    click(fixture, 'lib-unsaved-dialog .ok');

    expect(await leaving).toBe(false);
  });

  it('asks the browser to warn before the tab closes with an unsent edit', async () => {
    const { view } = await renderPage();

    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    view().changed.emit([{ type: 'area-put', area: counter }]);
    const warned = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warned);
    expect(warned.defaultPrevented).toBe(true);
  });
});

/** A session double: the map the sheet reads and every edit it applies. */
function fakeSession(document: ShopMapDocumentV2, drawn: string[] = []) {
  const map = signal<ShopMapDocumentV2 | null>(document);
  const applied: WalkEvent[][] = [];
  const session: MapEditSession = {
    document: map,
    apply: (events) => {
      applied.push([...events]);
      const current = map();
      if (current === null) {
        return false;
      }
      let areas = current.areas;
      for (const event of events) {
        if (event.type === 'area-put') {
          areas = areas.some((one) => one.id === event.area.id)
            ? areas.map((one) => (one.id === event.area.id ? event.area : one))
            : [...areas, event.area];
        } else if (event.type === 'area-removed') {
          areas = areas.filter((one) => one.id !== event.id);
        }
      }
      map.set({ ...current, areas });
      return true;
    },
    isNew: (id) => drawn.includes(id),
    select: jest.fn(),
    pageUrl: () => EDIT,
  };
  return { session, applied };
}

async function renderSheet(
  document: ShopMapDocumentV2,
  options: { drawn?: string[]; query?: Record<string, string> } = {}
) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({
    params: { locationId: SHOP, walkId: WALK, areaId: 'a-1' },
    query: options.query,
  });
  const { session, applied } = fakeSession(document, options.drawn);
  await TestBed.configureTestingModule({
    imports: [AreaSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ...harness.providers,
      { provide: MAP_EDIT_SESSION, useValue: session },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AreaSheet);
  fixture.detectChanges();
  await settle(() => fixture.detectChanges());
  return { fixture, session, applied, ...harness };
}

const doc = (areas: MapArea[]): ShopMapDocumentV2 => ({
  version: 2,
  areas,
  marks: [],
  path: [],
});

async function renderMarkSheet(document: ShopMapDocumentV2, markId = 'm-1') {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({
    params: { locationId: SHOP, walkId: WALK, markId },
  });
  const { session, applied } = fakeSession(document);
  await TestBed.configureTestingModule({
    imports: [MarkEditSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ...harness.providers,
      { provide: MAP_EDIT_SESSION, useValue: session },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(MarkEditSheet);
  fixture.detectChanges();
  await settle(() => fixture.detectChanges());
  const field = () =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '.field'
    ) as HTMLInputElement;
  const type = (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  return { fixture, session, applied, field, type, ...harness };
}

const marked = (marks: MapMark[]): ShopMapDocumentV2 => ({
  version: 2,
  areas: [],
  marks,
  path: [],
});

/** Velista `0129`, target 3: the sheet of one mark. */
describe('MarkEditSheet', () => {
  it('shows the kind of the mark and its text in a field', async () => {
    const { fixture, field } = await renderMarkSheet(marked([mark()]));

    expect(all(fixture, '.title')).toEqual([
      'shopWalkRecord.where.kind.section',
    ]);
    expect(all(fixture, '.field-label')).toEqual([
      'shopWalkRecord.mark.name.section',
    ]);
    expect(field().value).toBe('Lácteos');
  });

  it('saves a changed text as the same mark, where and when it was made', async () => {
    const { fixture, applied, sheets, type } = await renderMarkSheet(
      marked([mark()])
    );

    type(' Huevos ');
    await (fixture.componentInstance as MarkEditSheet).save();

    expect(applied).toEqual([
      [{ type: 'mark-put', mark: mark({ text: 'Huevos' }) }],
    ]);
    expect(sheets.dismiss).toHaveBeenCalledWith(EDIT);
  });

  it('sends nothing when the text did not change, and closes', async () => {
    const { fixture, applied, sheets, type } = await renderMarkSheet(
      marked([mark()])
    );

    type('Lácteos  ');
    click(fixture, '.save');
    await settle(() => fixture.detectChanges());

    expect(applied).toEqual([]);
    expect(sheets.dismiss).toHaveBeenCalledWith(EDIT);
  });

  it('refuses an empty text, says why, and stays open', async () => {
    const { fixture, applied, sheets, type, field } = await renderMarkSheet(
      marked([mark({ kind: 'note', text: 'Door' })])
    );

    type('   ');
    await (fixture.componentInstance as MarkEditSheet).save();
    fixture.detectChanges();

    expect(applied).toEqual([]);
    expect(sheets.dismiss).not.toHaveBeenCalled();
    expect(all(fixture, '.field-error')).toEqual(['shopMapEdit.mark.unnamed']);
    expect(field().getAttribute('aria-invalid')).toBe('true');

    type('Back door');
    expect(all(fixture, '.field-error')).toEqual([]);
  });

  it('deletes only after the confirmation, and leaves the sheet', async () => {
    const { fixture, applied, sheets } = await renderMarkSheet(
      marked([mark()])
    );

    click(fixture, '.delete');
    expect(applied).toEqual([]);
    expect(all(fixture, '.confirm-text')).toEqual([
      'shopMapEdit.mark.deleteConfirm',
    ]);
    click(fixture, '.danger');
    await settle(() => fixture.detectChanges());

    expect(applied).toEqual([[{ type: 'mark-removed', id: 'm-1' }]]);
    expect(sheets.dismiss).toHaveBeenCalledWith(EDIT);
  });

  it('says a mark that is gone is not on the map', async () => {
    const { fixture } = await renderMarkSheet(marked([]));

    expect(all(fixture, '.title')).toEqual(['shopMapEdit.mark.missing']);
    expect(all(fixture, '.field')).toEqual([]);
  });
});

/** Velista `0123`, target 3: the area sheet. */
describe('AreaSheet', () => {
  it('names the area, its kind and size, and selects it', async () => {
    const { fixture, session } = await renderSheet(doc([area()]));

    expect(all(fixture, '.title')).toEqual(['Lácteos']);
    expect(all(fixture, '.detail')).toEqual(['shopMapEdit.area.kindAndSize']);
    expect(session.select).toHaveBeenCalledWith('a-1');
  });

  it('draws the category box disabled, ticked only for an area drawn here', async () => {
    const old = await renderSheet(doc([area()]));
    const box = (fixture: ComponentFixture<unknown>) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.category-box'
      );
    expect(box(old.fixture)?.disabled).toBe(true);
    expect(box(old.fixture)?.checked).toBe(false);

    const drawn = await renderSheet(doc([area()]), { drawn: ['a-1'] });
    expect(box(drawn.fixture)?.disabled).toBe(true);
    expect(box(drawn.fixture)?.checked).toBe(true);
  });

  it('offers Default first, and applies a colour', async () => {
    const { fixture, applied } = await renderSheet(doc([area()]));
    const swatches = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.swatch')
    ).map((node) => node.getAttribute('data-colour'));

    expect(swatches).toEqual([
      'default',
      'paleBlue',
      'green',
      'orange',
      'lilac',
      'yellow',
    ]);
    click(fixture, '[data-colour="paleBlue"]');

    expect(applied).toEqual([
      [
        {
          type: 'area-put',
          area: area({ colour: { mode: 'custom', value: '#c9e6f5' } }),
        },
      ],
    ]);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-colour="paleBlue"]')
        ?.getAttribute('aria-checked')
    ).toBe('true');
  });

  it('renames a section, and opens with the field when asked to change it', async () => {
    const { fixture, applied } = await renderSheet(doc([area()]), {
      query: { rename: '1' },
    });

    const field = (fixture.nativeElement as HTMLElement).querySelector(
      '.field'
    ) as HTMLInputElement;
    expect(field).not.toBeNull();
    field.value = 'Yogures';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click(fixture, '.save');

    expect(applied).toEqual([
      [{ type: 'area-put', area: area({ section: 'Yogures' }) }],
    ]);
  });

  it('deletes only after the confirmation, and leaves the sheet', async () => {
    const { fixture, applied, sheets } = await renderSheet(doc([area()]));

    click(fixture, '.delete');
    expect(applied).toEqual([]);
    click(fixture, '.confirm .danger');
    await settle(() => fixture.detectChanges());

    expect(applied).toEqual([[{ type: 'area-removed', id: 'a-1' }]]);
    expect(sheets.dismiss).toHaveBeenCalledWith(EDIT);
  });
});

/** Velista `0123`, targets 2 and 4: the menu's note, and the resize controls. */
describe('HoldMenu and ResizeControls', () => {
  async function mount<T>(component: Type<T>, inputs: Record<string, unknown>) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [component, RokuTranslatorTestingModule.forTesting()],
      providers: shopMapTesting().providers,
    }).compileComponents();
    const fixture = TestBed.createComponent(component);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await settle(() => fixture.detectChanges());
    return fixture;
  }

  it('adds a note with the text typed into the menu', async () => {
    const fixture = await mount(HoldMenu, {
      press: { at: { x: 1, y: 1 }, area: null, client: { x: 10, y: 10 } },
    });
    const chosen: HoldChoice[] = [];
    (fixture.componentInstance as HoldMenu).chosen.subscribe((choice) =>
      chosen.push(choice)
    );

    click(fixture, '[data-action="note"]');
    await settle(() => fixture.detectChanges());
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      '.note-field'
    ) as HTMLInputElement;
    field.value = 'Ask for the ham here';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '.note'
      ) as HTMLFormElement
    ).dispatchEvent(new Event('submit'));

    expect(chosen).toEqual([{ action: 'note', text: 'Ask for the ham here' }]);
  });

  it('names an unnamed area’s kind once', async () => {
    const fixture = await mount(ResizeControls, {
      area: area({ kind: 'blocked', section: undefined }),
    });

    expect(all(fixture, '.name')).toEqual(['shopMapEdit.kind.blocked']);
    expect(all(fixture, '.hint')).toEqual(['shopMapEdit.resize.hintAlone']);
  });

  it('turns the snap switch and says Done', async () => {
    const fixture = await mount(ResizeControls, {
      area: area({ kind: 'counter', section: undefined }),
    });
    const controls = fixture.componentInstance as ResizeControls;
    const snaps: boolean[] = [];
    let done = 0;
    controls.snapChanged.subscribe((on) => snaps.push(on));
    controls.finished.subscribe(() => (done += 1));

    const box = (fixture.nativeElement as HTMLElement).querySelector(
      '.switch'
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.click();
    click(fixture, '.done');

    expect(snaps).toEqual([true]);
    expect(done).toBe(1);
  });
});
