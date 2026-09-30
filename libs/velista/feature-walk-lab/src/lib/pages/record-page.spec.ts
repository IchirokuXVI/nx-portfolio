import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  ReloadBlocker,
} from '@portfolio/velista/platform';
import { SAVE_EVERY_MS, WalkCapture } from '../capture/walk-capture';
import { WalkDb } from '../storage/walk-db';
import { WalkFiles } from '../storage/walk-files';
import { WalkLabState } from '../walk-lab-state';
import { RecordPage } from './record-page';

@Component({ selector: 'lib-test-page', template: '' })
class TestPage {}

/** One `devicemotion` event, as a phone lying flat would send it. */
function motion(az: number, yawDegPerSecond = 0): Event {
  const event = new Event('devicemotion');
  Object.defineProperty(event, 'accelerationIncludingGravity', {
    value: { x: 0.05, y: 0.1, z: az },
  });
  Object.defineProperty(event, 'rotationRate', {
    value: { alpha: yawDegPerSecond, beta: 0, gamma: 0 },
  });
  return event;
}

/**
 * Walking in place: gravity plus a bounce at `cadence` steps a second, one sample
 * every ten milliseconds, advancing the fake clock between samples so every row gets
 * a real `t`.
 */
async function walkFor(seconds: number, cadence = 1.8): Promise<void> {
  for (let i = 0; i < seconds * 100; i++) {
    const t = i / 100;
    window.dispatchEvent(
      motion(9.81 + 3 * Math.sin(2 * Math.PI * cadence * t))
    );
    jest.advanceTimersByTime(10);
    if (i % 50 === 0) {
      await Promise.resolve();
    }
  }
}

