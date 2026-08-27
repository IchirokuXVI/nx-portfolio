import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { LineApprovalStatus, LineStatus } from '@portfolio/velista/models';
import { CheckFilledIcon, CircleIcon, SlashCircleIcon } from '../icons/icons';

/**
 * The ring on the leading side of a line: a picture of where that line has got to.
 *
 * ## It is an indicator, not a target
 *
 * The whole row is the target, which is what makes the gesture work with a thumb on
 * the move (section 4.7). Drawing a 24px control and asking somebody walking through a
 * supermarket to hit it would be the single worst decision available on this screen.
 *
 * ## It is `aria-hidden`
 *
 * The row itself is a `checkbox` with `aria-checked`, so this element announcing
 * anything would say the state twice. It is a picture of what the row already says.
 *
 * ## The shape differs in all three states
 *
 * Not only the colour. Hollow ring, filled ring with a tick, and a struck circle, so
 * the row survives a colourblind reader and a monochrome screen. `0002` requires
 * colour never to be the only signal, and a row of identically shaped dots in three
 * hues is the exact thing that rule forbids.
 */
@Component({
  selector: 'lib-line-state-control',
  imports: [CheckFilledIcon, CircleIcon, SlashCircleIcon],
  template: `
    @switch (shape()) {
      @case ('ready') {
        <lib-check-filled-icon class="glyph ready" />
      }
      @case ('unavailable') {
        <lib-slash-circle-icon class="glyph unavailable" />
      }
      @default {
        <lib-circle-icon class="glyph pending" />
      }
    }
  `,
  styleUrl: './line-state-control.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.awaiting]': 'approvalStatus() === "PENDING"',
    '[class.turned-down]': 'approvalStatus() === "REJECTED"',
  },
})
export class LineStateControl {
  readonly status = input.required<LineStatus>();
  readonly approvalStatus = input.required<LineApprovalStatus>();

  /**
   * Which of the three shapes to draw.
   *
   * Keyed on the **item** status only. Approval is a separate machine and is drawn
   * separately, as an edge and a caption, because a control that tried to say both
   * would need nine states and would communicate none of them (section 3.4).
   */
  shape(): 'ready' | 'unavailable' | 'pending' {
    switch (this.status()) {
      case 'READY':
        return 'ready';
      case 'NOT_AVAILABLE':
        return 'unavailable';
      default:
        return 'pending';
    }
  }
}
