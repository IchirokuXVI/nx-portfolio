import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, inject, input } from '@angular/core';

/**
 * The cross that empties a field, and the focus rule every one of them shares.
 *
 * A field somebody uses more than once gets one, so that the next search does not
 * start by deleting the last one a character at a time. The click handler on the
 * button does the emptying; this directive only decides where focus goes.
 *
 * **A press never moves focus.** The cross sits inside the field, and a tap on it
 * would otherwise blur the input and drop the phone's keyboard just as somebody is
 * about to type again. `preventDefault` on `mousedown` keeps focus where it was, so
 * an open keyboard stays open and a closed one stays closed. Opening the keyboard on
 * a press that only meant to clear would be the opposite mistake.
 *
 * **A keyboard press hands focus to the field.** The cross disappears with the text,
 * and focus on a removed button falls to the page body. When the cross itself has
 * focus, which only Tab can give it since a press never focuses it, the field gets
 * focus back.
 */
@Directive({
  selector: 'button[libClearsField]',
  host: {
    '(mousedown)': '$event.preventDefault()',
    '(click)': 'onClick()',
  },
})
export class ClearsField {
  /** The input this cross empties. */
  readonly field = input.required<HTMLInputElement>({
    alias: 'libClearsField',
  });

  private readonly _host = inject<ElementRef<HTMLButtonElement>>(ElementRef);
  private readonly _document = inject(DOCUMENT);

  protected onClick(): void {
    if (this._document.activeElement === this._host.nativeElement) {
      this.field().focus();
    }
  }
}
