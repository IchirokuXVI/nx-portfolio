import { signal } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';

/** A page that can say whether it may be left. */
export interface LeaveAware {
  /** Answers `true` when the route may be left. It may ask the operator first. */
  canLeave(): boolean | Promise<boolean>;
}

/**
 * Leaving a record with changes asks first (admin plan 0053, section 2.6).
 *
 * The back link, a tab, the rail, a link in the page and the Back button of
 * the browser are all one navigation to the router, so one guard covers them.
 * The page holds the question and its answer. The guard only asks the page.
 *
 * The router also runs it when the same route is opened for another ID, so
 * going from one record to the next asks as well.
 *
 * A component that cannot answer may be left. That is a route some other
 * component was mounted at, and it has no draft this guard knows of.
 */
export const recordLeaveGuard: CanDeactivateFn<LeaveAware> = (component) =>
  typeof component?.canLeave === 'function' ? component.canLeave() : true;

/**
 * The leave question of a form that is not a page (admin plan 0060): the
 * form of a price rule inside its row, and the form of a price inside its
 * panel.
 *
 * It holds whether the question is up and what the operator answered. The
 * form draws the dialog while {@link asking} is `true`, and hands its two
 * buttons to {@link answer}. `RecordPage` holds its own question, because it
 * also asks for its Details tab and for Cancel.
 */
export class LeaveQuestion implements LeaveAware {
  private readonly _asking = signal(false);
  private _pending: Promise<boolean> | null = null;
  private _resolve: ((leave: boolean) => void) | null = null;

  /** Whether the question is on the screen. */
  readonly asking = this._asking.asReadonly();

  constructor(
    /** Whether leaving now would lose something the operator typed. */
    private readonly _dirty: () => boolean
  ) {}

  /**
   * Nothing changed: at once. Something changed: the question, and what the
   * operator chose. A second navigation while the question is up waits for
   * the same answer.
   */
  canLeave(): boolean | Promise<boolean> {
    if (!this._dirty()) {
      return true;
    }
    this._pending ??= new Promise<boolean>((resolve) => {
      this._resolve = resolve;
      this._asking.set(true);
    });
    return this._pending;
  }

  /** The operator chose. A yes throws nothing away: the form goes with it. */
  answer(leave: boolean): void {
    const resolve = this._resolve;
    this._resolve = null;
    this._pending = null;
    this._asking.set(false);
    resolve?.(leave);
  }
}
