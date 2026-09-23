import {
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  untracked,
} from '@angular/core';
import { TourAnchors } from './tour-anchors';
import type { TourAnchorId } from './tour-stops';

/**
 * Declares an element as something the tour can light (velista `0099`, section 2).
 *
 * `<nav libTourAnchor="nav">`. An attribute and never a wrapper, so no screen changes
 * shape to carry it. The element registers while it exists and withdraws when it goes.
 *
 * **Null declares nothing**, which is how a repeated component carries the attribute
 * on one instance only: a group card binds `'group-lists'` on the first card with
 * lists and null on the rest, rather than every card claiming the same id.
 *
 * Why a declaration rather than a query: the screens live in six lazy libraries, and a
 * query by class or test id breaks silently the first time a wrapper is renamed, and
 * finds nothing at all on a screen that has not loaded yet.
 */
@Directive({
  selector: '[libTourAnchor]',
  host: {
    // The lit control is decoration while its card is up, and the card's own words
    // name it (section 10).
    '[attr.aria-hidden]': 'lit() ? "true" : null',
  },
})
export class TourAnchor {
  private readonly _anchors = inject(TourAnchors);
  private readonly _element = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly libTourAnchor = input.required<TourAnchorId | null>();

  protected readonly lit = computed(() => {
    const id = this.libTourAnchor();
    return (
      id !== null &&
      this._anchors.lit() === id &&
      this._anchors.elements().get(id) === this._element.nativeElement
    );
  });

  constructor() {
    // An effect, so an id that changes (a card that stops being the first with lists)
    // withdraws the old one and declares the new one. Its cleanup runs on destroy too.
    //
    // The registration is `untracked`: it reads the registry and writes it, and an
    // effect that tracked that read would run itself again on its own write.
    effect((onCleanup) => {
      const id = this.libTourAnchor();
      if (id === null) {
        return;
      }

      const element = this._element.nativeElement;
      if (untracked(() => this._anchors.register(id, element))) {
        onCleanup(() => untracked(() => this._anchors.unregister(id, element)));
      }
    });
  }
}
