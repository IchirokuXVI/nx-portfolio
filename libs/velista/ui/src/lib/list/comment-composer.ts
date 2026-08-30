import {
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
  COMMENT_BODY_MAX_LENGTH,
  VOICE_COMMENT_MAX_BYTES,
  VOICE_COMMENT_MAX_SECONDS,
} from '@portfolio/velista/models';
import {
  VOICE_CAPTURE,
  type VoiceCaptureI,
  type VoiceCaptureSession,
  type VoiceRecording,
} from '@portfolio/velista/platform';
import { MicIcon, SendIcon, StopIcon } from '../icons/icons';

/** What the composer is doing, which decides the whole of what it draws. */
type Mode = 'idle' | 'recording' | 'held';

/**
 * Saying something about a line, by typing it or by saying it.
 *
 * A textarea rather than the single line input the line composer uses, and the
 * difference is what is being written: a line is a thing to buy and a comment is a
 * sentence about one, so it wraps and it grows.
 *
 * **No longer offered to a reader.** `comment.add` used to require only an approved
 * membership on the zone, which made this the one thing somebody with read access
 * could really do. Backend plan 0036 section 4 narrows it to `WRITE` or `DECIDE`,
 * so read means read here as well, and the sheet draws this component only for
 * `canComment` (velista plan 0030, section 3.1).
 *
 * ## Both controls are present at once
 *
 * Not the empty field switch the line composer gets. That one has a single job at a
 * time because its row is already crowded with a stepper, and because adding a line
 * is a single act with one output. **A comment is a message**, and the choice
 * between typing one and speaking one is a choice about the message rather than
 * about whether the field happens to be empty: somebody who starts typing, stops,
 * and decides to say it instead should not have to clear the box to find the
 * microphone (plan 0039, section 2).
 *
 * While recording, the microphone becomes a stop and the field is **dimmed rather
 * than removed**, because removing it would move the send button under the thumb
 * that is about to press stop.
 *
 * ## No silence detection
 *
 * Press to start, press to stop, and a hard cap. Plan 0038's line composer ends a
 * recording when the talking stops, because the person has their hands full in
 * front of a fridge; here they are holding the phone and looking at the screen, and
 * a message is not one sentence. Somebody leaving a comment pauses to think, and a
 * detector that ended the recording during that pause would have cut them off mid
 * message with no way to continue.
 *
 * The cap **stops rather than sends**, which is plan 0032 section 4.4's rule: a
 * message that leaves on its own is a message nobody agreed to send.
 *
 * ## A failed send never discards the recording
 *
 * Somebody just spoke for forty seconds. Losing that to a dropped connection is the
 * worst outcome in this plan and it is entirely avoidable, so the blob is **held
 * here until a send succeeds**: the container reports failure by leaving `busy`,
 * the composer keeps what it has, and the send button can be pressed again. It is
 * held rather than queued, for plan 0038 section 6's reason — retryable by hand is
 * not the same as sent automatically twenty minutes later.
 */
