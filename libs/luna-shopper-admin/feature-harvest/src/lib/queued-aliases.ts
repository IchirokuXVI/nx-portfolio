import { signal, type Signal } from '@angular/core';

/**
 * How many printed names are waiting for a person, for the navigation badge
 * (admin plan 0010, section 4).
 *
 * A module level signal, which is a global, and it is one on purpose. The badge
 * belongs to `HARVEST_LINKS`, which is a module level constant read once by
 * `app-providers.ts`; a link in that list has no injector to reach a service
 * through, and giving one to it would mean a token, a provider and a second
 * registry for one number. This app is one operator in one browser with one
 * running instance, so a module scoped signal and a root scoped service differ
 * only in ceremony.
 *
 * `null` means **not counted yet** rather than none, and the difference is the
 * point: the queue is per chain by construction, so until the operator has
 * chosen one there is no count to show and a `0` would say the queue was
 * drained. The badge draws nothing until a read has answered.
 */
const _queued = signal<number | null>(null);

/** What the badge shows. `null` until a chain has been chosen and read. */
export const queuedAliases: Signal<number | null> = _queued.asReadonly();

/**
 * Record what the queue's first page showed.
 *
 * Called by the queue itself, on every load and after every decision, so the
 * badge and the page can never disagree: they are the same number, and the page
 * is the only thing that knows which chain it is for.
 */
export function observeQueuedAliases(count: number | null): void {
  _queued.set(count);
}
