import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { StopIcon, TrashIcon } from '../icons/icons';

/**
 * What the row is showing, which is the part of `RecorderState` it cares about.
 *
 * Not `RecorderState` itself: `idle`, `refused` and `unavailable` are states in
 * which this row is not drawn at all, and taking the whole union would invite a
 * caller to pass one and expect something sensible.
 */
export type RecordingPhase = 'recording' | 'capped';

/**
 * The controls on screen while a recording is running (plan 0041, sections 4 and 6).
 *
 * Trash on the far left, whatever the caller puts in the middle, stop on the far
 * right. Two callers today, the assistant panel and the comment composer, which is
 * what plan `0038` section 7 said had to be true before this left the assistant:
 * a shared component with one caller is a guess about the second one.
 *
 * ## The trash, and why it replaced pause
 *
 * Pause held a recording and gave it back; it never gave anybody a way out. Every
 * recording that was started had exactly one exit, which was to be sent, so
 * somebody who pressed the microphone by accident or thought better of what they
 * were saying had to send it and then delete it, and on a comment that means
 * sending a message to the people they shop with before withdrawing it.
 *
 * It is enabled in **both** phases, including at the cap. Pause was disabled there
 * so that stop was the only way out, and a trash disabled there would mean the one
 * recording somebody most wants to throw away, the longest one, is the one they
 * cannot.
 *
 * ## The distance is the safeguard
 *
 * `justify-content: space-between` and the middle taking the slack, so the two
 * controls are as far apart as the container allows. That is plan `0032` section
 * 4.3's argument, kept: they are the only two controls on screen and confusing them
 * costs the whole message. It is the one thing here a caller cannot change.
 *
 * ## It is a default, not a cage (section 6.1)
 *
 * Every string is an input, so the component holds no copy of its own and the
 * assistant can say something longer than a comment sheet does. The middle is a
 * content slot, so a caller that later wants a level meter there (plan `0038`
 * section 4.1) adds one without touching this file. What is deliberately fixed is
 * the geometry above.
 *
 * Rule D1: it injects nothing, knows nothing about `AudioRecorder`, and reaches no
 * service. It takes a phase and emits two intentions.
 */
@Component({
  selector: 'lib-recording-row',
  imports: [RokuTranslatorPipe, StopIcon, TrashIcon],
  template: `
    <div class="row">
      <!--
        Far left. Coral, because it is the control that destroys something, which
        is what coral means everywhere else in this app. Never colour alone: it is
        also the only bin glyph on screen.
      -->
      <button
        (click)="discard.emit()"
        [attr.aria-label]="discardLabel() | rokuT"
        class="discard"
        type="button"
      >
        <lib-trash-icon class="glyph" />
      </button>

      <div class="middle">
        <ng-content />
      </div>

      <!--
        Far right, and amber, because stop is the send now: one press ends the
        recording and the message goes. It used to be coral, which was right when
        it was the only control that ended anything and there was nothing
        destructive beside it to confuse it with.
      -->
      <button
        (click)="stop.emit()"
        [attr.aria-label]="stopLabel() | rokuT"
        class="stop"
        type="button"
      >
        <lib-stop-icon class="glyph" />
      </button>
    </div>
  `,
  styleUrl: './recording-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingRow {
  /**
   * Recording, or held at the cap.
   *
   * Nothing in this component is disabled by it and nothing is hidden by it: both
   * controls do the same thing in both phases. It is here because callers style
   * the middle differently once the clock has stopped, and because a component
   * that is drawn in two situations should be able to say which it is in.
   */
  readonly phase = input<RecordingPhase>('recording');

  /** Translation key for the trash's accessible name. */
  readonly discardLabel = input.required<string>();

  /** Translation key for the stop's accessible name. */
  readonly stopLabel = input.required<string>();

  /** End the recording and send it. */
  readonly stop = output<void>();

  /** End the recording and throw it away. */
  readonly discard = output<void>();
}
