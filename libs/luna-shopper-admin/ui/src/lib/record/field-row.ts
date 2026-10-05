import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { FieldMessage } from '@portfolio/luna-shopper-admin/models';
import { WarningIcon } from '@portfolio/shared/ui';

/**
 * The ids of the lines that refuse a control, in the order they are drawn.
 *
 * Exported so the control can name them in `aria-describedby` without reading
 * the row: the page hands the same `controlId` and the same count to both.
 */
export function errorIdsOf(controlId: string, count: number): string[] {
  return Array.from(
    { length: Math.max(0, count) },
    (_, index) => `${controlId}-error-${index}`
  );
}

/** The id of the line of help under a control. */
export function helpIdOf(controlId: string): string {
  return `${controlId}-help`;
}

/**
 * What a control is described by: its refusals first, then its help. `null`
 * when it has neither, so the attribute is left off.
 */
export function describedByOf(
  controlId: string,
  messages: number,
  help: boolean
): string | null {
  const ids = [
    ...errorIdsOf(controlId, messages),
    ...(help ? [helpIdOf(controlId)] : []),
  ];

  return ids.length === 0 ? null : ids.join(' ');
}

/**
 * One field of a record: its label, then its value or its control (admin plan
 * 0052, section 3.1).
 *
 * **One field for each row, at every width.** On a wide screen the label is a
 * column at the left and the value takes the rest. On a phone the label is
 * above the value. Reading and changing use the same grid, so nothing moves
 * when the page becomes a form.
 *
 * What a screen reader hears follows `controlId`. With none, the row is a
 * term and its description, which is how a pair of label and value is said.
 * With one, the label is a `<label>` tied to that control.
 *
 * A refusal is a line under the control with a warning mark and the sentence.
 * Its id comes from {@link errorIdsOf}, and the control names it.
 */
@Component({
  selector: 'lib-field-row',
  imports: [NgTemplateOutlet, RokuTranslatorPipe, WarningIcon],
  template: `
    <!-- Drawn in one place and put in either shape below. A component has one
         default slot, and a second one in the other branch would take the
         content away from the first. -->
    <ng-template #body>
      @if (loading()) {
        <span aria-busy="true" class="bar" data-loading>
          <span class="sr-only">{{ 'record.row.loading' | rokuT }}</span>
        </span>
      } @else {
        <ng-content />
      }
      @for (message of messages(); track $index) {
        <p [attr.id]="errorId($index)" class="error" data-error>
          <span class="mark"><lib-warning-icon /></span>
          @if (message.kind === 'key') {
            {{ message.key | rokuT: message.args ?? {} }}
          } @else {
            {{ message.text }}
          }
        </p>
      }
      @if (help(); as key) {
        <p [attr.id]="helpId()" class="help" data-help>{{ key | rokuT }}</p>
      }
    </ng-template>

    <ng-template #state>
      @if (changed()) {
        <span class="changed" data-changed>{{
          'record.row.changed' | rokuT
        }}</span>
      }
    </ng-template>

    @if (controlId(); as id) {
      <div class="row editing">
        <div class="label">
          <label [for]="id">{{ label() }}</label>
          <!-- Hidden from a screen reader: the control itself says it is
               required, and a star read aloud says nothing. -->
          @if (required()) {
            <span aria-hidden="true" class="star">*</span>
          }
          <ng-container [ngTemplateOutlet]="state" />
        </div>
        <div class="value"><ng-container [ngTemplateOutlet]="body" /></div>
      </div>
    } @else {
      <dl class="row">
        <dt class="label">
          {{ label() }}
          <ng-container [ngTemplateOutlet]="state" />
        </dt>
        <dd class="value"><ng-container [ngTemplateOutlet]="body" /></dd>
      </dl>
    }
  `,
  styles: `
    :host {
      display: block;
      border-block-start: 1px solid var(--admin-border);
    }

    .row {
      display: grid;
      grid-template-columns: 10.5rem minmax(0, 1fr);
      column-gap: var(--admin-space-4);
      align-items: baseline;
      padding: var(--admin-space-2) var(--admin-space-4);
    }

    /* A control is taller than a line of text, so the label is set where the
       text inside the control is and not at the top of the box. */
    .row.editing {
      align-items: start;
    }

    .row.editing .label {
      padding-block-start: var(--admin-space-2);
    }

    .label {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
      overflow-wrap: anywhere;
    }

    .star {
      font-weight: 600;
      color: var(--admin-danger);
    }

    .changed {
      margin-inline-start: var(--admin-space-1);
      padding: 0.0625rem var(--admin-space-1);
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-neutral-on-wash);
    }

    .value {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .bar {
      display: block;
      inline-size: min(12rem, 100%);
      block-size: 0.75rem;
      margin-block: 0.25rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
    }

    .help,
    .error {
      margin-block-start: var(--admin-space-1);
      font-size: 0.8125rem;
    }

    .help {
      color: var(--admin-ink-muted);
    }

    .error {
      display: flex;
      gap: var(--admin-space-1);
      align-items: flex-start;
      font-weight: 500;
      color: var(--admin-danger);
    }

    .mark {
      flex: none;
      inline-size: 0.875rem;
      block-size: 0.875rem;
      margin-block-start: 0.125rem;
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    /* On a phone the label is above the value, and reads as the name of what
       is under it. */
    @media (max-width: 47.99rem) {
      .row {
        display: block;
        padding-block: var(--admin-space-3);
      }

      .label,
      .row.editing .label {
        display: block;
        margin-block-end: var(--admin-space-1);
        padding-block-start: 0;
      }

      .row.editing .label {
        font-weight: 500;
        color: var(--admin-ink);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldRow {
  /** The label, already translated. */
  readonly label = input.required<string>();
  /** The control the label is for. `null` while reading. */
  readonly controlId = input<string | null>(null);
  /** A star after the label. */
  readonly required = input(false);
  /** "Changed" beside the label. */
  readonly changed = input(false);
  /** A translation key for the line under the control. */
  readonly help = input<string | null>(null);
  /** The refusals, each one a line with a warning mark. */
  readonly messages = input<readonly FieldMessage[]>([]);
  /** A grey bar in place of the value. */
  readonly loading = input(false);

  /** The id of one refusal, or `null` while there is no control to name it. */
  errorId(index: number): string | null {
    const id = this.controlId();
    return id === null ? null : errorIdsOf(id, index + 1)[index];
  }

  helpId(): string | null {
    const id = this.controlId();
    return id === null ? null : helpIdOf(id);
  }
}
