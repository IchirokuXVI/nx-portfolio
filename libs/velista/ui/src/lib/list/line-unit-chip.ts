import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  viewChildren,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LineUnit } from '@portfolio/velista/models';

/**
 * What a line with several kinds of product counts in (velista `0183`,
 * section 2): "pieces", "weight", "volume", as one segmented control.
 *
 * Drawn only when the line's products offer two units or more, so a line with
 * one unit draws nothing at all (backend `0246` W1). Each segment is a radio of
 * one group. The arrow keys move the choice, as a radio group's do, and Home
 * and End go to the ends. The group is one tab stop, on the chosen segment.
 *
 * It holds no state of its own: `value` is the line's unit as the store has it,
 * and `chosen` says what was pressed. The sheet writes it, and a refusal puts
 * the store's line back, which puts this back with it.
 */
@Component({
  selector: 'lib-line-unit-chip',
  imports: [RokuTranslatorPipe],
  template: `
    @if (units().length > 1) {
      <div
        [attr.aria-disabled]="disabled() || null"
        [attr.aria-label]="'line.unit.label' | rokuT"
        class="group"
        role="radiogroup"
      >
        @for (unit of units(); track unit) {
          <button
            (click)="choose(unit)"
            (keydown)="onKeydown($event)"
            [attr.aria-checked]="unit === value()"
            [attr.tabindex]="unit === value() ? 0 : -1"
            [class.is-on]="unit === value()"
            [disabled]="disabled()"
            #segment
            class="segment"
            role="radio"
            type="button"
          >
            {{ 'line.unit.' + unit | rokuT }}
          </button>
        }
      </div>
    }
  `,
  styleUrl: './line-unit-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineUnitChip {
  /** The units the line's products offer, in the order they are drawn. */
  readonly units = input.required<readonly LineUnit[]>();

  /** The unit the line counts in now. */
  readonly value = input.required<LineUnit>();

  /** While a unit change is being written. */
  readonly disabled = input(false);

  /** A segment other than the chosen one was pressed or reached by the keys. */
  readonly chosen = output<LineUnit>();

  private readonly _segments =
    viewChildren<ElementRef<HTMLButtonElement>>('segment');

  protected choose(unit: LineUnit): void {
    if (this.disabled() || unit === this.value()) {
      return;
    }
    this.chosen.emit(unit);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const units = this.units();
    const at = units.indexOf(this.value());
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (at + 1) % units.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (at - 1 + units.length) % units.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = units.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (this.disabled()) {
      return;
    }
    this._segments()[next]?.nativeElement.focus();
    this.choose(units[next]);
  }
}
