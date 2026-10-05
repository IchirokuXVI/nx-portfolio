import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  DraftValue,
  FieldDescriptor,
  FieldMessage,
  ReferenceScope,
  ResourceRow,
  ScopeMarkView,
} from '@portfolio/luna-shopper-admin/models';
import { Switch } from '../record/switch';
import { LocalizedTextControl } from './localized-text-control';
import type { ReferenceLookup } from './reference-lookup';
import { ReferencePicker, type ReferenceEmpty } from './reference-picker';
import { ReferencesControl } from './references-control';

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
 *
 * **A refusal is said by the row and carried by the control** (admin plan
 * 0052, section 3.3). `invalid` sets `aria-invalid`, which the global rule
 * draws as a red edge, and `describedBy` names the lines under the control
 * that say why.
 */
@Component({
  selector: 'lib-field-control',
  imports: [
    RokuTranslatorPipe,
    LocalizedTextControl,
    ReferencePicker,
    ReferencesControl,
    Switch,
  ],
  template: `
    @switch (field().kind) {
      @case ('localized-text') {
        <lib-localized-text-control
          (valueChange)="valueChange.emit($event)"
          [controlId]="controlId()"
          [describedBy]="describedBy()"
          [disabled]="disabled()"
          [invalid]="invalid()"
          [label]="field().label | rokuT"
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
               one. A switch can only say two of those, so it would submit
               "not available here" for every row an operator merely opened. -->
          <select
            (change)="onTriState($event)"
            [attr.aria-describedby]="describedBy()"
            [attr.aria-invalid]="invalid() ? 'true' : null"
            [disabled]="disabled()"
            [id]="controlId()"
            [value]="triState()"
          >
            <option value="">{{ 'resource.field.unset' | rokuT }}</option>
            <option value="true">{{ 'resource.value.yes' | rokuT }}</option>
            <option value="false">{{ 'resource.value.no' | rokuT }}</option>
          </select>
        } @else {
          <!-- Two answers, so a switch. It says what was pressed, and the
               form holds the value until Save (admin plan 0052, section
               3.4). -->
          <lib-switch
            (checkedChange)="valueChange.emit($event)"
            [checked]="value() === true"
            [controlId]="controlId()"
            [describedBy]="describedBy()"
            [disabled]="disabled()"
            [invalid]="invalid()"
            [label]="field().label | rokuT"
          />
        }
      }

      @case ('enum') {
        <select
          (change)="onInput($event)"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [disabled]="disabled()"
          [id]="controlId()"
          [required]="required()"
          [value]="asText()"
        >
          <option value="">{{ 'resource.field.choose' | rokuT }}</option>
          <!-- Each option says whether it is the one held. The select's own
               value is written before its options are drawn, so by itself it
               finds no option to choose and shows "Choose" over a row that
               holds a value (admin plan 0045, where a member's role is the
               one thing the form is opened to change). -->
          @for (option of optionsOf(); track option.value) {
            <option
              [selected]="option.value === asText()"
              [value]="option.value"
            >
              {{ option.label | rokuT }}
            </option>
          }
        </select>
      }

      @case ('reference') {
        <lib-reference-picker
          (valueChange)="valueChange.emit($event)"
          [controlId]="controlId()"
          [describedBy]="describedBy()"
          [disabled]="disabled() || scopeOf() === null"
          [empty]="emptyOf()"
          [invalid]="invalid()"
          [label]="field().label | rokuT"
          [lookup]="lookup()"
          [resource]="resourceOf()"
          [scope]="scopeOf() ?? {}"
          [value]="asText()"
        />
      }

      @case ('references') {
        <lib-references-control
          (valueChange)="valueChange.emit($event)"
          [controlId]="controlId()"
          [describedBy]="describedBy()"
          [disabled]="disabled()"
          [invalid]="invalid()"
          [locks]="locks()"
          [lookup]="lookup()"
          [marks]="marks()"
          [names]="names()"
          [ordered]="isOrdered()"
          [resource]="resourceOf()"
          [scope]="scopeOf()"
          [value]="asIds()"
        />
      }

      @case ('date') {
        <input
          (input)="onInput($event)"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [disabled]="disabled()"
          [id]="controlId()"
          [required]="required()"
          [type]="dateType()"
          [value]="asText()"
          class="short"
        />
      }

      @default {
        @if (multiline()) {
          <textarea
            (input)="onInput($event)"
            [attr.aria-describedby]="describedBy()"
            [attr.aria-invalid]="invalid() ? 'true' : null"
            [attr.maxlength]="maxLengthOf() ?? null"
            [class.mono]="field().kind === 'json'"
            [disabled]="disabled()"
            [id]="controlId()"
            [required]="required()"
            [value]="asText()"
            rows="4"
          ></textarea>
        } @else {
          <span class="line">
            <input
              (input)="onInput($event)"
              [attr.aria-describedby]="describedBy()"
              [attr.aria-invalid]="invalid() ? 'true' : null"
              [attr.inputmode]="inputMode()"
              [attr.maxlength]="maxLengthOf() ?? null"
              [class.mono]="isCode()"
              [class.short]="isShort()"
              [disabled]="disabled()"
              [id]="controlId()"
              [required]="required()"
              [value]="asText()"
              type="text"
            />
            <!-- The picture an address points at, beside the field once it
                 loads. An address that is half typed, or that names no
                 picture, draws nothing: the field itself is the answer
                 there. The alt is empty because the address names it. -->
            @if (isImage() && asText() !== '') {
              <img
                (error)="pictured.set(null)"
                (load)="pictured.set(asText())"
                [class.loaded]="pictured() === asText()"
                [src]="asText()"
                alt=""
                data-picture
              />
            }
          </span>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }

    /* What a control looks like is the global rule's (styles.scss). A field
       of a form adds only how wide it is: it fills its row, up to 420 px.
       Restating the padding or the background here would also wipe the arrow
       that rule draws on a select (admin plan 0050). */
    input,
    select,
    textarea,
    lib-reference-picker,
    lib-references-control,
    lib-localized-text-control {
      inline-size: 100%;
      max-inline-size: 26.25rem;
    }

    textarea {
      display: block;
      resize: vertical;
    }

    /* A printed object is read across its lines, so it takes the row. */
    textarea.mono {
      max-inline-size: none;
    }

    .mono {
      font-family: var(--admin-font-mono);
    }

    .line {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
    }

    /* Out of the row until it has loaded, so a broken address leaves no
       hole beside the field. */
    img {
      display: none;
      flex: none;
      inline-size: 3.5rem;
      block-size: 3.5rem;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-neutral-wash);
      object-fit: contain;
    }

    img.loaded {
      display: block;
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

    /* A number, an amount, a date and a code are short, and a box as wide as
       a name would say they are not. On a phone every control fills its
       row. */
    @media (min-width: 48rem) {
      .short {
        max-inline-size: 10.5rem;
      }
    }

    @media (max-width: 47.99rem) {
      input,
      select,
      textarea,
      lib-reference-picker,
      lib-references-control,
      lib-localized-text-control {
        max-inline-size: none;
      }
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
  /**
   * The row as the form holds it right now: the row read, with the draft's
   * values over it. Only a `references` field reads it, to scope its picker
   * and to ask which targets are locked (admin plan 0028, section 3).
   */
  readonly context = input<ResourceRow>({});
  /** Whether the value was refused. Sets `aria-invalid` and the red edge. */
  readonly invalid = input(false);
  /**
   * The ids of the lines that describe the control: its refusals and its
   * help. The row draws them, and `describedByOf` beside it builds this.
   */
  readonly describedBy = input<string | null>(null);

  readonly valueChange = output<DraftValue>();

  /** The address whose picture has loaded, for a field that holds one. */
  readonly pictured = signal<string | null>(null);

  asText(): string {
    const value = this.value();
    return typeof value === 'string' ? value : '';
  }

  asRecord(): Readonly<Record<string, string>> {
    const value = this.value();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, string>>)
      : {};
  }

  asIds(): readonly string[] {
    const value = this.value();
    return Array.isArray(value) ? value : [];
  }

  /**
   * What a `references` picker is limited to, read from the form's row.
   *
   * A computed rather than a method, because `scopeFrom` builds a new object
   * every call and a binding that changes on every check is an error in
   * development. The same goes for {@link locks}.
   */
  readonly scopeOf = computed<ReferenceScope | null>(() => {
    const field = this.field();
    if (
      (field.kind !== 'references' && field.kind !== 'reference') ||
      field.scopeFrom === undefined
    ) {
      return {};
    }
    return field.scopeFrom(this.context());
  });

  /** The descriptor's lock, bound to the form's row, or `null` for none. */
  readonly locks = computed<((target: ResourceRow) => boolean) | null>(() => {
    const field = this.field();
    if (field.kind !== 'references' || field.locked === undefined) {
      return null;
    }
    const row = this.context();
    return (target) => field.locked?.(row, target) === true;
  });

  /** The descriptor's mark for one target, or `null` for none. */
  readonly marks = computed<
    ((target: ResourceRow) => ScopeMarkView | undefined) | null
  >(() => {
    const field = this.field();
    if (field.kind !== 'references' || field.mark === undefined) {
      return null;
    }
    return (target) => field.mark?.(target);
  });

  /** What the descriptor calls one target, or `null` for its title. */
  readonly names = computed<
    ((target: ResourceRow) => FieldMessage | undefined) | null
  >(() => {
    const field = this.field();
    if (field.kind !== 'references' || field.nameOf === undefined) {
      return null;
    }
    const row = this.context();
    return (target) => field.nameOf?.(row, target);
  });

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

  /**
   * Whether a reference field offers "None", which clears it (admin plan
   * 0050, section 2). The descriptor says so with `emptyOption`, and a field
   * that says nothing follows `nullable`: null is an answer of the column or
   * it is not.
   */
  readonly emptyOf = computed<ReferenceEmpty>(() => {
    const field = this.field();
    if (field.kind !== 'reference') {
      return null;
    }
    return (field.emptyOption ?? field.nullable === true) ? 'none' : null;
  });

  resourceOf(): string {
    const field = this.field();
    return field.kind === 'reference' || field.kind === 'references'
      ? field.resource
      : '';
  }

  maxLengthOf(): number | undefined {
    const field = this.field();
    return field.kind === 'text' || field.kind === 'localized-text'
      ? field.maxLength
      : undefined;
  }

  /**
   * Whether the control is a textarea.
   *
   * A `json` field always is: it holds a printed object, which is several lines
   * before it is anything worth reading.
   */
  multiline(): boolean {
    const field = this.field();
    return (
      field.kind === 'json' ||
      (field.kind === 'text' && field.multiline === true)
    );
  }

  /** Whether the control itself says it must be filled. */
  required(): boolean {
    return this.field().required === true;
  }

  /** Whether the order of a list of references is part of the answer. */
  isOrdered(): boolean {
    const field = this.field();
    return field.kind === 'references' && field.ordered === true;
  }

  /** Text an operator copies character by character, in the mono face. */
  isCode(): boolean {
    const field = this.field();
    return field.kind === 'text' && field.format === 'code';
  }

  /** Whether the text is the address of a picture, drawn beside the field. */
  isImage(): boolean {
    const field = this.field();
    return field.kind === 'text' && field.format === 'image';
  }

  /** A number, an amount of money and a code take a short box. */
  isShort(): boolean {
    const kind = this.field().kind;
    return kind === 'money' || kind === 'number' || this.isCode();
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
