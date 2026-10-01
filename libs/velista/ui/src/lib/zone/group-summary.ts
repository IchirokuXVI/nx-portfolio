import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { GroupHeaderVm } from '@portfolio/velista/models';
import { ChevronRightIcon, OfflineIcon, PersonIcon } from '../icons/icons';
import { PresenceRow } from '../presence/presence-row';
import { RoleChip } from './role-chip';

/**
 * The first block of the group page's content: the reader's role, who is here now,
 * and the two ways further in.
 *
 * This was `GroupHeader`, and it held the group's name in an `h1` beside an initial
 * tile. Velista `0130` gave every page one header, so the name is the page header's
 * title and what is left here is no longer a header: the tile is gone, the role chip
 * leads the presence line, and the member count is the value of the Members row,
 * which is where somebody goes to see members (section 5.1).
 *
 * **Rule G2 is drawn here and decided elsewhere.** This component renders a governance
 * row when `isStaff` is true and does not, itself, know what a role is worth. It is
 * also the reason the row is one control and not five: the settings sheet holds rename,
 * regenerate and delete together, so this carries a way in rather than a toolbar.
 *
 * It emits and injects nothing (rule D1). The page above it owns every store.
 */
@Component({
  selector: 'lib-group-summary',
  imports: [
    RokuTranslatorPipe,
    ChevronRightIcon,
    OfflineIcon,
    PersonIcon,
    PresenceRow,
    RoleChip,
  ],
  templateUrl: './group-summary.html',
  styleUrl: './group-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupSummary {
  readonly group = input.required<GroupHeaderVm>();

  readonly openMembers = output<void>();
  readonly openSettings = output<void>();
}
