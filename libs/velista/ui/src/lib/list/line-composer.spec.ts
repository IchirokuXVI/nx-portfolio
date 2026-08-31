import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { RecordedAudio } from '@portfolio/velista/models';
import {
  AUDIO_CAPTURE,
  AudioRecorder,
  RECORDING_LIMITS,
  SILENCE_DETECTOR,
  type AudioCaptureI,
  type SilenceDetectorI,
  type SilenceHandlers,
} from '@portfolio/velista/platform';
import { LineComposer } from './line-composer';

/**
 * Plan 0038: the add button records when there is nothing typed.
 *
 * Nothing here reaches a microphone, a `MediaRecorder` or an `AudioContext`. The
 * detector is a fake that hands back its handlers, so a test ends a recording by
 * calling `onEnd` rather than by making a noise.
 */
const RECORDING = new Blob(['audio'], { type: 'audio/webm' });

const STREAM = {} as MediaStream;

function fakeCapture(overrides: Partial<AudioCaptureI> = {}): AudioCaptureI {
  return {
    supported: () => true,
    open: () =>
      Promise.resolve({
        stream: STREAM,
        pause: jest.fn(),
        resume: jest.fn(),
        stop: jest.fn().mockResolvedValue(RECORDING),
        close: jest.fn(),
      }),
    ...overrides,
  };
}

/** A detector that never fires on its own, and hands its handlers to the test. */
function fakeDetector(): SilenceDetectorI & {
  handlers: SilenceHandlers | null;
} {
  const detector = {
    handlers: null as SilenceHandlers | null,
    supported: () => true,
    watch(_stream: MediaStream, handlers: SilenceHandlers) {
      detector.handlers = handlers;
      return { close: () => (detector.handlers = null) };
    },
  };

  return detector;
}

async function render(capture: AudioCaptureI = fakeCapture()) {
  TestBed.resetTestingModule();

  const detector = fakeDetector();

  await TestBed.configureTestingModule({
    imports: [LineComposer, RokuTranslatorTestingModule.forTesting()],
    providers: [
      AudioRecorder,
      { provide: AUDIO_CAPTURE, useValue: capture },
      { provide: SILENCE_DETECTOR, useValue: detector },
      {
        provide: RECORDING_LIMITS,
        useValue: { warnAtSeconds: 30, maxSeconds: 30 },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineComposer);
  fixture.detectChanges();

  return { fixture, detector };
}

function host(fixture: ComponentFixture<LineComposer>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function button(fixture: ComponentFixture<LineComposer>): HTMLButtonElement {
  const found = host(fixture).querySelector<HTMLButtonElement>('.send, .stop');
  if (found === null) {
    throw new Error('the one button is not rendered');
  }
  return found;
}

function type(fixture: ComponentFixture<LineComposer>, text: string): void {
  const field = host(fixture).querySelector<HTMLInputElement>('input.field');
  if (field === null) {
    throw new Error('there is no field to type into');
  }
  field.value = text;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

async function press(fixture: ComponentFixture<LineComposer>): Promise<void> {
  button(fixture).click();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('LineComposer, one slot and the empty field decides', () => {
  it('is a microphone when nothing is typed', async () => {
    const { fixture } = await render();

    expect(button(fixture).querySelector('lib-mic-icon')).not.toBeNull();
  });

  it('becomes the plus the moment one character is typed', async () => {
    const { fixture } = await render();

    type(fixture, 'a');
    expect(button(fixture).querySelector('lib-plus-icon')).not.toBeNull();

    // And back again, because the switch is the field's emptiness rather than a
    // mode somebody selected.
    type(fixture, '');
    expect(button(fixture).querySelector('lib-mic-icon')).not.toBeNull();
  });

  it('adds the line when there is something typed, and records nothing', async () => {
    const { fixture, detector } = await render();
    const added: { content: string; quantity: number }[] = [];
    fixture.componentInstance.submitted.subscribe((one) => added.push(one));

    type(fixture, 'Sourdough loaf');
    await press(fixture);

    expect(added).toEqual([{ content: 'Sourdough loaf', quantity: 1 }]);
    expect(detector.handlers).toBeNull();
  });

  it('records on an empty field, and shows a stop and a meter', async () => {
    const { fixture } = await render();

    await press(fixture);

    expect(host(fixture).querySelector('.stop')).not.toBeNull();
    expect(host(fixture).querySelector('.meter')).not.toBeNull();
    // The field is gone while it listens: somebody speaking never has the
    // keyboard open, and somebody typing never sees the microphone.
    expect(host(fixture).querySelector('input.field')).toBeNull();
  });

  it('emits the recording when the talking stops', async () => {
    const { fixture, detector } = await render();
    const spoken: RecordedAudio[] = [];
    fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

    await press(fixture);
    detector.handlers?.onEnd('silence');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(spoken).toHaveLength(1);
    expect(spoken[0].blob).toBe(RECORDING);
  });

  it('stops on a press as well, because the detector is a convenience', async () => {
    // Stop is always available. The detector is a convenience over a control and
    // never the only way out (plan 0038, section 4).
    const { fixture } = await render();
    const spoken: RecordedAudio[] = [];
    fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

    await press(fixture);
    await press(fixture);

    expect(spoken).toHaveLength(1);
    expect(host(fixture).querySelector('input.field')).not.toBeNull();
  });

  it('moves the meter with the level', async () => {
    const { fixture, detector } = await render();

    await press(fixture);
    detector.handlers?.onLevel?.({ level: 0.2, quiet: false });
    fixture.detectChanges();

    const fill = host(fixture).querySelector<HTMLElement>('.meter-fill');
    expect(fill?.style.inlineSize).not.toBe('0%');
  });

  it('says it did not start rather than throwing', async () => {
    const { fixture } = await render(
      fakeCapture({ open: () => Promise.reject(new Error('denied')) })
    );
    let failed = 0;
    fixture.componentInstance.recordingFailed.subscribe(() => (failed += 1));

    await press(fixture);

    expect(failed).toBe(1);
    // The field still works, which is the point of saying so rather than
    // taking the composer away.
    expect(host(fixture).querySelector('input.field')).not.toBeNull();
  });

  it('records even where nothing can watch the stream', async () => {
    // No stream to analyse is every fake and any browser without the audio API.
    // The recording still runs and the stop button still ends it; what is lost is
    // only the convenience of it ending itself.
    const { fixture } = await render(
      fakeCapture({
        open: () =>
          Promise.resolve({
            stream: null,
            pause: jest.fn(),
            resume: jest.fn(),
            stop: jest.fn().mockResolvedValue(RECORDING),
            close: jest.fn(),
          }),
      })
    );
    const spoken: RecordedAudio[] = [];
    fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

    await press(fixture);
    expect(host(fixture).querySelector('.stop')).not.toBeNull();

    await press(fixture);
    expect(spoken).toHaveLength(1);
  });
});
