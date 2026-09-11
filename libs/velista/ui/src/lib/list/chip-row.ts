import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One chip: what it says, and what removing it is called. */
export interface ChipRowItem {
  /** Whatever the caller identifies this chip by. It comes back on `remove`. */
  readonly id: string;
  /** The chip's words, already translated. See the class comment for why. */
  readonly label: string;
  /** The accessible name of its x, already translated. "Remove: A to Z". */
  readonly removeLabel: string;
}

/**
 * The gap between two chips, in pixels, matching `--app-space-3` in the stylesheet.
 *
 * A number here as well as a token there, because the fit has to be arithmetic and
 * a `var()` is a string until something lays it out. The two are checked against
 * each other by nothing, which is the price of measuring in script at all; the
 * failure is one chip too many or too few on one width, and never a wrong count.
 */
const CHIP_GAP = 8;

/**
 * How many chips to draw, given their natural widths and the room there is.
 *
 * Pure, and exported, because this is the whole of the overflow rule and jsdom
 * measures nothing: a spec can hand it widths and assert the answer, which is the
 * only way to test the `+N` chip without a browser.
 *
 * **An unmeasured row draws every chip.** `available` is zero before the first
 * `ResizeObserver` callback and in any spec that did not fake one, and collapsing
 * every chip into a `+N` on the first frame would be a visible flash of the wrong
 * answer. Drawing too many for one frame is invisible, because the row clips.
 */
export function fitChips(
  widths: readonly number[],
  plusWidth: number,
  available: number
): number {
  if (widths.length === 0 || available <= 0) {
    return widths.length;
  }

  const whole = widths.reduce(
    (sum, width, at) => sum + width + (at === 0 ? 0 : CHIP_GAP),
    0
  );
  if (whole <= available) {
    return widths.length;
  }

  // Something has to be dropped, so the `+N` chip is certain and its room comes off
  // the top rather than being discovered at the end.
  let used = plusWidth;
  let shown = 0;
  for (const width of widths) {
    const next = used + CHIP_GAP + width;
    if (next > available) {
      break;
    }
    used = next;
    shown += 1;
  }
  return shown;
}

/**
 * One line of chips naming what is on, with what does not fit collapsed into a
 * `+N` (velista `0075`, section 5).
 *
 * ## One line, never two
 *
 * The row sits between the tools row and the lines on a 390 wide phone, and a chip
 * row that wraps to two or three lines pushes the shopping off the screen. So it
 * never wraps: it draws the longest prefix of chips that fits beside a `+N` chip,
 * and `+N` opens the sheet, because the things it stands for are only nameable
 * there.
 *
 * ## Why it measures twice
 *
 * The visible row holds only the chips that fit, so it cannot be measured: the
 * chips it dropped have no width in it, and feeding those zeros back would draw
 * them again. A second row holds every chip at its natural width, `aria-hidden` and
 * `visibility: hidden`, and is what gets measured. Hidden that way it is out of the
 * tab order and out of the accessibility tree, and it is spans rather than buttons
 * so that there is nothing in it to reach even if it were not.
 *
 * ## Why the labels arrive translated
 *
 * Each chip's words come from the state the **caller** holds, through keys with
 * arguments that only the caller can fill ("Only Groceries", "2 of 3 lists"), so
 * resolving them here would mean this component knowing what a basket is. The two
 * strings it does own are the `+N` chip's, whose number nothing but this component
 * knows, and those it translates itself.
 */
@Component({
  selector: 'lib-chip-row',
  imports: [RokuTranslatorPipe],
  templateUrl: './chip-row.html',
  styleUrl: './chip-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChipRow {
  readonly chips = input.required<readonly ChipRowItem[]>();

  /**
   * The count at the trailing edge, already formatted, or null for none.
   *
   * The caller decides whether there is one: the rule is that it is drawn only
   * while fewer lines are shown than the basket holds, and this component knows
   * nothing about lines.
   */
  readonly count = input<string | null>(null);

  /** A chip's x was pressed. The caller puts that one property back. */
  readonly remove = output<string>();

  /** The `+N` chip was pressed. The caller opens the sheet. */
  readonly more = output<void>();

  private readonly _host = inject(ElementRef<HTMLElement>);

  /** Every chip in the measuring row, which always holds all of them. */
  private readonly _rulers = viewChildren<ElementRef<HTMLElement>>('ruler');

  private readonly _plus = viewChildren<ElementRef<HTMLElement>>('plusRuler');

  private readonly _available = signal(0);

  /**
   * The natural widths, remeasured whenever the chips or the room change.
   *
   * Read through the signals the view children are, so a chip whose words changed
   * is measured again without a lifecycle hook: Angular reports the new element
   * list and this recomputes.
   */
  private readonly _widths = signal<readonly number[]>([]);

  private readonly _plusWidth = signal(0);

  private readonly _measure = effect(() => {
    const rulers = this._rulers();
    const plus = this._plus();
    // Read so that a resize remeasures too: a chip's width does not change with the
    // viewport, but the font and the container's padding can.
    this._available();

    this._widths.set(
      rulers.map((ruler) => ruler.nativeElement.getBoundingClientRect().width)
    );
    this._plusWidth.set(
      plus[0]?.nativeElement.getBoundingClientRect().width ?? 0
    );
  });

  /** How many chips the visible row draws. */
  protected readonly shown = computed(() =>
    fitChips(this._widths(), this._plusWidth(), this._available())
  );

  protected readonly visible = computed(() =>
    this.chips().slice(0, this.shown())
  );

  /** How many did not fit, which is the number on the `+N` chip. */
  protected readonly hidden = computed(
    () => this.chips().length - this.shown()
  );

  constructor() {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const measured = entries[0]?.contentRect.width ?? 0;
        // A row laid out at zero is a row on a screen nobody is looking at yet. The
        // last usable width is kept, so it is already right when it is shown again,
        // and zero would mean "unmeasured" and draw every chip.
        if (measured > 0) {
          this._available.set(measured);
        }
      });

      observer.observe(this._host.nativeElement);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }
}
