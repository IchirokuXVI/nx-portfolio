import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogSuggestion,
  RecordedAudio,
} from '@portfolio/velista/models';
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

/**
 * The two settings, off unless a test turns them on, exactly as the product ships
 * them: the default is a plain recorder and every assertion about it should start
 * from what somebody who has never opened the settings screen gets.
 */
interface Options {
  sendOnSilence?: boolean;
  keepListening?: boolean;
  /** False is the basket's composer, which has no microphone at all (`0053`). */
  voice?: boolean;
}

async function render(
  capture: AudioCaptureI = fakeCapture(),
  options: Options = {}
) {
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
  fixture.componentRef.setInput(
    'sendOnSilence',
    options.sendOnSilence ?? false
  );
  fixture.componentRef.setInput(
    'keepListening',
    options.keepListening ?? false
  );
  fixture.componentRef.setInput('voice', options.voice ?? true);
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

/** Let the promises in a handover run out, then render what they left behind. */
async function settle(fixture: ComponentFixture<LineComposer>): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
  }
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

  /**
   * Plan 0053, section 3.1: the basket's composer has no second job for the slot.
   *
   * A test rather than a reading of the template, because the flag is the only thing
   * standing between a screen with no assistant behind it and a microphone that
   * records into nowhere. If it quietly stops working, this is what says so.
   */
  describe('with voice off', () => {
    it('never becomes a microphone, however empty the field is', async () => {
      const { fixture } = await render(fakeCapture(), { voice: false });

      expect(button(fixture).querySelector('lib-mic-icon')).toBeNull();
      expect(button(fixture).querySelector('lib-plus-icon')).not.toBeNull();

      // And still not after typing and clearing again, which is the gesture that
      // flips the button back on every other screen.
      type(fixture, 'a');
      type(fixture, '');
      expect(button(fixture).querySelector('lib-mic-icon')).toBeNull();
    });

    it('disables the button on an empty field rather than repurposing it', async () => {
      const { fixture } = await render(fakeCapture(), { voice: false });

      expect(button(fixture).disabled).toBe(true);

      type(fixture, 'Batteries');
      expect(button(fixture).disabled).toBe(false);
    });

    it('starts no recording when the button is pressed', async () => {
      const { fixture, detector } = await render(fakeCapture(), {
        voice: false,
      });

      await press(fixture);

      // Nothing was watched, nothing is listening, and the field is still there:
      // the recorder is not merely unused, it is unreachable.
      expect(detector.handlers).toBeNull();
      expect(host(fixture).querySelector('.stop')).toBeNull();
      expect(host(fixture).querySelector('input.field')).not.toBeNull();
    });
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

  it('emits the recording when the talking stops, with that setting on', async () => {
    const { fixture, detector } = await render(fakeCapture(), {
      sendOnSilence: true,
    });
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

  /**
   * What somebody who has never opened the settings screen gets: press, talk, stop to
   * send, bin to throw it away. Nothing happens on its own.
   */
  describe('the plain recorder, which is the default', () => {
    it('puts the bin at the far end of the row, away from stop', async () => {
      // Plan 0042, section 6. The two controls a recording can end with were a
      // thumb's width apart, one of which throws the recording away. The distance is
      // the safeguard, so it is asserted in the DOM order rather than left to a
      // stylesheet somebody could tune down.
      const { fixture } = await render();

      await press(fixture);

      const row = host(fixture).querySelector('.listening');
      const order = [...(row?.children ?? [])].map((child) => child.className);

      expect(order[0]).toContain('stop');
      expect(order[1]).toContain('meter');
      expect(order[order.length - 1]).toContain('discard');

      // The reading order agrees with the visual order, so the bin is also the last
      // control a keyboard reaches in the row.
      const controls = row?.querySelectorAll('button');
      expect(controls?.[0].className).toContain('stop');
      expect(controls?.[controls.length - 1].className).toContain('discard');
    });

    it('does not send when the talking stops', async () => {
      // The behaviour plan 0038 shipped, and the reason it is no longer the default:
      // a pause to think about the next item sent half a list.
      const { fixture, detector } = await render();
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      detector.handlers?.onEnd('silence');
      await settle(fixture);

      expect(spoken).toEqual([]);
      // Still recording, and still offering both ways out.
      expect(host(fixture).querySelector('.stop')).not.toBeNull();
    });

    it('still ends at the cap, whatever the setting says', async () => {
      // By then the recorder has stopped taking audio, so a segment left open would
      // never be sent and the row would sit there looking live.
      const { fixture, detector } = await render();
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      detector.handlers?.onEnd('cap');
      await settle(fixture);

      expect(spoken).toHaveLength(1);
    });

    it('sends on stop, and goes back to the field', async () => {
      const { fixture } = await render();
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      await press(fixture);

      expect(spoken).toHaveLength(1);
      expect(host(fixture).querySelector('input.field')).not.toBeNull();
    });

    it('throws the recording away on the bin, and emits nothing', async () => {
      // Without this a recording had one way out, which was to be sent: somebody who
      // pressed the microphone by accident had to say something to the whole list
      // before they could withdraw it.
      const { fixture } = await render();
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      host(fixture).querySelector<HTMLButtonElement>('.discard')?.click();
      await settle(fixture);

      expect(spoken).toEqual([]);
      expect(host(fixture).querySelector('input.field')).not.toBeNull();
    });

    it('closes a session the bin ends even when it would keep listening', async () => {
      // With `keepListening` on, stop reopens the microphone, so the bin is the only
      // control that actually closes it.
      const { fixture } = await render(fakeCapture(), {
        sendOnSilence: true,
        keepListening: true,
      });

      await press(fixture);
      host(fixture).querySelector<HTMLButtonElement>('.discard')?.click();
      await settle(fixture);

      expect(host(fixture).querySelector('input.field')).not.toBeNull();
      expect(host(fixture).querySelector('.stop')).toBeNull();
    });
  });

  /**
   * A pause is punctuation, not the end of the session: somebody at an open fridge
   * names four things with a breath between them, and a microphone that shut after
   * the first would need pressing again with the hand holding the door. Both settings
   * on, which is the hands free product.
   */
  describe('it listens through its own pauses', () => {
    it('sends the segment and opens the microphone again', async () => {
      const { fixture, detector } = await render(fakeCapture(), {
        sendOnSilence: true,
        keepListening: true,
      });
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      detector.handlers?.onEnd('silence');
      await settle(fixture);

      expect(spoken).toHaveLength(1);
      // Still listening, and watching a fresh stream: a detector whose handlers went
      // away with the old segment would never end the next one.
      expect(host(fixture).querySelector('.stop')).not.toBeNull();
      expect(host(fixture).querySelector('input.field')).toBeNull();
      expect(detector.handlers).not.toBeNull();
    });

    it('keeps going across several pauses', async () => {
      const { fixture, detector } = await render(fakeCapture(), {
        sendOnSilence: true,
        keepListening: true,
      });
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      for (let said = 0; said < 3; said += 1) {
        detector.handlers?.onEnd('silence');
        await settle(fixture);
      }

      expect(spoken).toHaveLength(3);
      expect(host(fixture).querySelector('.stop')).not.toBeNull();
    });

    it('never flashes the field back between two segments', async () => {
      // The recorder is idle for as long as the next `getUserMedia` takes, and a view
      // drawn from it alone would put the text field, and on a phone the keyboard, back
      // on screen at every pause in a sentence.
      //
      // The second open never resolves, so the fixture is parked in the middle of the
      // handover: the previous segment is finished and the next stream has not arrived.
      // That is the frame the bug would appear in, and it is held here indefinitely.
      const capture = fakeCapture();
      let opens = 0;
      const stalling: AudioCaptureI = {
        ...capture,
        open: (...args) => {
          opens += 1;
          return opens === 1
            ? capture.open(...args)
            : new Promise(() => undefined);
        },
      };

      const { fixture, detector } = await render(stalling, {
        sendOnSilence: true,
        keepListening: true,
      });
      await press(fixture);
      detector.handlers?.onEnd('silence');
      await settle(fixture);

      expect(opens).toBe(2);
      expect(host(fixture).querySelector('input.field')).toBeNull();
      expect(host(fixture).querySelector('.stop')).not.toBeNull();
    });

    it('ends for good when stop is pressed', async () => {
      const { fixture } = await render(fakeCapture(), { sendOnSilence: true });
      const spoken: RecordedAudio[] = [];
      fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

      await press(fixture);
      await press(fixture);

      expect(spoken).toHaveLength(1);
      // Back to the field, and no reopened microphone behind it.
      expect(host(fixture).querySelector('input.field')).not.toBeNull();
      expect(host(fixture).querySelector('.stop')).toBeNull();
    });

    it('does not reopen a microphone that was just refused', async () => {
      // A device that refused once refuses again, and reopening on every silence
      // would ask the same question in a loop.
      const { fixture } = await render(
        fakeCapture({ open: () => Promise.reject(new Error('denied')) }),
        { sendOnSilence: true, keepListening: true }
      );

      await press(fixture);

      expect(host(fixture).querySelector('input.field')).not.toBeNull();
      expect(host(fixture).querySelector('.stop')).toBeNull();
    });

    it('says the last one is on its way while it listens for the next', async () => {
      const { fixture, detector } = await render(fakeCapture(), {
        sendOnSilence: true,
        keepListening: true,
      });
      fixture.componentRef.setInput('busy', true);
      await press(fixture);
      detector.handlers?.onEnd('silence');
      await settle(fixture);

      // The meter stays: the microphone is open and being heard is still worth
      // showing. Only the words under it change.
      expect(host(fixture).querySelector('.meter')).not.toBeNull();
      expect(host(fixture).querySelector('.hint-spinner')).not.toBeNull();
    });
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

/**
 * The panel is put down by a click on the page, and the row it is pinned above is
 * what it is put down by everything except.
 *
 * The exception is the whole of the rule: the panel covers a list somebody may want
 * to look at, so tapping a line has to close it, while the field, the stepper and
 * the send button are the row they are still using to fill it. Both halves are the
 * host element, so neither can drift from the other.
 */
describe('LineComposer, putting the suggestions down', () => {
  const OFFERED: readonly CatalogSuggestion[] = [
    {
      kind: 'item',
      item: {
        id: 'item-oat',
        name: { es: 'Bebida de avena', en: 'Oat drink' },
        brand: 'Oatly',
        productGroupId: null,
      },
    },
  ];

  async function offering() {
    const { fixture } = await render();
    fixture.componentRef.setInput('suggestions', OFFERED);
    type(fixture, 'oat');
    return fixture;
  }

  function drawn(fixture: ComponentFixture<LineComposer>): boolean {
    return host(fixture).querySelector('ul.suggestions') !== null;
  }

  function clickOn(fixture: ComponentFixture<LineComposer>, target: Element) {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  }

  function find(
    fixture: ComponentFixture<LineComposer>,
    selector: string
  ): Element {
    const found = host(fixture).querySelector(selector);
    if (found === null) {
      throw new Error(`there is no ${selector} to click`);
    }
    return found;
  }

  it('closes on a click anywhere else on the page', async () => {
    const fixture = await offering();
    expect(drawn(fixture)).toBe(true);

    // A line of the list the panel is drawn over. Anything outside the host is the
    // same gesture: this is not the row I am typing into.
    clickOn(fixture, document.body);

    expect(drawn(fixture)).toBe(false);
  });

  it('stays up for a click on the field it belongs to', async () => {
    const fixture = await offering();

    clickOn(fixture, find(fixture, 'input.field'));

    expect(drawn(fixture)).toBe(true);
  });

  it('stays up for a click on the quantity', async () => {
    const fixture = await offering();

    // Setting the number and choosing the product are one gesture, so the control
    // that sets it cannot be the control that takes the products away.
    clickOn(fixture, find(fixture, 'lib-quantity-stepper .step'));

    expect(drawn(fixture)).toBe(true);
  });

  it('stays up for a click on a suggestion, which is what chooses it', async () => {
    const fixture = await offering();
    const chosen: { content: string }[] = [];
    fixture.componentInstance.submitted.subscribe((one) => chosen.push(one));

    clickOn(fixture, find(fixture, 'button.suggestion'));

    // The dismissal must not race the choice: were the panel closed by the click
    // that lands on one of its own rows, choosing would be a coin toss.
    expect(chosen).toHaveLength(1);
  });

  it('comes back on the next keystroke', async () => {
    const fixture = await offering();
    clickOn(fixture, document.body);
    expect(drawn(fixture)).toBe(false);

    // Typing is asking again. A panel that stayed shut until the field was emptied
    // would be a dropdown somebody had broken for the rest of a sentence.
    type(fixture, 'oat m');

    expect(drawn(fixture)).toBe(true);
  });
});
