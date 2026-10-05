import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * A yes or no, as a switch (admin plan 0052, section 3.4).
 *
 * A `button` with `role="switch"`, so it takes the focus, Space and Enter the
 * way a button does and a screen reader says "on" or "off".
 *
 * **It says what was pressed and writes nothing.** The form holds the value
 * until Save, like every other field. A change that must be fast is a named
 * action with its own question.
 *
 * "Yes" or "No" is written beside it, so the state is never colour alone. The
 * word is hidden from a screen reader, which already heard the state.
 */
@Component({
  selector: 'lib-switch',
  imports: [RokuTranslatorPipe],
  template: `
    <button
      (click)="checkedChange.emit(!checked())"
      [attr.aria-checked]="checked()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [attr.aria-label]="label()"
      [class.on]="checked()"
      [disabled]="disabled()"
      [id]="controlId()"
      role="switch"
      type="button"
    >
      <span class="knob"></span>
    </button>
    <span aria-hidden="true" class="word" data-word>{{
      (checked() ? 'resource.value.yes' : 'resource.value.no') | rokuT
    }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: var(--admin-control);
    }

    /* The track. 36 by 20 px beside a pointer, and the row around it is the
       full height of a control. */
    button {
      position: relative;
      flex: none;
      inline-size: 2.25rem;
      block-size: 1.25rem;
      min-block-size: 0;
      padding: 0;
      border: none;
      border-radius: 0.625rem;
      background: var(--admin-border-strong);
      cursor: pointer;
    }

    button.on {
      background: var(--admin-accent);
    }

    .knob {
      position: absolute;
      inset-block-start: 0.125rem;
      inset-inline-start: 0.125rem;
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: 50%;
      background: var(--admin-surface-raised);
    }

    button.on .knob {
      inset-inline-start: 1.125rem;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    /* 44 by 26 px under a thumb. */
    @media (max-width: 47.99rem) {
      button {
        inline-size: 2.75rem;
        block-size: 1.625rem;
        border-radius: 0.8125rem;
      }

      .knob {
        inline-size: 1.375rem;
        block-size: 1.375rem;
      }

      button.on .knob {
        inset-inline-start: 1.25rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Switch {
  /** The value. */
  readonly checked = input.required<boolean>();
  /** The id of the button, which a label points at. */
  readonly controlId = input.required<string>();
  /** The accessible name: the label of the field, already translated. */
  readonly label = input.required<string>();
  readonly disabled = input(false);
  /** Whether the value was refused. Sets `aria-invalid`. */
  readonly invalid = input(false);
  /** The ids of the lines under the switch that say something about it. */
  readonly describedBy = input<string | null>(null);

  /** The value the operator asked for. The form decides what to do with it. */
  readonly checkedChange = output<boolean>();
}
