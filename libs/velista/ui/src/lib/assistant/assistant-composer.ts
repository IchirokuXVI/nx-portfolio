import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ASSISTANT_MESSAGE_MAX_LENGTH } from '@portfolio/velista/models';
import { AudioRecorder } from '@portfolio/velista/platform';
import { MicIcon, SendIcon } from '../icons/icons';
import { RecordingElapsed } from '../recording/recording-elapsed';
import { RecordingRow } from '../recording/recording-row';

/**
 * What the one button on the right is currently for.
 *
 * Two rather than three since plan 0041: stop moved into `RecordingRow`, which
 * replaces the field and this button wholesale while a recording is running. It
 * still lands in the same corner, so the property section 4.1 asked for holds.
 */
export type ComposerButton = 'record' | 'send';

/**
 * The field, the recorder, and the one button that is both (plan 0032, section 4).
 *
 * ## One slot, three jobs
 *
 * The right hand button is the same size in the same corner throughout, and what it is
 * depends only on the state: microphone on an empty field, send on a typed one, stop
 * while recording. Never two buttons competing for one intention, and **nothing moves
 * under the thumb**: stop inherits the microphone's exact position, so the finger that
 * started a recording ends it without travelling.
 *
 * Since plan `0041` the third of those is drawn by `RecordingRow`, which replaces the
 * field and the button together while a recording runs and puts stop in the same
 * corner. The slot did not change; what changed is which component paints it.
 *
 * ## The trash, where pause was
 *
 * Pause and resume are gone from this composer. They held a recording and gave it
 * back, and never gave anybody a way out of one: every recording that started had
 * exactly one exit, which was to be sent. The trash is that way out, and it sits at
 * the far left where pause was, as far from stop as the row allows (plan `0041`,
 * section 4). `AudioRecorder` keeps `pause()` and `resume()`, because they are how the
 * cap holds a recording without discarding it.
 *
 * ## A press, not a hold
 *
 * `(click)` and nothing else. Press and hold is the conventional voice gesture and it is
 * the one this audience cannot perform: it asks for sustained, steady pressure for the
 * length of the message, which is precisely what a tremor removes. A recording here
 * survives a hand that shakes, drifts, or lets go, and a pointer leaving the button
 * mid gesture is not an event this component has an opinion about (section 4.2).
 *
 * ## The field stays an ordinary text input
 *
 * Ordinary `<input>`, ordinary submit, and **no custom key handling**, so the platform
 * keyboard's own dictation button keeps working into it beside this one (section 10).
 * Somebody who already knows that gesture should not have to learn this one.
 *
 * ## Why it injects the recorder
 *
 * `AudioRecorder` is in `platform`, which rule D1 permits this library to reach, the
 * way `AppLayout` already reaches `ThemeStore`. What D1 forbids is `data-access`, and
 * there is none here: the recording leaves as an output and this component never
 * learns what becomes of it. Keeping the capture beside the controls is what stops
 * five signals and four callbacks being threaded through the page above.
 */
