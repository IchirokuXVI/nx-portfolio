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
import { AudioPlayer } from './audio-player';

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
  imports: [RokuTranslatorPipe, AudioPlayer],
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

      @if (comment().pending) {
        <!--
          A voice send takes seconds, so this stands in the caller's own position
          until the real comment lands (plan 0039, section 5). It never shows a
          guess at the words: the client has nothing to guess from, and a bubble
          with invented text is worse than one that says it is waiting.
        -->
        <p class="body waiting">{{ 'list.comments.sending' | rokuT }}</p>
      } @else if (comment().body !== '') {
        <p class="body">{{ comment().body }}</p>
      } @else {
        <!--
          A recording nobody could transcribe is still a message somebody left, so
          the row says which of the two happened rather than drawing an empty
          bubble (plan 0039, section 3).
        -->
        <p class="body waiting">{{ bodyPlaceholder() | rokuT }}</p>
      }

      <!--
        Where the words came from (plan 0041, section 9.2).

        Plan 0039 made the transcript **be** the comment, in the same bubble, in
        the same type, under the same person's name. Read cold, a transcription
        error is then indistinguishable from somebody in the group having written
        something odd, and it is attributed to them. That plan's answer was that
        the audio is the record and the transcript is the reading of it, which
        only works if the reader knows which of the two they are looking at.

        Not a warning: no icon, no colour, no alert. A fact about where the
        sentence came from, and it reads as one.
      -->
      @if (autoTranscribed()) {
        <p class="source">{{ 'list.comments.autoTranscript' | rokuT }}</p>
      }

      @if (recording(); as audio) {
        <lib-audio-player
          [durationSeconds]="audio.durationSeconds"
          [load]="loaderFor(audio.src)"
        />
      }
    </article>
  `,
  styleUrl: './comment-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentRow {
  readonly comment = input.required<CommentRowVm>();

  /**
   * How the recording is fetched, supplied by whoever draws this row.
   *
   * The row does not know what a URL is for or who is allowed to fetch one; it
   * hands the player a function and the player calls it when play is pressed
   * (rule D1). Absent means a row that never draws a player, which is what a
   * comment with no recording gets anyway.
   */
  readonly loadAudio = input<((src: string) => Promise<string>) | null>(null);

  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The recording to draw a player for, if there is one and it can be fetched.
   *
   * A pending bubble draws no player: there is nothing on the server to fetch
   * yet, and offering a play button for it would be a control that cannot work.
   */
  readonly recording = computed(() => {
    const row = this.comment();
    return row.pending || this.loadAudio() === null ? null : row.recording;
  });

  /**
   * Whether to say the words were written by a machine.
   *
   * `transcription` is null exactly when the comment was typed, which is what
   * `CommentRowVm` documents, so no new field and no inferring it from the
   * presence of a recording.
   *
   * Not drawn on a pending bubble, which has no words yet, and not on either
   * neutral phrase: saying a machine wrote the sentence that says no machine
   * could write it would be nonsense.
   */
  readonly autoTranscribed = computed(() => {
    const row = this.comment();
    return !row.pending && row.body !== '' && row.transcription !== null;
  });

  /**
   * Which neutral phrase stands in for an empty body.
   *
   * The two states look identical on screen for about three seconds and
   * completely different after a minute, which is the whole reason the server
   * sends a transcription state rather than letting the client infer one from an
   * empty body (backend plan 0045, section 4.2).
   */
  readonly bodyPlaceholder = computed(() =>
    this.comment().transcription === 'PENDING'
      ? 'list.comments.transcribing'
      : 'list.comments.noTranscript'
  );

  /**
   * A zero argument loader for one source, which is what the player's input is.
   *
   * Built here rather than in the template so the identity is stable per source:
   * a new function every change detection would be a new input value every cycle.
   */
  loaderFor(src: string): () => Promise<string> {
    const cached = this._loaders.get(src);
    if (cached !== undefined) {
      return cached;
    }

    const loader = () => {
      const load = this.loadAudio();
      return load === null
        ? Promise.reject(new Error('no loader supplied'))
        : load(src);
    };
    this._loaders.set(src, loader);
    return loader;
  }

  private readonly _loaders = new Map<string, () => Promise<string>>();

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
