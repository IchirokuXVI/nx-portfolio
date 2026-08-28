import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ZoneCardVm } from '@portfolio/velista/models';
import { ChevronRightIcon, ListLinesIcon, MemberAddIcon } from '../icons/icons';

/**
 * One group, as a card.
 *
 * The name keeps the code word **zone** while everything a user reads says "group".
 * That mismatch is rule N2 in plan 0001 and it is intentional: the user facing word is
 * a translation value, so changing it again is a two file edit. Renaming this class to
 * `GroupCard` is exactly the confusion the rule exists to prevent.
 *
 * Three things this component has to get right, all of them from plan 0003:
 *
 * - **Never nested buttons.** The card is one tap target and the list rows are their
 *   own, so they are siblings rather than children (section 7). A row inside a card
 *   button is invalid HTML and unusable with a keyboard.
 * - **Role and status are never colour alone** (section 7). `OWNER`, `MEMBER` and
 *   `PENDING` are text labels that happen to be tinted.
 * - **A long name must not push the Review action off screen** (section 4.1): the name
 *   truncates and the counter and action never shrink.
 */
@Component({
  selector: 'lib-zone-card',
  imports: [
    NgTemplateOutlet,
    RokuTranslatorPipe,
    ChevronRightIcon,
    ListLinesIcon,
    MemberAddIcon,
  ],
  templateUrl: './zone-card.html',
  styleUrl: './zone-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneCard {
  readonly zone = input.required<ZoneCardVm>();

  readonly open = output<string>();

  /**
   * Emits **both** ids, because the list route needs both.
   *
   * `zones/:zoneId/lists/:listId` is rule L1 (plan 0012, section 4.1) and it is not
   * decoration: there is no `GET /v1/lists/:id`, so a list id on its own resolves
   * nothing. This card already knows the zone it is drawing, so it says so rather than
   * making the container look it up from the id it was handed.
   */
  readonly openList = output<{ zoneId: string; listId: string }>();

  readonly reviewRequests = output<string>();
}
