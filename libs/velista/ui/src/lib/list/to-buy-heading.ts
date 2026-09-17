import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';

const NO_BREAK_SPACE = String.fromCharCode(0x00a0);

/**
 * The heading of To buy, which holds the reorder action (velista `0088`, section 2).
 *
 * To buy is the one group whose lines can be put in order, so the action sits beside
 * its name rather than in the list's header. It moved here from `ListHeader` whole,
 * with the hold of `0082` section 7 and the sentence a held press answers with.
 */
@Component({
  selector: 'lib-to-buy-heading',
  imports: [RokuTranslatorPipe],
  template: `
    <div class="bar">
      <h2 class="title">{{ 'list.trips.toBuy' | rokuT }}</h2>
      @if (canReorder()) {
        <!--
          Held rather than absent while the screen is not in list order: the name
          stays, and a press answers with the sentence below. aria-disabled and never
          disabled, because a disabled button swallows the click that would explain it.
        -->
        <button
          (click)="pressReorder()"
          [attr.aria-disabled]="reorderHeld() ? 'true' : null"
          [class.held]="reorderHeld()"
          class="action"
          type="button"
        >
          {{ 'list.reorder.enter' | rokuT }}
        </button>
      }
    </div>
    <p aria-live="polite" class="held-message" role="status">
      {{ heldMessage() }}
    </p>
  `,
  styleUrl: './to-buy-heading.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToBuyHeading {
  /** Whether reordering is offered at all right now (rule L4). */
  readonly canReorder = input(false);

  /** Whether reorder has to wait for the list order (velista `0082`, section 7). */
  readonly reorderHeld = input(false);

  readonly startReorder = output<void>();

  /** Presses since the action was last held. Starts again whenever the hold changes. */
  private readonly _heldTaps = linkedSignal({
    source: this.reorderHeld,
    computation: () => 0,
  });

  /**
   * What a held press says, or the empty string.
   *
   * A second press writes the same words, which a screen reader does not announce
   * again, so every other press carries a trailing no-break space: the text changes, the
   * words do not, and each press is heard once.
   */
  readonly heldMessage = computed(() => {
    const taps = this._heldTaps();
    if (!this.reorderHeld() || taps === 0) {
      return '';
    }
    return (
      this._translator.t('list.reorder.unavailable') +
      (taps % 2 === 0 ? NO_BREAK_SPACE : '')
    );
  });

  private readonly _translator = inject(RokuTranslatorService);

  /** Enter the mode, or say why it has to wait. */
  pressReorder(): void {
    if (this.reorderHeld()) {
      this._heldTaps.update((taps) => taps + 1);
      return;
    }
    this.startReorder.emit();
  }
}
