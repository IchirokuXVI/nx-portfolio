import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListHeaderVm } from '@portfolio/velista/models';
import { OfflineIcon } from '../icons/icons';
import { ListViewers } from '../presence/list-viewers';

/**
 * The list's head block, the first row of the page's column above the field (velista
 * `0189`): who else has the list open, and whether it is live. It scrolls away with
 * the lines; only the field under it stays pinned.
 *
 * ## The name and the group are not here
 *
 * It held the list's name and the settings button until velista `0130`. Both are in
 * the page's `PageHeader` now, because a header holds only a title and everything else
 * about the list is content under it. So this has no `h1` and is not a `header`
 * element, and the name in `ListHeaderVm` is read by the page, for its title.
 *
 * The group went the same way in velista `0205`: it is the subtitle of the page
 * header now ("in Casa" under the list's name), so `zoneName` too is read by the page.
 * With nobody else here and a live list this block draws nothing and takes no room,
 * which is the usual case: the field sits directly under the page header.
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
  host: {
    // The condition under which both lines draw nothing: `ListViewers` hides itself
    // on an empty set, and the band draws only for a list that is not live.
    '[class.empty]': 'header().viewers.length === 0 && header().live',
  },
})
export class ListHeader {
  readonly header = input.required<ListHeaderVm>();
}
