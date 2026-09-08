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

/** Which of the two renderings of the same rows is on screen. */
export type QueueView = 'review' | 'list';

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
 */
@Component({
  selector: 'lib-queue-frame',
  imports: [NgTemplateOutlet, RokuTranslatorPipe],
  template: `
    <header>
      <h1>{{ titleKey() | rokuT }}</h1>
      <p class="tally">
        {{
          'harvest.queue.tally'
            | rokuT: { remaining: remaining(), decided: decided() }
        }}
      </p>

      <div class="views" role="group">
        <button
          (click)="show('review')"
          [attr.aria-pressed]="view() === 'review'"
          [class.on]="view() === 'review'"
          type="button"
        >
          {{ 'harvest.queue.view.review' | rokuT }}
        </button>
        <button
          (click)="show('list')"
          [attr.aria-pressed]="view() === 'list'"
          [class.on]="view() === 'list'"
          type="button"
        >
          {{ 'harvest.queue.view.list' | rokuT }}
        </button>
      </div>
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

      @if (view() === 'review') {
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

    .views {
      display: flex;
      gap: var(--admin-space-1);
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
      color: var(--admin-danger-on-wash);
    }

    button {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
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
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

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
   * The view this screen opens in, when the URL names none.
   *
   * Each screen keeps the view it has today, so nobody's habit breaks: entries
   * and places open in review, shops opens in list.
   */
  readonly defaultView = input<QueueView>('review');

  /** The rows the list view draws, in the order they are to be drawn. */
  readonly rows = input<readonly QueueRowRef[]>([]);
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
  private readonly _view = signal<QueueView | null>(
    asView(this._route.snapshot.queryParamMap.get(QUEUE_VIEW_PARAM))
  );

  /** The URL's answer where it has one, and the screen's habit where it does not. */
  readonly view = computed<QueueView>(() => this._view() ?? this.defaultView());

  show(view: QueueView): void {
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
