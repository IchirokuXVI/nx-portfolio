import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CopyIcon } from '../icons/icons';
import { normalizeJoinCode } from './join-code';

/**
 * The eight character field, its rules, and the paste button beside it.
 *
 * ## Why the rules live in the field
 *
 * A code that reaches the gateway with a lower case letter or a stray space is a 404
 * the person cannot act on, and the message they would get back says nothing about
 * spaces. Correcting as they type means the failure they see is only ever the real
 * one: no group has that code. `normalizeJoinCode` does all of it, and this component
 * only wires it to the events.
 *
 * ## Why paste is an output and not a clipboard read
 *
 * Reading the clipboard is `navigator.clipboard`, and plan 0001's rule D2 puts every
 * browser global behind `BrowserFacade`, which is a service this library may not
 * inject (rule D1). So the button says it was pressed and the container, which may
 * inject that facade, does the reading and writes the result back through `value`.
 * The two way binding is what makes that one line at the call site.
 */
@Component({
  selector: 'lib-join-code-field',
  imports: [RokuTranslatorPipe, CopyIcon],
  templateUrl: './join-code-field.html',
  styleUrl: './join-code-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinCodeField {
  /** The code, already normalized. Two way, so a paste can be written back. */
  readonly value = model.required<string>();

  /** The input's id, so the caller's own label and message can address it. */
  readonly fieldId = input.required<string>();

  /** The id of the error message under the field, when there is one. */
  readonly errorId = input<string | null>(null);

  /** Draws the field in the rejected treatment. The message itself is the caller's. */
  readonly invalid = input(false);

  /** True while the request is in flight: the field goes read only, not disabled. */
  readonly readOnly = input(false);

  readonly pasteCode = output<void>();

  /**
   * Every keystroke, filtered.
   *
   * The element's own value is written back as well as the signal, because a rejected
   * character otherwise stays on screen: Angular does not re-render an input whose
   * bound value did not change, and after filtering it usually has not.
   */
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = normalizeJoinCode(input.value);

    if (input.value !== cleaned) {
      input.value = cleaned;
    }

    this.value.set(cleaned);
  }
}
