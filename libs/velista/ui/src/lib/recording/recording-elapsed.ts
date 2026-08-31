import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The dot and the clock that sit between the trash and the stop.
 *
 * Separate from `RecordingRow` because the middle of that row is a content slot
 * (plan 0041, section 6.1) and this is what both callers happen to put in it.
 * Offered as a component so neither has to redraw it, and separate so that a
 * caller who later wants a level meter there (plan `0038` section 4.1) is adding
 * something beside this rather than editing the row.
 *
 * The dot is filled while the microphone is open and hollow once it is not. It is
 * the one signal here that is not a shape, which is why it is never the only one:
 * the clock stops at the same moment, and the caller's own notice says what
 * happened in words.
 */
@Component({
  selector: 'lib-recording-elapsed',
  template: `
    <span [class.live]="live()" aria-hidden="true" class="dot"></span>
    <p [class.held]="!live()" class="clock">{{ elapsed() }}</p>
  `,
  styleUrl: './recording-elapsed.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingElapsed {
  /** Already formatted, because `m:ss` and `12s` are both reasonable and the caller decides. */
  readonly elapsed = input.required<string>();

  /** Whether the microphone is still open. False at the cap. */
  readonly live = input(true);
}
