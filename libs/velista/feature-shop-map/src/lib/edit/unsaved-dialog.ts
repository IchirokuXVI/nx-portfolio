import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { WalkSaveStatus } from '@portfolio/velista/data-access';

/**
 * "Not saved yet" (velista `0123`, target 6; the `Unsaved` board): what is on
 * this phone only, that the app keeps trying, and how the last try went. OK
 * stays; Leave anyway, when the host offers it, leaves without what is unsent.
 *
 * It holds no page state: the host passes the saver's status and next try and
 * reads the answer, so the recording screen of velista `0126` shows the same
 * warning with its own sentence.
 */
@Component({
  selector: 'lib-unsaved-dialog',
  imports: [RokuTranslatorPipe],
  templateUrl: './unsaved-dialog.html',
  styleUrl: './unsaved-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'stay.emit()',
  },
})
export class UnsavedDialog {
  /** Where the saver stands. */
  readonly status = input.required<WalkSaveStatus>();

  /** When the saver tries again, as epoch milliseconds, or null. */
  readonly nextTryAt = input<number | null>(null);

  /** The sentence of what is unsent. The edit page's by default. */
  readonly bodyKey = input('shopMapEdit.unsaved.body');

  /** Whether Leave anyway is offered. */
  readonly leavable = input(true);

  /** OK: stay on the page. */
  readonly stay = output<void>();

  /** Leave anyway, without what is unsent. */
  readonly leave = output<void>();

  private readonly _ok = viewChild<ElementRef<HTMLButtonElement>>('ok');
  private readonly _now = signal(Date.now());

  protected readonly seconds = computed(() => {
    const at = this.nextTryAt();
    return at === null
      ? null
      : Math.max(1, Math.ceil((at - this._now()) / 1000));
  });

  constructor() {
    const tick = setInterval(() => this._now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    afterNextRender(() => this._ok()?.nativeElement.focus());
  }
}
