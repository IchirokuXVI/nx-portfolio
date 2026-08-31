import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  LINE_CONTENT_COUNTER_FROM,
  LINE_CONTENT_MAX_LENGTH,
  type RecordedAudio,
} from '@portfolio/velista/models';
import {
  AudioRecorder,
  SILENCE_DETECTOR,
  type SilenceDetectorI,
  type SilenceWatch,
} from '@portfolio/velista/platform';
import { MicIcon, PlusIcon, SpinnerIcon, StopIcon } from '../icons/icons';
import { QuantityStepper } from './quantity-stepper';

/** What the one button at the end of the row is for. */
export type LineComposerButton = 'add' | 'record';

/**
 * The field at the bottom of the list, and the reason this screen has no floating
 * action button.
 *
 * ## Adding happens in runs
 *
 * Somebody stands in the kitchen and enters six things. So the field **keeps focus
 * across a submit**, the keyboard never comes down between two adds, and the quantity
 * resets to one so the seventh item does not silently inherit the sixth one's count.
 * A FAB would put a dialog between every pair of those six.
 *
 * ## It is absent without `WRITE`, never disabled
 *
 * That decision belongs to the container, which knows whether the caller may write.
 * This component is simply not rendered in that case, because a disabled text field at
 * the bottom of a screen is an invitation that does not work and costs a tap to find
 * out (section 3.2).
 *
 * It is drawn from certainty since velista plan 0030: `myPermissions` arrives with the
 * list, so the composer is absent from the first frame for somebody who may not add,
 * rather than being taken away after their first line is refused.
 *
 * ## The counter appears late
 *
 * Only past 350 of 400 characters. A running count under a field somebody is typing a
 * shopping item into is noise for every realistic entry, and the cap exists to stop an
 * accident rather than to be aimed at.
 *
 * ## One slot, two jobs, and the empty field decides
 *
 * Somebody standing at an open fridge has one hand free and is not going to type
 * (plan 0038). So the button at the end of the row is a **microphone** when the
 * field is empty and the plus it has always been when it is not, and the field's
 * emptiness is the switch rather than a mode anybody selects: two buttons side by
 * side, one of which is always inert, is a row of controls that has to be read
 * before either can be used, and this row already carries a stepper.
 *
 * The run property survives it. Somebody typing never sees the microphone and
 * somebody speaking never has the keyboard open, so neither mode interrupts the
 * other.
 *
 * **A press, not a hold**, as everywhere else in this app: hold to talk needs a
 * steady hand on a phone being held one handed in a kitchen, and it has no
 * accessible equivalent.
 *
 * ## It ends itself when the talking stops, and then it listens again
 *
 * The piece with no precedent here, and the reason the person is speaking at all
 * is that their hands are busy. `SilenceDetector` watches the live stream and
 * says when quiet has lasted long enough; this component ends the segment and
 * emits it. Stop is on screen throughout, so the detector is a convenience over a
 * control rather than the only way out.
 *
 * **A pause is a punctuation mark, not the end of the session.** Somebody at an
 * open fridge names four things with a breath between them, and a microphone that
 * closed after the first would need pressing again with the hand that is holding
 * the door. So the detector's ending sends the segment and immediately opens the
 * next one, and the previous one is still on its way to the server while the next
 * is being spoken: that is what the sending hint is for.
 *
 * The two ways out of a segment therefore mean different things, and this is the
 * whole of the state in here:
 *
 * | what ended it | what happens next |
 * | --- | --- |
 * | the detector, on silence or at the cap | sent, and the microphone reopens |
 * | the stop button | sent, and the session is over |
 *
 * Stop is the only deliberate end, which is what makes it worth its place on
 * screen: without it a session that listens through its own pauses has no exit
 * that is not an accident.
 *
 * ## It is absent without `WRITE`, exactly as the composer is
 *
 * The microphone inherits that by being inside a component the container does not
 * render for somebody who may not write. There is no separate check and there must
 * not be: a second condition for the same fact is a second place for it to
 * disagree (plan 0038, section 2.1).
 */
