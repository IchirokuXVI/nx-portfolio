import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ShoppingListRowVm } from '@portfolio/velista/models';
import { ChevronRightIcon } from '@portfolio/velista/ui';

/**
 * One trip in the history (plan 0045, section 3.3).
 *
 * A row and not a card, because the page is a list of them and a stack of cards reads
 * as a stack of decisions. It carries one action, which is opening the basket.
 *
 * **Nothing here deletes.** No swipe, no overflow menu, no long press. Backend `0050`
 * section 7 keeps deletion in the API and no screen offers it, which is not an
 * oversight to be corrected later: a history that cannot lose entries is the point of
 * keeping one, and a swipe action on a row somebody is scrolling past is the surest way
 * to lose one by accident.
 *
 * The name arrives resolved, exactly as the dashboard card's does. See `displayNames`.
 */
@Component({
  selector: 'lib-shopping-list-row',
  imports: [RokuTranslatorPipe, ChevronRightIcon],
  templateUrl: './shopping-list-row.html',
  styleUrl: './shopping-list-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListRow {
  readonly row = input.required<ShoppingListRowVm>();

  /** The generation date, formatted in the reader's locale by the container. */
  readonly generatedOn = input('');

  readonly open = output<string>();
}
