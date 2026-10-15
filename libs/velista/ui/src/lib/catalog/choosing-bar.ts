import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * The foot of the catalog opened to choose (velista `0140`, section 3; artboard
 * `CatalogPick`): what the choice is for, in two lines, and the one button.
 *
 * It takes the place of `AddingBar`, which names the list the plus adds to: the
 * catalog that chooses adds to nothing, so it says what the product is for. There
 * is no bar of tabs under it, so it keeps the bottom of the screen clear of the
 * home indicator itself.
 *
 * Every string arrives translated, because the screen that opened the catalog is
 * what knows the list and the line.
 */
@Component({
  selector: 'lib-choosing-bar',
  template: `
    <span class="for">
      <span class="for-label">{{ forLabel() }}</span>
      @if (forDetail() !== '') {
        <span class="for-detail">{{ forDetail() }}</span>
      }
    </span>
    <button
      (click)="used.emit()"
      [disabled]="disabled()"
      class="use"
      type="button"
    >
      {{ action() }}
    </button>
  `,
  styleUrl: './choosing-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChoosingBar {
  /** "For Cocina". */
  readonly forLabel = input.required<string>();
  /** "Leche para el café", or empty for none. */
  readonly forDetail = input('');
  /** The button's words: "Use this product". */
  readonly action = input.required<string>();
  readonly disabled = input(false);

  /** The button was pressed. */
  readonly used = output<void>();
}
