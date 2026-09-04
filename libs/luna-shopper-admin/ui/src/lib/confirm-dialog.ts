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
  imports: [RokuTranslatorPipe],
  template: `
    <div class="panel">
      <h2 id="confirm-heading">{{ headingKey() | rokuT }}</h2>
      <p>{{ bodyKey() | rokuT: bodyArgs() }}</p>

      <div class="controls">
        <button
          (click)="confirm.emit()"
          [disabled]="busy()"
          #confirmButton
          class="danger"
          type="button"
        >
          {{ (busy() ? busyKey() : confirmKey()) | rokuT }}
        </button>
        <button (click)="dismiss.emit()" [disabled]="busy()" type="button">
          {{ 'resource.action.cancel' | rokuT }}
        </button>
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
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.danger {
      border-color: transparent;
      background: var(--admin-danger);
      font-weight: 600;
      color: var(--admin-danger-ink);
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

  readonly confirm = output<void>();
  readonly dismiss = output<void>();

  private readonly _confirmButton =
    viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  ngAfterViewInit(): void {
    // The keyboard follows the dialog. Without this the focus is left on the
    // control that opened it, behind a cover, and Tab walks into content the
    // operator cannot see.
    this._confirmButton()?.nativeElement.focus();
  }
}
