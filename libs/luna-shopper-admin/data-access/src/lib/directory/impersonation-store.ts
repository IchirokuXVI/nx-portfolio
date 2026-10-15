import { computed, inject, Injectable, signal, untracked } from '@angular/core';
import { SessionStore } from '../auth/session-store';
import { DIRECTORY_SERVICE } from './directory-service';

/** One answer, and the operator it was given to. */
interface Answer {
  readonly operator: string | null;
  readonly enabled: boolean;
}

/**
 * Whether this deployment allows support sessions, read one time for the
 * session of the operator (admin plan 0062, target state 1).
 *
 * The answer is kept with the operator who asked. A sign out and a sign in as
 * somebody else ask again, and until the new answer arrives the action is not
 * offered. A read that fails counts as `false`: an action that is offered and
 * then refused teaches an operator to ignore the refusal.
 *
 * The session store is optional, so that a spec of a screen needs no session.
 * There the answer belongs to the operator `null`, which is the only one.
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationStore {
  private readonly _directory = inject(DIRECTORY_SERVICE);
  private readonly _sessions = inject(SessionStore, { optional: true });
  private readonly _answer = signal<Answer | null>(null);
  private _reading: {
    readonly operator: string | null;
    readonly done: Promise<void>;
  } | null = null;

  /** Whether the action may be offered to the operator signed in now. */
  readonly enabled = computed(() => {
    const answer = this._answer();
    return (
      answer !== null && answer.enabled && answer.operator === this._operator()
    );
  });

  /**
   * Ask, unless this operator already asked. Idempotent: a second caller gets
   * the same promise.
   */
  load(): Promise<void> {
    const operator = untracked(() => this._operator());
    if (this._sessions !== null && operator === null) {
      return Promise.resolve();
    }
    if (this._reading?.operator === operator) {
      return this._reading.done;
    }

    const done = this._directory.impersonationEnabled().then(
      (enabled) => this._answer.set({ operator, enabled }),
      () => this._answer.set({ operator, enabled: false })
    );
    this._reading = { operator, done };
    return done;
  }

  private _operator(): string | null {
    return this._sessions?.session()?.adminId ?? null;
  }
}
