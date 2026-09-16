import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import type { ListHeaderVm } from '@portfolio/velista/models';
import { OfflineIcon } from '../icons/icons';
import { ListViewers } from '../presence/list-viewers';

const NO_BREAK_SPACE = String.fromCharCode(0x00a0);

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

  /**
   * Whether reorder has to wait for the list order (velista `0082`, section 7).
   *
   * True while A to Z is on, a category is picked, or a search is active. The action
   * stays visible and **held**, following `AuthActions`: `aria-disabled` and never
   * `disabled`, because a disabled button swallows its own click and the sentence
   * explaining why it will not act could never be triggered by the thing pressed.
   */
  readonly reorderHeld = input(false);

  readonly openSettings = output<void>();
  readonly startReorder = output<void>();

  /**
   * How many times the held action was pressed since it was last held.
   *
   * Linked to {@link reorderHeld}, so it starts again at zero whenever the hold
   * changes, and the message goes when all three conditions are off.
   */
  private readonly _heldTaps = linkedSignal({
    source: this.reorderHeld,
    computation: () => 0,
  });

  /**
   * What a held press says, or the empty string.
   *
   * The region under the header is polite and always in the document, so a sentence
   * written into it is announced. A second press writes the same words, which a
   * screen reader does not announce again, so every other press carries a trailing
   * no-break space: the text changes, the words do not, and each tap is heard once.
   */
  readonly heldMessage = computed(() => {
    const taps = this._heldTaps();
    if (!this.reorderHeld() || taps === 0) {
      return '';
    }
    return (
      this._translator.t('list.reorder.unavailable') +
      (taps % 2 === 0 ? NO_BREAK_SPACE : '')
    );
  });

  private readonly _translator = inject(RokuTranslatorService);

  /** The reorder action: enter the mode, or say why it has to wait. */
  pressReorder(): void {
    if (this.reorderHeld()) {
      this._heldTaps.update((taps) => taps + 1);
      return;
    }
    this.startReorder.emit();
  }

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
