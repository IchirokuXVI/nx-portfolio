import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BrandWordmark } from '../brand/brand-wordmark';
import { ChevronDownIcon, CommentIcon, OfflineIcon } from '../icons/icons';

/**
 * The app's header.
 *
 * Two variants, chosen by `signedIn` rather than by the caller picking a component:
 * anonymous shows the locale switch, because someone who has not signed in may well
 * be on the wrong language and has nothing else to do up here; signed in shows the
 * assistant and the account button.
 *
 * ## The second slot was search, and search never existed
 *
 * It called `_notYetRouted('search')` from the day it was drawn (plan 0003) and there
 * was never a search page, a search service or a search route behind it. So spending
 * the slot on the assistant removes no feature (plan 0032, section 1): same 44 by 44
 * target, same position, and `SearchIcon` stays exported so putting search back later
 * is one line here.
 *
 * Rule D1: no service, no data. The initial and the locale label arrive as inputs and
 * every action leaves as an output. The **menu**, though, is this component's own:
 * open and closed is presentation state and nothing else, so owning it here costs no
 * injection and saves every caller from re-implementing dismissal (plan 0007,
 * section 6.2).
 */
@Component({
  selector: 'lib-app-bar',
  imports: [
    RokuTranslatorPipe,
    RouterLink,
    BrandWordmark,
    CommentIcon,
    ChevronDownIcon,
    OfflineIcon,
  ],
  templateUrl: './app-bar.html',
  styleUrl: './app-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Dismissal, the shape `LanguageSelector` in `libs/damoclesSword/ui` already uses:
    // a document listener that closes when the click landed outside this host. A menu
    // that only closes by picking something is a menu people get stuck in.
    '(document:click)': 'closeOnOutsideClick($event.target)',
    '(document:keydown.escape)': 'closeOnEscape()',
  },
})
export class AppBar {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly _trigger =
    viewChild<ElementRef<HTMLButtonElement>>('localeTrigger');

  readonly signedIn = input(false);

  /**
   * Where the lockup leads, or null to leave it as plain text.
   *
   * Rule D1 again: this component may not build the URL, because the locale and the
   * mount are both things it would have to reach for, and the mount is `/velista`
   * today and `''` after extraction. So the page passes an absolute URL built with
   * `appPath`, the same one its own back controls already use.
   *
   * Null on the front door and on the dashboard, the two screens where the lockup
   * would point at the page being looked at.
   */
  readonly homeUrl = input<string | null>(null);

  /**
   * The letter in the account button.
   *
   * The container derives it from `SessionStore.username`, which is the caller's global
   * name: it rides on the token pair since backend plan 0018, and `ProfileStore`
   * overrides it after a rename (rule A2, plan 0015). So there is no request behind
   * this and no loading state for it either.
   *
   * This comment used to say the API exposed no profile and the only readable name was
   * per zone. That was true when it was written and has not been since; a stale comment
   * is read as a constraint, which is why `0010` rule G2 asks for it to be corrected
   * rather than left (plan 0015, section 4.4).
   *
   * Null still falls back to a neutral glyph rather than inventing an initial, which is
   * the right rendering for a name that is genuinely empty.
   */
  readonly accountInitial = input<string | null>(null);

  /** The active locale, upper cased for display, for example `EN`. */
  readonly locale = input('EN');

  /**
   * The locales the menu offers, as codes.
   *
   * An empty list renders the label with no chevron and no menu, which is the right
   * degenerate case for an app that ever ships with one language enabled: a disclosure
   * that discloses nothing is a control that lies, which is the defect this whole
   * menu exists to fix.
   */
  readonly locales = input<readonly string[]>([]);

  /** Whether the header sits on a divider. False on the anonymous screen, which is airy. */
  readonly bordered = input(true);

  /**
   * Whether the live connection is up. False draws the offline mark (plan 0035,
   * section 5.3).
   *
   * Before it, a dead socket had exactly one symptom in the whole app: one grey line on
   * a list page. Every other screen, the dashboard and a group page included, looked
   * identical live and stale. The mark is not a button, deliberately: a control here
   * would have to lead somewhere and there is nowhere to go.
   *
   * **Not the blocking screen's business.** `ConnectionState.offline` covers the page
   * with `ConnectionLost` and this header is behind it. This is for the case where HTTP
   * works and the socket does not, which is precisely the one with no symptom today.
   *
   * Rule D1: an input, like `signedIn` and `accountInitial`. This component knows
   * nothing about `RealtimeClient` and the pages that draw it pass this in.
   *
   * True by default, so a screen that has no socket to speak of draws nothing.
   */
  readonly connected = input(true);

  readonly openAssistant = output<void>();
  readonly account = output<void>();

  /**
   * The locale that was picked, as a code.
   *
   * It **replaces** the old `changeLocale` output, which carried nothing beyond
   * "somebody pressed a button" and left the page with no idea what to do about it.
   * The page no longer needs to be told about the press at all: it needs to be told
   * which language to switch to.
   */
  readonly localeChange = output<string>();

  /**
   * Whether the menu is showing. Internal presentation state, so it is neither an
   * input nor an output; `protected` rather than `private` only because Angular's
   * template type checker cannot reach a private member.
   */
  protected readonly menuOpen = signal(false);

  /** Whether there is anything to disclose. Drives the chevron and the ARIA. */
  protected readonly hasMenu = computed(() => this.locales().length > 0);

  protected toggleMenu(): void {
    if (!this.hasMenu()) {
      return;
    }

    this.menuOpen.update((open) => !open);
  }

  /** Marks the entry the page is already on, so it is not signalled by colour alone. */
  protected isCurrent(locale: string): boolean {
    return locale.toLocaleUpperCase() === this.locale().toLocaleUpperCase();
  }

  protected pick(locale: string): void {
    this.menuOpen.set(false);
    this.localeChange.emit(locale);
  }

  protected closeOnOutsideClick(target: EventTarget | null): void {
    if (!this.menuOpen()) {
      return;
    }

    const host = this._host.nativeElement;
    if (target === null || !host.contains(target as Node)) {
      this.menuOpen.set(false);
    }
  }

  protected closeOnEscape(): void {
    if (!this.menuOpen()) {
      return;
    }

    this.menuOpen.set(false);
    // Escape dismisses without choosing, so focus goes back where it came from
    // rather than to the top of the document.
    this._trigger()?.nativeElement.focus();
  }
}
