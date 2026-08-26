import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BrandMark } from '../brand/brand-mark';
import { BrandWordmark } from '../brand/brand-wordmark';
import { ChevronDownIcon, SearchIcon } from '../icons/icons';

/**
 * The app's header.
 *
 * Two variants, chosen by `signedIn` rather than by the caller picking a component:
 * anonymous shows the locale switch, because someone who has not signed in may well
 * be on the wrong language and has nothing else to do up here; signed in shows search
 * and the account button.
 *
 * Rule D1: no service, no data. The initial and the locale label arrive as inputs and
 * every action leaves as an output.
 */
@Component({
  selector: 'lib-app-bar',
  imports: [
    RokuTranslatorPipe,
    BrandMark,
    BrandWordmark,
    SearchIcon,
    ChevronDownIcon,
  ],
  templateUrl: './app-bar.html',
  styleUrl: './app-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppBar {
  readonly signedIn = input(false);

  /**
   * The letter in the account button.
   *
   * There is no display name to derive one from: the API exposes no profile, and the
   * only human readable name anywhere is per zone (plan 0004, section 11 item 2). The
   * container passes what it can and this falls back to a neutral glyph rather than
   * inventing an initial.
   */
  readonly accountInitial = input<string | null>(null);

  /** The active locale, upper cased for display, for example `EN`. */
  readonly locale = input('EN');

  /** Whether the header sits on a divider. False on the anonymous screen, which is airy. */
  readonly bordered = input(true);

  readonly openSearch = output<void>();
  readonly account = output<void>();
  readonly changeLocale = output<void>();
}
