import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListHeaderVm } from '@portfolio/velista/models';
import { OfflineIcon } from '../icons/icons';
import { ListViewers } from '../presence/list-viewers';

/**
 * The top of the list: what it is called, which group it belongs to, and how far the
 * shop has got.
 *
 * ## The title can be absent, and that is a designed state
 *
 * Rule L2: the lines are requested from the list id alone and never wait on the request
 * that names the list. Finding the name means paging the zone's lists, which on a cold
 * arrival is a second round trip. So the title skeletons and fills in, while the body
 * is already usable. Somebody opening the app in an aisle should not wait for a heading
 * before they can see what to buy.
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

  /** Whether to offer the overflow at all. False when the caller may do nothing to it. */
  readonly hasMenu = input(false);

  /** Whether reordering is available right now (rule L4). */
  readonly canReorder = input(false);

  readonly openSettings = output<void>();
  readonly startReorder = output<void>();

  /**
   * The bar's fill, as a percentage.
   *
   * An empty list is 0 rather than a division by zero, and the template never asks:
   * at zero lines it draws "List is empty" and no bar at all, because an empty bar
   * under an empty list is decoration that describes nothing (plan 0019, section 3).
   * The guard stays anyway, so the computed is safe to read from anywhere.
   */
  readonly percent = computed(() => {
    const { wantedCount, lineCount } = this.header();
    return lineCount === 0 ? 0 : Math.round((wantedCount / lineCount) * 100);
  });
}