@Component({
  selector: 'lib-comment-composer',
  imports: [RokuTranslatorPipe, SendIcon, MicIcon, StopIcon],
  template: `
    <form (submit)="onSubmit($event)" class="composer">
      <textarea
        (input)="onInput($event)"
        [attr.aria-label]="'list.comments.placeholder' | rokuT"
        [attr.maxlength]="maxLength"
        [disabled]="mode() === 'recording'"
        [placeholder]="placeholder() | rokuT"
        [value]="body()"
        #field
        class="field"
        name="body"
        rows="2"
      ></textarea>

      @if (canRecord()) {
        <button
          (click)="toggleRecording()"
          [attr.aria-label]="micLabel() | rokuT"
          [attr.aria-pressed]="mode() === 'recording'"
          [class.recording]="mode() === 'recording'"
          [disabled]="busy()"
          class="mic"
          type="button"
        >
          @if (mode() === 'recording') {
            <lib-stop-icon class="glyph" />
          } @else {
            <lib-mic-icon class="glyph" />
          }
        </button>
      }

      <button
        [attr.aria-label]="'list.comments.send' | rokuT"
        [disabled]="!canSubmit() || busy()"
        class="send"
        type="submit"
      >
        <lib-send-icon class="glyph" />
      </button>
    </form>

    @if (mode() === 'recording') {
      <p class="status" role="status">
        {{ 'list.comments.recording' | rokuT: { seconds: elapsed() } }}
      </p>
    }

    @if (mode() === 'held') {
      <p class="status" role="status">
        {{ 'list.comments.recordingHeld' | rokuT: { seconds: heldSeconds() } }}
      </p>
    }

    @if (errorKey(); as key) {
      <p class="error" role="alert">{{ key | rokuT: errorArgs() }}</p>
    }
  `,
  styleUrl: './comment-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentComposer {
  readonly busy = input(false);

  readonly submitted = output<string>();

  /**
   * A recording the person is ready to send.
   *
   * The container uploads it and reports back through {@link busy}; on failure it
   * calls nothing, and the blob stays here to be sent again.
   */
  readonly recorded = output<VoiceRecording>();

  readonly body = signal('');
  readonly maxLength = COMMENT_BODY_MAX_LENGTH;

  readonly mode = signal<Mode>('idle');
  readonly elapsed = signal(0);
  readonly errorKey = signal<string | null>(null);
  readonly errorArgs = signal<Record<string, string | number>>({});

  private readonly _capture = inject<VoiceCaptureI>(VOICE_CAPTURE);
  private readonly _field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  private _session: VoiceCaptureSession | null = null;
  private _ticker: ReturnType<typeof setInterval> | null = null;
  private readonly _held = signal<VoiceRecording | null>(null);

  /**
   * Whether the microphone is drawn at all.
   *
   * A browser that cannot record gets no button and a composer that is exactly
   * what it was before (plan 0039, section 6). Drawing a control that cannot work
   * is worse than not drawing one.
   */
  readonly canRecord = computed(() => this._capture.supported());

  readonly heldSeconds = computed(() =>
    Math.round(this._held()?.durationSeconds ?? 0)
  );

  /** Something to send: typed words, or a recording waiting to go. */
  readonly canSubmit = computed(
    () => this.body().trim() !== '' || this._held() !== null
  );

  readonly placeholder = computed(() =>
    this.mode() === 'recording'
      ? 'list.comments.recordingPlaceholder'
      : 'list.comments.placeholder'
  );

  readonly micLabel = computed(() =>
    this.mode() === 'recording'
      ? 'list.comments.stopRecording'
      : 'list.comments.startRecording'
  );

  constructor() {
    // A composer that is destroyed mid recording must not leave the microphone
    // open: the browser keeps its indicator on and the stream alive behind a
    // component nobody holds any more.
    inject(DestroyRef).onDestroy(() => {
      this._stopClock();
      this._session?.close();
      this._session = null;
    });
  }

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
    void this.submit();
  }

  async submit(): Promise<void> {
    // Pressing send while recording ends the recording first, which is what
    // somebody who reached for the wrong button meant either way.
    if (this.mode() === 'recording') {
      await this._finish();
      return;
    }

    const held = this._held();
    if (held !== null) {
      this.recorded.emit(held);
      return;
    }

    if (this.body().trim() === '') {
      return;
    }

    this.submitted.emit(this.body().trim());
    this.body.set('');
    this._field()?.nativeElement.focus();
  }

  /**
   * Clear the composer after a send the container confirmed.
   *
   * Called by the container **only on success**, which is what makes section 6's
   * rule hold: nothing in here throws the recording away on its own, so a failed
   * upload leaves it exactly where it was.
   */
  clear(): void {
    this.body.set('');
    this._held.set(null);
    this.errorKey.set(null);
    this.mode.set('idle');
  }

  /** Report a send that failed, keeping whatever is in the composer. */
  reportError(key: string, args: Record<string, string | number> = {}): void {
    this.errorKey.set(key);
    this.errorArgs.set(args);
  }

  async toggleRecording(): Promise<void> {
    if (this.mode() === 'recording') {
      await this._finish();
      return;
    }

    this.errorKey.set(null);
    // A new recording replaces a held one. Two recordings in one composer is a
    // state with no control to resolve it, and the person just started speaking.
    this._held.set(null);

    try {
      this._session = await this._capture.open();
    } catch {
      // A refused permission and an absent device read the same from here, and
      // the field still works either way (plan 0039, section 6).
      this.reportError('list.comments.micRefused');
      return;
    }

    this.mode.set('recording');
    this.elapsed.set(0);
    this._startClock();
  }

  private _startClock(): void {
    this._stopClock();
    this._ticker = setInterval(() => {
      const next = this.elapsed() + 1;
      this.elapsed.set(next);

      // The cap stops rather than sends (plan 0032, section 4.4). What is on the
      // screen afterwards is a held recording and a send button, so leaving is
      // still something a person does.
      if (next >= VOICE_COMMENT_MAX_SECONDS) {
        void this._finish();
      }
    }, 1000);
  }

  private _stopClock(): void {
    if (this._ticker !== null) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  /** Stop recording and hold what came out, or say why it cannot be sent. */
  private async _finish(): Promise<void> {
    const session = this._session;
    this._session = null;
    this._stopClock();

    if (session === null) {
      this.mode.set('idle');
      return;
    }

    const recording = await session.stop();
    this.mode.set('idle');

    if (recording.blob.size === 0) {
      this.reportError('list.comments.recordingEmpty');
      return;
    }

    // Said in words with the limit in it, and **the recording is kept**, so it can
    // be sent after trimming rather than lost (plan 0039, section 6). There is no
    // trimming control today; what this buys is that the bytes are still here when
    // there is one, and that nothing silently disappeared.
    if (recording.blob.size > VOICE_COMMENT_MAX_BYTES) {
      this.reportError('list.comments.recordingTooBig', {
        limit: Math.round(VOICE_COMMENT_MAX_BYTES / (1024 * 1024)),
      });
    }

    this._held.set(recording);
    this.mode.set('held');
  }
}