@Component({
  selector: 'lib-line-composer',
  imports: [
    RokuTranslatorPipe,
    PlusIcon,
    MicIcon,
    StopIcon,
    SpinnerIcon,
    QuantityStepper,
  ],
  templateUrl: './line-composer.html',
  styleUrl: './line-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineComposer {
  /** Whether a submit is in flight. The field stays usable; only the button waits. */
  readonly busy = input(false);

  /**
   * Whether to take focus on creation.
   *
   * True on an empty list, where there is exactly one thing to do and the composer is
   * already focused (section 3.1), and false otherwise, because stealing focus and
   * raising a keyboard over a list somebody opened to read would be hostile.
   *
   * Focused **programmatically** rather than through the `autofocus` attribute, which
   * `@angular-eslint` forbids and is right to: the attribute fires on page load with no
   * regard for what the person was doing, and there is no way to withdraw it. Doing it
   * here means the one condition that justifies it is written down and testable.
   */
  readonly takeFocus = input(false);

  readonly submitted = output<{ content: string; quantity: number }>();

  /**
   * Something somebody said, for the page to post to the list scoped assistant.
   *
   * The recording and nothing else. Rule D1: this component does not know what
   * becomes of it, and it certainly does not know there is an assistant.
   */
  readonly spoke = output<RecordedAudio>();

  /** It did not start: a refused microphone, no device, or a browser that cannot. */
  readonly recordingFailed = output<void>();

  readonly content = signal('');
  readonly quantity = signal(1);

  readonly maxLength = LINE_CONTENT_MAX_LENGTH;
  readonly counterFrom = LINE_CONTENT_COUNTER_FROM;

  readonly showCounter = computed(
    () => this.content().length >= this.counterFrom
  );

  readonly canSubmit = computed(() => this.content().trim() !== '');

  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');

  private readonly _recorder = inject(AudioRecorder);
  private readonly _detector = inject<SilenceDetectorI>(SILENCE_DETECTOR);

  private _watch: SilenceWatch | null = null;

  /** 0 to 1, from the detector, for the meter. Reset between recordings. */
  private readonly _level = signal(0);

  /**
   * Whether the session is open: pressed, and not yet stopped.
   *
   * It decides two things, and the second is why it is a signal. It decides whether a
   * segment that ends reopens the microphone. And it holds the listening row on screen
   * **across** that handover: `AudioRecorder.active()` goes false the moment a segment
   * stops and true again only once the next `getUserMedia` resolves, so a view drawn
   * from the recorder alone would flash the text field and the keyboard back at every
   * pause in a sentence.
   */
  private readonly _listeningOn = signal(false);

  /**
   * Whether the listening row is on screen.
   *
   * The session or the recorder, not the recorder alone: between one segment and the
   * next the recorder is briefly idle while the browser hands back a fresh stream, and
   * that gap is not something the person did.
   */
  readonly listening = computed(
    () => this._listeningOn() || this._recorder.active()
  );

  readonly button = computed<LineComposerButton>(() =>
    this.canSubmit() ? 'add' : 'record'
  );

  readonly buttonLabel = computed(() =>
    this.button() === 'add' ? 'list.add.action' : 'list.add.startListening'
  );

  /**
   * The meter, as a width.
   *
   * Scaled well past the raw level, because speech at a conversational distance
   * from a phone microphone reads as a small number and a meter that never leaves
   * the left hand end says "not hearing you" when it is hearing perfectly.
   */
  readonly levelPercent = computed(() =>
    Math.min(100, Math.round(this._level() * 400))
  );

  constructor() {
    // A composer destroyed mid recording must not leave the microphone open: the
    // browser keeps its indicator on and the stream alive behind a component
    // nobody holds any more. `AudioRecorder` releases itself on destroy; the
    // watch is this component's and goes with it.
    inject(DestroyRef).onDestroy(() => this._stopWatching());

    // `afterNextRender` runs in the browser and never on the server (plan 0001, D2),
    // which is also why this cannot be an attribute: the attribute would be in the
    // server rendered HTML and would fire on hydration.
    afterNextRender(() => {
      if (this.takeFocus()) {
        this._field()?.nativeElement.focus();
      }
    });
  }

  onInput(event: Event): void {
    this.content.set((event.target as HTMLInputElement).value);
  }

  /** The one button, pressed. */
  press(): void {
    if (this.button() === 'add') {
      this.submit();
      return;
    }

    this._listeningOn.set(true);
    void this._record();
  }

  /**
   * End the session by hand and send what there is.
   *
   * The deliberate exit, and the only one: a segment that ends because somebody
   * stopped talking reopens the microphone, so without this a session begun by
   * accident would have no way out that was not another accident.
   */
  stop(): void {
    this._listeningOn.set(false);
    void this._finish();
  }

  private async _record(): Promise<void> {
    await this._recorder.start();

    const state = this._recorder.state();
    if (state === 'refused' || state === 'unavailable') {
      // Said by the page, in the strip, because the sentence differs between a
      // refusal and a device that is not there and neither is this component's
      // to write (plan 0038, section 6).
      //
      // The session ends here as well as the segment. A microphone that has just
      // been refused will be refused again, and reopening it on every silence
      // would ask the same question in a loop.
      this._listeningOn.set(false);
      this._recorder.cancel();
      this.recordingFailed.emit();
      return;
    }

    this._level.set(0);

    const stream = this._recorder.stream;
    if (stream === null) {
      // No stream to watch, which is every fake and any browser without the
      // audio API. The recording still runs and the stop button still ends it;
      // what is lost is only the convenience of it ending itself.
      return;
    }

    this._watch = this._detector.watch(stream, {
      onLevel: (reading) => this._level.set(reading.level),
      onEnd: () => void this._finish(),
    });
  }

  private async _finish(): Promise<void> {
    this._stopWatching();

    const seconds = this._recorder.elapsedSeconds();
    const blob = await this._recorder.stop();
    this._level.set(0);

    // Reopened before the emit rather than after it, so the gap in which the
    // microphone is shut is as short as this component can make it: the send that
    // follows is a request to a transcription provider and takes seconds, and a
    // person mid sentence does not pause for it.
    if (this._listeningOn()) {
      void this._record();
    }

    // Nothing to send. An empty file to a paid provider is what the detector's
    // minimum length exists to prevent, and this is the same rule at the end of
    // the path rather than a second one.
    if (blob === null || blob.size === 0) {
      return;
    }

    this.spoke.emit({
      blob,
      mimeType: blob.type,
      durationSeconds: seconds,
    });
  }

  private _stopWatching(): void {
    this._watch?.close();
    this._watch = null;
  }

  /**
   * The form's own submit, which is what makes the phone keyboard's Go key work.
   *
   * `(submit)` and not `(ngSubmit)`: the latter is `NgForm`'s output and needs
   * `FormsModule`, which this composer does not import and does not want, because
   * nothing here is a form control. Without the module `(ngSubmit)` binds to a DOM
   * event of that name, which no browser ever fires, so the Go key and the button
   * would both do nothing except let the native submit through and reload the page.
   * `preventDefault` is then this handler's job rather than the directive's.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  /**
   * Send it, and stay ready for the next one.
   *
   * The field is cleared and the quantity reset **here**, before the request resolves,
   * because the add is optimistic and the row is already on screen: leaving the text in
   * the field until a response arrived would show the same item twice and invite a
   * second submit of it.
   *
   * Focus is taken back explicitly. Clearing an input does not move focus, but the
   * button that was tapped has it, and on a phone that is enough to drop the keyboard.
   */
  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.submitted.emit({
      content: this.content().trim(),
      quantity: this.quantity(),
    });

    this.content.set('');
    this.quantity.set(1);
    this._field()?.nativeElement.focus();
  }
}
