import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListHeaderVm } from '@portfolio/velista/models';
import { OfflineIcon } from '../icons/icons';
import { ListViewers } from '../presence/list-viewers';

/**
 * The first block of the list's content: which group it belongs to, how far the shop
 * has got, who else has it open, and whether it is live.
 *
 * ## The name is not here
 *
 * It held the list's name and the settings button until velista `0130`. Both are in
 * the page's `PageHeader` now, because a header holds only a title and everything else
 * about the list is content under it. So this has no `h1` and is not a `header`
 * element, and the name in `ListHeaderVm` is read by the page, for its title.
 *
 * Rule L2 still shapes it: the lines never wait on the request that names the list, so
 * on a cold arrival the group line is absent and the counts are the lines' own.
 *
 * ## The progress moves with the thumb
 *
 * It is computed from the lines the page is holding, which are optimistic, so ticking a
 * row moves the counter on the same frame as the row. A progress bar that waited for
 * the server would lag every tap on the screen whose entire point is that taps do not
 * lag (section 3.3).
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

  /**
   * The bar's fill, as a percentage.
   *
   * It fills with what is **finished**, not with what is wanted. `wantedCount` counts
   * the lines the household still wants, so the bar filled backwards until plan 0060:
   * full before the shop and empty after it.
   *
   * `wantedCount` can never exceed `lineCount`, so the subtraction cannot go negative
   * and the bar cannot invert. Both of the header's sources guarantee it: once the
   * lines are here `selectHeader` counts a subset of the lines it is also measuring,
   * and before they arrive the cached summary has been through `readListCounts`, which
   * clamps. That clamp is load bearing here, and the mapper's own comment explains it
   * only as a display nicety.
   *
   * An empty list is 0 rather than a division by zero, and the template never asks:
   * at zero lines it draws "List is empty" and no bar at all, because an empty bar
   * under an empty list is decoration that describes nothing (plan 0019, section 3).
   * The guard stays anyway, so the computed is safe to read from anywhere.
   */
  readonly percent = computed(() => {
    const { wantedCount, lineCount } = this.header();

    return lineCount === 0
      ? 0
      : Math.round(((lineCount - wantedCount) / lineCount) * 100);
  });
}
