import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  signal,
  viewChildren,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { fitChips } from '../list/chip-row';

/** One of a shop's sections, its name already in the reader's language. */
export interface SectionChip {
  readonly id: string;
  readonly name: string;
}

/**
 * The gap between two chips, in pixels, matching `--app-space-2` in the stylesheet.
 * A number as well as a token for `ChipRow`'s reason: the fit is arithmetic.
 */
const SECTION_GAP = 4;

/**
 * A shop's sections, on one line under its row (velista `0124`, target 4).
 *
 * ## `+X` counts only what is not drawn
 *
 * The chips go in the shop's own order, as many as fit, and the rest fold into one
 * `+X` button. **X is what is not on the line**: nine sections with five drawn is
 * `+4`, never `+9` (decided in review). How many fit is measured, never a fixed
 * number, because a section's name is as long as it is and the row is as wide as
 * the phone: the fit is `ChipRow`'s `fitChips`, fed from a hidden ruler that holds
 * every chip at its natural width and a `ResizeObserver` on the line.
 *
 * ## Pressed, it opens in place
 *
 * `+X` is a button named "Show all 9 sections". Pressed, the chips wrap onto as
 * many lines as they need and end in "Show fewer". Whether it is open is this row's
 * own, and it closes again when the list changes, which is a new `sections` array.
 *
 * ## Never inside the row's label
 *
 * The host places this beside the row's `<label>`, never inside it: a tap on a chip
 * or on `+X` must not pick the shop, and a `<label>` never wraps a button.
 *
 * A shop with no sections is drawn with no line at all, which is the host's `@if`.
 */
@Component({
  selector: 'lib-section-chips',
  imports: [RokuTranslatorPipe],
  templateUrl: './section-chips.html',
  styleUrl: './section-chips.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionChips {
  readonly sections = input.required<readonly SectionChip[]>();

  /** Every chip is drawn, wrapped. Closed again whenever the sections change. */
  protected readonly open = linkedSignal({
    source: () => this.sections(),
    computation: () => false,
  });

  private readonly _host = inject(ElementRef<HTMLElement>);

  /** Every chip in the measuring row, which always holds all of them. */
  private readonly _rulers = viewChildren<ElementRef<HTMLElement>>('ruler');

  private readonly _plus = viewChildren<ElementRef<HTMLElement>>('plusRuler');

  private readonly _available = signal(0);

  private readonly _widths = signal<readonly number[]>([]);

  private readonly _plusWidth = signal(0);

  private readonly _measure = effect(() => {
    const rulers = this._rulers();
    const plus = this._plus();
    // Read so that a resize remeasures too.
    this._available();

    this._widths.set(
      rulers.map((ruler) => ruler.nativeElement.getBoundingClientRect().width)
    );
    this._plusWidth.set(
      plus[0]?.nativeElement.getBoundingClientRect().width ?? 0
    );
  });

  /** How many chips the closed line draws. */
  private readonly _fit = computed(() =>
    fitChips(this._widths(), this._plusWidth(), this._available(), SECTION_GAP)
  );

  protected readonly visible = computed(() =>
    this.open() ? this.sections() : this.sections().slice(0, this._fit())
  );

  /** How many are not on the closed line, which is the number on `+X`. */
  protected readonly hidden = computed(() =>
    this.open() ? 0 : this.sections().length - this._fit()
  );

  protected readonly total = computed(() => this.sections().length);

  constructor() {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const measured = entries[0]?.contentRect.width ?? 0;
        // Zero is a row on a screen nobody is looking at yet: keep the last width.
        if (measured > 0) {
          this._available.set(measured);
        }
      });

      observer.observe(this._host.nativeElement);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }
}
