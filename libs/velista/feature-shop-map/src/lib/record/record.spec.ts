import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { convertToParamMap, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { MapMark } from '@portfolio/luna-shopper/shop-map/model';
import {
  GatewayError,
  MEMORY_OTHER_WALK_ID,
  MEMORY_SHOWN_WALK_ID,
} from '@portfolio/velista/data-access';
import { BrowserFacade } from '@portfolio/velista/platform';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import {
  compassAt,
  shopMapTesting,
  uprightPose,
  type ShopMapHarnessOptions,
} from '../shop-map.testing';
import { MarkSheet } from './mark-sheet';
import { RecordWalkPage } from './record-walk-page';
import {
  suggestionSection,
  SuggestionSheet,
  type SuggestionAnswer,
} from './suggestion-sheet';
import { writeWalkBaseline } from './walk-baselines';

const SHOP = 'loc-tejares';
const HISTORY = (walkId: string) => `/en/shops/${SHOP}/walks/${walkId}`;

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

async function flush(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

/**
 * The recording page over the memory walks, with fake timers: the canvas is told
 * about the walk every 100 ms, and the saver sends every 20 s.
 */
async function renderPage(
  options: ShopMapHarnessOptions & {
    fresh?: boolean;
    walkId?: string;
    baseline?: number;
  } = {}
) {
  TestBed.resetTestingModule();
  let walkId = options.walkId ?? MEMORY_SHOWN_WALK_ID;
  const harness = shopMapTesting({
    params: { locationId: SHOP, walkId },
    ...options,
  });
  if (options.fresh) {
    const made = await harness.walks.create(SHOP, 'Spring');
    walkId = made.id;
    harness.route.paramMap.next(
      convertToParamMap({ locationId: SHOP, walkId })
    );
  }
  await TestBed.configureTestingModule({
    imports: [RecordWalkPage, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  if (options.baseline !== undefined) {
    writeWalkBaseline(TestBed.inject(BrowserFacade), walkId, options.baseline);
  }
  const fixture = TestBed.createComponent(RecordWalkPage);
  fixture.detectChanges();
  await flush(fixture);
  await flush(fixture);
  const view = () =>
    fixture.debugElement.query(By.directive(ShopMapView))?.componentInstance as
      | ShopMapView
      | undefined;
  return { fixture, navigate, view, walkId, ...harness };
}

/** Walks along +y at 1 m/s for `ms`, ten readings a second, with the draw timer running. */
function walkFor(
  harness: Awaited<ReturnType<typeof renderPage>>,
  from: number,
  ms: number,
  options: { tracked?: boolean; heading?: number } = {}
): void {
  for (let t = from; t < from + ms; t += 100) {
    harness.sensors.compass(compassAt(t, (options.heading ?? 0) + 300));
    harness.sensors.pose(
      options.tracked === false
        ? { t, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, tracked: false }
        : uprightPose(t, 0, t / 1000, options.heading ?? 0)
    );
    jest.advanceTimersByTime(100);
  }
  harness.fixture.detectChanges();
}

describe('RecordWalkPage (velista 0126)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('starts a new walk on a tap, with the camera, and saves it as started', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, sensors, walks } = harness;

    expect(all(fixture, '.intro-title')).toEqual([
      'shopWalkRecord.start.title',
    ]);
    click(fixture, '.controls .primary');
    await flush(fixture);
    expect(sensors.starts).toBe(1);

    walkFor(harness, 0, 5_000);
    expect(all(fixture, '.pill')).toEqual(['shopWalkRecord.status.good']);
    expect(harness.view()?.live()?.person).toBeDefined();
    expect(all(fixture, '.marks .mark')).toEqual([
      'shopWalkRecord.marks.section',
      'shopWalkRecord.marks.counter',
      'shopWalkRecord.marks.note',
    ]);

    // The saver's 20 s save: one started entry with the kept path.
    walkFor(harness, 5_000, 20_000);
    await flush(fixture);
    expect(walks.appended[0]).toEqual(
      expect.objectContaining({ kind: 'started', baseSeq: 0, logFrom: 0 })
    );
    expect(walks.appended[0].events[0]).toEqual(
      expect.objectContaining({ type: 'path' })
    );
    // The next 20 s save is a new continued entry built on the answered seq.
    walkFor(harness, 25_000, 21_000);
    await flush(fixture);
    expect(walks.appended[1]).toEqual(
      expect.objectContaining({ kind: 'continued', baseSeq: 1 })
    );
    expect(walks.appended[1].id).not.toBe(walks.appended[0].id);
  });

  it('marks where the phone is, from the sheet whose Save sits above the keyboard', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, walks } = harness;
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);

    click(fixture, '.marks .mark.primary');
    const sheet = fixture.debugElement.query(By.directive(MarkSheet));
    expect(sheet).not.toBeNull();
    expect((sheet.componentInstance as MarkSheet).kind()).toBe('section');
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      '#mark-name'
    ) as HTMLInputElement;
    field.value = 'Lácteos';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click(fixture, '.savebar .save');

    expect(fixture.debugElement.query(By.directive(MarkSheet))).toBeNull();
    walkFor(harness, 3_000, 200);
    const marks = fixture.componentInstance.document()?.marks ?? [];
    expect(marks.map((one) => one.text)).toContain('Lácteos');
    await fixture.componentInstance.canLeave();
    await flush(fixture);
    const events = walks.appended.flatMap((entry) => entry.events);
    expect(
      events.some(
        (event) => event.type === 'mark-put' && event.mark.text === 'Lácteos'
      )
    ).toBe(true);
  });

  it('stops on Stop, saves the stop with its reason, and goes to the history', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, sensors, walks, pages, walkId } = harness;
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);

    click(fixture, '.bar .stop');
    await flush(fixture);
    await flush(fixture);

    expect(sensors.ends).toBe(1);
    expect(walks.appended.map((one) => [one.kind, one.reason])).toEqual([
      ['started', undefined],
      ['stopped', 'button'],
    ]);
    expect(pages.back).toHaveBeenCalledWith(HISTORY(walkId));
  });

  it('stops with a sound when tracking is lost, and offers a resume at a mark once stopped', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, tones, walks } = harness;
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);
    walkFor(harness, 3_000, 1_000, { tracked: false });

    expect(tones.stopped).toHaveBeenCalledTimes(1);
    expect(all(fixture, '.warn-title')).toEqual([
      'shopWalkRecord.stopped.title',
    ]);
    expect(all(fixture, '.warn-body')).toEqual(['shopWalkRecord.stopped.lost']);
    // Review of #576, item 3: no resume while tracking may still come back.
    expect(all(fixture, '.controls .primary')).toEqual([]);
    expect(all(fixture, '.controls .hint')).toEqual([
      'shopWalkRecord.stopped.lostHint',
    ]);

    walkFor(harness, 4_000, 3_000, { tracked: false });
    await flush(fixture);
    expect(all(fixture, '.pill')).toEqual(['shopWalkRecord.status.stopped']);
    expect(all(fixture, '.warn-body')).toEqual([
      'shopWalkRecord.stopped.trackingLost',
    ]);
    expect(tones.stopped).toHaveBeenCalledTimes(1);
    expect(walks.appended.map((one) => one.reason ?? one.kind)).toContain(
      'tracking-lost'
    );
    expect(all(fixture, '.controls .primary')).toEqual([
      'shopWalkRecord.stopped.resume',
    ]);
  });

  it('asks "is the purple path right?" after an automatic resume, and keeps it on yes', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, tones, walks } = harness;
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);
    walkFor(harness, 3_000, 1_000, { tracked: false });
    walkFor(harness, 4_000, 3_000);

    expect(tones.resumed).toHaveBeenCalledTimes(1);
    expect(all(fixture, '.check-title')).toEqual([
      'shopWalkRecord.check.title',
    ]);
    expect(harness.view()?.live()?.unconfirmed?.length).toBeGreaterThan(5);
    expect(harness.view()?.live()?.person).toBeUndefined();

    click(fixture, '.check .primary');
    walkFor(harness, 7_000, 200);
    expect(all(fixture, '.pill')).toEqual(['shopWalkRecord.status.good']);
    await fixture.componentInstance.canLeave();
    await flush(fixture);
    // The loss saved the session so far; the purple points, once confirmed,
    // are the session's next save, and walking goes on as a resumed session.
    expect(walks.appended.map((one) => one.kind)).toEqual([
      'started',
      'continued',
      'confirmed',
      'resumed',
      'stopped',
    ]);
  });

  it('resumes the walk from history at a chosen mark, as a resumed entry', async () => {
    const harness = await renderPage({ walkId: MEMORY_OTHER_WALK_ID });
    const { fixture, sensors, walks } = harness;

    expect(all(fixture, '.bar .title')).toEqual(['shopWalkRecord.where.title']);
    const chips = all(fixture, '.controls .chip');
    expect(chips).toEqual(['Huevos']);
    click(fixture, '.controls .chip');
    expect(all(fixture, '.picked-name')).toEqual(['Huevos']);
    expect(harness.view()?.live()?.person).toBeDefined();

    const page = fixture.componentInstance as unknown as {
      startFromHere(): Promise<void>;
    };
    const starting = page.startFromHere();
    await flush(fixture);
    expect(sensors.starts).toBe(1);
    walkFor(harness, 0, 600);
    await starting;
    fixture.detectChanges();

    expect(all(fixture, '.pill')).toEqual(['shopWalkRecord.status.good']);
    walkFor(harness, 600, 2_000);
    await fixture.componentInstance.canLeave();
    await flush(fixture);
    expect(walks.appended[0]).toEqual(
      expect.objectContaining({ kind: 'resumed' })
    );
  });

  // Review of #576, item 1.
  it('turns a resume from the history by the compass when the walk has a baseline', async () => {
    const harness = await renderPage({
      walkId: MEMORY_OTHER_WALK_ID,
      baseline: 300,
    });
    const { fixture, sensors, walks } = harness;
    click(fixture, '.controls .chip');
    const mark = fixture.componentInstance.document()?.marks[0];
    if (mark === undefined) {
      throw new Error('no mark');
    }
    const page = fixture.componentInstance as unknown as {
      startFromHere(): Promise<void>;
    };
    const starting = page.startFromHere();
    await flush(fixture);
    expect(sensors.starts).toBe(1);

    // Standing at the mark in a camera frame turned 90 degrees, facing 20
    // degrees off the mark's arrow, with the compass true to the walk.
    const facing = mark.heading + 20;
    const stand = (from: number, to: number) => {
      for (let t = from; t < to; t += 100) {
        sensors.compass(compassAt(t, facing + 300));
        sensors.pose(uprightPose(t, -mark.y, mark.x, facing + 90));
        jest.advanceTimersByTime(100);
      }
    };
    stand(0, 1_500);
    await starting;
    stand(1_500, 1_800);
    fixture.detectChanges();

    expect(all(fixture, '.pill')).toEqual(['shopWalkRecord.status.good']);
    const person = harness.view()?.live()?.person;
    expect(person?.heading).toBeDefined();
    const off = Math.abs((((person?.heading ?? 0) - facing + 540) % 360) - 180);
    expect(off).toBeLessThan(2);
    await fixture.componentInstance.canLeave();
    await flush(fixture);
    expect(walks.appended[0]).toEqual(
      expect.objectContaining({ kind: 'resumed' })
    );
  });

  // Review of #577: Start from here runs once, and Close cancels it.
  it('resumes once for a double tap while it waits for the compass', async () => {
    const harness = await renderPage({
      walkId: MEMORY_OTHER_WALK_ID,
      baseline: 300,
    });
    const { fixture, sensors, walks } = harness;
    click(fixture, '.controls .chip');
    click(fixture, '.controls .primary');
    await flush(fixture);
    click(fixture, '.controls .primary');
    await flush(fixture);

    expect(sensors.starts).toBe(1);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.controls .primary')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(all(fixture, '.notice-text')).toEqual([
      'shopWalkRecord.notice.cameraWaiting',
    ]);

    // No compass on this phone: tracked poses only, for the whole wait.
    for (let t = 0; t < 6_000; t += 100) {
      sensors.pose(uprightPose(t, 0, 0, 0));
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }
    await flush(fixture);
    expect(all(fixture, '.pill')).toEqual(['shopWalkRecord.status.good']);
    await fixture.componentInstance.canLeave();
    await flush(fixture);

    expect(walks.appended.map((one) => [one.kind, one.reason])).toEqual([
      ['resumed', undefined],
      ['stopped', 'left-page'],
    ]);
  });

  it('resumes nothing when Close is tapped during the wait', async () => {
    const harness = await renderPage({
      walkId: MEMORY_OTHER_WALK_ID,
      baseline: 300,
    });
    const { fixture, sensors, walks, pages } = harness;
    click(fixture, '.controls .chip');
    click(fixture, '.controls .primary');
    await flush(fixture);
    for (let t = 0; t < 1_000; t += 100) {
      sensors.pose(uprightPose(t, 0, 0, 0));
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }

    click(fixture, '.bar .back');
    await flush(fixture);
    for (let t = 1_000; t < 6_000; t += 100) {
      sensors.pose(uprightPose(t, 0, 0, 0));
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }
    await flush(fixture);

    expect(pages.back).toHaveBeenCalled();
    expect(walks.appended).toEqual([]);
    expect(all(fixture, '.pill')).toEqual([]);
  });

  it('keeps the notice of a walk read again during the wait', async () => {
    const harness = await renderPage({
      walkId: MEMORY_OTHER_WALK_ID,
      baseline: 300,
    });
    const { fixture, sensors, walks } = harness;
    click(fixture, '.controls .chip');
    click(fixture, '.controls .primary');
    await flush(fixture);
    expect(all(fixture, '.notice-text')).toEqual([
      'shopWalkRecord.notice.cameraWaiting',
    ]);

    // Another phone saved first: the page reads the walk again and says so.
    const page = fixture.componentInstance as unknown as {
      _reload(notice: 'changed' | 'refused'): Promise<void>;
    };
    await page._reload('changed');
    for (let t = 0; t < 1_000; t += 100) {
      sensors.pose(uprightPose(t, 0, 0, 0));
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    }
    await flush(fixture);

    expect(all(fixture, '.notice-text')).toEqual([
      'shopWalkRecord.notice.changed',
    ]);
    expect(walks.appended).toEqual([]);
  });

  // Review of #576, item 4.
  it('keeps the mark sheet and its text while tracking is lost, and saves once it is back', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture } = harness;
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);
    click(fixture, '.marks .mark.primary');
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      '#mark-name'
    ) as HTMLInputElement;
    field.value = 'Lácteos';
    field.dispatchEvent(new Event('input'));

    walkFor(harness, 3_000, 800, { tracked: false });
    click(fixture, '.savebar .save');

    expect(fixture.debugElement.query(By.directive(MarkSheet))).not.toBeNull();
    expect(all(fixture, '.savebar .waiting')).toEqual([
      'shopWalkRecord.mark.waiting',
    ]);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.savebar .save')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(field.value).toBe('Lácteos');

    // Back within 3 s by itself, and confirmed: Save now makes the mark.
    walkFor(harness, 3_800, 1_000);
    click(fixture, '.check .primary');
    walkFor(harness, 4_800, 300);
    click(fixture, '.savebar .save');
    expect(fixture.debugElement.query(By.directive(MarkSheet))).toBeNull();
    walkFor(harness, 5_100, 200);
    expect(
      fixture.componentInstance.document()?.marks.map((one) => one.text)
    ).toContain('Lácteos');
  });

  it('says so where the browser has no camera tracking', async () => {
    const { fixture } = await renderPage({ camera: false });

    expect(all(fixture, '.state-title')).toEqual([
      'shopWalkRecord.unsupported.title',
    ]);
  });

  it('stops the walk when the page is hidden, unless the camera holds the screen', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, sensors, walks } = harness;
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);
    const hidden = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');

    document.dispatchEvent(new Event('visibilitychange'));
    expect(sensors.ends).toBe(0);

    sensors.showing = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(fixture);
    hidden.mockRestore();

    expect(sensors.ends).toBe(1);
    expect(walks.appended.map((one) => one.reason).filter(Boolean)).toEqual([
      'left-page',
    ]);
    expect(walks.appendOptions.some((one) => one.keepalive === true)).toBe(
      true
    );
  });

  it('shows "Not saved yet" when leaving with a save that did not arrive', async () => {
    const harness = await renderPage({ fresh: true });
    const { fixture, walks } = harness;
    jest
      .spyOn(walks, 'append')
      .mockRejectedValue(
        new GatewayError({ code: 'internal', status: 0, correlationId: 'spec' })
      );
    click(fixture, '.controls .primary');
    await flush(fixture);
    walkFor(harness, 0, 3_000);

    const leaving = fixture.componentInstance.canLeave();
    await flush(fixture);
    await flush(fixture);

    expect(all(fixture, 'lib-unsaved-dialog .body')[0]).toBe(
      'shopWalkRecord.unsaved.body'
    );
    click(fixture, 'lib-unsaved-dialog .leave');
    expect(await leaving).toBe(true);
  });
});

