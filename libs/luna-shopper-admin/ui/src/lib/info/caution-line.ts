import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CheckIcon, WarningIcon } from '@portfolio/shared/ui';

/**
 * One line beside a mark (admin plan 0041, section 3; admin plan 0052,
 * section 3.11).
 *
 * For an effect that is large or cannot be taken back: saving a price rule
 * works out every shown price again, and a write to a zone is seen at once by
 * the people in it. It stays on the screen, next to the action, because a
 * caution must be seen before the action and not found afterwards behind a
 * button.
 *
 * The record page says two more things in one line, so the line has a tone:
 *
 * - `caution` is amber, with the warning mark. It is the default.
 * - `refused` is red, with the warning mark: a refusal that belongs to no
 *   field. It interrupts a screen reader.
 * - `saved` is pine, with a check mark: the save went through. It is said
 *   when the reader is free.
 *
 * The mark is not the only sign. The line is on the wash of its tone, and the
 * sentence says what happens. One link can follow the sentence, as the content
 * of the element: "Open that brand", "Add another product".
 */
@Component({
  selector: 'lib-caution-line',
  imports: [CheckIcon, WarningIcon],
  template: `
    <span class="mark">
      @if (tone() === 'saved') {
        <lib-check-icon />
      } @else {
        <lib-warning-icon />
      }
    </span>
    <span class="text">{{ text() }} <ng-content /></span>
  `,
  host: {
    '[attr.data-tone]': 'tone()',
    '[attr.role]': 'role()',
  },
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

    :host([data-tone='refused']) {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    :host([data-tone='saved']) {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .mark {
      flex: none;
      inline-size: 1.125rem;
      block-size: 1.125rem;
      margin-block-start: 0.0625rem;
    }

    /* The link is the ink of the wash it stands on, and underlined so that it
       is not told from the sentence by weight alone. The page puts it in, so
       the rule has to reach content this component did not draw. */
    :host ::ng-deep a {
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 0.1875rem;
      color: inherit;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CautionLine {
  /** The sentence, already translated. */
  readonly text = input.required<string>();
  /** What kind of line this is. See the list above. */
  readonly tone = input<'caution' | 'refused' | 'saved'>('caution');

  /** A refusal interrupts, a save is said in turn, and a caution is only read. */
  role(): 'alert' | 'status' | null {
    switch (this.tone()) {
      case 'refused':
        return 'alert';
      case 'saved':
        return 'status';
      default:
        return null;
    }
  }
}
