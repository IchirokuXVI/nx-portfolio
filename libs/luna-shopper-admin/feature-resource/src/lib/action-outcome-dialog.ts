import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
  type AfterViewInit,
  type Type,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { keepTabInside } from '@portfolio/luna-shopper-admin/ui';

/**
 * The panel a named action answered with, in a dialog of its own (backend
 * plan 0210).
 *
 * The frame of the confirmation dialog, with the panel where the sentence and
 * the two buttons would be, and one way out. The panel is created when the
 * dialog opens and destroyed when it closes, so whatever it was handed lives
 * exactly as long as the dialog: the page holds the outcome in a signal and
 * drops it on close, and nothing else holds it.
 *
 * Escape closes. Tab stays inside, because the page behind is covered.
 */
@Component({
  selector: 'lib-action-outcome-dialog',
  imports: [NgComponentOutlet, RokuTranslatorPipe],
  template: `
    <div #frame class="panel">
      <h2 #heading id="outcome-heading" tabindex="-1">
        {{ headingKey() | rokuT: headingArgs() }}
      </h2>
      <ng-container *ngComponentOutlet="panel(); inputs: inputs()" />
      <div class="controls">
        <button (click)="closed.emit()" type="button" data-close>
          {{ 'resource.action.close' | rokuT }}
        </button>
      </div>
    </div>
  `,
  host: {
    '(keydown.escape)': 'closed.emit()',
    // On the host, which the keys reach from whatever has the focus inside.
    '(keydown)': 'trap($event)',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'outcome-heading',
    'data-action-outcome': '',
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
      background: var(--admin-surface);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      inline-size: 100%;
      max-inline-size: 36rem;
      max-block-size: 100%;
      overflow-y: auto;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    h2:focus {
      outline: none;
    }

    .controls {
      display: flex;
      justify-content: flex-end;
    }

    button {
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionOutcomeDialog implements AfterViewInit {
  /** A translation key. */
  readonly headingKey = input.required<string>();
  readonly headingArgs = input<Record<string, string | number>>({});
  readonly panel = input.required<Type<unknown>>();
  readonly inputs = input<Readonly<Record<string, unknown>>>({});

  readonly closed = output<void>();

  private readonly _frame =
    viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly _heading =
    viewChild.required<ElementRef<HTMLElement>>('heading');

  ngAfterViewInit(): void {
    // The heading, rather than the first control: the operator reads what
    // this is before Tab takes them to a button.
    this._heading().nativeElement.focus();
  }

  trap(event: KeyboardEvent): void {
    keepTabInside(event, this._frame().nativeElement);
  }
}
