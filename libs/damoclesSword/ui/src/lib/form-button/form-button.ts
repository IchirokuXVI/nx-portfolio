import { Component, input } from '@angular/core';

/**
 * A themeable form button. Unlike {@link ../call-to-action-button}'s
 * `CallToActionButton` (which is a router `<a>`), this renders a real
 * `<button>` so it can submit the enclosing `<form>`. The label is projected via
 * `<ng-content>`; colours are driven by the `--form-button-bg` /
 * `--form-button-color` / `--form-button-accent` CSS custom properties,
 * overridable by consumers.
 */
@Component({
  selector: 'lib-damocles-sword-form-button',
  imports: [],
  templateUrl: './form-button.html',
  styleUrl: './form-button.scss',
})
export class FormButton {
  /** Button `type`; defaults to `submit` so it submits the enclosing form. */
  type = input<'submit' | 'button' | 'reset'>('submit');
  /** Disables the button (e.g. while a submission is in flight). */
  disabled = input(false);
}
