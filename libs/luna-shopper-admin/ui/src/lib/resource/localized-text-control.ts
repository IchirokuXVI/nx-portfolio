import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * One input per locale (plan 0004, section 2).
 *
 * In the generic form from the first day rather than added when the first
 * Spanish name is needed, because this is the single most annoying thing to
 * retrofit: every name and label on supermarkets, items, locations and price
 * scopes is a `jsonb` column with one string per language, and a form that
 * edited only one of them would have to be rewritten in fifteen places.
 *
 * The locale is shown beside its box and is not translated. `en` and `es` are
 * the language tags the column is keyed by, so an operator setting the Spanish
 * name needs to see which key they are writing, not the word for it in their
 * own interface language.
 */
@Component({
  selector: 'lib-localized-text-control',
  template: `
    @for (locale of locales(); track locale) {
      <!-- The label points at its control by id rather than wrapping it. A
           wrapping label whose control is inside an @if is associated with
           nothing a linter, or a screen reader, can see. -->
      <div class="row">
        <label [for]="controlId() + '-' + locale" class="locale">{{
          locale
        }}</label>
        @if (list()) {
          <!-- One entry per line. A line break is the one separator a synonym
               cannot contain, so nothing has to guess where an entry ends. -->
          <textarea
            (input)="onInput(locale, $event)"
            [disabled]="disabled()"
            [id]="controlId() + '-' + locale"
            [value]="valueFor(locale)"
            rows="4"
          ></textarea>
        } @else {
          <input
            (input)="onInput(locale, $event)"
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
      min-inline-size: 2rem;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    input,
    textarea {
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      flex: 1;
      font: inherit;
      font-size: 1rem;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: var(--admin-ink);
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
  readonly disabled = input(false);
  readonly maxLength = input<number | undefined>(undefined);
  /** Whether each locale holds a list of entries, one per line. */
  readonly list = input(false);

  readonly valueChange = output<Readonly<Record<string, string>>>();

  valueFor(locale: string): string {
    return this.value()[locale] ?? '';
  }

  onInput(locale: string, event: Event): void {
    const text = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    // Every locale is emitted, not only the one that changed. The value is one
    // column, and a partial object would erase the other language on submit.
    this.valueChange.emit({ ...this.value(), [locale]: text });
  }
}
