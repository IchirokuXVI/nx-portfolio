import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  isEditable,
  type DraftValue,
  type FieldDescriptor,
  type FieldMessage,
  type FormMode,
  type ResourceCell,
  type ResourceDraft,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { FieldControl } from './field-control';
import type { ReferenceLookup } from './reference-lookup';
import { ResourceCellView } from './resource-cell';

/** One field changing. */
export interface FieldChange {
  readonly name: string;
  readonly value: DraftValue;
}

/**
 * Every form in the back office (plan 0004, section 5).
 *
 * Create and edit are the same component with the same descriptor, because they
 * are the same act with a different starting point. What it provides once, so
 * that fifteen entities inherit the fix rather than each getting it wrong
 * separately:
 *
 * - A control per field kind, including one input per locale for localized text.
 * - Validation shown **per field**, and a server's refusal put back on the field
 *   that caused it rather than dumped in a banner. Only a complaint about a
 *   field this form does not have goes to the banner, because there is nowhere
 *   else for it and dropping it would leave a refused submit with no reason on
 *   screen.
 * - Disabled and pending states while submitting, so a double submit is
 *   impossible.
 *
 * Fields the descriptor marks not editable still render, as text. An id and a
 * created date are the two things an operator most often needs to copy, and a
 * form that hid everything it cannot change would be a worse detail view than
 * the table row it was opened from.
 *
 * **It derives nothing.** No field's value is computed from another's, ever.
 * `unitPrice` is stored verbatim and the obvious derivation disagrees with the
 * source on 110 of 4,232 products, in the field whose only purpose is
 * comparison, so a form that helpfully filled it in would be quietly wrong once
 * in forty times.
 */
@Component({
  selector: 'lib-resource-form',
  imports: [RokuTranslatorPipe, FieldControl, ResourceCellView],
  template: `
    <!-- The native submit event, not ngSubmit. This form holds no ngModel, so
         importing FormsModule for one output would pull a whole forms
         implementation in to rename an event that already exists; and a
         template that binds ngSubmit without it silently listens for a DOM
         event nobody dispatches. -->
    <form (submit)="onSubmit($event)" novalidate>
      <h1>{{ titleKey() | rokuT: titleArgs() }}</h1>

      @if (subtitle(); as text) {
        <p class="subtitle">{{ text }}</p>
      }

      @for (field of fields(); track field.name) {
        <div class="field">
          <label [for]="controlId(field)">
            {{ field.label | rokuT }}
            @if (field.required) {
              <span aria-hidden="true" class="required">*</span>
            }
          </label>

          @if (editable(field)) {
            <lib-field-control
              (valueChange)="
                valueChange.emit({ name: field.name, value: $event })
              "
              [controlId]="controlId(field)"
              [disabled]="busy()"
              [field]="field"
              [lookup]="lookup()"
              [value]="valueOf(field)"
            />
          } @else {
            <p [id]="controlId(field)" class="readonly">
              <lib-resource-cell [cell]="cellOf(field)" />
            </p>
          }

          @if (field.help; as help) {
            <p class="help">{{ help | rokuT }}</p>
          }

          @for (message of messagesFor(field); track $index) {
            <p class="error" role="alert">
              @if (message.kind === 'key') {
                {{ message.key | rokuT: message.args }}
              } @else {
                {{ message.text }}
              }
            </p>
          }
        </div>
      }

      @if (strayErrors().length > 0) {
        <div class="banner" role="alert">
          @for (message of strayErrors(); track $index) {
            <p>{{ message }}</p>
          }
        </div>
      }

      @if (errorKey(); as key) {
        <p class="banner" role="alert">{{ key | rokuT }}</p>
      }

      <div class="controls">
        <button [disabled]="busy()" class="primary" type="submit">
          {{ submitKey() | rokuT }}
        </button>
        <button (click)="leave.emit()" [disabled]="busy()" type="button">
          {{ 'resource.action.cancel' | rokuT }}
        </button>
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      max-inline-size: 36rem;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    .subtitle {
      margin-block-start: calc(var(--admin-space-4) * -1);
      color: var(--admin-ink-muted);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .required {
      color: var(--admin-danger);
    }

    .readonly {
      padding: var(--admin-space-2) 0;
      overflow-wrap: anywhere;
    }

    .help {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .error {
      font-size: 0.875rem;
      color: var(--admin-danger);
    }

    .banner {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      font-size: 0.875rem;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceForm {
  readonly titleKey = input.required<string>();
  /**
   * What to interpolate into the heading, which is the resource's own name.
   *
   * Already translated by the page. The heading is one key for every entity
   * ("New {{name}}"), so the entity's singular label has to arrive as a string
   * rather than as a second key: a translator pipe cannot resolve a key that is
   * itself the argument of another.
   */
  readonly titleArgs = input<Record<string, string | number>>({});
  /** What the row is called, when there is one. Shown under the heading. */
  readonly subtitle = input<string | null>(null);
  readonly mode = input.required<FormMode>();
  readonly fields = input.required<readonly FieldDescriptor<ResourceRow>[]>();
  readonly draft = input.required<ResourceDraft>();
  /** Per field, what to say under it. Built by the page from the store. */
  readonly messages = input<Readonly<Record<string, readonly FieldMessage[]>>>(
    {}
  );
  /** The formatted values of the fields this form only shows. */
  readonly readonlyCells = input<Readonly<Record<string, ResourceCell>>>({});
  /** The server's complaints about fields that are not on this form. */
  readonly strayErrors = input<readonly string[]>([]);
  /** A key for a failure that belongs to no field. */
  readonly errorKey = input<string | null>(null);
  readonly busy = input(false);
  readonly lookup = input<ReferenceLookup>({
    search: async () => [],
    resolve: async () => null,
  });

  readonly valueChange = output<FieldChange>();
  readonly save = output<void>();
  /**
   * The operator asked to leave without saving.
   *
   * Named `leave` rather than `cancel`, which is a standard DOM event: an output
   * that shadows one is ambiguous at the binding site, where nothing says
   * whether the listener will hear the component or the element.
   */
  readonly leave = output<void>();

  editable(field: FieldDescriptor<ResourceRow>): boolean {
    return isEditable(field);
  }

  controlId(field: FieldDescriptor<ResourceRow>): string {
    return `field-${field.name}`;
  }

  valueOf(field: FieldDescriptor<ResourceRow>): DraftValue {
    return this.draft()[field.name] ?? '';
  }

  cellOf(field: FieldDescriptor<ResourceRow>): ResourceCell {
    return (
      this.readonlyCells()[field.name] ?? {
        text: '',
        key: 'resource.value.none',
      }
    );
  }

  messagesFor(field: FieldDescriptor<ResourceRow>): readonly FieldMessage[] {
    return this.messages()[field.name] ?? [];
  }

  submitKey(): string {
    if (this.busy()) {
      return 'resource.action.saving';
    }
    return this.mode() === 'create'
      ? 'resource.action.create'
      : 'resource.action.save';
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.save.emit();
  }
}
