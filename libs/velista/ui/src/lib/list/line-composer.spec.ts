import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
import { SKELETON_DELAY_MS, SuggestionList } from './suggestion-list';

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

interface Options {
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

  /**
   * Velista `0079`, section 7. The button already waited while a submit was out; Enter
   * and a tapped suggestion did not, so a line could land beside the one the assistant
   * was still adding.
   */
  describe('while a submit is out', () => {
    const OAT: CatalogSuggestion = {
      kind: 'item',
      item: {
        id: 'item-oat',
        name: { es: 'Bebida de avena', en: 'Oat drink' },
        brand: 'Oatly',
        size: null,
        unit: 'UNIT',
        productGroupId: null,
        category: 'OTHER',
        offer: null,
        chainPrices: [],
        imageUrl: null,
        packCount: null,
        unitBasis: null,
      },
    };

    it('sends nothing on Enter or on a suggestion, and keeps the field editable', async () => {
      const { fixture } = await render();
      const added: unknown[] = [];
      fixture.componentInstance.submitted.subscribe((one) => added.push(one));
      fixture.componentRef.setInput('busy', true);
      fixture.componentRef.setInput('suggestions', [OAT]);
      type(fixture, 'oat');

      host(fixture)
        .querySelector('form.composer')
        ?.dispatchEvent(new Event('submit'));
      fixture.debugElement
        .query(By.directive(SuggestionList))
        .componentInstance.chose.emit({
          suggestion: OAT,
          anchor: document.createElement('button'),
        });
      fixture.detectChanges();

      expect(added).toEqual([]);
      const field =
        host(fixture).querySelector<HTMLInputElement>('input.field');
      expect(field?.disabled).toBe(false);
      expect(field?.value).toBe('oat');
    });

    it('sends again once the submit is over', async () => {
      const { fixture } = await render();
      const added: unknown[] = [];
      fixture.componentInstance.submitted.subscribe((one) => added.push(one));
      fixture.componentRef.setInput('busy', true);
      type(fixture, 'oat');

      fixture.componentRef.setInput('busy', false);
      fixture.detectChanges();
      host(fixture)
        .querySelector('form.composer')
        ?.dispatchEvent(new Event('submit'));

      expect(added).toEqual([{ content: 'oat', quantity: 1 }]);
    });
  });

