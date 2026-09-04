import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  DraftValue,
  FieldDescriptor,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { LocalizedTextControl } from './localized-text-control';
import type { ReferenceLookup } from './reference-lookup';
import { ReferencePicker } from './reference-picker';

/**
 * One field, as the control that edits it.
 *
 * The switch is here and nowhere else, so a new field kind is one case in one
 * file rather than a change to every form. Nothing in it decides what a value
 * means: it emits what the operator did and the store decides.
 *
 * Money and numbers are `type="text"` on purpose. `type="number"` reports an
 * unreadable entry as the empty string, so a mistyped price would arrive here
 * as a cleared field rather than as something to complain about, and on several
 * browsers a scroll wheel over a focused number input silently changes it.
 */
@Component({
  selector: 'lib-field-control',
  imports: [RokuTranslatorPipe, LocalizedTextControl, ReferencePicker],
  template: `
    @switch (field().kind) {
      @case ('localized-text') {
        <lib-localized-text-control
          (valueChange)="valueChange.emit($event)"
          [controlId]="controlId()"
          [disabled]="disabled()"
          [list]="isList()"
          [locales]="localesOf()"
          [maxLength]="maxLengthOf()"
          [value]="asRecord()"
        />
      }

      @case ('boolean') {
        @if (field().nullable === true) {
          <!-- Three answers, because the column has three. A per shop
               availability override is yes, no, or "nobody has checked this
               shop, use what the scope says", and the third is the ordinary
               one. A checkbox can only say two of those, so it would submit
               "not available here" for every row an operator merely opened. -->
          <select
            (change)="onTriState($event)"
            [disabled]="disabled()"
            [id]="controlId()"
            [value]="triState()"
          >
            <option value="">{{ 'resource.field.unset' | rokuT }}</option>
            <option value="true">{{ 'resource.value.yes' | rokuT }}</option>
            <option value="false">{{ 'resource.value.no' | rokuT }}</option>
          </select>
        } @else {
          <input
            (change)="onCheckbox($event)"
            [checked]="value() === true"
            [disabled]="disabled()"
            [id]="controlId()"
            type="checkbox"
          />
        }
      }

      @case ('enum') {
        <select
          (change)="onInput($event)"
          [disabled]="disabled()"
          [id]="controlId()"
          [value]="asText()"
        >
          <option value="">{{ 'resource.field.choose' | rokuT }}</option>
          @for (option of optionsOf(); track option.value) {
            <option [value]="option.value">{{ option.label | rokuT }}</option>
          }
        </select>
      }

      @case ('reference') {
        <lib-reference-picker
          (valueChange)="valueChange.emit($event)"
          [controlId]="controlId()"
          [disabled]="disabled()"
          [lookup]="lookup()"
          [nullable]="field().nullable === true"
          [resource]="resourceOf()"
          [value]="asText()"
        />
      }

      @case ('date') {
        <input
          (input)="onInput($event)"
          [disabled]="disabled()"
          [id]="controlId()"
          [type]="dateType()"
          [value]="asText()"
        />
      }

      @default {
        @if (multiline()) {
          <textarea
            (input)="onInput($event)"
            [attr.maxlength]="maxLengthOf() ?? null"
            [disabled]="disabled()"
            [id]="controlId()"
            [value]="asText()"
            rows="4"
          ></textarea>
        } @else {
          <input
            (input)="onInput($event)"
            [attr.inputmode]="inputMode()"
            [attr.maxlength]="maxLengthOf() ?? null"
            [disabled]="disabled()"
            [id]="controlId()"
            [value]="asText()"
            type="text"
          />
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }

    input[type='text'],
    input[type='date'],
    input[type='datetime-local'],
    select,
    textarea {
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      inline-size: 100%;
      font: inherit;
      font-size: 1rem;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: var(--admin-ink);
    }

    input[type='checkbox'] {
      inline-size: 1.25rem;
      block-size: 1.25rem;
    }

    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    :disabled {
      opacity: 0.55;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldControl {
  readonly field = input.required<FieldDescriptor<ResourceRow>>();
  readonly value = input.required<DraftValue>();
  readonly controlId = input.required<string>();
  readonly disabled = input(false);
  /** Only reference fields use it, and only they require one to be supplied. */
  readonly lookup = input<ReferenceLookup>(NO_LOOKUP);

  readonly valueChange = output<DraftValue>();

  asText(): string {
    const value = this.value();
    return typeof value === 'string' ? value : '';
  }

  asRecord(): Readonly<Record<string, string>> {
    const value = this.value();
    return typeof value === 'object' && value !== null ? value : {};
  }

  localesOf(): readonly string[] {
    const field = this.field();
    return field.kind === 'localized-text' ? field.locales : [];
  }

  /** Whether each locale holds a list of entries rather than one string. */
  isList(): boolean {
    const field = this.field();
    return field.kind === 'localized-text' && field.list === true;
  }

  optionsOf() {
    const field = this.field();
    return field.kind === 'enum' ? field.options : [];
  }

  resourceOf(): string {
    const field = this.field();
    return field.kind === 'reference' ? field.resource : '';
  }

  maxLengthOf(): number | undefined {
    const field = this.field();
    return field.kind === 'text' || field.kind === 'localized-text'
      ? field.maxLength
      : undefined;
  }

  multiline(): boolean {
    const field = this.field();
    return field.kind === 'text' && field.multiline === true;
  }

  dateType(): string {
    const field = this.field();
    return field.kind === 'date' && field.time === true
      ? 'datetime-local'
      : 'date';
  }

  /**
   * Which keyboard a phone offers.
   *
   * `decimal` for money and numbers, which is the numeric keypad **with** a
   * separator key. `numeric` has no way to type a price.
   */
  inputMode(): string | null {
    const kind = this.field().kind;
    return kind === 'money' || kind === 'number' ? 'decimal' : null;
  }

  onInput(event: Event): void {
    const target = event.target as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement;
    this.valueChange.emit(target.value);
  }

  onCheckbox(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).checked);
  }

  /** Which of the three answers a nullable boolean is showing. */
  triState(): string {
    const value = this.value();
    return typeof value === 'boolean' ? String(value) : '';
  }

  /**
   * One of three answers, emitted as what it means rather than as its label.
   *
   * The empty option is `null` and not `''`, because null is the column's own
   * answer: it defers to the scope. An empty string would be a fourth thing the
   * store would then have to interpret.
   */
  onTriState(event: Event): void {
    const chosen = (event.target as HTMLSelectElement).value;
    this.valueChange.emit(chosen === '' ? null : chosen === 'true');
  }
}

/**
 * What a reference picker gets when nobody supplied a lookup.
 *
 * It finds nothing, rather than throwing. A descriptor with a reference field
 * and a page that forgot to pass a lookup is a mistake, and the picker saying
 * "no results" while the rest of the form works is a better way to find it than
 * a blank screen.
 */
const NO_LOOKUP: ReferenceLookup = {
  search: async () => [],
  resolve: async () => null,
};
