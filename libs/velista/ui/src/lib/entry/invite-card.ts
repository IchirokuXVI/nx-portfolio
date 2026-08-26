import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CopyIcon, ShareIcon } from '../icons/icons';

/**
 * What the creator of a group is handed, above their groups.
 *
 * A group of one is useless, so the code leads: the card is the first thing on the
 * dashboard after a create, and the list of groups sits under it. It is not a screen
 * of its own, because a screen would have to be dismissed before the person could see
 * what they made (plan 0008, section 3.3).
 *
 * **The confirmation is text, not colour.** `copied` swaps the button's own label,
 * and the live region beside it says the same thing out loud, so somebody who cannot
 * see a colour change still knows the code is on their clipboard. Copying itself is
 * the container's job: it is `navigator.clipboard`, and rule D2 puts that behind
 * `BrowserFacade`, which this library may not inject.
 */
@Component({
  selector: 'lib-invite-card',
  imports: [RokuTranslatorPipe, CopyIcon, ShareIcon],
  templateUrl: './invite-card.html',
  styleUrl: './invite-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteCard {
  readonly zoneName = input.required<string>();
  readonly joinCode = input.required<string>();

  /** Set for a few seconds after a successful copy. Swaps the label. */
  readonly copied = input(false);

  /**
   * Whether to offer sharing at all.
   *
   * The Web Share API exists on a phone and mostly does not on a desktop, and a
   * button that opens nothing is worse than one that is absent. The container asks
   * `BrowserFacade`; this component only draws what it is told.
   */
  readonly shareable = input(true);

  readonly copyCode = output<void>();
  readonly share = output<void>();
}
