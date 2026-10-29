import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { handleBackWhile } from '@portfolio/velista/platform';
import { CloseIcon } from '../icons/icons';

/**
 * A product's photo drawn large, over a dimmed screen, after a press on its
 * picture in a row.
 *
 * **Not a sheet.** A sheet is a route with its own URL, and this shows nothing
 * the row did not already hold: the same photo, bigger. So it is part of the
 * row, as "Leave without saving?" is part of its page.
 *
 * **A native `dialog`, opened modal.** The browser then does what a card drawn by
 * hand has to rebuild: the page behind is inert, the focus moves into the dialog
 * and goes back to the picture after it, and Escape and the back gesture of
 * Android close it.
 *
 * **A press anywhere closes it.** Nothing in it can be pressed but the cross, so
 * a press on the photo or on the dimmed screen has no other job.
 *
 * **Every event stops here.** The dialog stands in the top layer, but in the DOM
 * it is still inside the row, and a press or a key that bubbled out would also
 * open the row's own sheet.
 */
@Component({
  selector: 'lib-photo-viewer',
  imports: [CloseIcon, RokuTranslatorPipe],
  template: `
    <dialog
      (click)="$event.stopPropagation(); close()"
      (close)="closed.emit()"
      (keydown)="$event.stopPropagation()"
      (pointerdown)="$event.stopPropagation()"
      [attr.aria-label]="name()"
      #dialog
      class="viewer"
      tabindex="-1"
    >
      <figure class="panel">
        <!-- No referrer (velista 0172, D5): the photo is fetched from the chain's
             own site, and the address of the page somebody is reading is not its
             business. -->
        <img
          [alt]="name()"
          [src]="src()"
          class="photo"
          decoding="async"
          referrerpolicy="no-referrer"
        />
        <figcaption class="name">{{ name() }}</figcaption>
      </figure>
      <button
        [attr.aria-label]="'photo.close' | rokuT"
        class="close"
        type="button"
      >
        <lib-close-icon aria-hidden="true" class="close-glyph" />
      </button>
    </dialog>
  `,
  styleUrl: './photo-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewer {
  /** The photo. */
  readonly src = input.required<string>();

  /** The product's name: the photo's text alternative and the dialog's name. */
  readonly name = input.required<string>();

  /** The dialog closed, by any route. The owner removes the viewer. */
  readonly closed = output<void>();

  private readonly _dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // A native back press closes the viewer, as Escape does (velista `0166`).
    handleBackWhile(
      () => true,
      () => this.close()
    );

    afterNextRender(() => {
      const dialog = this._dialog().nativeElement;
      // jsdom has no `showModal`. The attribute alone draws it, as a spec needs.
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    });
  }

  protected close(): void {
    const dialog = this._dialog().nativeElement;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      this.closed.emit();
    }
  }
}
