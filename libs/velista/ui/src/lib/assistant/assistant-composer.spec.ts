import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AUDIO_CAPTURE,
  AudioRecorder,
  RECORDING_LIMITS,
  provideVelistaTesting,
  type AudioCaptureI,
  type AudioCaptureSession,
} from '@portfolio/velista/platform';
import { AssistantComposer } from './assistant-composer';

/**
 * The thresholds this spec drives, and the whole reason they are injected.
 *
 * Plan 0032's last exit criterion: the 3:00 and 5:00 states have to be reachable in a
 * test without waiting five minutes. Six seconds and ten, so the arithmetic is the
 * same and the wait is not.
 */
const WARN_AT = 6;
const MAX = 10;

/** A microphone that is always there and always hands back the same recording. */
const RECORDING = new Blob(['audio'], { type: 'audio/webm' });

function fakeCapture(overrides: Partial<AudioCaptureI> = {}): AudioCaptureI {
  const session: AudioCaptureSession = {
    pause: jest.fn(),
    resume: jest.fn(),
    stop: jest.fn().mockResolvedValue(RECORDING),
    close: jest.fn(),
  };

  return {
    supported: () => true,
    open: () => Promise.resolve(session),
    ...overrides,
  };
}

async function render(
  capture: AudioCaptureI = fakeCapture()
): Promise<ComponentFixture<AssistantComposer>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [AssistantComposer, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      AudioRecorder,
      { provide: AUDIO_CAPTURE, useValue: capture },
      {
        provide: RECORDING_LIMITS,
        useValue: { warnAtSeconds: WARN_AT, maxSeconds: MAX },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AssistantComposer);
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<AssistantComposer>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function action(
  fixture: ComponentFixture<AssistantComposer>
): HTMLButtonElement {
  const button = host(fixture).querySelector<HTMLButtonElement>('.action');
  if (button === null) {
    throw new Error('the one action button is not rendered');
  }
  return button;
}

function field(
  fixture: ComponentFixture<AssistantComposer>
): HTMLInputElement | null {
  return host(fixture).querySelector<HTMLInputElement>('.field');
}

function type(
  fixture: ComponentFixture<AssistantComposer>,
  text: string
): void {
  const input = field(fixture);
  if (input === null) {
    throw new Error('there is no field to type into');
  }
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/**
 * Presses the one button and lets its promise settle.
 *
 * Microtasks rather than `whenStable`, because half of these tests run under fake
 * timers and `whenStable` waits on a real one, which never fires. Everything the press
 * awaits — opening the capture, taking the blob — is a resolved promise, so draining
 * the microtask queue is enough and is the same under both clocks.
 */
async function press(
  fixture: ComponentFixture<AssistantComposer>
): Promise<void> {
  action(fixture).click();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

/** Which glyph the one slot is currently showing. */
function glyph(fixture: ComponentFixture<AssistantComposer>): string {
  const icons = ['lib-mic-icon', 'lib-send-icon', 'lib-stop-icon'];

  return (
    icons.find((icon) => action(fixture).querySelector(icon) !== null) ??
    'nothing'
  );
}

describe('AssistantComposer', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('one slot, three jobs', () => {
    it('is a microphone on an empty field', async () => {
      const fixture = await render();

      expect(glyph(fixture)).toBe('lib-mic-icon');
    });

    it('becomes send the moment anything is typed', async () => {
      const fixture = await render();

      type(fixture, 'Add milk');

      expect(glyph(fixture)).toBe('lib-send-icon');
    });

    it('is stop while recording', async () => {
      const fixture = await render();

      await press(fixture);

      expect(glyph(fixture)).toBe('lib-stop-icon');
    });

    it('never moves: it is the same element in the same place throughout', async () => {
      // Nothing may move under the thumb. Stop inherits the microphone's exact
      // position, so the finger that started a recording ends it without travelling
      // (section 4.1).
      const fixture = await render();
      const before = action(fixture);

      type(fixture, 'Add milk');
      expect(action(fixture)).toBe(before);

      type(fixture, '');
      await press(fixture);
      expect(action(fixture)).toBe(before);
    });

    it('sends what was typed and clears the field', async () => {
      const fixture = await render();
      const sent: string[] = [];
      fixture.componentInstance.send.subscribe((text) => sent.push(text));

      type(fixture, '  Add milk  ');
      await press(fixture);

      expect(sent).toEqual(['Add milk']);
      expect(field(fixture)?.value).toBe('');
    });
  });

  describe('a press, not a hold', () => {
    it('starts and stops on single presses', async () => {
      // Press and hold is the gesture this audience cannot perform: it asks for
      // sustained, steady pressure for the length of the message, which is precisely
      // what a tremor removes (section 4.2).
      const fixture = await render();
      const spoken: Blob[] = [];
      fixture.componentInstance.spoke.subscribe((audio) => spoken.push(audio));

      await press(fixture);
      expect(glyph(fixture)).toBe('lib-stop-icon');

      await press(fixture);
      expect(glyph(fixture)).toBe('lib-mic-icon');
      // The recording, not the words: the service transcribes (backend `0041`).
      expect(spoken).toEqual([RECORDING]);
    });

    it('survives the pointer leaving the button mid recording', async () => {
      // The component listens to `click` and to nothing else, so a finger that drifts
      // off the button, or lifts and comes back, changes nothing.
      const fixture = await render();

      await press(fixture);
      // Plain events, because jsdom has no `PointerEvent`. What is being asserted is
      // that nothing is listening for these at all, so the constructor does not matter.
      action(fixture).dispatchEvent(
        new Event('pointerleave', { bubbles: true })
      );
      action(fixture).dispatchEvent(new Event('pointerup', { bubbles: true }));
      action(fixture).dispatchEvent(new Event('mouseleave', { bubbles: true }));
      fixture.detectChanges();

      expect(glyph(fixture)).toBe('lib-stop-icon');
    });
  });

  describe('the control row', () => {
    it('renders pause, the length, then stop, in that order', async () => {
      // Pause at the far left and stop at the far right, as far apart as the container
      // allows: they are the only two controls on screen and confusing them costs the
      // whole message, so the distance is the safeguard (section 4.3).
      const fixture = await render();

      await press(fixture);

      const row = host(fixture).querySelector('.row');
      const order = Array.from(row?.children ?? []).map(
        (child) => child.className.split(' ')[0]
      );
      expect(order).toEqual(['control', 'dot', 'elapsed', 'action']);
    });

    it('marks listening and paused by shape as well as colour', async () => {
      // Pause is two bars, carry on is a triangle, and the dot is filled or hollow.
      // Somebody who cannot tell the amber from the coral still has two controls.
      const fixture = await render();

      await press(fixture);
      expect(
        host(fixture).querySelector('.control lib-pause-icon')
      ).not.toBeNull();
      expect(host(fixture).querySelector('.dot.listening')).not.toBeNull();

      host(fixture).querySelector<HTMLButtonElement>('.control')?.click();
      fixture.detectChanges();

      expect(
        host(fixture).querySelector('.control lib-play-icon')
      ).not.toBeNull();
      expect(host(fixture).querySelector('.dot.listening')).toBeNull();
    });
  });

  describe('the two thresholds', () => {
    it('warns at the first one and keeps recording', async () => {
      jest.useFakeTimers();
      const fixture = await render();

      await press(fixture);
      jest.advanceTimersByTime(WARN_AT * 1000);
      fixture.detectChanges();

      const notice = host(fixture).querySelector('.notice');
      expect(notice?.textContent).toContain('longest');
      // Still listening: the warning grows the container, it does not stop anything.
      expect(host(fixture).querySelector('.dot.listening')).not.toBeNull();
      expect(
        host(fixture).querySelector<HTMLButtonElement>('.control')?.disabled
      ).toBe(false);
    });

    it('pauses at the second one, sends nothing, and says so', async () => {
      // Sending on a timer takes the choice away from somebody who was mid sentence,
      // and a message that leaves on its own is a message nobody agreed to send. So it
      // is held, pause is disabled, and stop is the only way out (section 4.4).
      jest.useFakeTimers();
      const fixture = await render();
      const spoken: Blob[] = [];
      fixture.componentInstance.spoke.subscribe((audio) => spoken.push(audio));

      await press(fixture);
      jest.advanceTimersByTime(MAX * 1000);
      fixture.detectChanges();

      expect(spoken).toHaveLength(0);
      expect(host(fixture).querySelector('.dot.listening')).toBeNull();
      expect(
        host(fixture).querySelector<HTMLButtonElement>('.control')?.disabled
      ).toBe(true);
      expect(host(fixture).querySelector('.notice')?.textContent).toContain(
        'pressStop'
      );
      // And stop still works, which is the whole point of holding it.
      expect(glyph(fixture)).toBe('lib-stop-icon');
    });
  });

  describe('when the microphone is not available', () => {
    it('renders a state for a refusal and never rejects', async () => {
      const fixture = await render(
        fakeCapture({
          open: () => Promise.reject(new Error('NotAllowedError')),
        })
      );

      await press(fixture);

      expect(host(fixture).querySelector('.trouble')?.textContent).toContain(
        'refused'
      );
      // The typed field is still there, which is why this is said here rather than
      // over the whole panel.
      expect(field(fixture)).not.toBeNull();
    });

    it('says so plainly when the browser cannot record at all', async () => {
      const fixture = await render(fakeCapture({ supported: () => false }));

      await press(fixture);

      expect(host(fixture).querySelector('.trouble')?.textContent).toContain(
        'unavailable'
      );
    });
  });

  describe('while a turn is out', () => {
    it('holds the field and the button, and keeps the text', async () => {
      const fixture = await render();

      type(fixture, 'Add tomatoes');
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();

      expect(field(fixture)?.disabled).toBe(true);
      expect(action(fixture).disabled).toBe(true);
      expect(field(fixture)?.value).toBe('Add tomatoes');
    });
  });
});
