import { Injectable, signal, type Signal } from '@angular/core';
import type { TourAnchorId } from './tour-stops';

/**
 * The elements the tour can light, by the id each one declared (velista `0099`,
 * section 2).
 *
 * Apart from `TourStore` because it depends on nothing. `libTourAnchor` sits on
 * screens in six lazy libraries and in `ui`, and a directive that reached for the
 * router, the locale and the mount would need all three provided in every spec of
 * every one of those screens. This needs nothing, so it is root scoped and the
 * attribute costs a spec nothing.
 */
@Injectable({ providedIn: 'root' })
export class TourAnchors {
  private readonly _elements = signal<ReadonlyMap<TourAnchorId, HTMLElement>>(
    new Map()
  );

  private readonly _waiting = new Map<
    TourAnchorId,
    Set<(element: HTMLElement) => void>
  >();

  private readonly _lit = signal<TourAnchorId | null>(null);

  /** Every element registered now, by id. */
  readonly elements: Signal<ReadonlyMap<TourAnchorId, HTMLElement>> =
    this._elements.asReadonly();

  /** The id the card is lighting, or null. Read by the directive for `aria-hidden`. */
  readonly lit: Signal<TourAnchorId | null> = this._lit.asReadonly();

  /**
   * Declare an element, and say whether it was taken.
   *
   * **A second element with an id already held is refused loudly** (section 12). The
   * card would otherwise light whichever registered last, which is a fact about render
   * order and not about the screen. The first one stays.
   */
  register(id: TourAnchorId, element: HTMLElement): boolean {
    const held = this._elements().get(id);
    if (held === element) {
      return true;
    }

    if (held !== undefined) {
      console.error(
        `[tour] "${id}" is already declared by another element. The second one is ignored.`
      );
      return false;
    }

    this._elements.update((current) => new Map(current).set(id, element));

    const waiting = this._waiting.get(id);
    this._waiting.delete(id);
    waiting?.forEach((resolve) => resolve(element));
    return true;
  }

  /** Withdraw an element, if it is the one holding the id. */
  unregister(id: TourAnchorId, element: HTMLElement): void {
    if (this._elements().get(id) !== element) {
      return;
    }

    this._elements.update((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  /**
   * The element for an id, as soon as one registers, or null after `withinMs`.
   *
   * A timer rather than an effect, so the store can await it outside an injection
   * context and a spec can drive it with fake timers.
   */
  whenRegistered(
    id: TourAnchorId,
    withinMs: number
  ): Promise<HTMLElement | null> {
    const held = this._elements().get(id);
    if (held !== undefined) {
      return Promise.resolve(held);
    }

    return new Promise((resolve) => {
      const waiting = this._waiting.get(id) ?? new Set();
      const done = (element: HTMLElement | null): void => {
        clearTimeout(timer);
        waiting.delete(done);
        resolve(element);
      };
      const timer = setTimeout(() => done(null), withinMs);

      waiting.add(done);
      this._waiting.set(id, waiting);
    });
  }

  /** Say which id the card is lighting. Called by `TourStore` only. */
  light(id: TourAnchorId | null): void {
    this._lit.set(id);
  }
}
