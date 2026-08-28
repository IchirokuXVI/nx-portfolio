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
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** How the last ask went, as the container knows it. */
export type ResendState = 'ready' | 'sent' | 'refused';

/**
 * Asking for another confirmation email, as one sentence in three states.
 *
 * **A sentence and not a button, by decision (user, 2026-08-26.)** Confirming an email
 * is optional in this product, so the affordance must not compete with the group
 * actions below it, and a full width button would say otherwise. Ready reads
 * "Did not get it? Send it again", with only the action words carrying the accent.
 *
 * ## Rule C3: the countdown is the server's number
 *
 * The `verifyResend` bucket is **three per ten minutes**, so the fourth ask in a window
 * waits far longer than a minute. A hardcoded sixty would count down to zero, invite
 * the tap, and fail again, which is worse than not offering it at all. So this renders
 * whatever wait it was told about and nothing else, and when it was told none it says
 * so without a clock rather than inventing one.
 *
 * The number arrives in the response body rather than a `Retry-After` header, because
 * this API exposes no custom response headers cross origin (plan 0009, section 5.7).
 *
 * ## Why the interval lives here
 *
 * It is the only state in the whole flow that changes on its own, and it belongs to
 * whichever copy of this sentence is on screen: the nudge on the dashboard and the one
 * on the expired screen count independently and are never both mounted. `ZoneStore` is
 * not involved. One interval, cleared on destroy, and a spec proves the clearing rather
 * than the reading of this comment.
 *
 * `setInterval` without `BrowserFacade` is safe here in a way it would not be for a
 * browser-only API: the countdown can only begin in response to a tap, so it cannot be
 * scheduled during a server render, and the timer is a platform primitive rather than
 * something only a browser has.
 */
@Component({
  selector: 'lib-resend-sentence',
  imports: [RokuTranslatorPipe],
  templateUrl: './resend-sentence.html',
  styleUrl: './resend-sentence.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResendSentence {
  /** How the last ask went. `ready` includes never having asked. */
  readonly state = input.required<ResendState>();

  /**
   * The wait the **server** returned, in seconds, or null when it named none.
   *
   * Null is a real state and not a missing value: without a number there is nothing
   * honest to count down, so the sentence falls back to copy that promises no
   * particular moment.
   */
  readonly waitSeconds = input<number | null>(null);

  /**
   * Which question introduces the action.
   *
   * Two, because the two places this appears are asking different things. In the
   * dashboard nudge the email has just been sent, so it is "Did not get it?". On the
   * expired link screen it went out long ago and the question is whether the person
   * still wants to confirm at all.
   */
  readonly promptKey = input<
    'auth.resend.prompt' | 'auth.resend.promptExpired'
  >('auth.resend.prompt');

  readonly resend = output<void>();

  /** Seconds left, or null when nothing is being counted. */
  private readonly _remaining = signal<number | null>(null);

  /** Whether a countdown ran all the way out, which is what returns this to Ready. */
  private readonly _elapsed = signal(false);

  private _timer: ReturnType<typeof setInterval> | null = null;

  /**
   * What is actually rendered.
   *
   * Falls back to `ready` the moment a countdown runs out, whatever the container
   * still believes: the wait is over, so offering the action again is the truth, and
   * making the container watch a clock to discover that would put the same interval in
   * two places.
   *
   * A state with no wait from the server does **not** fall back, and that is the
   * difference rule C3 turns on: not being told how long to wait is not the same as
   * having waited. Offering the action straight back would invite a tap that is
   * certain to be refused.
   */
  readonly shown = computed<ResendState>(() =>
    this._elapsed() ? 'ready' : this.state()
  );

  /** The wait as `m:ss`, which is what the copy interpolates. */
  readonly clock = computed(() => {
    const remaining = this._remaining();
    if (remaining === null) {
      return '';
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  });

  constructor() {
    effect(() => {
      const state = this.state();
      const wait = this.waitSeconds();

      // Ready never counts, and a state with no number from the server counts nothing
      // either: rule C3 has no fallback duration to reach for.
      this._restart(state === 'ready' || wait === null ? null : wait);
    });

    inject(DestroyRef).onDestroy(() => this._stop());
  }

  private _restart(seconds: number | null): void {
    this._stop();
    this._remaining.set(seconds);
    this._elapsed.set(false);

    if (seconds === null) {
      return;
    }

    this._timer = setInterval(() => {
      this._remaining.update((current) => {
        if (current === null || current <= 1) {
          this._stop();
          this._elapsed.set(true);
          return null;
        }

        return current - 1;
      });
    }, 1000);
  }

  private _stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
