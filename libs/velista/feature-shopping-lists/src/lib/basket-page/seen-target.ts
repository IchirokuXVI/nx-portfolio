import {
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import { BrowserFacade } from '@portfolio/velista/platform';
import { ChangeAcknowledger } from './change-acknowledger';

/**
 * How much of a row has to be on screen before it counts as looked at.
 *
 * Half its height. A row whose top edge has just crawled past the tools bar has
 * not been read, and a row that has to be whole would never qualify on the one
 * at the bottom of a short viewport.
 */
const SEEN_RATIO = 0.5;

/**
 * Tell the acknowledger when a marked row is really in front of somebody
 * (velista `0093`, section 7).
 *
 * ## It registers only while the row is marked
 *
 * `active` is the row's own mark, so an ordinary row observes nothing at all: a
 * basket of forty rows would otherwise hold forty observers to answer a question
 * about the two that changed. The effect below adds and removes the observation
 * as the mark comes and goes, which is every basket read.
 *
 * ## It decides nothing
 *
 * It reports "this element is on screen" and no more. Whether that adds up to
 * somebody having seen a change is {@link ChangeAcknowledger}'s, which also
 * holds the document's visibility and the dwell. A directive per row deciding
 * for itself would send one request per row.
 *
 * `BrowserFacade.observeIntersection` and never `IntersectionObserver` here,
 * which is rule D2: no component in this app touches a browser global. Under a
 * server render it observes nothing and this row is never reported seen, which
 * is the quiet direction.
 */
@Directive({
  selector: '[libSeenTarget]',
})
export class SeenTarget {
  /** Whether this row carries a mark, and so is worth watching. */
  readonly libSeenTarget = input(false);

  private readonly _element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _browser = inject(BrowserFacade);
  private readonly _acknowledger = inject(ChangeAcknowledger);

  private _stop: (() => void) | null = null;

  constructor() {
    effect((onCleanup) => {
      const active = this.libSeenTarget();
      this._release();

      if (active) {
        this._stop = this._browser.observeIntersection(
          this._element.nativeElement,
          (intersecting) =>
            this._acknowledger.reportRowSeen(
              this._element.nativeElement,
              intersecting
            ),
          { threshold: SEEN_RATIO }
        );
      }

      onCleanup(() => this._release());
    });

    // A directive on a row inside an `@for`, so its `DestroyRef` really does
    // fire: it is the route's injector that never is, and this is a component
    // level one. Belt and braces beside the effect's own cleanup, because an
    // observer left behind holds the element out of the collector.
    inject(DestroyRef).onDestroy(() => this._release());
  }

  private _release(): void {
    this._stop?.();
    this._stop = null;
    // Reported as gone rather than silently dropped. A marked row scrolled off
    // and a marked row destroyed by a refetch are the same thing to the
    // acknowledger, and one that was never told would count a row that is not
    // there any more.
    this._acknowledger.reportRowSeen(this._element.nativeElement, false);
  }
}
