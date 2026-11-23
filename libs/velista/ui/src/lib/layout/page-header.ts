import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { handleBackWhile, LiveConnection } from '@portfolio/velista/platform';
import { ChevronLeftIcon, CloseIcon, OfflineIcon } from '../icons/icons';

/**
 * The one header every page inside `AppLayout` draws (velista `0130`).
 *
 * Every page used to draw its own: a brand bar here, a back row and a title row
 * there, a border on some and none on others, and a title that was `2xl` on one page
 * and `xl` on the next. This is the home page's header, and only three things differ
 * from page to page: the title, what the left end holds, and the quick actions.
 *
 * ## The rules it holds, H1 to H6
 *
 * - **H1.** One block size, `--app-header-height`, with the top safe area added as
 *   padding. No input makes it taller or shorter.
 * - **H2.** One title: one line, cut with an ellipsis, in the display face at
 *   `--app-header-title-size`. It is the page's `h1`. Amended by the owner on
 *   2026-11-22 (velista `0205`): under the title the header may draw **one** optional
 *   subtitle line, in `--app-text-xs` and `--app-text-muted`, one line and cut with an
 *   ellipsis, inside the same block size (H1 holds). It is a `p` beside the `h1`, so
 *   the page's heading stays the title.
 * - **H3.** Always a bottom border. No input turns it off.
 * - **H4.** The left end holds a back button or an icon, never neither and never
 *   both. `backLabel` decides: set, the chevron draws; not set, the projected
 *   `[pageHeaderIcon]` does.
 * - **H5.** The right end holds quick actions, projected as `[pageHeaderActions]`.
 *   An action that is not ready is absent, and its absence changes nothing here.
 *   Before them, on every page, the header draws one quiet mark while the realtime
 *   socket has been down for more than two seconds (plan 0168). It reads
 *   `LiveConnection` from `platform`, which is the one store this component reads:
 *   the alternative was an input threaded through every page that draws a header.
 * - **H6.** The header never loads. `title` is required, so a page that waits for a
 *   name passes the word for the kind of page (Group, List) until it arrives.
 *
 * A consequence of H1 and H2 together: a header holds **only** a title and at most
 * that one subtitle line. A progress line, a logo, a count or a second subtitle is
 * page content and goes below it.
 *
 * ## Plain values in, one event out
 *
 * Rule N1: the product's name is a translation value, so `title` is a string the
 * page already translated and nothing here names the product. Rule D1: only a page
 * injects a store, so this emits `back` and the page decides where back goes, with
 * the fallback it names for `PageNavigation.back`.
 *
 * ## Outside the scroller
 *
 * It is `flex: none` and not `position: sticky`. A page places it before its
 * scrolling element, as home always did, so it never scrolls away.
 */
@Component({
  selector: 'lib-page-header',
  imports: [ChevronLeftIcon, CloseIcon, OfflineIcon, RokuTranslatorPipe],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  /** Already translated. The word for the kind of page while the name loads. */
  readonly title = input.required<string>();

  /**
   * Already translated. The one line under the title (H2, velista `0205`). `null`
   * draws no line and leaves the header exactly as it is without one. An empty string
   * draws an empty line of the same height, for a page that will have a subtitle and
   * does not know it yet, so the title does not move when the words arrive.
   */
  readonly subtitle = input<string | null>(null);

  /**
   * The accessible name of the back control, already translated. When it is set the
   * control draws and the icon slot does not (H4).
   */
  readonly backLabel = input<string | null>(null);

  /**
   * Which glyph the back control draws. `close` is the X, for a page that is left
   * rather than gone back from: the rewind and the first step of a recording.
   */
  readonly leading = input<'back' | 'close'>('back');

  readonly back = output<void>();

  /** Whether to draw the reconnecting mark. Two seconds late by design (plan 0168, D6). */
  protected readonly attention = inject(LiveConnection).attention;

  constructor() {
    // A native back press means what the chevron means, and the page already knows
    // its fallback (velista `0166`). Only while the chevron is drawn: an icon on the
    // left is a page with nowhere above it.
    handleBackWhile(
      () => this.backLabel() !== null,
      () => this.back.emit()
    );
  }
}
