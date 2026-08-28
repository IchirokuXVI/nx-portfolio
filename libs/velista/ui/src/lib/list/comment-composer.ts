import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { COMMENT_BODY_MAX_LENGTH } from '@portfolio/velista/models';
import { SendIcon } from '../icons/icons';

/**
 * Saying something about a line.
 *
 * A textarea rather than the single line input the line composer uses, and the
 * difference is what is being written: a line is a thing to buy and a comment is a
 * sentence about one, so it wraps and it grows.
 *
 * **No longer offered to a reader.** `comment.add` used to require only an approved
 * membership on the zone, which made this the one thing somebody with read access could
 * really do. Backend plan 0036 section 4 narrows it to `WRITE` or `DECIDE`, so read
 * means read here as well, and the sheet draws this component only for `canComment`
 * (velista plan 0030, section 3.1). The decision belongs to the container, as the line
 * composer's does: this one is simply not rendered, and a sentence takes its place so
 * the sheet does not end in nothing.
 *
 * ## The button is the height of the box, and it is a glyph
 *
 * It used to be `min-height: var(--app-touch-target)` next to a two row textarea, on a
 * row aligned to `flex-end`. So it was noticeably shorter than the thing it belonged
 * to and sat against its bottom edge, which reads as two controls that happen to be
 * adjacent rather than one composer. `align-items: stretch` makes the pair one block,
 * and stretch also means the button keeps matching if the textarea's rows ever change.
 *
 * A tall button wants a glyph and not a word: **Send** across the middle of a 60px
 * square is a label looking for its control. So the plane is drawn and the word is the
 * `aria-label`, which is also what a tooltip-less icon button owes a screen reader.
 */
@Component({
  selector: 'lib-comment-composer',
  imports: [RokuTranslatorPipe, SendIcon],
  template: `
    <form (submit)="onSubmit($event)" class="composer">
      <textarea
        (input)="onInput($event)"
        [attr.aria-label]="'list.comments.placeholder' | rokuT"
        [attr.maxlength]="maxLength"
        [placeholder]="'list.comments.placeholder' | rokuT"
        [value]="body()"
        #field
        class="field"
        name="body"
        rows="2"
      ></textarea>

      <button
        [attr.aria-label]="'list.comments.send' | rokuT"
        [disabled]="!canSubmit() || busy()"
        class="send"
        type="submit"
      >
        <lib-send-icon class="glyph" />
      </button>
    </form>
  `,
  styleUrl: './comment-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentComposer {
  readonly busy = input(false);

  readonly submitted = output<string>();

  readonly body = signal('');
  readonly maxLength = COMMENT_BODY_MAX_LENGTH;

  readonly canSubmit = computed(() => this.body().trim() !== '');

  private readonly _field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  onInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  /**
   * The form's own submit, for the reason `LineComposer.onSubmit` gives at length:
   * `(ngSubmit)` is `NgForm`'s output and needs `FormsModule`, which this composer
   * neither imports nor wants, so binding it would leave the native submit to run and
   * reload the page.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.submitted.emit(this.body().trim());
    this.body.set('');
    this._field()?.nativeElement.focus();
  }
}
