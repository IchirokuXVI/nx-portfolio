import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type { ListViewerVm } from '@portfolio/velista/models';
import { ChevronRightIcon } from '../icons/icons';
import { RoleChip } from '../zone/role-chip';

/**
 * Who else has this list open, as a sentence that can be opened.
 *
 * `PresenceRow` draws the advisory version of this on five surfaces and keeps doing so.
 * This is the list page's own, and it is a separate component rather than a fifth mode
 * of that one because it answers a different question. A card says *somebody is here*
 * and is read in passing; this sits at the top of the screen somebody stands in a shop
 * looking at, so it names who, says what they are, and says since when.
 *
 * ## Two names, then a number
 *
 * One person is named. Two are both named. Three or more name the first and count the
 * rest, and **the avatars say the same thing as the words**: two people are two
 * initials, more than two is one initial and a `+n`, where `n` is exactly the number
 * the sentence says is not named. A stack that showed three faces over a sentence
 * mentioning one would be two different answers to one question.
 *
 * There is no "and 1 more": at three people the count is 2, so the collapsed form is
 * never used for a single unnamed person.
 *
 * ## It draws nothing for nobody
 *
 * `PresenceRow`'s rule, and for `PresenceRow`'s reason: presence under reports by
 * design (plan 0004, section 6.7), so a zero is the one number it must not assert, and
 * an empty presence set is also what every surface shows before the first broadcast
 * arrives and the instant the socket drops. The host is the row and it is
 * `display: none` when there is nobody, so the header pays neither a gap nor a
 * separator for an absent one.
 *
 * ## Advisory, and only advisory
 *
 * Nothing here gates anything, and opening the panel changes nothing about the list.
 * It is a disclosure over a sentence, not a control (plan 0022, section 3).
 */
@Component({
  selector: 'lib-list-viewers',
  imports: [RokuTranslatorPipe, ChevronRightIcon, RoleChip],
  templateUrl: './list-viewers.html',
  styleUrl: './list-viewers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.empty]': 'viewers().length === 0',
    '(keydown.escape)': 'close()',
    '(document:click)': 'closeOnOutsideClick($event.target)',
  },
})
export class ListViewers {
  /** The people, already named, already without the reader. Empty draws nothing. */
  readonly viewers = input.required<readonly ListViewerVm[]>();

  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');

  /** Whether the panel naming everybody is showing. Closed on arrival, every time. */
  readonly open = signal(false);

  /**
   * How many avatars are drawn before the count takes over.
   *
   * Two, which is the number the sentence names. Anything else would make the stack and
   * the words disagree about who is being talked about.
   */
  private static readonly SHOWN = 2;

  /**
   * The initials that are drawn, at most two, and one when there is a `+n` beside them.
   *
   * Code points rather than `charAt`, because slicing cuts a surrogate pair in half and
   * a name starting with an emoji would draw the replacement character.
   */
  readonly initials = computed(() => {
    const names = this.viewers().map((viewer) => viewer.name);
    const shown =
      names.length > ListViewers.SHOWN ? 1 : Math.min(names.length, 2);

    return names
      .slice(0, shown)
      .map((name) => (Array.from(name.trim())[0] ?? '').toLocaleUpperCase());
  });

  /**
   * How many people the stack cannot show, which is also how many the sentence counts.
   *
   * Zero at one and two people, where everybody is both drawn and named. It is deliberately
   * one number feeding both, so `+2` and "and 2 more" can never disagree.
   */
  readonly overflow = computed(() => {
    const total = this.viewers().length;
    return total > ListViewers.SHOWN ? total - 1 : 0;
  });

  /** The named one, or the first of the two named ones. */
  readonly first = computed(() => this.viewers()[0]?.name ?? '');

  /** The second named one. Only read on the branch where there are exactly two. */
  readonly second = computed(() => this.viewers()[1]?.name ?? '');

  /**
   * A time of day in the reader's language.
   *
   * `Intl` rather than Angular's `DatePipe`, for `CommentRow`'s reason: the pipe needs
   * `registerLocaleData` per locale and a `LOCALE_ID` this app does not set, because
   * the language is the app's own runtime state rather than the shell's build time
   * locale. The formatter is built once per locale rather than once per row.
   *
   * The time and not the date: a shopping trip is measured in minutes, and "28/08/2026,
   * 17:04" beside a name is a receipt rather than a fact somebody reads at a glance.
   */
  private readonly _clock = computed(() => {
    try {
      return new Intl.DateTimeFormat(this._locale(), { timeStyle: 'short' });
    } catch {
      // A locale tag `Intl` will not take. The machine readable instant is on the
      // `datetime` attribute regardless, so nothing is lost that a parser wanted.
      return null;
    }
  });

  /** One arrival time, formatted, or the ISO string if `Intl` refused the locale. */
  since(at: Date): string {
    return this._clock()?.format(at) ?? at.toISOString();
  }

  /** The letter in one person's bubble in the panel. */
  initialOf(name: string): string {
    return (Array.from(name.trim())[0] ?? '').toLocaleUpperCase();
  }

  toggle(): void {
    this.open.update((open) => !open);
  }

  /** Closes and hands focus back, which is what Escape and the trigger both want. */
  close(): void {
    if (!this.open()) {
      return;
    }

    this.open.set(false);
    this._trigger()?.nativeElement.focus();
  }

  /**
   * A click elsewhere closes the panel and leaves focus where it landed.
   *
   * Separate from `close`, which hands focus back to the trigger. `LineRow` and
   * `MemberRow` make the same distinction for the same reason: pulling focus back to a
   * control somebody has finished with makes the page feel like it is arguing.
   */
  protected closeOnOutsideClick(target: EventTarget | null): void {
    if (!this.open()) {
      return;
    }

    const host = this._host.nativeElement;
    if (target === null || !host.contains(target as Node)) {
      this.open.set(false);
    }
  }
}
