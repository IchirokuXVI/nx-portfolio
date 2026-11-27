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
 * the trip is got. A projected element marked `listToolsTrail` sits at the trailing
 * edge, before the filter button, which is where the basket's estimated total goes
 * (velista `0132`, section 3). A projected element marked `listToolsBelow` is drawn
 * under the row, which is where the basket's chips go. The zone list page projects
 * none of the three.
 *
 * ## Not pinned
 *
 * The host carries `tools-bar`. It was sticky inside the basket's scroller (velista
 * `0079`, section 2) and then pinned in a head block outside it (velista `0189`). It
 * is the scroller's first row now and scrolls away with the lines: only the field
 * under it stays on screen, so it has no position of its own.
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
