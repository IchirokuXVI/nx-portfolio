import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injector,
  input,
  output,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * One card of the tour (velista `0099`, section 4).
 *
 * "3 OF 5", a title, two sentences, then Skip the tour and Next. Presentational under
 * rule D1: it takes the keys and the numbers, and says which button was pressed.
 *
 * ## Skip is never a cross in a corner
 *
 * It is a button with words, the same height as Next and in the same place on every
 * card, so the way out is found once and then known. The last card says Finish.
 *
 * ## A dialog, with the focus kept in it (section 10)
 *
 * Focus moves to the card when it opens and again on every new stop, so a screen reader
 * reads each card as it arrives. Tab goes round the two buttons and nowhere else, and
 * `AppLayout` makes the app behind `inert` besides. Escape is Skip, which is what the
 * back button is too.
 */
@Component({
  selector: 'lib-tour-card',
  imports: [RokuTranslatorPipe],
  templateUrl: './tour-card.html',
  styleUrl: './tour-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
  },
})
export class TourCard {
  private readonly _injector = inject(Injector);

  readonly titleKey = input.required<string>();
  readonly bodyKey = input.required<string>();
  /** This card's position, from 1. */
  readonly n = input.required<number>();
  readonly total = input.required<number>();
  /** Whether this card says Finish instead of Next. */
  readonly last = input(false);

  readonly next = output<void>();
  readonly skip = output<void>();

  private readonly _dialog =
    viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly _skip =
    viewChild.required<ElementRef<HTMLElement>>('skipButton');
  private readonly _next =
    viewChild.required<ElementRef<HTMLElement>>('nextButton');

  constructor() {
    // Every new card takes the focus, not only the first one.
    effect(() => {
      this.titleKey();
      untracked(() =>
        afterNextRender(() => this._dialog().nativeElement.focus(), {
          injector: this._injector,
        })
      );
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.skip.emit();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    // Round the two buttons. The dialog itself comes before the first, so Tab from it
    // is left alone and Shift Tab from it wraps like Shift Tab from the first.
    const dialog = this._dialog().nativeElement;
    const first = this._skip().nativeElement;
    const last = this._next().nativeElement;
    const active = dialog.ownerDocument.activeElement;

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    }
  }
}
