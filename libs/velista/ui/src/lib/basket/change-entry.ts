import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * One change, as two lines of the changes sheet (velista `0093`, section 6).
 *
 * Every field is already resolved by the sheet: the sentence is a key and its
 * arguments, the actor is a rendered name, and the time is a rendered string.
 * Rule D1 keeps this component taking plain values and injecting nothing, and
 * the date is the sharpest case: `Intl` needs the reader's locale, which lives
 * in a store a `ui` component may not reach for.
 */
export interface ChangeEntryView {
  readonly id: string;
  /** The first line, from `basketChangeSentence`. */
  readonly key: string;
  readonly args: Record<string, string | number>;
  /** Who, already named, or the empty string when nobody may be named. */
  readonly who: string;
  /** Which list, already named, or the empty string when the reader has no ref. */
  readonly list: string;
  /** When, already formatted through `Intl` in the reader's locale. */
  readonly when: string;
  /** The server's flag. Draws the same tag a marked row wears. */
  readonly unseen: boolean;
}

/**
 * One entry of the changes sheet.
 *
 * ## It is not a button and it opens nothing
 *
 * A change is a fact, and the row it is about is one dismiss away. A control
 * here would be a second way to reach a row, on a sheet somebody opened to read
 * rather than to act, and the row it pointed at may not exist any more.
 *
 * ## The second line is present only where there is something to say
 *
 * A guest is served no list and often no actor, so their entries are one line
 * and a sentence. Nothing draws a placeholder: an empty muted line under every
 * entry is a sheet that looks broken to the reader it is redacted for.
 */
@Component({
  selector: 'lib-change-entry',
  imports: [RokuTranslatorPipe],
  template: `
    <p class="what">
      {{ entry().key | rokuT: entry().args }}
      @if (entry().unseen) {
        <!--
          The same tag a marked row wears, so the two halves of this feature
          read as one thing. A dot and a word, in the accent role: the word is
          what survives a monochrome screen (velista 0052, section 6.3).
        -->
        <span class="tag">
          <span aria-hidden="true" class="tag-dot"></span>
          {{ 'basket.mark.added' | rokuT }}
        </span>
      }
    </p>

    @if (meta(); as said) {
      <p class="meta">{{ said }}</p>
    }
  `,
  styleUrl: './change-entry.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeEntry {
  readonly entry = input.required<ChangeEntryView>();

  /**
   * Who, which list and when, joined, with the absent parts simply gone.
   *
   * Joined here rather than by three spans in the template, because the
   * separator belongs between two present pieces and a template cannot say that
   * without a branch per gap.
   */
  protected meta(): string {
    const entry = this.entry();
    return [entry.who, entry.list, entry.when]
      .filter((part) => part !== '')
      .join(' · ');
  }
}
