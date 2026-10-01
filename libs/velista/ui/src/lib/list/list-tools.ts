import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { FilterIcon } from '../icons/icons';

/**
 * The row above a list of lines: what the page puts at its leading edge, and a way
 * into the filter sheet (velista `0082`, section 2).
 *
 * It was the basket page's own markup until the zone list page needed the same row,
 * and it is one component now so the two screens cannot drift apart.
 *
 * ## No search of its own
 *
 * It held the list's search field until velista `0117`. The composer's field at the
 * bottom of both pages is the search now, and while it holds words the page draws its
 * results in place of this row and the lines under it.
 *
 * ## Plain values in, events out
 *
 * Rule D1: only a page injects a store. The page hands down the badge and hears back
 * a press on the filter.
 *
 * ## What the page puts in it
 *
 * The default slot is the leading edge of the row, which on the basket is how much of
 * the trip is got. A projected element marked `listToolsBelow` is drawn under the row,
 * which is where the basket's chips go. The zone list page projects neither.
 *
 * ## Sticky on its own host
 *
 * The host carries `tools-bar` and the sticky position (velista `0079`, section 2).
 * A sticky box sticks within its parent, so it has to be the host that is the child
 * of the scrolling page, not a box inside the host that is only as tall as itself.
 */
@Component({
  selector: 'lib-list-tools',
  imports: [FilterIcon, RokuTranslatorPipe],
  templateUrl: './list-tools.html',
  styleUrl: './list-tools.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tools-bar' },
})
export class ListTools {
  /** How many filter settings are on, for the badge and the button's name. */
  readonly activeCount = input(0);

  readonly openFilter = output<void>();
}
