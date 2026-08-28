import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * Who is here, as a dot, a stack of initials and a sentence.
 *
 * `ResumeListCard` drew this first and it is now on four more surfaces (plan 0022), so
 * it is one component: five copies of an avatar stack is five chances for the overlap,
 * the ring colour or the plural to drift, and the whole point of the treatment is that a
 * group card and a list header are recognisably saying the same kind of thing.
 *
 * ## It draws nothing for nobody
 *
 * Never "0 online", never a greyed out placeholder, and never a zero. Presence under
 * reports by design (plan 0004, section 6.7), so a zero is the one number it must not
 * assert, and the empty case is also what every surface shows before the first broadcast
 * arrives and the instant the socket drops.
 *
 * The rule lives **here** rather than in five parents, and it takes the host with it:
 * the host is the row, and it is `display: none` when there is nobody, so a card that
 * places this in a flex column with a gap pays neither the gap nor a stray separator.
 * That is also what lets a parent position it by class, the way every other child
 * component on these screens is placed.
 *
 * ## The reader is already gone by the time it gets here
 *
 * `names` is what the container resolved: the caller filtered out, ids that would not
 * resolve dropped. This component renders a list of names and knows nothing about
 * presence, which is what lets it be tested with an array.
 *
 * ## Advisory, and only advisory
 *
 * Nothing here gates anything. There is no lock, no disabled control and no "are you
 * sure" anywhere in its callers, by rule (plan 0022, section 3).
 */
@Component({
  selector: 'lib-presence-row',
  imports: [RokuTranslatorPipe],
  template: `
    @if (names().length > 0) {
      <span aria-hidden="true" class="avatars">
        @for (initial of initials(); track $index) {
          <span class="avatar">{{ initial }}</span>
        }
      </span>

      <!--
        Presence changes with nobody touching the screen, so it is announced politely
        rather than silently swapped (plan 0003, section 7).

        **Not** a live region in compact mode, where this sits inside a row that is
        itself one tap target: a region that rewrites itself inside a control keeps
        rewriting that control's accessible name while somebody is reading it. The
        screen a compact row sits on carries the announced sentence instead.

        The sentence stays either way, off screen when compact, because "two avatars" is
        not a fact a screen reader can read off two letters.
      -->
      <span [attr.aria-live]="compact() ? null : 'polite'" class="text">
        <span aria-hidden="true" class="dot"></span>
        <span [class.off-screen]="compact()">{{
          key() | rokuT: { names: sentence(), count: names().length }
        }}</span>
      </span>
    }
  `,
  styleUrl: './presence-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.empty]': 'names().length === 0',
    '[class.compact]': 'compact()',
  },
})
export class PresenceRow {
  /** The people, already named and already without the reader. Empty draws nothing. */
  readonly names = input.required<readonly string[]>();

  /** The sentence naming them, interpolating `{{names}}`. */
  readonly messageKey = input.required<string>();

  /**
   * The sentence counting them, interpolating `{{count}}`, for a crowd.
   *
   * Empty means never collapse, which is the resume card's behaviour and stays it.
   */
  readonly countKey = input('');

  /**
   * The dot and the initials, with the sentence off screen (plan 0022, section 3.3).
   *
   * What a list row gets: a row has no space for a sentence, and the screen it sits on
   * already carries one.
   */
  readonly compact = input(false);

  /**
   * The count at which the names give way to a number.
   *
   * Four, because three names is a readable sentence and four is a queue. Below it the
   * names are always used, whatever `countKey` says.
   */
  private static readonly CROWD = 4;

  /** The first two initials, for the stack. The rest are in the sentence. */
  readonly initials = computed(() =>
    this.names()
      .slice(0, 2)
      .map((name) => (Array.from(name.trim())[0] ?? '').toLocaleUpperCase())
  );

  /**
   * "Ana, Marc", ready to drop into a sentence.
   *
   * Joined here rather than in a template, and never assembled from a translated "and":
   * Spanish does not join a list the way English does, so the separator belongs to the
   * locale's own sentence rather than to this component.
   */
  readonly sentence = computed(() => this.names().join(', '));

  /**
   * Which key to render, resolved once so the template does not branch twice.
   *
   * A compact row always counts when it can. Its sentence is off screen and is read as
   * part of the accessible name of the control it sits in, where "2 shopping now" is
   * three useful words and a list of names is a paragraph.
   */
  readonly key = computed(() => {
    const crowd = this.countKey();
    if (crowd === '') {
      return this.messageKey();
    }

    return this.compact() || this.names().length >= PresenceRow.CROWD
      ? crowd
      : this.messageKey();
  });
}
