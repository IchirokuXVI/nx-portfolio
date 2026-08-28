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

/**
 * Saying something about a line.
 *
 * A textarea rather than the single line input the line composer uses, and the
 * difference is what is being written: a line is a thing to buy and a comment is a
 * sentence about one, so it wraps and it grows.
 *
 * **Offered to a reader too.** `comment.add` requires only an approved membership on
 * the zone, not write access on the list, so this is the one thing somebody with read
 * access can actually do and it stays available in the read only state (section 3.2).
 */
@Component({
  selector: 'lib-comment-composer',
  imports: [RokuTranslatorPipe],
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

      <button [disabled]="!canSubmit() || busy()" class="send" type="submit">
        {{ 'list.comments.send' | rokuT }}
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
