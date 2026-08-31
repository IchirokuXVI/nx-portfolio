import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  COMMENT_BODY_MAX_LENGTH,
  VOICE_COMMENT_MAX_BYTES,
  type RecordedAudio,
} from '@portfolio/velista/models';
import { AudioRecorder } from '@portfolio/velista/platform';
import { MicIcon, SendIcon } from '../icons/icons';
import { RecordingElapsed } from '../recording/recording-elapsed';
import { RecordingRow } from '../recording/recording-row';

/** What the one button at the end of the row is currently for. */
type ComposerButton = 'record' | 'send';

/**
 * Saying something about a line, by typing it or by saying it.
 *
 * A textarea rather than the single line input the assistant uses, and the
 * difference is what is being written: a line is a thing to buy and a comment is a
 * sentence about one, so it wraps and it grows.
 *
 * **No longer offered to a reader.** `comment.add` used to require only an approved
 * membership on the zone, which made this the one thing somebody with read access
 * could really do. Backend plan 0036 section 4 narrows it to `WRITE` or `DECIDE`,
 * so read means read here as well, and the sheet draws this component only for
 * `canComment` (velista plan 0030, section 3.1).
 *
 * ## One button, two jobs, and the recording row over both
 *
 * This is the assistant's rule, adopted whole (plan 0041, section 2). A microphone
 * on an empty field, a send on a typed one, and while a recording runs the field
 * and the button are replaced by `RecordingRow`: trash on the far left, the length
 * in the middle, stop on the far right.
 *
 * Plan `0039` put the microphone **beside** the field instead, so that somebody who
 * started typing and changed their mind would not have to clear the box to find it.
 * That is a real cost and it is the smaller one. There are two places in this app
 * where you can speak, they sit two taps apart, and a second control scheme for the
 * same act costs more than a keystroke on a rare path.
 *
 * **The textarea stays a textarea.** What is adopted is the button, not the box.
 *
 * ## Stop sends
 *
 * One press, and the recording goes. Plan `0039` held it for a second press on the
 * argument that a message which leaves on its own is a message nobody agreed to
 * send, and that rule is about **the cap, not the button**: a recording that ends
 * because a timer ran out was never agreed to, and one that ends because somebody
 * pressed stop was. The check that costs no press is already here, which is the
 * pending bubble being replaced by the real comment with its transcript in it.
 *
 * At the cap the recorder holds instead, in `stopped`, with both the trash and the
 * stop still live. **The cap stops the recording; the person stops the message.**
 *
 * ## A failed send never discards the recording
 *
 * Somebody just spoke for forty seconds. Losing that to a dropped connection is the
 * worst outcome in plan `0039` and it is entirely avoidable, so the blob is **held
 * here until a send succeeds**: the container reports failure through
 * {@link reportError}, the composer keeps what it has, and the error line carries a
 * retry that sends the same bytes. It is held rather than queued, for plan 0038
 * section 6's reason: retryable by hand is not the same as sent automatically twenty
 * minutes later.
 *
 * This is the one thing that is deliberately **not** identical to the assistant,
 * which throws a failed turn away. A turn is ephemeral by design; a comment is a
 * message somebody left for the people they shop with.
 */
