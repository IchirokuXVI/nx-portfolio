import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { LocateIcon, SpinnerIcon } from '../icons/icons';

/**
 * "Near me" / "Cerca de mí", in the shop picker's title row (velista `0103`).
 *
 * In the title row so it is reachable without scrolling, on both sheets that draw
 * the picker, which is why it is its own component: each sheet owns its head.
 *
 * **Pressing it is the only thing that asks for the position.** It reports the
 * press and nothing else; the container asks. While it works it says so, "Finding
 * you", and a second press is swallowed, but it is never `disabled`: a disabled
 * button drops focus to the body, and Escape would then no longer reach the sheet.
 */
@Component({
  selector: 'lib-near-me-button',
  imports: [LocateIcon, RokuTranslatorPipe, SpinnerIcon],
  template: `<button
    (click)="press()"
    [attr.aria-busy]="busy()"
    [attr.aria-label]="
      busy()
        ? ('basket.view.shop.near.finding' | rokuT)
        : ('basket.view.shop.near.buttonLabel' | rokuT)
    "
    [class.is-busy]="busy()"
    class="near"
    type="button"
  >
    @if (busy()) {
      <lib-spinner-icon class="glyph" />
      {{ 'basket.view.shop.near.finding' | rokuT }}
    } @else {
      <lib-locate-icon class="glyph" />
      {{ 'basket.view.shop.near.button' | rokuT }}
    }
  </button>`,
  styleUrl: './near-me-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NearMeButton {
  /** A search is out: draw "Finding you", and swallow a second press. */
  readonly busy = input(false);

  /** Somebody pressed it, and not while it was already working. */
  readonly pressed = output<void>();

  protected press(): void {
    if (!this.busy()) {
      this.pressed.emit();
    }
  }
}
