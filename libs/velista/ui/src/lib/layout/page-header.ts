import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ChevronLeftIcon, CloseIcon } from '../icons/icons';

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
 *   `--app-header-title-size`. It is the page's `h1`.
 * - **H3.** Always a bottom border. No input turns it off.
 * - **H4.** The left end holds a back button or an icon, never neither and never
 *   both. `backLabel` decides: set, the chevron draws; not set, the projected
 *   `[pageHeaderIcon]` does.
 * - **H5.** The right end holds quick actions, projected as `[pageHeaderActions]`.
 *   An action that is not ready is absent, and its absence changes nothing here.
 * - **H6.** The header never loads. `title` is required, so a page that waits for a
 *   name passes the word for the kind of page (Group, List) until it arrives.
 *
 * A consequence of H1 and H2 together: a header holds **only** a title. A subtitle,
 * a progress line, a logo or a count is page content and goes below it.
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
  imports: [ChevronLeftIcon, CloseIcon],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  /** Already translated. The word for the kind of page while the name loads. */
  readonly title = input.required<string>();

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
}
