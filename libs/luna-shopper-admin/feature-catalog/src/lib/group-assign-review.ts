import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  BulkOperationErrorCode,
  GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  ProductGroupAssignments,
  type GroupAssignmentAnswer,
  type GroupAssignmentOutcome,
} from './product-group-assignments';

/** A product somebody ticked, as the review draws it. */
export interface GroupCandidate {
  readonly id: string;
  readonly title: string;
  /** The group it is in now, which is what the request expects it to be in. */
  readonly currentGroupId: string | null;
  /** That group's name, or `null` when it is in none or the name is unknown. */
  readonly currentGroupName: string | null;
}

/** The group every ticked product is about to join. */
export interface GroupTarget {
  readonly id: string;
  readonly name: string;
}

/** One line of the answer, beside the product it was about. */
interface AnswerLine {
  readonly candidate: GroupCandidate;
  readonly outcome: GroupAssignmentOutcome;
}

/**
 * The review before products move into a group, and the answer after (admin
 * plan 0035, section 2).
 *
 * **The only place an assignment is sent from.** Both ways in, "Add items" on a
 * group and "Set group" on the product list, tick rows and then open this, so
 * the write is always one press after a screen that names every product, where
 * it is now and where it is going. A product already in the target group is
 * named too, and left out of the request, because moving it would be a write
 * that changes nothing.
 *
 * The answer names every product. The route is all or nothing, so when it
 * refuses, the line that caused it carries its reason and every other line says
 * it did not move because of it, rather than looking as if it had.
 */
