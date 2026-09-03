import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * The chrome every decision queue shares (plan 0006, section 5).
 *
 * Three screens are decision queues rather than editors, and they have one
 * shape: a thing to look at, and confirm, reject or skip. What differs between
 * them is the thing, which is projected, so this file owns the part that must
 * not differ.
 *
 * Two properties are what the plan means by "built for repetition".
 *
 * **The next item comes up without navigating back to a list.** There is no list
 * here to go back to. Deciding removes the item and the one behind it becomes
 * the subject, so working through four thousand entries is one screen and not
 * four thousand round trips.
 *
 * **The primary action is reachable without aiming.** The action bar is fixed to
 * the bottom of the viewport on a narrow screen, the buttons fill the width, and
 * they are large enough to hit with a thumb without looking. An operator working
 * a queue is reading the item, not hunting for the button, and a queue whose
 * buttons move as the item's height changes makes them hunt on every single one.
 *
 * `skip` is offered on every queue, and it matters more than it looks. Without
 * it the only way past an item nobody can judge is to answer it wrongly, and
 * these queues write to the catalog.
 */
@Component({
  selector: 'lib-queue-frame',
  imports: [RokuTranslatorPipe],
  template: `
    <header>
      <h1>{{ titleKey() | rokuT }}</h1>
      <p class="tally">
        {{
          'harvest.queue.tally'
            | rokuT: { remaining: remaining(), decided: decided() }
        }}
      </p>
    </header>

    @if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (failed()) {
      <ng-content select="[queueFailure]" />
    } @else if (empty()) {
      <p class="state">{{ emptyKey() | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      <div class="subject">
        <ng-content />
      </div>

      <ng-content select="[queueContext]" />

      <div class="actions">
        <button
          (click)="confirm.emit()"
          [disabled]="busy()"
          class="primary"
          type="button"
        >
          {{ (busy() ? 'resource.action.working' : confirmKey()) | rokuT }}
        </button>
        @if (rejectKey(); as key) {
          <button
            (click)="reject.emit()"
            [disabled]="busy()"
            class="danger"
            type="button"
          >
            {{ key | rokuT }}
          </button>
        }
        <button (click)="skip.emit()" [disabled]="busy()" type="button">
          {{ 'harvest.queue.skip' | rokuT }}
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      /* Room for the action bar once it is fixed, so the last line of a long
         item is not permanently underneath it. */
      padding-block-end: 5rem;
    }

    header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
      justify-content: space-between;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    .tally {
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .subject {
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .actions {
      display: flex;
      gap: var(--admin-space-3);
      margin-block-start: auto;
    }

    .actions button {
      flex: 1;
      min-block-size: 3rem;
      font-size: 1rem;
    }

    .actions .primary {
      flex: 2;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    .actions .danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger-ink);
    }

    /* On a phone the bar leaves the flow, so it stays under the thumb however
       tall the item is and does not move between one decision and the next. */
    @media (max-width: 47.99rem) {
      .actions {
        position: fixed;
        z-index: 20;
        inset-block-end: 0;
        inset-inline: 0;
        padding: var(--admin-space-3);
        border-block-start: 1px solid var(--admin-border);
        background: var(--admin-surface-raised);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueFrame {
  readonly titleKey = input.required<string>();
  /** What to say when the queue is genuinely finished. */
  readonly emptyKey = input.required<string>();
  readonly confirmKey = input.required<string>();

  /**
   * What "no" is called, or null when this queue has no such action.
   *
   * Source catalog entries are the queue with no no. The harvester exposes
   * `POST entries/:entryId/item` and nothing that rejects one, so an entry is
   * imported or left alone, and a button that pretended otherwise would have
   * nothing to call.
   */
  readonly rejectKey = input<string | null>(null);

  readonly loading = input.required<boolean>();
  /** Nothing is drawable. The projected `queueFailure` block explains why. */
  readonly failed = input.required<boolean>();
  readonly empty = input.required<boolean>();
  readonly busy = input.required<boolean>();

  readonly remaining = input.required<number>();
  readonly decided = input.required<number>();

  /**
   * A failure with an item still on screen: a line above it, not a takeover.
   *
   * A rejected decision leaves the item exactly where it was, and the operator
   * has to be able to see both the failure and the thing it was about.
   */
  readonly errorKey = input<string | null>(null);

  readonly confirm = output<void>();
  readonly reject = output<void>();
  readonly skip = output<void>();
}
