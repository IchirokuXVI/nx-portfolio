import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { WarningIcon } from '@portfolio/shared/ui';

/**
 * One line beside a warning mark (admin plan 0041, section 3).
 *
 * For an effect that is large or cannot be taken back: saving a price rule
 * works out every shown price again, and a write to a zone is seen at once by
 * the people in it. It stays on the screen, next to the action, because a
 * caution must be seen before the action and not found afterwards behind a
 * button.
 *
 * The mark is not the only sign. The line is on the waiting wash, and the
 * sentence says what happens.
 */
@Component({
  selector: 'lib-caution-line',
  imports: [WarningIcon],
  template: `
    <span class="mark"><lib-warning-icon /></span>
    <span class="text">{{ text() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--admin-space-2);
      align-items: flex-start;
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius-control);
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .mark {
      flex: none;
      inline-size: 1.125rem;
      block-size: 1.125rem;
      margin-block-start: 0.0625rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CautionLine {
  /** The sentence, already translated. */
  readonly text = input.required<string>();
}
