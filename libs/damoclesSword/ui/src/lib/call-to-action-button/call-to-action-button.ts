import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A themeable call-to-action link. The label is projected via `<ng-content>`;
 * the background and accent colour are driven by the `--call-to-action-bg` /
 * `--call-to-action-accent` (and optional `--call-to-action-color`) CSS custom
 * properties, overridable by consumers.
 */
@Component({
  selector: 'lib-damocles-sword-call-to-action-button',
  imports: [RouterLink],
  templateUrl: './call-to-action-button.html',
  styleUrl: './call-to-action-button.scss',
})
export class CallToActionButton {
  /** Router commands for the link; defaults to the current page. */
  link = input<string | unknown[]>([]);
}
