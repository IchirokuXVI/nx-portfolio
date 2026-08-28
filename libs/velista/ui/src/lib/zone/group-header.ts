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
 * The top of the group page: what it is called, who is in it, and what staff may do.
 *
 * **Rule G2 is drawn here and decided elsewhere.** This component renders a governance
 * row when `isStaff` is true and does not, itself, know what a role is worth. It is
 * also the reason the row is one control and not five: the settings sheet holds rename,
 * regenerate and delete together, so the header carries the group's identity and a way
 * in rather than a toolbar.
 *
 * It emits and injects nothing (rule D1). The page above it owns every store.
 */
@Component({
  selector: 'lib-group-header',
  imports: [
    RokuTranslatorPipe,
    ChevronRightIcon,
    OfflineIcon,
    PersonIcon,
    PresenceRow,
    RoleChip,
  ],
  templateUrl: './group-header.html',
  styleUrl: './group-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupHeader {
  readonly group = input.required<GroupHeaderVm>();

  readonly openMembers = output<void>();
  readonly openSettings = output<void>();
}
