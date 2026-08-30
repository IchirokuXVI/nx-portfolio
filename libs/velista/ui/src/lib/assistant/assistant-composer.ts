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
import { Dictation } from '@portfolio/velista/platform';
import {
  MicIcon,
  PauseIcon,
  PlayIcon,
  SendIcon,
  StopIcon,
} from '../icons/icons';

/** What the one button on the right is currently for. */
export type ComposerButton = 'record' | 'send' | 'stop';

/**
 * The field, the dictation, and the one button that is both (plan 0032, section 4).
 *
 * ## One slot, three jobs
 *
 * The right hand button is the same size in the same corner throughout, and what it is
 * depends only on the state: microphone on an empty field, send on a typed one, stop
 * while recording. Never two buttons competing for one intention, and **nothing moves
 * under the thumb** — stop inherits the microphone's exact position, so the finger that
 * started a recording ends it without travelling.
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
 * ## Why it injects the dictation
 *
 * `Dictation` is in `platform`, which rule D1 permits this library to reach, the way
 * `AppLayout` already reaches `ThemeStore`. What D1 forbids is `data-access`, and there
 * is none here: the words leave as an output and this component never learns what
 * becomes of them. Keeping the capture beside the controls is what stops five signals
 * and four callbacks being threaded through the page above.
 */
@Component({
  selector: 'lib-assistant-composer',
  imports: [
    RokuTranslatorPipe,
    MicIcon,
    PauseIcon,
    PlayIcon,
    SendIcon,
    StopIcon,
  ],
  templateUrl: './assistant-composer.html',
  styleUrl: './assistant-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantComposer {
  private readonly _dictation = inject(Dictation);

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

  protected readonly dictation = this._dictation;

  /** The elapsed length as `m:ss`, which is what sits between pause and stop. */
  protected readonly elapsed = computed(() => {
    const seconds = this._dictation.elapsedSeconds();

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  /**
   * Which of the three the button is, and the whole of section 4.1 in one expression.
   *
   * Recording wins over a typed field, because a field with dictated text in it and a
   * microphone still open is a state where stop is unambiguously the next thing.
   */
  protected readonly button = computed<ComposerButton>(() =>
    this._dictation.active()
      ? 'stop'
      : this.text().trim().length > 0
        ? 'send'
        : 'record'
  );

  /** A message the person typed or dictated with the platform keyboard. */
  readonly send = output<string>();

  /**
   * A message they spoke, as the words.
   *
   * A string and not a recording, because the service that shipped takes text and has
   * no audio route at all (backend `0039`); `SpeechCapture` carries the account. The
   * happy consequence is that the caller's own bubble can show what was understood
   * straight away, which under an audio upload would have needed the service to send
   * the transcription back.
   *
   * **It still sends immediately**, which is what section 12 settled: for this audience
   * an accidental stop is a sent message with no way back, and a confirm step would tax
   * every message to protect the rare one. Seeing the words appear as the caller's own
   * bubble is the check, and it costs no press.
   */
  readonly spoke = output<string>();

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
    switch (this.button()) {
      case 'send':
        this._submit();
        return;
      case 'record':
        void this._dictation.start();
        return;
      default:
        void this._stop();
    }
  }

  /** Submitting the form, which is the keyboard's own way of pressing send. */
  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.button() === 'send') {
      this._submit();
    }
  }

  protected pauseOrResume(): void {
    if (this._dictation.state() === 'paused') {
      this._dictation.resume();
      return;
    }

    this._dictation.pause();
  }

  /**
   * Dismiss the "it did not start" state, so the composer comes back.
   *
   * A refused microphone leaves the dictation in `refused` and the panel says so; the
   * way out of it is this rather than a retry, because pressing the microphone again
   * against a permission the browser has remembered produces the same state silently.
   */
  protected dismissDictationState(): void {
    this._dictation.cancel();
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
    const said = await this._dictation.stop();

    // Null is no session, an empty string is a microphone that heard nothing
    // recognisable, and both are the same as an empty field: the press ended the
    // dictation and sent nothing, rather than sending an empty message.
    if (said !== null && said.length > 0) {
      this.spoke.emit(said);
    }
  }
}
