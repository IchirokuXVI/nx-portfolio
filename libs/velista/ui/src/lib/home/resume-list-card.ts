import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ResumeListVm } from '@portfolio/velista/models';
import { ChevronRightIcon } from '../icons/icons';

/**
 * The last list the user opened, and the fastest path back into it.
 *
 * This is the strongest argument for the home route being the landing page: someone
 * who opens the installed app in a supermarket aisle is one tap from where they were,
 * with no navigation in between.
 *
 * The counts are optional and the progress bar simply does not render without them, so
 * the card is useful the moment the backend can name the list and stays useful when it
 * can also count it (plan 0003, section 5.2).
 */
@Component({
  selector: 'lib-resume-list-card',
  imports: [RokuTranslatorPipe, ChevronRightIcon],
  templateUrl: './resume-list-card.html',
  styleUrl: './resume-list-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResumeListCard {
  readonly list = input.required<ResumeListVm>();

  /** Emits the list id. The container decides where that goes. */
  readonly open = output<string>();

  /** Percentage ready, or null when the counts have not arrived. */
  readonly progress = computed(() => {
    const { lineCount, readyCount } = this.list();
    if (
      lineCount === undefined ||
      readyCount === undefined ||
      lineCount === 0
    ) {
      return null;
    }
    return Math.round((readyCount / lineCount) * 100);
  });

  /** The first two initials, for the stacked avatars. */
  readonly initials = computed(() =>
    this.list()
      .shoppers.slice(0, 2)
      .map((name) => name.slice(0, 1).toUpperCase())
  );

  /** "Ana and Marc", already joined, because Spanish does not join lists the same way. */
  readonly shopperNames = computed(() => this.list().shoppers.join(', '));
}