@Component({
  selector: 'lib-group-assign-review',
  imports: [RokuTranslatorPipe],
  template: `
    <section
      (keydown.escape)="back()"
      [attr.aria-label]="'catalog.productGroups.assign.heading' | rokuT"
      class="review"
      role="group"
      tabindex="-1"
      data-assign-review
    >
      @if (answer(); as done) {
        <h2>
          {{
            (done.applied
              ? 'catalog.productGroups.assign.applied'
              : 'catalog.productGroups.assign.refused'
            ) | rokuT: { count: moving().length, group: group().name }
          }}
        </h2>
        @if (done.error; as sentence) {
          <p class="detail">{{ sentence }}</p>
        }
        <ul class="lines" data-assign-result>
          @for (line of answerLines(); track line.candidate.id) {
            <li [attr.data-outcome]="lineState(line)">
              <strong>{{ line.candidate.title }}</strong>
              @if (line.outcome.applied) {
                <span>{{ 'catalog.productGroups.assign.moved' | rokuT }}</span>
              } @else if (line.outcome.error; as error) {
                <span class="refused">{{
                  errorCodeKey(error.code) | rokuT
                }}</span>
                @if (error.detail !== '') {
                  <span class="detail">{{ error.detail }}</span>
                }
              } @else {
                <span class="muted">{{
                  'catalog.productGroups.assign.notMoved' | rokuT
                }}</span>
              }
            </li>
          }
        </ul>
        <div class="controls">
          <button (click)="close()" class="primary" type="button" data-close>
            {{ 'catalog.productGroups.assign.close' | rokuT }}
          </button>
        </div>
      } @else {
        <h2>
          {{
            'catalog.productGroups.assign.heading'
              | rokuT: { count: moving().length, group: group().name }
          }}
        </h2>
        <p class="muted">{{ 'catalog.productGroups.assign.lead' | rokuT }}</p>

        <ul class="lines">
          @for (candidate of candidates(); track candidate.id) {
            <li [attr.data-review-item]="candidate.id">
              <strong>{{ candidate.title }}</strong>
              @if (candidate.currentGroupId === group().id) {
                <span class="muted">{{
                  'catalog.productGroups.assign.alreadyIn' | rokuT
                }}</span>
              } @else {
                <span>
                  {{
                    (candidate.currentGroupId === null
                      ? 'catalog.productGroups.assign.fromNone'
                      : 'catalog.productGroups.assign.from'
                    )
                      | rokuT
                        : {
                            from:
                              candidate.currentGroupName ??
                              candidate.currentGroupId,
                            group: group().name,
                          }
                  }}
                </span>
              }
            </li>
          }
        </ul>

        @if (errorKey(); as key) {
          <p class="failure" role="alert">{{ key | rokuT }}</p>
        }

        <div class="controls">
          <button
            (click)="send()"
            [disabled]="sending() || moving().length === 0"
            class="primary"
            type="button"
            data-assign
          >
            {{
              (sending()
                ? 'resource.action.working'
                : 'catalog.productGroups.assign.confirm'
              ) | rokuT: { count: moving().length, group: group().name }
            }}
          </button>
          <button
            (click)="back()"
            [disabled]="sending()"
            type="button"
            data-assign-back
          >
            {{ 'catalog.productGroups.assign.back' | rokuT }}
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    .review {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 48rem;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .lines {
      display: flex;
      flex-direction: column;
      inline-size: 100%;
      list-style: none;
    }

    .lines li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: baseline;
      padding-block: var(--admin-space-2);
      border-block-start: 1px solid var(--admin-border);
    }

    .muted,
    .detail {
      color: var(--admin-ink-muted);
    }

    .detail {
      flex-basis: 100%;
      font-size: 0.8125rem;
    }

    .refused {
      font-weight: 600;
      color: var(--admin-danger);
    }

    .failure {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
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
export class GroupAssignReview {
  private readonly _assignments = inject(ProductGroupAssignments);

  /** Every ticked product, including any already in the group. */
  readonly candidates = input.required<readonly GroupCandidate[]>();
  readonly group = input.required<GroupTarget>();

  /** Back to ticking, with nothing sent. */
  readonly cancelled = output<void>();
  /** The answer has been read. `true` when the products moved. */
  readonly closed = output<boolean>();

  readonly sending = signal(false);
  readonly answer = signal<GroupAssignmentAnswer | null>(null);
  private readonly _error = signal<GatewayError | null>(null);
  readonly errorKey = computed(() => gatewayErrorKey(this._error()));

  /** The products the request will name: everything not already there. */
  readonly moving = computed(() =>
    this.candidates().filter(
      (candidate) => candidate.currentGroupId !== this.group().id
    )
  );

  readonly answerLines = computed<readonly AnswerLine[]>(() => {
    const answer = this.answer();
    if (answer === null) {
      return [];
    }
    return this.moving().map((candidate) => ({
      candidate,
      outcome: answer.results.find(
        (outcome) => outcome.itemId === candidate.id
      ) ?? { itemId: candidate.id, applied: false, error: null },
    }));
  });

  /**
   * Send the reviewed products, in one request.
   *
   * A request the gateway refuses as a whole (it never reached the check of any
   * line) keeps the review open with the sentence, and sends nothing again.
   */
  async send(): Promise<void> {
    const moving = this.moving();
    if (this.sending() || moving.length === 0) {
      return;
    }
    this.sending.set(true);
    this._error.set(null);
    try {
      const answer = await this._assignments.assign(
        moving.map((candidate) => ({
          itemId: candidate.id,
          groupId: this.group().id,
          expectedGroupId: candidate.currentGroupId,
        }))
      );
      this.answer.set(answer);
    } catch (error) {
      this._error.set(error as GatewayError);
    } finally {
      this.sending.set(false);
    }
  }

  back(): void {
    if (this.sending() || this.answer() !== null) {
      return;
    }
    this.cancelled.emit();
  }

  close(): void {
    this.closed.emit(this.answer()?.applied === true);
  }

  /** A line's state, for styling and for a spec to read. */
  lineState(line: AnswerLine): string {
    if (line.outcome.applied) {
      return 'moved';
    }
    return line.outcome.error === null ? 'held' : 'refused';
  }

  /** The sentence for one refused line's code. */
  errorCodeKey(code: BulkOperationErrorCode): string {
    return `catalog.productGroups.assign.error.${code}`;
  }
}