  /**
   * Velista `0116`. The basket's composer asks which list before it adds, so a send
   * names the button it came from and leaves the words until the page says the line
   * has somewhere to go.
   */
  describe('holding a send for a question', () => {
    const OAT: CatalogSuggestion = {
      kind: 'item',
      item: {
        id: 'item-oat',
        name: { es: 'Bebida de avena', en: 'Oat drink' },
        brand: 'Oatly',
        size: null,
        unit: 'UNIT',
        productGroupId: null,
        category: 'OTHER',
        offer: null,
        chainPrices: [],
        imageUrl: null,
        packCount: null,
        unitBasis: null,
      },
    };

    function field(fixture: ComponentFixture<LineComposer>): HTMLInputElement {
      const found =
        host(fixture).querySelector<HTMLInputElement>('input.field');
      if (found === null) {
        throw new Error('there is no field');
      }
      return found;
    }

    async function held() {
      const rendered = await render(fakeCapture(), { voice: false });
      rendered.fixture.componentRef.setInput('holdOnSend', true);
      rendered.fixture.detectChanges();
      return rendered;
    }

    it('is never locked: the field takes words and the plus sends them', async () => {
      const { fixture } = await held();
      type(fixture, 'oat');

      expect(field(fixture).readOnly).toBe(false);
      expect(field(fixture).hasAttribute('aria-disabled')).toBe(false);
      expect(button(fixture).disabled).toBe(false);
    });

    it('names the plus as the anchor and keeps the words and the quantity', async () => {
      const { fixture } = await held();
      const added: { anchor?: HTMLElement }[] = [];
      const queries: string[] = [];
      fixture.componentInstance.submitted.subscribe((one) => added.push(one));
      fixture.componentInstance.queryChanged.subscribe((q) => queries.push(q));
      type(fixture, 'oat');
      fixture.componentInstance.quantity.set(3);

      button(fixture).click();
      fixture.detectChanges();

      expect(added).toEqual([
        { content: 'oat', quantity: 3, anchor: button(fixture) },
      ]);
      expect(field(fixture).value).toBe('oat');
      expect(fixture.componentInstance.quantity()).toBe(3);
      expect(queries).toEqual(['oat']);
    });

    it('names the card button a suggestion was chosen with', async () => {
      const { fixture } = await held();
      const added: { anchor?: HTMLElement; itemIds?: readonly string[] }[] = [];
      fixture.componentInstance.submitted.subscribe((one) => added.push(one));
      const card = document.createElement('button');

      fixture.componentInstance.choose(OAT, card);

      expect(added[0]?.anchor).toBe(card);
      expect(added[0]?.itemIds).toEqual(['item-oat']);
    });

    it('clears, resets and keeps focus once the page says the line was placed', async () => {
      const { fixture } = await held();
      const queries: string[] = [];
      fixture.componentInstance.queryChanged.subscribe((q) => queries.push(q));
      type(fixture, 'oat');
      fixture.componentInstance.quantity.set(2);
      button(fixture).click();

      fixture.componentInstance.sent();
      fixture.detectChanges();

      expect(field(fixture).value).toBe('');
      expect(fixture.componentInstance.quantity()).toBe(1);
      expect(queries).toEqual(['oat', '']);
      expect(document.activeElement).toBe(field(fixture));
    });

    it('keeps focus in the field when the plus is pressed', async () => {
      const { fixture } = await held();
      type(fixture, 'oat');
      const press = new MouseEvent('mousedown', { cancelable: true });

      button(fixture).dispatchEvent(press);

      expect(press.defaultPrevented).toBe(true);
    });

    it('names no anchor and clears at once without the hold', async () => {
      const { fixture } = await render(fakeCapture(), { voice: false });
      const added: unknown[] = [];
      fixture.componentInstance.submitted.subscribe((one) => added.push(one));
      type(fixture, 'oat');

      button(fixture).click();
      fixture.detectChanges();

      expect(added).toEqual([{ content: 'oat', quantity: 1 }]);
      expect(field(fixture).value).toBe('');
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

  it('keeps listening through a quiet stretch, and sends nothing', async () => {
    // The person decides when they have finished speaking. A microphone that sent
    // on its own would cut off anybody who paused to think about the next item.
    const { fixture, detector } = await render();
    const spoken: RecordedAudio[] = [];
    fixture.componentInstance.spoke.subscribe((one) => spoken.push(one));

    await press(fixture);
    detector.handlers?.onEnd('silence');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(spoken).toEqual([]);
    expect(host(fixture).querySelector('.stop')).not.toBeNull();
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
    it('puts stop at the far end of the row, away from the bin', async () => {
      // Plan 0042, section 6. The two controls a recording can end with were a
      // thumb's width apart, one of which throws the recording away. The distance is
      // the safeguard, so it is asserted in the DOM order rather than left to a
      // stylesheet somebody could tune down.
      //
      // Which control takes which end is `RecordingRow`'s: bin first, stop last. The
      // microphone that starts a recording is in the same corner on this screen and
      // on the assistant panel, so the row it opens has to be the same row.
      const { fixture } = await render();

      await press(fixture);

      const row = host(fixture).querySelector('.listening');
      const order = [...(row?.children ?? [])].map((child) => child.className);

      expect(order[0]).toContain('discard');
      expect(order[1]).toContain('meter');
      expect(order[order.length - 1]).toContain('stop');

      // The reading order agrees with the visual order, so stop is also the last
      // control a keyboard reaches in the row.
      const controls = row?.querySelectorAll('button');
      expect(controls?.[0].className).toContain('discard');
      expect(controls?.[controls.length - 1].className).toContain('stop');
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
        size: null,
        unit: 'UNIT',
        productGroupId: null,
        category: 'OTHER',
        offer: null,
        chainPrices: [],
        imageUrl: null,
        packCount: null,
        unitBasis: null,
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
    return host(fixture).querySelector('.panel') !== null;
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

    clickOn(fixture, find(fixture, 'button.pick'));

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

/**
 * The field is the combobox that owns the panel's grid (velista `0101`, rule 8),
 * and the panel's cards reach the page through the composer.
 */
describe('LineComposer, the field and its cards', () => {
  const OAT: CatalogSuggestion = {
    kind: 'item',
    item: {
      id: 'item-oat',
      name: { es: 'Bebida de avena', en: 'Oat drink' },
      brand: 'Oatly',
      size: null,
      unit: 'UNIT',
      productGroupId: null,
      category: 'OTHER',
      offer: null,
      chainPrices: [],
      imageUrl: null,
      packCount: null,
      unitBasis: null,
    },
  };

  function field(fixture: ComponentFixture<LineComposer>): HTMLInputElement {
    const found = host(fixture).querySelector<HTMLInputElement>('input.field');
    if (found === null) {
      throw new Error('there is no field');
    }
    return found;
  }

  it('names the panel it controls while it is open, and nothing while it is not', async () => {
    const { fixture } = await render();

    expect(field(fixture).getAttribute('role')).toBe('combobox');
    expect(field(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(field(fixture).getAttribute('aria-controls')).toBeNull();

    fixture.componentRef.setInput('suggestions', [OAT]);
    type(fixture, 'oat');

    const panel = host(fixture).querySelector('.panel');
    expect(field(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(field(fixture).getAttribute('aria-controls')).toBe(panel?.id);
  });

  describe('a search that found nothing (0108, target 1)', () => {
    function answered(
      fixture: ComponentFixture<LineComposer>,
      words: string | null,
      found: readonly CatalogSuggestion[] = []
    ): void {
      fixture.componentRef.setInput('suggestions', found);
      fixture.componentRef.setInput('suggestedFor', words);
      fixture.detectChanges();
    }

    it('says so for the words in the field, and that they can still be added', async () => {
      const { fixture } = await render();
      type(fixture, 'zzzz');
      answered(fixture, 'zzzz');

      expect(host(fixture).querySelector('.none-h')).not.toBeNull();
      expect(host(fixture).querySelector('.none-p')).not.toBeNull();
    });

    it('takes the row away on the next keystroke', async () => {
      const { fixture } = await render();
      type(fixture, 'zzzz');
      answered(fixture, 'zzzz');
      type(fixture, 'zzzzz');

      expect(host(fixture).querySelector('.none')).toBeNull();
    });

    it('draws no row while the search is still running, or when it found something', async () => {
      const { fixture } = await render();
      type(fixture, 'zzzz');
      answered(fixture, 'zzzz');
      fixture.componentRef.setInput('suggesting', true);
      fixture.detectChanges();

      expect(host(fixture).querySelector('.none')).toBeNull();

      fixture.componentRef.setInput('suggesting', false);
      answered(fixture, 'oat', [OAT]);
      type(fixture, 'oat');

      expect(host(fixture).querySelector('.none')).toBeNull();
      expect(host(fixture).querySelectorAll('.sug')).toHaveLength(1);
    });
  });

  it('draws the skeleton while the page is asking the catalog', async () => {
    const { fixture } = await render();
    fixture.componentRef.setInput('suggesting', true);
    type(fixture, 'oat');
    await new Promise((resolve) => setTimeout(resolve, SKELETON_DELAY_MS + 30));
    fixture.detectChanges();

    expect(host(fixture).querySelectorAll('.sk')).toHaveLength(3);
  });

  it('hands a stepped line from a card to the page', async () => {
    const { fixture } = await render();
    const holding = {
      key: 'l1',
      lineId: 'l1',
      text: 'Oat drink',
      listName: null,
      quantity: 1,
      editable: true,
    };
    const changed: unknown[] = [];
    fixture.componentInstance.holdingChanged.subscribe((one) =>
      changed.push(one)
    );
    fixture.componentRef.setInput('suggestions', [OAT]);
    fixture.componentRef.setInput('holdingsOf', () => [holding]);
    type(fixture, 'oat');

    host(fixture)
      .querySelectorAll<HTMLButtonElement>('.already .step')[1]
      ?.click();
    fixture.detectChanges();

    expect(changed).toEqual([{ holding, from: 1, to: 2 }]);
  });
});
