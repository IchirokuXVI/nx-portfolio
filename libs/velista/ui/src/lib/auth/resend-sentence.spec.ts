import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ResendSentence, type ResendState } from './resend-sentence';

/**
 * A host, so `state` and `waitSeconds` can be changed the way the container changes
 * them: as inputs. Setting a signal input through `setInput` would work too, but this
 * is the shape the two real callers have, and the effect that drives the countdown is
 * the thing under test.
 */
@Component({
  imports: [ResendSentence],
  template: `
    <lib-resend-sentence [state]="state()" [waitSeconds]="waitSeconds()" />
  `,
})
class Host {
  readonly state = signal<ResendState>('ready');
  readonly waitSeconds = signal<number | null>(null);
}

async function render(): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

/**
 * The clock the sentence would interpolate.
 *
 * Read off the component rather than out of the DOM, because the testing translator
 * answers with the key rather than the sentence, so `{{wait}}` never reaches the text.
 * What matters here is the number and its formatting, and this is where both live.
 */
function clock(fixture: ComponentFixture<Host>): string | null {
  const shown = fixture.debugElement.query(By.directive(ResendSentence))
    .componentInstance as ResendSentence;

  return shown.clock() === '' ? null : shown.clock();
}

describe('ResendSentence', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('offers the action when nothing has been asked yet', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('button')).not.toBeNull();
  });

  /**
   * **Rule C3, and the acceptance criterion it is written for.**
   *
   * How long is left is the server's to say and never a screen's to assume. The wait
   * below is far longer than any bucket in the product, which is the point: whatever
   * number comes back is what is drawn. A hardcoded sixty would count down to zero,
   * invite the tap, and fail again, which is worse than not offering the action at all.
   */
  it('counts a refusal down from the servers number, not from 60', async () => {
    const fixture = await render();

    // 7:31, which is the wait the mock draws and is seven minutes past what a
    // hardcoded countdown could ever show.
    fixture.componentInstance.waitSeconds.set(451);
    fixture.componentInstance.state.set('refused');
    fixture.detectChanges();

    expect(clock(fixture)).toBe('7:31');

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(clock(fixture)).toBe('7:30');

    // A minute in, a sixty second countdown would have finished and put the action
    // back. This one is still counting, which is the whole difference.
    jest.advanceTimersByTime(60_000);
    fixture.detectChanges();
    expect(clock(fixture)).toBe('6:30');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('counts a successful send down from its own wait', async () => {
    const fixture = await render();

    fixture.componentInstance.waitSeconds.set(52);
    fixture.componentInstance.state.set('sent');
    fixture.detectChanges();

    expect(clock(fixture)).toBe('0:52');
  });

  it('returns to the action once the countdown runs out', async () => {
    const fixture = await render();

    fixture.componentInstance.waitSeconds.set(3);
    fixture.componentInstance.state.set('sent');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();

    jest.advanceTimersByTime(3000);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button')).not.toBeNull();
  });

  /**
   * Rule C3 has no fallback duration to reach for, so a state the server named no
   * wait for renders a sentence with no clock in it, and does **not** put the action
   * straight back: not being told how long to wait is not the same as having waited.
   */
  it('shows no clock, and no action, when the server named no wait', async () => {
    const fixture = await render();

    fixture.componentInstance.waitSeconds.set(null);
    fixture.componentInstance.state.set('refused');
    fixture.detectChanges();

    expect(clock(fixture)).toBeNull();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  /**
   * The plan asks for this to be proven by a spec rather than by reading the
   * component, because a leaked interval is invisible until it is not: it keeps a
   * destroyed component's signals alive and ticks for the rest of the session.
   */
  it('clears its interval on destroy', async () => {
    const fixture = await render();
    const cleared = jest.spyOn(globalThis, 'clearInterval');

    fixture.componentInstance.waitSeconds.set(120);
    fixture.componentInstance.state.set('sent');
    fixture.detectChanges();

    const before = jest.getTimerCount();
    fixture.destroy();

    expect(cleared).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBeLessThan(before);

    cleared.mockRestore();
  });

  it('starts one interval per state change, never two at once', async () => {
    // Asking again while a countdown is already running restarts it rather than
    // stacking a second ticker on top, which would count down twice as fast.
    const fixture = await render();

    fixture.componentInstance.waitSeconds.set(120);
    fixture.componentInstance.state.set('sent');
    fixture.detectChanges();

    fixture.componentInstance.waitSeconds.set(60);
    fixture.componentInstance.state.set('refused');
    fixture.detectChanges();

    expect(jest.getTimerCount()).toBe(1);
    expect(clock(fixture)).toBe('1:00');
  });
});
