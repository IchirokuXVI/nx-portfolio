import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListHeaderVm } from '@portfolio/velista/models';
import { OfflineIcon } from '../icons/icons';
import { ListViewers } from '../presence/list-viewers';

/**
 * The list's head block, pinned under the page header (velista `0189`): which group
 * the list belongs to, who else has it open, and whether it is live.
 *
 * ## The name is not here
 *
 * It held the list's name and the settings button until velista `0130`. Both are in
 * the page's `PageHeader` now, because a header holds only a title and everything else
 * about the list is content under it. So this has no `h1` and is not a `header`
 * element, and the name in `ListHeaderVm` is read by the page, for its title.
 *
 * Rule L2 still shapes it: the lines never wait on the request that names the list, so
 * on a cold arrival the group line is absent.
 *
 * ## No progress
 *
 * The count line, the cost and the bar went with velista `0189`: the owner will find
 * them another place. `ListHeaderVm` still carries the numbers for that.
 */
@Component({
  selector: 'lib-list-header',
  imports: [RokuTranslatorPipe, OfflineIcon, ListViewers],
  templateUrl: './list-header.html',
  styleUrl: './list-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListHeader {
  readonly header = input.required<ListHeaderVm>();
}
