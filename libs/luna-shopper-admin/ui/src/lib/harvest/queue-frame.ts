import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { Viewport } from '../viewport';

/** Which of the two renderings of the same rows is on screen. */
export type QueueView = 'review' | 'list';

/**
 * A view that one queue adds beside the two every queue has (admin plan 0044).
 *
 * The Places queue reads the same rows grouped by chain. That is a view of the
 * queue and not a page, so it is an entry of the same switch, and the queue
 * projects what it draws as `queueExtra`.
 */
export interface QueueExtraView {
  /** What the `view` query parameter holds while this view is on screen. */
  readonly id: string;
  /** A translation key for its entry in the switch. */
  readonly labelKey: string;
}

/** The query parameter that carries it, so a reload and a link both keep it. */
export const QUEUE_VIEW_PARAM = 'view';

/** The least the frame needs of a row to draw a checkbox beside it. */
export interface QueueRowRef {
  readonly id: string;
}

/** One named row of a bulk run's report. */
export interface QueueReportRow {
  readonly name: string;
  /** Why it was refused. `''` for a row that was never attempted. */
  readonly reasonKey: string;
}

/**
 * What a bulk run did, in the words the screen says it in (plan 0020, section
 * 6).
 *
 * Built by the screen, because naming a row is the one part of it the store
 * cannot do: the store holds ids and the name is a column. Everything else about
 * the run is decided in `QueueStore.decideMany`.
 */
export interface QueueReport {
  /** How many rows the run got through, succeeded or failed. */
  readonly done: number;
  /** How many it set out to act on, which is everything but the skipped. */
  readonly total: number;
  readonly succeeded: number;
  readonly stopped: boolean;
  /** Refused, by name, each with its own reason. Never a count. */
  readonly failed: readonly QueueReportRow[];
  /** Never attempted, by name. A different sentence from a refusal. */
  readonly skipped: readonly QueueReportRow[];
}

/**
 * The chrome every decision queue shares (plan 0006, section 5; plan 0020).
 *
 * Three screens are decision queues rather than editors, and they have one
 * shape: a thing to look at, and confirm, reject or skip. What differs between
 * them is the thing, which is projected, so this file owns the part that must
 * not differ.
 *
 * Two properties are what plan 0006 means by "built for repetition".
 *
 * **The next item comes up without navigating back to a list.** Deciding removes
 * the item and the one behind it becomes the subject, so working through four
 * thousand entries is one screen and not four thousand round trips.
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
 *
 * **The same rows are also a list** (plan 0020). One at a time is right when
 * each row is a judgement; a list is right when the rows are alike and the
 * answer is the same for all of them, which is the ordinary end of a crawl. So
 * the header carries a toggle, the list view draws a checkbox per row, and the
 * selection bar sits **in the same fixed position** as the action bar: same
 * place, same size, same reachability by thumb, because an operator who has
 * learned where the buttons are should not have to learn it twice.
 *
 * The view is a query parameter rather than storage, so a reload keeps it and a
 * link carries it, and each screen states the view it opens in.
 *
 * **On a wide screen, one at a time is a split** (admin plan 0044, target 4).
 * At 72 rem and above the rows are a column 360 px wide at the left, and the
 * row that is open is at the right. It is the same view and the same query
 * parameter: the column is the queue the operator is walking, drawn beside the
 * row instead of hidden behind it. The list view stays, for bulk work.
 *
 * **The action bar holds still.** It is fixed above the navigation bar on a
 * phone and sticks to the bottom edge of the window on a wider screen, so the
 * accept and reject buttons are where they were when the next row comes up,
 * however tall that row is. Two quick presses then hit the same action twice
 * and never two different ones. Accept is filled and reject is outlined, so
 * the two differ in shape as well as in color.
 */
