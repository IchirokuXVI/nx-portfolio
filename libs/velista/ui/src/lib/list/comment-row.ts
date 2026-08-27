import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type { CommentRowVm } from '@portfolio/velista/models';

/**
 * One thing somebody said about a line.
 *
 * ## The author may have no name
 *
 * `CommentView` carries `authorUserId` and no username, and the only place in the API
 * that pairs an id with a name is a membership. So a comment from somebody who has
 * since left the group cannot be named at all, and this row falls back to a neutral
 * phrase, "Someone in the group", rather than to the id and **never** to the word
 * Unknown, which reads like an error rather than like a person who left (section 5.4).
 *
 * ## The timestamp is the only one in the product
 *
 * `CommentView` is the one view the API gives a `createdAt`, which is why comments can
 * be ordered in time and nothing else on this screen can.
 */
@Component({
  selector: 'lib-comment-row',
  imports: [RokuTranslatorPipe],
  template: `
    <article [class.mine]="comment().mine" class="comment">
      <header class="head">
        <span class="author">
          @if (comment().author !== null) {
            {{ comment().author }}
          } @else {
            {{ 'list.comments.someone' | rokuT }}
          }
        </span>

        <time [attr.datetime]="comment().createdAt.toISOString()" class="when">
          {{ when() }}
        </time>
      </header>

      <p class="body">{{ comment().body }}</p>
    </article>
  `,
  styleUrl: './comment-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentRow {
  readonly comment = input.required<CommentRowVm>();

  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The timestamp, in the reader's language.
   *
   * `Intl` rather than Angular's `DatePipe`, which needs `registerLocaleData` per
   * locale and a `LOCALE_ID` this app does not set: the language is this app's own
   * runtime state, not the shell's build time locale. `Intl` reads the tag it is
   * handed, which is exactly the tag `RokuLocaleStore` is holding.
   *
   * The machine readable value is on the `datetime` attribute regardless, so an
   * environment with no `Intl` data still gives the real instant to anything that
   * wants to parse it.
   */
  readonly when = computed(() => {
    const at = this.comment().createdAt;

    try {
      return new Intl.DateTimeFormat(this._locale(), {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(at);
    } catch {
      // An unrecognised tag, which `Intl` throws a `RangeError` for. The ISO string is
      // ugly and correct, and a comment with no timestamp at all would be worse.
      return at.toISOString();
    }
  });
}
