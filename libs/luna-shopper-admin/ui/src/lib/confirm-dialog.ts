import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
  type AfterViewInit,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * Asking before something is lost.
 *
 * Two callers, and they are the two irreversible things in this plan: deleting
 * a row, and leaving a form with unsaved work in it. Both are cheap to confirm
 * and expensive to undo, and neither has an undo at all.
 *
 * Written rather than `window.confirm`, which cannot be translated, cannot be
 * styled to say which environment the operator is about to delete something in,
 * and cannot be driven from a spec.
 *
 * Escape dismisses, and dismissing is the safe answer: this dialog only ever
 * guards an action that has not happened yet, so a keystroke that means "get me
 * out of here" must never be the one that goes through with it.
 */
@Component({
  selector: 'lib-confirm-dialog',
  imports: [NgTemplateOutlet, RokuTranslatorPipe],
  template: `
    <div class="panel">
      <h2 id="confirm-heading">{{ headingKey() | rokuT: headingArgs() }}</h2>
      <p>{{ bodyKey() | rokuT: bodyArgs() }}</p>

      <!-- Whatever the caller has to put beside the sentence. The shop mapping
           of plan 0011 puts a link to the run screen here, because what it is
           warning about is fixed by starting a run and a warning with no way to
           act on it is an apology. -->
      <ng-content />

      <!-- The button that dismisses, drawn in one place and put before or
           after the other one. -->
      <ng-template #dismissing>
        @if (dismissKey(); as key) {
          <button
            (click)="dismiss.emit()"
            [class.primary]="prefer() === 'dismiss'"
            [disabled]="busy()"
            #dismissButton
            type="button"
            data-dismiss
          >
            {{ key | rokuT }}
          </button>
        }
      </ng-template>

      <div class="controls">
        @if (order() === 'dismiss-first') {
          <ng-container [ngTemplateOutlet]="dismissing" />
        }
        <button
          (click)="confirm.emit()"
          [class.danger]="tone() === 'danger'"
          [class.primary]="tone() === 'primary'"
          [disabled]="busy()"
          #confirmButton
          type="button"
          data-confirm
        >
          {{ (busy() ? busyKey() : confirmKey()) | rokuT: confirmArgs() }}
        </button>
        @if (order() === 'confirm-first') {
          <ng-container [ngTemplateOutlet]="dismissing" />
        }
      </div>
    </div>
  `,
  host: {
    '(keydown.escape)': 'dismiss.emit()',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'confirm-heading',
  },
  styles: `
    :host {
      position: fixed;
      z-index: 90;
      display: flex;
      align-items: center;
      justify-content: center;
      inset: 0;
      padding: var(--admin-space-4);
      /* Opaque, like the re-authentication overlay: a translucent cover reads as
         obscured while staying legible to a phone camera. */
      background: var(--admin-surface);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      inline-size: 100%;
      max-inline-size: 26rem;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      cursor: pointer;
    }

    button.danger {
      border-color: transparent;
      background: var(--admin-danger);
      font-weight: 600;
      color: var(--admin-danger-ink);
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog implements AfterViewInit {
  readonly headingKey = input.required<string>();
  readonly bodyKey = input.required<string>();
  readonly bodyArgs = input<Record<string, string | number>>({});
  readonly confirmKey = input('resource.action.confirm');
  readonly busyKey = input('resource.action.working');
  readonly busy = input(false);
  /**
   * What the button that goes through with it looks like.
   *
   * `danger` by default, because for a long time every caller was deleting a
   * row or discarding a form. Admin plan 0011 brought the first one that is
   * neither: mapping a source's shop to one of ours is undone by unmapping it,
   * and a red button on a reversible act teaches an operator to ignore red.
   */
  readonly tone = input<'danger' | 'primary'>('danger');
  /** What to put into the heading: "Delete the brand Hdo.?" */
  readonly headingArgs = input<Record<string, string | number>>({});
  /** What to put into the words of the button that goes through with it. */
  readonly confirmArgs = input<Record<string, string | number>>({});
  /**
   * The words of the button that dismisses (admin plan 0053, section 2.5):
   * "Stay here", "Keep it". `null` draws no such button, for a dialog that
   * only says something and has one way out.
   */
  readonly dismissKey = input<string | null>('resource.action.cancel');
  /**
   * The button the operator is led to. It has the focus, and `dismiss` also
   * draws the dismissing button as the primary one.
   *
   * `dismiss` is for a question whose safe answer is to stay: leaving a form
   * with changes in it.
   */
  readonly prefer = input<'confirm' | 'dismiss'>('confirm');
  /** Which button comes first. The one that goes through with it, as a rule. */
  readonly order = input<'confirm-first' | 'dismiss-first'>('confirm-first');

  readonly confirm = output<void>();
  readonly dismiss = output<void>();

  private readonly _confirmButton =
    viewChild<ElementRef<HTMLButtonElement>>('confirmButton');
  private readonly _dismissButton =
    viewChild<ElementRef<HTMLButtonElement>>('dismissButton');

  ngAfterViewInit(): void {
    // The keyboard follows the dialog. Without this the focus is left on the
    // control that opened it, behind a cover, and Tab walks into content the
    // operator cannot see.
    (
      (this.prefer() === 'dismiss' ? this._dismissButton() : undefined) ??
      this._confirmButton()
    )?.nativeElement.focus();
  }
}
