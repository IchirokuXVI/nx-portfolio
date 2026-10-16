import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { EyeIcon } from '../icons/icons';

const MINUTE_MS = 60_000;

/** The sentence for the time left, as a key and its numbers. */
export interface TimeLeftCopy {
  readonly key: string;
  readonly params: Readonly<Record<string, number>>;
}

/**
 * The time a support session has left, as the strip says it (velista `0133`, target 5):
 * "1 h 42 min left", then "42 min left", then "Less than a minute left".
 *
 * Whole minutes, rounded down, so the number never promises a minute that is not
 * there. A whole hour reads "1 h left" rather than "1 h 0 min left". Pure and
 * exported, so the three boundaries are tested without a clock.
 */
export function timeLeftCopy(untilMs: number, nowMs: number): TimeLeftCopy {
  const minutes = Math.floor(Math.max(0, untilMs - nowMs) / MINUTE_MS);

  if (minutes < 1) {
    return { key: 'support.strip.leftUnderMinute', params: {} };
  }

  if (minutes < 60) {
    return { key: 'support.strip.leftMinutes', params: { minutes } };
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? { key: 'support.strip.leftHours', params: { hours } }
    : {
        key: 'support.strip.leftHoursMinutes',
        params: { hours, minutes: rest },
      };
}

/**
 * The strip at the top of every screen while an operator has the app open as a user
 * (velista `0133`, target 5).
 *
 * One row: the eye, "Viewing as **name**", the time left and "End". The name takes the
 * room that is left and ends in an ellipsis, and the time and the button never shrink.
 * "End" is its only control. There is no close control, and no setting hides it.
 *
 * **Not a live region.** The time changes on the minute, and a screen reader that
 * announced each change would talk over the app for two hours. The strip is the first
 * thing in the document, so it is read one time as the page loads, in reading order,
 * and it is a labelled region so it can be found again.
 *
 * Presentational (rule D1): it takes the name and the deadline and says that "End" was
 * pressed. Its own clock is the one thing it keeps, because the time it shows is a
 * fact about this component and nothing else reads it.
 */
@Component({
  selector: 'lib-support-strip',
  imports: [EyeIcon, RokuTranslatorPipe],
  template: `
    <section [attr.aria-label]="'support.strip.label' | rokuT" class="strip">
      <lib-eye-icon class="eye" />
      <p class="who">
        {{ 'support.strip.viewingAs' | rokuT }} <b>{{ username() }}</b>
      </p>
      <p class="left">{{ left().key | rokuT: left().params }}</p>
      <button (click)="end.emit()" class="end" type="button">
        <span class="end-face">{{ 'support.strip.end' | rokuT }}</span>
      </button>
    </section>
  `,
  styleUrl: './support-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportStrip {
  readonly username = input.required<string>();
  readonly until = input.required<Date>();

  /** "End" was pressed. Whoever holds the session ends it. */
  readonly end = output<void>();

  private readonly _now = signal(Date.now());
  private _tick: ReturnType<typeof setTimeout> | null = null;

  readonly left = computed(() =>
    timeLeftCopy(this.until().getTime(), this._now())
  );

  constructor() {
    // On the minute: the next tick is when the whole number of minutes left drops.
    effect(() => {
      const until = this.until().getTime();
      untracked(() => this._schedule(until));
    });

    inject(DestroyRef).onDestroy(() => this._stop());
  }

  private _schedule(until: number): void {
    this._stop();

    const now = Date.now();
    this._now.set(now);

    const remaining = until - now;
    if (remaining < MINUTE_MS) {
      // "Less than a minute left" until the session ends, and the end is not this
      // component's to draw.
      return;
    }

    const delay = (remaining % MINUTE_MS) + 1;
    this._tick = setTimeout(() => this._schedule(until), delay);
  }

  private _stop(): void {
    if (this._tick !== null) {
      clearTimeout(this._tick);
      this._tick = null;
    }
  }
}
