import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * One input per locale (plan 0004, section 2).
 *
 * In the generic form from the first day rather than added when the first
 * Spanish name is needed, because this is the single most annoying thing to
 * retrofit: every name and label on supermarkets, items, locations and price
 * scopes is a `jsonb` column with one string per language, and a form that
 * edited only one of them would have to be rewritten in fifteen places.
 *
 * The tag before each box is the code of the language, in capitals, and is
 * not translated. `en` and `es` are the language tags the column is keyed by,
 * so an operator setting the Spanish name sees which key they are writing.
 *
 * **The tag is for the eye and the name of the box is in words** (admin plan
 * 0052, section 3.7). A screen reader that read "E S" before a box would say
 * nothing about what the box holds, so each box is named "Name in Spanish":
 * the label of the field, then the language.
 */
@Component({
  selector: 'lib-localized-text-control',
  imports: [RokuTranslatorPipe],
  template: `
    @for (locale of locales(); track locale; let first = $first) {
      <div class="row">
        <span aria-hidden="true" class="locale">{{ locale }}</span>
        @if (list()) {
          <!-- One entry per line. A line break is the one separator a synonym
               cannot contain, so nothing has to guess where an entry ends. -->
          <textarea
            (input)="onInput(locale, $event)"
            [attr.aria-describedby]="first ? describedBy() : null"
            [attr.aria-invalid]="first && invalid() ? 'true' : null"
            [attr.aria-label]="
              'record.localized.in'
                | rokuT
                  : {
                      label: label(),
                      language: ('record.language.' + locale | rokuT),
                    }
            "
            [disabled]="disabled()"
            [id]="controlId() + '-' + locale"
            [value]="valueFor(locale)"
            rows="4"
          ></textarea>
        } @else {
          <input
            (input)="onInput(locale, $event)"
            [attr.aria-describedby]="first ? describedBy() : null"
            [attr.aria-invalid]="first && invalid() ? 'true' : null"
            [attr.aria-label]="
              'record.localized.in'
                | rokuT
                  : {
                      label: label(),
                      language: ('record.language.' + locale | rokuT),
                    }
            "
            [attr.maxlength]="maxLength() ?? null"
            [disabled]="disabled()"
            [id]="controlId() + '-' + locale"
            [value]="valueFor(locale)"
            type="text"
          />
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .row {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .locale {
      flex: none;
      inline-size: 1.5rem;
      font-family: var(--admin-font-mono);
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    /* What a control looks like is the global rule's (styles.scss). Here a
       box only takes the rest of its row. */
    input,
    textarea {
      flex: 1;
      min-inline-size: 0;
    }

    textarea {
      resize: vertical;
    }

    input:focus-visible,
    textarea:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocalizedTextControl {
  readonly controlId = input.required<string>();
  readonly locales = input.required<readonly string[]>();
  readonly value = input.required<Readonly<Record<string, string>>>();
  /**
   * The label of the field, already translated. It is the first word of the
   * name of each box: "Name in Spanish".
   */
  readonly label = input('');
  /**
   * Whether the value was refused. The box of the first language carries it,
   * with {@link describedBy}: a refusal is about the field, and one box has
   * to be the place the sentence is tied to.
   */
  readonly invalid = input(false);
  /** The ids of the lines that describe the field. */
  readonly describedBy = input<string | null>(null);
  readonly disabled = input(false);
  readonly maxLength = input<number | undefined>(undefined);
  /** Whether each locale holds a list of entries, one per line. */
  readonly list = input(false);

  readonly valueChange = output<Readonly<Record<string, string>>>();

  /**
   * What was last emitted, and the input it was built on.
   *
   * The input is what the owner last drew, and it is one change detection
   * behind an emit. Two boxes changed in one frame would each spread the
   * same old input, and the second would undo the first. So a change is
   * spread over what was last emitted, for as long as the input is still the
   * one it was built on. A new input is the owner's word, and wins.
   */
  private _sent: {
    readonly over: Readonly<Record<string, string>>;
    readonly value: Readonly<Record<string, string>>;
  } | null = null;

  valueFor(locale: string): string {
    return this.value()[locale] ?? '';
  }

  onInput(locale: string, event: Event): void {
    const text = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    // Every locale is emitted, not only the one that changed. The value is one
    // column, and a partial object would erase the other language on submit.
    const given = this.value();
    const held = this._sent?.over === given ? this._sent.value : given;
    const value = { ...held, [locale]: text };
    this._sent = { over: given, value };
    this.valueChange.emit(value);
  }
}