@Component({
  selector: 'lib-assistant-composer',
  imports: [
    RokuTranslatorPipe,
    MicIcon,
    SendIcon,
    RecordingRow,
    RecordingElapsed,
  ],
  templateUrl: './assistant-composer.html',
  styleUrl: './assistant-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantComposer {
  /**
   * The recorder the page provides, or null where none is.
   *
   * Optional for {@link voice}'s reason: a composer that offers no microphone must not
   * need a recorder to exist, and one it is given is never started.
   */
  private readonly _recorder = inject(AudioRecorder, { optional: true });

  /**
   * Whether this composer offers a microphone at all (velista `0174`, target 2).
   *
   * `LineComposer`'s input, with its rules. True by default, so a caller that says
   * nothing keeps the composer it always had. False where the deployment cannot
   * transcribe: {@link button} then answers `'send'` whatever the field holds, the
   * button is disabled while the field is empty, a press never reaches the recorder,
   * and no copy about recording is drawn. Hidden rather than disabled (decision D1):
   * a microphone that cannot be pressed asks a question the screen cannot answer in a
   * word, and the field already does the job.
   */
  readonly voice = input(true);

  /**
   * Whether the composer may be used at all.
   *
   * True while a turn is in flight and while a rate limit is counting down, and the
   * page decides which. The text is **kept** either way: a wait is not a reason to
   * throw away what somebody wrote, and re-typing it is the exact cost section 3.1
   * exists to avoid.
   */
  readonly disabled = input(false);

  readonly maxLength = ASSISTANT_MESSAGE_MAX_LENGTH;

  /** What has been typed. Owned here; the page is told only when it is sent. */
  protected readonly text = signal('');

  protected readonly recorder = this._recorder;

  /** The elapsed length as `m:ss`, which is what sits between pause and stop. */
  protected readonly elapsed = computed(() => {
    const seconds = this._recorder?.elapsedSeconds() ?? 0;

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  /**
   * Which of the two the button is, and the whole of section 4.1 in one expression.
   *
   * The recording case is not here any more: while the recorder is active the
   * template draws `RecordingRow` in place of the field and this button, and stop
   * lands in the same corner the microphone was in.
   */
  protected readonly button = computed<ComposerButton>(() =>
    this.text().trim().length > 0 || !this.voice() ? 'send' : 'record'
  );

  /**
   * Whether the button is out of use: while the page says so, and, with no
   * microphone, while there is nothing to send. With a microphone an empty field still
   * has a job for the button, which is to record.
   */
  protected readonly buttonDisabled = computed(
    () => this.disabled() || (!this.voice() && this.text().trim().length === 0)
  );

  /** A message the person typed or dictated with the platform keyboard. */
  readonly send = output<string>();

  /**
   * A message they spoke. The recording, and nothing said about where it goes.
   *
   * A file rather than the words, because the service transcribes (backend `0041`).
   * The cost is that the caller's own bubble cannot fill in until the reply comes
   * back; the page draws a placeholder for that stretch and never a guess.
   *
   * **It still sends immediately**, which is what section 12 settled: for this audience
   * an accidental stop is a sent message with no way back, and a confirm step would tax
   * every message to protect the rare one. Seeing what the service heard appear as the
   * caller's own bubble is the check, and it costs no press.
   */
  readonly spoke = output<Blob>();

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  /**
   * The one button, pressed.
   *
   * `void` rather than awaited: a button handler that returns a promise is a promise
   * nothing is holding, and both branches already handle their own failure.
   */
  protected press(): void {
    if (this.button() === 'send') {
      this._submit();
      return;
    }

    // With no microphone the button is always send, so this is unreachable; the check
    // is here so that it stays unreachable whatever `button` becomes.
    if (this.voice()) {
      void this._recorder?.start();
    }
  }

  /** Stop from the recording row, which is the press that sends. */
  protected stopAndSend(): void {
    void this._stop();
  }

  /**
   * Throw the recording away (plan 0041, section 4).
   *
   * `cancel` rather than `stop`, so the blob is never assembled and nothing is
   * emitted. Available at the cap as well as while recording: the longest
   * recording is the one somebody most wants to be rid of.
   */
  protected discard(): void {
    this._recorder?.cancel();
  }

  /** Submitting the form, which is the keyboard's own way of pressing send. */
  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.button() === 'send') {
      this._submit();
    }
  }

  /**
   * Dismiss the "it did not start" state, so the composer comes back.
   *
   * A refused microphone leaves the recorder in `refused` and the panel says so; the
   * way out of it is this rather than a retry, because pressing the microphone again
   * against a permission the browser has remembered produces the same state silently.
   */
  protected dismissRecorderState(): void {
    this._recorder?.cancel();
  }

  private _submit(): void {
    const said = this.text().trim();
    if (said.length === 0 || this.disabled()) {
      return;
    }

    this.text.set('');
    this.send.emit(said);
  }

  private async _stop(): Promise<void> {
    const recording = (await this._recorder?.stop()) ?? null;

    // Null means the recorder had nothing, which is the same as an empty field: the
    // press ended the recording and sent nothing rather than sending an empty message.
    if (recording !== null && recording.size > 0) {
      this.spoke.emit(recording);
    }
  }
}
