import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
 * own, and it closes again when the list changes: a different set of sections, by
 * id. A new array holding the same sections is not a change, because the parent rows
 * rebuild theirs on every recompute (a locale switch, a store refresh, a Near me
 * answer), and a row that folded itself shut on each of those would be unusable.
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

  /**
   * The sections by id, as one string, so that a rebuilt array holding the same
   * sections compares equal and only a different list closes the row.
   */
  private readonly _key = computed(() =>
    this.sections()
      .map((section) => section.id)
      .join(' ')
  );

  /** Every chip is drawn, wrapped. Closed again whenever the list changes. */
  protected readonly open = linkedSignal({
    source: this._key,
    computation: () => false,
  });

  private readonly _host = inject(ElementRef<HTMLElement>);

  /** Every chip in the measuring row, which always holds all of them. */
  private readonly _rulers = viewChildren<ElementRef<HTMLElement>>('ruler');

  private readonly _plus = viewChildren<ElementRef<HTMLElement>>('plusRuler');

  private readonly _available = signal(0);

  private readonly _widths = signal<readonly number[]>([]);

  private readonly _plusWidth = signal(0);

  /**
   * After render, because the rulers are measured and a plain `effect` runs before
   * the view it reads has been updated. The names are read too: the rulers are
   * tracked by id, so a locale switch renames them in place without a new
   * `viewChildren` list, and the widths have to be taken again all the same.
   */
  private readonly _measure = afterRenderEffect(() => {
    const rulers = this._rulers();
    const plus = this._plus();
    // Read so that a resize, and a rename, remeasure too.
    this._available();
    this.sections().forEach((section) => section.name);

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
