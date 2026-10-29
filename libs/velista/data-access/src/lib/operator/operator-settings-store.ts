import {
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type { OperatorSettings } from '@portfolio/velista/models';
import {
  BackendReadiness,
  type ReadinessState,
} from '@portfolio/velista/platform';
import { OPERATOR_SETTINGS_SERVICE } from './operator-settings-service';

/** Where the read stands. `idle` until the backend has been ready once. */
export type OperatorSettingsState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * What this deployment states about itself, read once per document (velista `0172`,
 * target 1).
 *
 * The privacy policy and the terms are filled from it, plan `0173` reads the terms
 * version and the Google flag here, and plan `0174` the voice flag. One read and one
 * mapper for all three.
 *
 * ## When it reads
 *
 * The first time the backend is ready, which `BackendReadiness` says. Asking before
 * that would spend a request on a backend that has not answered its health probe, and
 * every page that reads these facts waits behind the startup gate anyway.
 *
 * A failed read is retried by {@link reload} and by the next **edge** into `ready`
 * (a connection that drops and comes back), and never by a timer: a backend that
 * cannot answer this route is not helped by being asked in a loop. A ready answer is
 * kept for the life of the document. The server caches it for five minutes, and none
 * of these facts changes while a person reads a page.
 *
 * ## Why app scoped and not root
 *
 * Rule D5, beside every other store: it resolves `OPERATOR_SETTINGS_SERVICE`, which
 * the app binds in its own injector, so at the root it would resolve the token's
 * default with no `HttpClient` behind it. `app-providers.ts` constructs it in an
 * environment initializer so the read goes out when the backend first answers, not
 * when somebody opens a legal page.
 */
@Injectable()
export class OperatorSettingsStore {
  private readonly _service = inject(OPERATOR_SETTINGS_SERVICE);
  private readonly _readiness = inject(BackendReadiness);

  private readonly _settings = signal<OperatorSettings | null>(null);
  private readonly _state = signal<OperatorSettingsState>('idle');

  /** The settings, or null until the first readable answer. */
  readonly settings: Signal<OperatorSettings | null> =
    this._settings.asReadonly();

  readonly state: Signal<OperatorSettingsState> = this._state.asReadonly();

  constructor() {
    // An edge into `ready`, read by hand. `onEdge` takes a counter, and readiness is a
    // state; the first run counts as an edge when the backend is already ready, which
    // is the case for a store constructed late.
    let previous: ReadinessState | null = null;
    effect(() => {
      const now = this._readiness.state();
      untracked(() => {
        const rose = now === 'ready' && previous !== 'ready';
        previous = now;
        const state = this._state();
        if (rose && (state === 'idle' || state === 'failed')) {
          void this._read();
        }
      });
    });
  }

  /**
   * Read again: the retry of a failed read, and the read after the server said the
   * terms moved (velista `0173`). While a read is in flight it does nothing, so a
   * second press cannot send a second request. Past the browser's cache, which would
   * otherwise answer with what the server said up to five minutes ago.
   */
  reload(): void {
    if (this._state() === 'loading') {
      return;
    }
    void this._read(true);
  }

  private async _read(fresh = false): Promise<void> {
    this._state.set('loading');
    try {
      const settings = await this._service.read(fresh ? { fresh } : undefined);
      if (settings === null) {
        this._fail();
        return;
      }
      this._settings.set(settings);
      this._state.set('ready');
    } catch {
      this._fail();
    }
  }

  /**
   * A failed read. When an earlier read succeeded, its answer still stands and the
   * state stays `ready`: a retry that failed has not made the facts untrue.
   */
  private _fail(): void {
    this._state.set(this._settings() === null ? 'failed' : 'ready');
  }
}
