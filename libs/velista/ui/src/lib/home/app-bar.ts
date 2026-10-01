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
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BrandWordmark } from '../brand/brand-wordmark';
import { ChevronDownIcon } from '../icons/icons';

/**
 * The front door's bar: the lockup, and the locale switch.
 *
 * It shows the locale switch because someone who has not signed in may well be on the
 * wrong language and has nothing else to do up here.
 *
 * ## It was the app's header, and had a signed in half
 *
 * `signedIn` used to choose between this and a second variant with the assistant, the
 * account button and the offline mark, which every signed in page drew above its own
 * back row. Velista `0130` gave those pages one `PageHeader` and moved the three
 * actions into home's, so that half is gone and with it every input and output only it
 * read. The landing page is signed out and outside that plan, and it is the one caller
 * left; `one-page-header.spec.ts` fails when another page draws this.
 *
 * Rule D1: no service, no data. The locale label arrives as an input and the pick
 * leaves as an output. The **menu**, though, is this component's own: open and closed
 * is presentation state and nothing else, so owning it here costs no injection and
 * saves every caller from re-implementing dismissal (plan 0007, section 6.2).
 */
@Component({
  selector: 'lib-app-bar',
  imports: [RokuTranslatorPipe, BrandWordmark, ChevronDownIcon],
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