describe('RecordPage', () => {
  beforeAll(() => {
    // jsdom has no motion API at all; a browser that has one exposes the constructor.
    (window as unknown as { DeviceMotionEvent: unknown }).DeviceMotionEvent =
      class {};
  });

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [RecordPage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        provideRouter([{ path: '**', component: TestPage }]),
        provideVelistaTesting(),
        provideFakeBrowserFacade(),
        WalkDb,
        WalkCapture,
        WalkFiles,
        WalkLabState,
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    // Only the viewport spec stubs it, and a failed assertion there must not leak it.
    delete (window as { visualViewport?: unknown }).visualViewport;
  });

  it('counts steps from devicemotion, saves as it goes, and keeps the walk on Finish', async () => {
    const page = TestBed.createComponent(RecordPage).componentInstance;
    const db = TestBed.inject(WalkDb);
    const reload = TestBed.inject(ReloadBlocker);
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    page.setName('Test shop');
    page.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(page.phase()).toBe('recording');
    expect(reload.isBlocked()).toBe(true);

    await walkFor(12);
    // The live track is redrawn every half second.
    jest.advanceTimersByTime(600);

    expect(page.steps()).toBeGreaterThan(15);
    expect(page.status().motion).toBeGreaterThan(1000);

    // Saved progressively: the list already shows it, as partial, before Finish.
    await jest.advanceTimersByTimeAsync(SAVE_EVERY_MS);
    const during = await db.list();
    expect(during).toHaveLength(1);
    expect(during[0].partial).toBe(true);
    expect(during[0].durationMs).toBeGreaterThan(10_000);

    page.markNow('entrance');
    page.openPanel('checkpoint');
    page.draft.set('door');
    page.saveLabel();
    expect(page.usedLabels()).toEqual(['door']);

    await page.finish();
    expect(page.finishArmed()).toBe(true);
    await page.finish();

    const saved = await db.list();
    expect(saved).toHaveLength(1);
    expect(saved[0].partial).toBe(false);
    const walk = await db.get(saved[0].id);
    expect(walk?.name).toBe('Test shop');
    expect(walk?.source.platform).toBe('web');
    expect(walk?.streams.motion?.length).toBeGreaterThan(1000);
    expect(walk?.marks.map((m) => m.kind)).toEqual(['entrance', 'checkpoint']);
    expect(reload.isBlocked()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      ['..', saved[0].id],
      expect.objectContaining({ replaceUrl: true })
    );
  });

  it('ends the recording and keeps the walk when the page is hidden', async () => {
    const page = TestBed.createComponent(RecordPage).componentInstance;
    const db = TestBed.inject(WalkDb);

    page.start();
    await Promise.resolve();
    await Promise.resolve();
    await walkFor(2);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await jest.advanceTimersByTimeAsync(10);

    expect(page.phase()).toBe('stopped');
    expect(page.stopReason()).toBe('hidden');
    const list = await db.list();
    expect(list).toHaveLength(1);
    const walk = await db.get(list[0].id);
    expect(walk?.events.some((e) => e.kind === 'hidden')).toBe(true);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('deletes the last mark, saved or not, and the stored walk agrees', async () => {
    const page = TestBed.createComponent(RecordPage).componentInstance;
    const db = TestBed.inject(WalkDb);
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    page.start();
    await Promise.resolve();
    await Promise.resolve();
    await walkFor(1);

    page.markNow('entrance');
    jest.advanceTimersByTime(100);
    page.openPanel('checkpoint');
    page.draft.set('wrong');
    page.saveLabel();
    // Both marks are drained into storage.
    await jest.advanceTimersByTimeAsync(SAVE_EVERY_MS);

    jest.advanceTimersByTime(100);
    page.markNow('checkout');
    expect(page.lastMark()?.kind).toBe('checkout');

    // Not yet saved: simply removed.
    page.deleteLastMark();
    expect(page.lastMark()?.label).toBe('wrong');
    // Already saved: cancelled with an event.
    page.deleteLastMark();
    expect(page.lastMark()?.kind).toBe('entrance');
    expect(page.marks().map((m) => m.kind)).toEqual(['entrance']);
    expect(page.usedLabels()).toEqual([]);

    await page.finish();
    await page.finish();

    const [summary] = await db.list();
    const walk = await db.get(summary.id);
    expect(walk?.marks.map((m) => m.kind)).toEqual(['entrance']);
    expect(walk?.events.filter((e) => e.kind === 'mark-deleted')).toHaveLength(
      1
    );
  });

  it('hides Delete last mark while a panel is open', async () => {
    const fixture = TestBed.createComponent(RecordPage);
    const page = fixture.componentInstance;
    const deleteButton = (): HTMLButtonElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector('.delete-last');

    page.start();
    await Promise.resolve();
    await Promise.resolve();
    page.markNow('entrance');
    fixture.detectChanges();
    expect(deleteButton()?.textContent?.trim()).toBe(
      'walkLab.record.deleteLastMark'
    );

    // A tap on it would delete a mark from under the label being typed.
    page.openPanel('checkpoint');
    fixture.detectChanges();
    expect(deleteButton()).toBeNull();

    page.closePanel();
    fixture.detectChanges();
    expect(deleteButton()).not.toBeNull();
  });

  it('pins the open panel to the bottom of the visual viewport', () => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      offsetTop: 0,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });

    const page = TestBed.createComponent(RecordPage).componentInstance;
    page.start();
    page.openPanel('checkpoint');
    expect(page.panelInset()).toBe(0);

    // The keyboard opens and takes 300 pixels.
    viewport.height = window.innerHeight - 300;
    viewport.dispatchEvent(new Event('resize'));
    expect(page.panelInset()).toBe(300);
    expect(page.panelMaxHeight()).toBe(window.innerHeight - 300);

    page.closePanel();
    expect(page.panelInset()).toBe(0);
    viewport.dispatchEvent(new Event('resize'));
    expect(page.panelInset()).toBe(0);
  });

  it('asks for a second tap before it finishes', async () => {
    const page = TestBed.createComponent(RecordPage).componentInstance;
    page.start();
    await Promise.resolve();

    await page.finish();
    expect(page.phase()).toBe('recording');
    jest.advanceTimersByTime(5_000);
    expect(page.finishArmed()).toBe(false);
  });
});
