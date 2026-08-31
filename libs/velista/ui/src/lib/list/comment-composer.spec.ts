import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { RecordedAudio } from '@portfolio/velista/models';
import {
  AUDIO_CAPTURE,
  AudioRecorder,
  RECORDING_LIMITS,
  type AudioCaptureI,
  type AudioCaptureSession,
} from '@portfolio/velista/platform';
import { CommentComposer } from './comment-composer';

/**
 * Plan 0041: the comment composer records the way the assistant does.
 *
 * The thresholds are injected and tiny here, which is the whole reason
 * `RECORDING_LIMITS` is a token: the warning and the cap both have to be reachable
 * without waiting a real minute, and the arithmetic is the same at six seconds as
 * it is at sixty.
 */
const WARN_AT = 6;
const MAX = 10;

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
): Promise<ComponentFixture<CommentComposer>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [CommentComposer, RokuTranslatorTestingModule.forTesting()],
    providers: [
      AudioRecorder,
      { provide: AUDIO_CAPTURE, useValue: capture },
      {
        provide: RECORDING_LIMITS,
        useValue: { warnAtSeconds: WARN_AT, maxSeconds: MAX },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommentComposer);
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<CommentComposer>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** The button in the bottom right, whichever component is drawing it. */
function action(fixture: ComponentFixture<CommentComposer>): HTMLButtonElement {
  const button = host(fixture).querySelector<HTMLButtonElement>('.send, .stop');
  if (button === null) {
    throw new Error('the one button is not rendered');
  }
  return button;
}

function field(
  fixture: ComponentFixture<CommentComposer>
): HTMLTextAreaElement | null {
  return host(fixture).querySelector<HTMLTextAreaElement>('textarea.field');
}

function type(fixture: ComponentFixture<CommentComposer>, text: string): void {
  const box = field(fixture);
  if (box === null) {
    throw new Error('there is no field to type into');
  }
  box.value = text;
  box.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/**
 * Press the one button and let its promises settle.
 *
 * Microtasks rather than `whenStable`, because half of these run under fake timers
 * and `whenStable` waits on a real one, which never fires.
 */
async function press(
  fixture: ComponentFixture<CommentComposer>
): Promise<void> {
  action(fixture).click();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function glyph(fixture: ComponentFixture<CommentComposer>): string {
  const icons = ['lib-mic-icon', 'lib-send-icon', 'lib-stop-icon'];

  return (
    icons.find((icon) => action(fixture).querySelector(icon) !== null) ??
    'nothing'
  );
}

describe('CommentComposer', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('one button, two jobs', () => {
    it('is a microphone on an empty field', async () => {
      const fixture = await render();

      expect(glyph(fixture)).toBe('lib-mic-icon');
    });

    it('becomes send the moment anything is typed, and back again', async () => {
      const fixture = await render();

      type(fixture, 'Get the big one');
      expect(glyph(fixture)).toBe('lib-send-icon');

      type(fixture, '');
      expect(glyph(fixture)).toBe('lib-mic-icon');
    });

    it('draws the recording row over the field while recording', async () => {
      const fixture = await render();

      await press(fixture);

      expect(host(fixture).querySelector('lib-recording-row')).not.toBeNull();
      expect(field(fixture)).toBeNull();
      expect(glyph(fixture)).toBe('lib-stop-icon');
    });
  });

  describe('stop sends', () => {
    it('emits the recording on one press, with no second press', async () => {
      // Plan 0039 held it for a second press; that rule is about the cap, not the
      // button (plan 0041, section 3).
      const fixture = await render();
      const recorded: RecordedAudio[] = [];
      fixture.componentInstance.recorded.subscribe((one) => recorded.push(one));

      await press(fixture);
      await press(fixture);

      expect(recorded).toHaveLength(1);
      expect(recorded[0].blob).toBe(RECORDING);
      expect(recorded[0].mimeType).toBe('audio/webm');
    });

    it('says so rather than sending when the recording came out empty', async () => {
      const fixture = await render(
        fakeCapture({
          open: () =>
            Promise.resolve({
              pause: jest.fn(),
              resume: jest.fn(),
              stop: jest.fn().mockResolvedValue(new Blob([])),
              close: jest.fn(),
            }),
        })
      );
      const recorded: RecordedAudio[] = [];
      fixture.componentInstance.recorded.subscribe((one) => recorded.push(one));

      await press(fixture);
      await press(fixture);

      expect(recorded).toHaveLength(0);
      expect(host(fixture).querySelector('.error')?.textContent).toContain(
        'recordingEmpty'
      );
    });
  });

  describe('the cap', () => {
    it('warns before it, and keeps recording', async () => {
      jest.useFakeTimers();
      const fixture = await render();

      await press(fixture);
      jest.advanceTimersByTime(WARN_AT * 1000);
      fixture.detectChanges();

      expect(host(fixture).querySelector('.notice')?.textContent).toContain(
        'left'
      );
      expect(host(fixture).querySelector('.dot.live')).not.toBeNull();
    });

    it('holds at it rather than sending, and both ways out stay live', async () => {
      // The cap stops the recording; the person stops the message. A recording that
      // ends because a timer ran out was never agreed to (plan 0041, section 3).
      jest.useFakeTimers();
      const fixture = await render();
      const recorded: RecordedAudio[] = [];
      fixture.componentInstance.recorded.subscribe((one) => recorded.push(one));

      await press(fixture);
      jest.advanceTimersByTime(MAX * 1000);
      fixture.detectChanges();

      expect(recorded).toHaveLength(0);
      expect(host(fixture).querySelector('.notice')?.textContent).toContain(
        'pressStop'
      );
      expect(
        host(fixture).querySelector<HTMLButtonElement>('.discard')?.disabled
      ).toBe(false);
      expect(glyph(fixture)).toBe('lib-stop-icon');
    });
  });

  describe('the trash', () => {
    it('throws the recording away and emits nothing', async () => {
      const fixture = await render();
      const recorded: RecordedAudio[] = [];
      fixture.componentInstance.recorded.subscribe((one) => recorded.push(one));

      await press(fixture);
      host(fixture).querySelector<HTMLButtonElement>('.discard')?.click();
      fixture.detectChanges();

      expect(recorded).toHaveLength(0);
      expect(host(fixture).querySelector('lib-recording-row')).toBeNull();
    });

    it('gives the composer back, ready to use', async () => {
      // Not "keeps what was typed": with one button doing both jobs, a field with
      // anything in it draws a send, so there is no way to start a recording without
      // an empty field in the first place. Asserting the text survived would be
      // asserting something about a state nobody can reach.
      const fixture = await render();

      await press(fixture);
      host(fixture).querySelector<HTMLButtonElement>('.discard')?.click();
      fixture.detectChanges();

      expect(field(fixture)).not.toBeNull();
      expect(glyph(fixture)).toBe('lib-mic-icon');
      expect(host(fixture).querySelector('.error')).toBeNull();
    });
  });

  describe('a failed send keeps the recording', () => {
    it('offers a retry that sends the same bytes', async () => {
      // The assertion that matters most in plan 0039, and it has to keep passing
      // across the change that removed the state it used to be held in.
      const fixture = await render();
      const recorded: RecordedAudio[] = [];
      fixture.componentInstance.recorded.subscribe((one) => recorded.push(one));

      await press(fixture);
      await press(fixture);
      expect(recorded).toHaveLength(1);

      // What the container does on failure: say what went wrong, and clear nothing.
      fixture.componentInstance.reportError('list.error.failed');
      fixture.detectChanges();

      const retry = host(fixture).querySelector<HTMLButtonElement>('.retry');
      expect(retry).not.toBeNull();

      retry?.click();
      fixture.detectChanges();

      expect(recorded).toHaveLength(2);
      expect(recorded[1]).toBe(recorded[0]);
    });

    it('offers no retry when there is no recording to retry with', async () => {
      const fixture = await render();

      fixture.componentInstance.reportError('list.error.failed');
      fixture.detectChanges();

      expect(host(fixture).querySelector('.retry')).toBeNull();
    });

    it('drops the held recording once the container confirms a send', async () => {
      const fixture = await render();

      await press(fixture);
      await press(fixture);
      fixture.componentInstance.clear();
      fixture.componentInstance.reportError('list.error.failed');
      fixture.detectChanges();

      expect(host(fixture).querySelector('.retry')).toBeNull();
    });
  });

  describe('when the microphone is not available', () => {
    it('says so and leaves the field working', async () => {
      const fixture = await render(
        fakeCapture({ open: () => Promise.reject(new Error('denied')) })
      );

      await press(fixture);

      expect(host(fixture).querySelector('.error')?.textContent).toContain(
        'micRefused'
      );
      expect(field(fixture)).not.toBeNull();
    });
  });
});
