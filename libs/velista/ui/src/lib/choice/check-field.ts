import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from '@angular/core';

/**
 * A small checkbox with its words (velista `0140`, section 2): "Keep it for next
 * time".
 *
 * The owner asked for one that is "more stylized and a bit smaller" than the
 * native control: an 18 pixel box and words of 14 pixels in the secondary colour.
 * It is the native checkbox with its look taken off, so Space toggles it and a
 * screen reader reads it as one, and **its whole row is the label**, so the touch
 * target is the row and not the box.
 */
@Component({
  selector: 'lib-check-field',
  template: `
    <label class="field">
      <input
        (change)="checked.set($any($event.target).checked)"
        [checked]="checked()"
        [disabled]="disabled()"
        class="box"
        type="checkbox"
      />
      <span class="words"><ng-content /></span>
    </label>
  `,
  styleUrl: './check-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckField {
  readonly checked = model(false);
  readonly disabled = input(false);
}
