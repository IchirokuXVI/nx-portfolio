import {
  DestroyRef,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * Where the realtime socket stands.
 *
 * - `off`: no session, or a server render, so there is nothing to be live about.
 * - `down`: a session wants a socket and has none that works, which covers connecting,
 *   retrying and the pause while the page is hidden.
 * - `up`: the socket is connected.
 */
export type LivePhase = 'off' | 'down' | 'up';

/**
 * How long the phase has to stay `down` before the header says so (plan 0168, D6).
 *
 * A cold start spends about a second connecting and an ordinary resume about 250 ms
 * (report `2026-10-23-velista-socket-reconnect-on-android.md`, section 3.1). A mark
 * bound to the bare phase would flash on both. Two seconds is longer than any healthy
 * reconnect in those traces.
 */
export const ATTENTION_AFTER_MS = 2_000;

/**
 * The realtime socket's phase, held where `ui` can read it (plan 0168, D5).
 *
 * `RealtimeSocket` in `data-access` writes it and `PageHeader` in `ui` draws from it,
 * and `ui` may not import `data-access` (plan 0004, section 3.2). The precedent is
 * `ConnectionState`: state every screen draws, written below, held here, with no HTTP
 * in it.
 *
 * It is not `ConnectionState` and never feeds it. That service raises the blocking
 * screen for a lost network, and a socket that is down while every REST call works is
 * a much smaller thing, worth one quiet mark and nothing more.
 */
@Injectable({ providedIn: 'root' })
export class LiveConnection {
  private readonly _browser = inject(BrowserFacade);

  private readonly _phase = signal<LivePhase>('off');
  private readonly _attention = signal(false);

  private _timer: ReturnType<typeof setTimeout> | null = null;

  /** The phase the socket last reported. `off` until it reports, so a server render draws nothing. */
  readonly phase: Signal<LivePhase> = this._phase.asReadonly();

  /**
   * Whether the phase has been `down` for longer than {@link ATTENTION_AFTER_MS}.
   *
   * False the moment the phase is `up` or `off`, with no delay in that direction: a
   * mark that lingers after the socket is back says something false.
   */
  readonly attention: Signal<boolean> = this._attention.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this._clearTimer());
  }

  /**
   * Record the socket's phase.
   *
   * A repeated `down` keeps the clock it started with. A socket that retries every few
   * seconds reports `down` on each attempt, and a clock that restarted on every report
   * would hold the mark back for as long as the retries went on.
   */
  report(phase: LivePhase): void {
    if (phase === this._phase()) {
      return;
    }

    this._phase.set(phase);
    this._clearTimer();

    if (phase !== 'down') {
      this._attention.set(false);
      return;
    }

    // A server render has no one to show a mark to, and a timer there would keep the
    // render waiting for it.
    if (!this._browser.isBrowser) {
      return;
    }

    this._timer = setTimeout(() => {
      this._timer = null;
      this._attention.set(true);
    }, ATTENTION_AFTER_MS);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
