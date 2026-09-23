import { afterNextRender, type ElementRef, type Signal } from '@angular/core';

/**
 * Move focus to a screen's heading once it has rendered (velista `0098`, section 9).
 *
 * Each step is its own page, and a screen reader that stays on the button just pressed
 * does not hear that the page changed. Landing on the `h1`, which carries
 * `tabindex="-1"`, reads out the new question first.
 *
 * Call it from a constructor: `afterNextRender` needs an injection context.
 */
export function focusHeading(
  heading: Signal<ElementRef<HTMLElement> | undefined>
): void {
  afterNextRender(() => heading()?.nativeElement.focus());
}
