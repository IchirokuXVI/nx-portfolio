import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A labelled cluster of tech chips for a detail page's meta panel (0007).
 * `heading` is already-translated text; `chips` are literal product names
 * (Angular 21, Nx 22, ...) that do not localize. Presentational and project
 * agnostic. Renders nothing when it has no chips.
 */
@Component({
  selector: 'lib-landing-v2-tech-chip-group',
  imports: [],
  templateUrl: './tech-chip-group.html',
  styleUrl: './tech-chip-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechChipGroup {
  heading = input.required<string>();
  chips = input<string[]>([]);
}