@Component({
  selector: 'lib-queue-frame',
  imports: [NgTemplateOutlet, RokuTranslatorPipe],
  template: `
    <!-- The page that holds this frame draws the title, in the page header
         (admin plan 0041). What is left here is the row about the queue
         itself, named after it for a screen reader. -->
    <header [attr.aria-label]="titleKey() | rokuT">
      <p class="tally">
        {{
          'harvest.queue.tally'
            | rokuT: { remaining: remaining(), decided: decided() }
        }}
      </p>

      <div class="tools"><ng-content select="[queueTool]" /></div>

      <div
        [attr.aria-label]="'harvest.queue.view.label' | rokuT"
        class="views"
        role="group"
      >
        <button
          (click)="show('review')"
          [attr.aria-pressed]="extra() === null && view() === 'review'"
          [class.on]="extra() === null && view() === 'review'"
          type="button"
          data-view="review"
        >
          {{ 'harvest.queue.view.review' | rokuT }}
        </button>
        <button
          (click)="show('list')"
          [attr.aria-pressed]="extra() === null && view() === 'list'"
          [class.on]="extra() === null && view() === 'list'"
          type="button"
          data-view="list"
        >
          {{ 'harvest.queue.view.list' | rokuT }}
        </button>
        @for (option of extraViews(); track option.id) {
          <button
            (click)="show(option.id)"
            [attr.aria-pressed]="extra()?.id === option.id"
            [attr.data-view]="option.id"
            [class.on]="extra()?.id === option.id"
            type="button"
          >
            {{ option.labelKey | rokuT }}
          </button>
        }
      </div>
    </header>

    <!-- A view of the queue's own. It reads for itself, so it is drawn
         whatever the rows are doing. Hidden and not removed while another
         view is on screen, because projected content has one place. -->
    <div [hidden]="extra() === null" class="extra">
      <ng-content select="[queueExtra]" />
    </div>

    @if (extra() !== null) {
      <!-- The queue's own view stands in for the rows. -->
    } @else if (loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (failed()) {
      <ng-content select="[queueFailure]" />
    } @else if (empty()) {
      <p class="state">{{ emptyKey() | rokuT }}</p>
    } @else {
      @if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      }

      @if (view() === 'review') {
        <div [class.split]="split()" class="review">
          @if (split()) {
            <!-- The queue the operator is walking, beside the row that is
                 open (admin plan 0044). A press opens that row. -->
            <nav
              [attr.aria-label]="'harvest.queue.column' | rokuT"
              class="column"
            >
              <ul>
                @for (row of rows(); track row.id) {
                  <li>
                    <button
                      (click)="openRow.emit(row.id)"
                      [attr.aria-current]="
                        row.id === currentId() ? 'true' : null
                      "
                      [class.open]="row.id === currentId()"
                      [disabled]="busy()"
                      class="line"
                      type="button"
                    >
                      <ng-container
                        [ngTemplateOutlet]="
                          lineTemplate() ?? rowTemplate() ?? null
                        "
                        [ngTemplateOutletContext]="{ $implicit: row }"
                      />
                    </button>
                  </li>
                }
              </ul>
              @if (canLoadMore()) {
                <button
                  (click)="loadMore.emit()"
                  [disabled]="loadingMore() || busy()"
                  class="more"
                  type="button"
                >
                  {{
                    (loadingMore()
                      ? 'resource.list.loading'
                      : 'harvest.queue.loadMore'
                    ) | rokuT: { loaded: rows().length }
                  }}
                </button>
              }
            </nav>
          }

          <div class="card">
            <div class="subject">
              <ng-content />
            </div>

            <ng-content select="[queueContext]" />

            <div class="actions decide">
              <button
                (click)="confirm.emit()"
                [disabled]="busy()"
                class="primary"
                type="button"
                data-action="confirm"
              >
                {{
                  (busy() ? 'resource.action.working' : confirmKey()) | rokuT
                }}
              </button>
              <!-- What else can be done with the row, when the screen has
                   more than yes, no and skip. On a phone these are links in
                   the card and the bar holds the three. -->
              <div class="other"><ng-content select="[queueAction]" /></div>
              <span class="grow"></span>
              <button
                (click)="skip.emit()"
                [disabled]="busy()"
                class="skip"
                type="button"
                data-action="skip"
              >
                {{ 'harvest.queue.skip' | rokuT }}
              </button>
              @if (rejectKey(); as key) {
                <button
                  (click)="reject.emit()"
                  [attr.aria-label]="key | rokuT"
                  [disabled]="busy() || rejectDisabled()"
                  class="danger"
                  type="button"
                  data-action="reject"
                >
                  <span class="long">{{ key | rokuT }}</span>
                  <span class="short">{{
                    rejectShortKey() ?? key | rokuT
                  }}</span>
                </button>
              }
            </div>
          </div>
        </div>
      } @else {
        @if (report(); as done) {
          <section class="report" role="status">
            <p class="outcome">
              {{
                (done.stopped
                  ? 'harvest.queue.bulk.stopped'
                  : 'harvest.queue.bulk.finished'
                ) | rokuT: { succeeded: done.succeeded, total: done.total }
              }}
            </p>

            @if (done.failed.length > 0) {
              <h3>{{ 'harvest.queue.bulk.refused' | rokuT }}</h3>
              <ul>
                @for (line of done.failed; track line.name) {
                  <li>
                    <strong>{{ line.name }}</strong>
                    <span>{{ line.reasonKey | rokuT }}</span>
                  </li>
                }
              </ul>
            }

            @if (done.skipped.length > 0) {
              <h3>{{ 'harvest.queue.bulk.leftAlone' | rokuT }}</h3>
              <ul>
                @for (line of done.skipped; track line.name) {
                  <li>
                    <strong>{{ line.name }}</strong>
                  </li>
                }
              </ul>
            }
          </section>
        }

        <ul class="rows">
          @for (row of rows(); track row.id) {
            <li [class.picked]="selected().has(row.id)">
              <input
                (change)="pickRow.emit(row.id)"
                [attr.aria-label]="'harvest.queue.select' | rokuT"
                [checked]="selected().has(row.id)"
                [disabled]="busy()"
                type="checkbox"
              />
              <!-- The cells are the button, and there is nothing interactive
                   inside them. A row whose answer is not obvious is opened
                   rather than decided from four columns. -->
              <button (click)="open(row.id)" class="cells" type="button">
                <ng-container
                  [ngTemplateOutlet]="rowTemplate() ?? null"
                  [ngTemplateOutletContext]="{ $implicit: row }"
                />
              </button>
            </li>
          }
        </ul>

        @if (canLoadMore()) {
          <button
            (click)="loadMore.emit()"
            [disabled]="loadingMore() || busy()"
            class="more"
            type="button"
          >
            {{
              (loadingMore()
                ? 'resource.list.loading'
                : 'harvest.queue.loadMore'
              ) | rokuT: { loaded: rows().length }
            }}
          </button>
        }

        <div class="actions selection">
          @if (progress(); as run) {
            <p class="progress" role="status">
              {{ progressKey() | rokuT: { done: run.done, total: run.total } }}
            </p>
            <button (click)="stop.emit()" class="danger" type="button">
              {{ 'harvest.queue.bulk.stop' | rokuT }}
            </button>
          } @else {
            <button (click)="selectAll.emit()" type="button">
              {{ 'harvest.queue.selectAll' | rokuT: { loaded: rows().length } }}
            </button>
            <button
              (click)="clearSelection.emit()"
              [disabled]="selectedCount() === 0"
              type="button"
            >
              {{
                'harvest.queue.clearSelection'
                  | rokuT: { count: selectedCount() }
              }}
            </button>
            <ng-content select="[queueBulk]" />
          }
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    .tally {
      flex: 1;
    }

    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }

    .tools:empty,
    .other:empty {
      display: none;
    }

    .extra {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    .extra[hidden] {
      display: none;
    }

    .review {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    .card {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    /* At 72 rem and above: the queue at the left, 360 px wide, and the row
       that is open at the right. */
    .review.split {
      display: grid;
      grid-template-columns: 22.5rem minmax(0, 1fr);
      gap: var(--admin-space-4);
      align-items: stretch;
    }

    .column {
      position: sticky;
      inset-block-start: var(--admin-page-block);
      display: flex;
      flex-direction: column;
      align-self: start;
      max-block-size: calc(100dvh - 2 * var(--admin-page-block));
      overflow-y: auto;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .column ul {
      display: flex;
      flex-direction: column;
      list-style: none;
    }

    .column li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    .column .line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
      align-items: baseline;
      inline-size: 100%;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: none;
      border-inline-start: 3px solid transparent;
      border-radius: 0;
      background: none;
      text-align: start;
    }

    .column .line.open {
      border-inline-start-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .column .more {
      margin: var(--admin-space-2) var(--admin-space-3);
    }

    h3 {
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .tally {
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .views button {
      border-radius: 0;
    }

    .views button:first-child {
      border-start-start-radius: var(--admin-radius-control);
      border-end-start-radius: var(--admin-radius-control);
    }

    .views button:last-child {
      border-start-end-radius: var(--admin-radius-control);
      border-end-end-radius: var(--admin-radius-control);
    }

    .views button + button {
      margin-inline-start: -1px;
    }

    .views {
      display: flex;
    }

    .views .on {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
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

    .report {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .report ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      list-style: none;
    }

    .report li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    .report span {
      color: var(--admin-ink-muted);
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .rows li {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .rows li.picked {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
    }

    .rows input {
      inline-size: 1.25rem;
      block-size: 1.25rem;
      flex: none;
    }

    .cells {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
      padding: var(--admin-space-2) 0;
      border: none;
      background: none;
      font: inherit;
      text-align: start;
      color: inherit;
      cursor: pointer;
    }

    .more {
      align-self: flex-start;
    }

    .progress {
      flex: 2;
      align-self: center;
      font-variant-numeric: tabular-nums;
    }

    /* The bar sticks to the bottom edge of the window, at the same distance
       from it whether the row above is short or long. So the buttons are
       where they were when the next row comes up. */
    .actions {
      position: sticky;
      z-index: 5;
      inset-block-end: var(--admin-page-block);
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
      margin-block-start: auto;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
    }

    .actions button {
      min-block-size: 2.5rem;
    }

    .actions .grow {
      flex: 1;
    }

    .actions .other {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }

    /* Accept is filled. */
    .actions .primary {
      border-color: var(--admin-accent);
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    /* Reject is outlined, so the two differ in shape as well as in color. */
    .actions .danger {
      border-color: var(--admin-danger);
      background: var(--admin-surface-raised);
      color: var(--admin-danger-on-wash);
    }

    .actions .short {
      display: none;
    }

    .actions.selection button {
      flex: 1;
    }

    button {
      border: 1px solid var(--admin-border);
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    /* On a phone the bar leaves the flow, so it stays under the thumb however
       tall the item is and does not move between one decision and the next. The
       selection bar takes the same rule and the same place: an operator who has
       learned where the buttons are does not have to learn it twice. */
    @media (max-width: 47.99rem) {
      /* Room for the bar, so that the last field of a card can be scrolled
         above it. The page already reserves the navigation bar under it. */
      :host {
        padding-block-end: 4.5rem;
      }

      /* Above the navigation bar, which is fixed at the bottom edge, and
         never under it: the bar starts where the navigation ends. */
      .actions {
        position: fixed;
        z-index: 20;
        inset-block-end: var(--admin-bar);
        inset-inline: 0;
        flex-wrap: nowrap;
        margin: 0;
        padding: var(--admin-space-2) var(--admin-space-3);
        border: none;
        border-block-start: 1px solid var(--admin-border);
        border-radius: 0;
        background: var(--admin-surface-raised);
      }

      .actions button {
        min-block-size: 2.75rem;
        font-size: var(--admin-field-size);
      }

      /* Reject, Skip, then the accept action, which takes the room that is
         left. The other actions are links in the card. */
      .actions.decide .danger {
        order: 1;
      }

      .actions.decide .skip {
        order: 2;
      }

      .actions.decide .primary {
        flex: 1;
        order: 3;
        min-inline-size: 0;
      }

      .actions.decide .other,
      .actions.decide .grow,
      .actions .long {
        display: none;
      }

      .actions .short {
        display: inline;
      }
    }

    @media (prefers-reduced-motion: no-preference) {
      .column {
        scroll-behavior: smooth;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueFrame {
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  /** What the queue is called, as the name of the row above it. */
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

  /**
   * Whether "no" cannot be said to the row in front, on a queue that has a
   * "no" for other rows.
   *
   * The button is then drawn disabled and keeps its place. Taking it away
   * moved Skip into its slot, so the second of two quick presses on Skip
   * landed where the next row's "no" was about to be drawn. A queue with no
   * such action at all states no {@link rejectKey}, and its bar never changes.
   */
  readonly rejectDisabled = input(false);

  /**
   * A shorter name for "no", for the bar on a phone, where three buttons share
   * one row. The long name stays the accessible name. Absent, the long name is
   * drawn.
   */
  readonly rejectShortKey = input<string | null>(null);

  readonly loading = input.required<boolean>();
  /** Nothing is drawable. The projected `queueFailure` block explains why. */
  readonly failed = input.required<boolean>();
  readonly empty = input.required<boolean>();
  readonly busy = input.required<boolean>();

  readonly remaining = input.required<number>();
  readonly decided = input.required<number>();

  /**
   * The view this screen opens in, when the URL names none.
   *
   * Each screen keeps the view it has today, so nobody's habit breaks: entries
   * and places open in review, shops opens in list.
   */
  readonly defaultView = input<QueueView>('review');

  /** The rows the list view draws, in the order they are to be drawn. */
  readonly rows = input<readonly QueueRowRef[]>([]);
  /** The row that is open, which the column of a split marks. */
  readonly currentId = input<string | null>(null);
  /** The views this queue adds beside the two every queue has. */
  readonly extraViews = input<readonly QueueExtraView[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = input(0);
  readonly canLoadMore = input(false);
  readonly loadingMore = input(false);

  /** How far a bulk run has got, or null when none is running. */
  readonly progress = input<{ done: number; total: number } | null>(null);

  /**
   * What the progress line says, which names the act rather than the time.
   *
   * `Rejecting 42 of 200`, and the screen supplies the verb, because "working"
   * on a screen that writes to the catalog tells an operator nothing about what
   * is being written.
   */
  readonly progressKey = input('harvest.queue.bulk.progress');

  /** What the last bulk run did, until another one starts. */
  readonly report = input<QueueReport | null>(null);

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

  /**
   * One row ticked or unticked.
   *
   * Not `toggle`: that is a native DOM event name, and an output that shadows
   * one is caught by `@angular-eslint/no-output-native`.
   */
  readonly pickRow = output<string>();
  readonly selectAll = output<void>();
  readonly clearSelection = output<void>();
  readonly loadMore = output<void>();
  readonly stop = output<void>();
  /** A row the operator wants to look at properly. */
  readonly openRow = output<string>();

  /** How one row of the list is drawn. Every column on it is the screen's. */
  readonly rowTemplate =
    contentChild<TemplateRef<{ $implicit: QueueRowRef }>>('queueRow');

  /**
   * Which view is on screen.
   *
   * Read once from the URL and written back on every toggle, rather than
   * followed: nothing else changes this parameter, and subscribing to the route
   * would need `rxjs-interop`, which this workspace forbids anywhere a remote
   * could load a second copy of it.
   */
  private readonly _view = signal<string | null>(
    this._route.snapshot.queryParamMap.get(QUEUE_VIEW_PARAM)
  );

  /** The URL's answer where it has one, and the screen's habit where it does not. */
  readonly view = computed<QueueView>(
    () => asView(this._view()) ?? this.defaultView()
  );

  /** The queue's own view that is on screen, or `null` for one of the two. */
  readonly extra = computed<QueueExtraView | null>(
    () => this.extraViews().find((option) => option.id === this._view()) ?? null
  );

  /**
   * Whether one at a time is drawn as a split: the queue beside the open row.
   * At 72 rem and above, which is the width the frame's third state starts at.
   */
  readonly split = inject(Viewport).split;

  /**
   * How one line of the column of a split is drawn. A queue that names none
   * gets its list row there, wrapped to the column's width.
   */
  readonly lineTemplate =
    contentChild<TemplateRef<{ $implicit: QueueRowRef }>>('queueLine');

  show(view: string): void {
    this._view.set(view);
    // Merged and replacing: the chain and the filters live on the same query
    // string, and a toggle is not a place anybody wants the back button to
    // return to.
    void this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { [QUEUE_VIEW_PARAM]: view },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** A row the operator clicked: the review view, with that row in front. */
  open(id: string): void {
    this.openRow.emit(id);
    this.show('review');
  }
}

function asView(value: string | null): QueueView | null {
  return value === 'review' || value === 'list' ? value : null;
}