@Component({
  selector: 'lib-comment-composer',
  imports: [
    RokuTranslatorPipe,
    SendIcon,
    MicIcon,
    RecordingRow,
    RecordingElapsed,
  ],
  template: `
    @let state = recorder.state();

    <!--
      The warning and the cap message grow the composer and sit above it, so
      nothing is covered and neither control moves under the thumb that is about
      to press one (plan 0032, section 4.4). They are written here rather than
      inside the recording row because the sentences differ per caller.
    -->
    @if (state === 'stopped') {
      <p aria-live="polite" class="notice">
        {{ 'list.comments.limit.reached' | rokuT }}
        <strong>{{ 'list.comments.limit.pressStop' | rokuT }}</strong>
      </p>
    } @else if (recorder.warning()) {
      <p aria-live="polite" class="notice">
        {{
          'list.comments.limit.left'
            | rokuT: { count: recorder.remainingSeconds() }
        }}
      </p>
    }

    @if (recorder.active()) {
      <lib-recording-row
        (discard)="discard()"
        (stop)="stopAndSend()"
        [discardLabel]="'list.comments.discardRecording'"
        [phase]="state === 'stopped' ? 'capped' : 'recording'"
        [stopLabel]="'list.comments.stopRecording'"
      >
        <lib-recording-elapsed
          [elapsed]="elapsed()"
          [live]="state === 'recording'"
        />
      </lib-recording-row>
    } @else {
      <form (submit)="onSubmit($event)" class="composer">
        <textarea
          (input)="onInput($event)"
          [attr.aria-label]="'list.comments.placeholder' | rokuT"
          [attr.maxlength]="maxLength"
          [placeholder]="'list.comments.placeholder' | rokuT"
          [value]="body()"
          #field
          class="field"
          name="body"
          rows="2"
        ></textarea>

        <button
          (click)="press()"
          [attr.aria-label]="buttonLabel() | rokuT"
          [disabled]="busy()"
          class="send"
          type="button"
        >
          @if (button() === 'send') {
            <lib-send-icon class="glyph" />
          } @else {
            <lib-mic-icon class="glyph" />
          }
        </button>
      </form>
    }

    @if (errorKey(); as key) {
      <p class="error" role="alert">
        {{ key | rokuT: errorArgs() }}
        <!--
          The retry is drawn only when there is something to retry with, which is
          exactly when a send failed with a recording still in hand. A typed
          comment's failure has the words still in the field and needs no second
          control to send them again.
        -->
        @if (hasHeldRecording()) {
          <button
            (click)="retry()"
            [disabled]="busy()"
            class="retry"
            type="button"
          >
            {{ 'list.comments.sendAgain' | rokuT }}
          </button>
        }
      </p>
    }
  `,
  styleUrl: './comment-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentComposer {
  readonly busy = input(false);

  readonly submitted = output<string>();

  /**
   * A recording the person just finished, on its way out.
   *
   * The container uploads it and reports back: {@link clear} on success, and
   * {@link reportError} on failure, after which the blob is still here.
   */
  readonly recorded = output<RecordedAudio>();

  readonly body = signal('');
  readonly maxLength = COMMENT_BODY_MAX_LENGTH;

  readonly errorKey = signal<string | null>(null);
  readonly errorArgs = signal<Record<string, string | number>>({});

  /**
   * The recorder, provided by the sheet with the comment cap on it.
   *
   * Not root scoped, so leaving the sheet releases the microphone, and a recorder
   * open in a comment cannot collide with the one in the assistant panel. Its
   * `RECORDING_LIMITS` are the sheet's, which is how a comment stops at a minute
   * where a message to the assistant runs to five (plan 0041, section 6.2).
   */
  protected readonly recorder = inject(AudioRecorder);

  private readonly _field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  /** The last recording, kept until a send succeeds. Never cleared by a failure. */
  private readonly _held = signal<RecordedAudio | null>(null);

  readonly hasHeldRecording = computed(() => this._held() !== null);

  readonly button = computed<ComposerButton>(() =>
    this.body().trim() === '' ? 'record' : 'send'
  );

  readonly buttonLabel = computed(() =>
    this.button() === 'send'
      ? 'list.comments.send'
      : 'list.comments.startRecording'
  );

  /** `m:ss`, the same shape the assistant's clock uses. */
  readonly elapsed = computed(() => {
    const seconds = this.recorder.elapsedSeconds();

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  onInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  /**
   * The form's own submit, for the reason `LineComposer.onSubmit` gives at length:
   * `(ngSubmit)` is `NgForm`'s output and needs `FormsModule`, which this composer
   * neither imports nor wants, so binding it would leave the native submit to run
   * and reload the page.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.press();
  }

  /** The one button, pressed. */
  press(): void {
    if (this.button() === 'send') {
      this._submitTyped();
      return;
    }

    void this._record();
  }

  /**
   * Start recording, and say so when it did not start.
   *
   * The microphone is drawn even where it cannot work, which is a change from plan
   * `0039` section 6: that plan drew no button at all on a browser that cannot
   * record, and it could, because the microphone sat beside a send button. With one
   * button doing both jobs there is nothing left to draw on an empty field, so the
   * button stays and the failure is said in words. The field never stops working,
   * which is what that rule was protecting.
   *
   * `start()` never rejects: a refused permission and an absent device are states
   * it renders, so this reads the state rather than catching.
   */
  private async _record(): Promise<void> {
    this.errorKey.set(null);
    // A new recording replaces a held one. Two recordings in one composer is a
    // state with no control to resolve it, and the person just started speaking.
    this._held.set(null);

    await this.recorder.start();

    const state = this.recorder.state();
    if (state === 'refused' || state === 'unavailable') {
      // A refused permission and an absent device read the same from here, and
      // the field still works either way.
      this.reportError('list.comments.micRefused');
      this.recorder.cancel();
    }
  }

  /** Stop, which sends. There is no second press. */
  async stopAndSend(): Promise<void> {
    const seconds = this.recorder.elapsedSeconds();
    const blob = await this.recorder.stop();

    if (blob === null || blob.size === 0) {
      // The recorder had nothing, or the browser gave back an empty file. Said
      // in words rather than sent, because an empty recording is a comment
      // nobody can read and nobody can play.
      this.reportError('list.comments.recordingEmpty');
      return;
    }

    const recording: RecordedAudio = {
      blob,
      mimeType: blob.type,
      durationSeconds: seconds,
    };

    if (blob.size > VOICE_COMMENT_MAX_BYTES) {
      // At a speech bitrate a minute is a fraction of this, so reaching it means
      // the browser ignored the bitrate entirely. Kept rather than dropped, which
      // is where every other failure in this composer lands.
      this._held.set(recording);
      this.reportError('list.comments.recordingTooBig', {
        limit: Math.round(VOICE_COMMENT_MAX_BYTES / (1024 * 1024)),
      });
      return;
    }

    this._held.set(recording);
    this.recorded.emit(recording);
  }

  /** Throw the recording away. Whatever was typed is still in the field. */
  discard(): void {
    this.recorder.cancel();
    this._held.set(null);
    this.errorKey.set(null);
  }

  /** Send the held recording again, after a failure. */
  retry(): void {
    const held = this._held();
    if (held === null) {
      return;
    }

    this.errorKey.set(null);
    this.recorded.emit(held);
  }

  /**
   * Clear the composer after a send the container confirmed.
   *
   * Called by the container **only on success**, which is what makes the held
   * recording rule hold: nothing in here throws a recording away on its own, so a
   * failed upload leaves it exactly where it was.
   */
  clear(): void {
    this.body.set('');
    this._held.set(null);
    this.errorKey.set(null);
  }

  /** Report a send that failed, keeping whatever is in the composer. */
  reportError(key: string, args: Record<string, string | number> = {}): void {
    this.errorKey.set(key);
    this.errorArgs.set(args);
  }

  private _submitTyped(): void {
    const said = this.body().trim();
    if (said === '' || this.busy()) {
      return;
    }

    this.submitted.emit(said);
    this.body.set('');
    this._field()?.nativeElement.focus();
  }
}