describe('the shelf suggestion (velista 0126)', () => {
  const mark = (overrides: Partial<MapMark>): MapMark => ({
    id: 'm',
    kind: 'section',
    x: 0,
    y: 0,
    heading: 90,
    text: 'Congelados',
    logMs: 0,
    ...overrides,
  });

  it('takes its section from the nearest section mark within reach', () => {
    const suggestion = { id: 's', x: 1, y: 0, w: 1.5, h: 13 };
    expect(
      suggestionSection(suggestion, [
        mark({ x: 0, y: 2, text: 'Congelados' }),
        mark({ x: 3.5, y: 2, text: 'Lácteos' }),
        mark({ kind: 'note', x: 1.2, y: 2, text: 'A note' }),
      ])
    ).toEqual({ name: 'Congelados', metres: 1 });
    expect(suggestionSection(suggestion, [mark({ x: -2 })])).toBeNull();
  });

  it('fills as a shelf with the section chosen after Change', async () => {
    TestBed.resetTestingModule();
    const harness = shopMapTesting();
    await TestBed.configureTestingModule({
      imports: [SuggestionSheet, RokuTranslatorTestingModule.forTesting()],
      providers: harness.providers,
    }).compileComponents();
    const fixture = TestBed.createComponent(SuggestionSheet);
    fixture.componentRef.setInput('suggestion', {
      id: 's',
      x: 1,
      y: 0,
      w: 1.5,
      h: 13,
    });
    fixture.componentRef.setInput('section', { name: 'Congelados', metres: 1 });
    fixture.componentRef.setInput('names', ['Congelados', 'Lácteos']);
    fixture.detectChanges();
    const answers: SuggestionAnswer[] = [];
    fixture.componentInstance.answered.subscribe((one) => answers.push(one));

    expect(all(fixture, '.card-name')).toEqual(['Congelados']);
    click(fixture, '.change');
    const chips = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLElement>('.chip');
    chips[1].click();
    fixture.detectChanges();
    click(fixture, '.buttons .primary');
    click(fixture, '.buttons .secondary');

    expect(answers).toEqual([
      { fill: true, section: 'Lácteos' },
      { fill: false },
    ]);
  });
});
