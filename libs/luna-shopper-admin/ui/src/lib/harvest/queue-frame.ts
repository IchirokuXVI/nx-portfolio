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

/**
 * What the `view` query parameter holds for the queue itself, one row at a
 * time. It is what the parameter means when it is absent, too.
 */
const REVIEW_VIEW = 'review';

/**
 * A view that one queue adds beside its rows (admin plan 0044).
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

/** The least the frame needs of a row to draw it in the column. */
export interface QueueRowRef {
  readonly id: string;
}

/**
 * The chrome every decision queue shares (plan 0006, section 5).
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
 * **On a wide screen, one at a time is a split** (admin plan 0044, target 4).
 * At 72 rem and above the rows are a column 360 px wide at the left, and the
 * row that is open is at the right. The column is the queue the operator is
 * walking, drawn beside the row instead of hidden behind it. A press on a
 * line opens that row, and no line changes its place when one does.
 *
 * **The rows were also a list, and are not any more** (admin plan 0049). Plan
 * 0020 gave every queue a second view with a checkbox on each row and a bar
 * of bulk actions. The owner removed it once the column existed: the column
 * is the list, and it is on screen beside the row. The count above the rows
 * went with it, because it counted the rows that were loaded and the tab of
 * the queue already shows how many wait.
 *
 * The one switch that is left belongs to a queue that has a view of its own,
 * which today is the Places queue and its rows grouped by chain. It is a
 * query parameter rather than storage, so a reload keeps it and a link
 * carries it.
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
      <div class="tools"><ng-content select="[queueTool]" /></div>

      <!-- Only a queue with a view of its own has anything to switch between
           (admin plan 0049). The other two draw no switch. -->
      @if (extraViews().length > 0) {
        <div
          [attr.aria-label]="'harvest.queue.view.label' | rokuT"
          class="views"
          role="group"
        >
          <button
            (click)="show(review)"
            [attr.aria-pressed]="extra() === null"
            [class.on]="extra() === null"
            type="button"
            data-view="review"
          >
            {{ 'harvest.queue.view.review' | rokuT }}
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
      }
    </header>

    <!-- What a tool of the header answered: the preview of a bulk act, or
         what the last decision did (admin plan 0061). Under the header and
         above the rows, and drawn whatever the rows are doing, since a bulk
         act reads the queue again while its answer is on screen. -->
    <ng-content select="[queueBanner]" />

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
                    [attr.aria-current]="row.id === currentId() ? 'true' : null"
                    [class.open]="row.id === currentId()"
                    [disabled]="busy()"
                    class="line"
                    type="button"
                  >
                    <ng-container
                      [ngTemplateOutlet]="lineTemplate() ?? null"
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
              {{ (busy() ? 'resource.action.working' : confirmKey()) | rokuT }}
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
                <span class="short">{{ rejectShortKey() ?? key | rokuT }}</span>
              </button>
            }
          </div>
        </div>
      </div>
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

    .tools {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }

    /* A queue with no tool and no view of its own has no row above it. */
    header:not(:has(.views)):has(.tools:empty) {
      display: none;
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

    .more {
      align-self: flex-start;
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

    button {
      border: 1px solid var(--admin-border);
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    /* On a phone the bar leaves the flow, so it stays under the thumb however
       tall the item is and does not move between one decision and the next. */
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

  /** The rows of the queue, in the order the column draws them. */
  readonly rows = input<readonly QueueRowRef[]>([]);
  /** The row that is open, which the column of a split marks. */
  readonly currentId = input<string | null>(null);
  /** The views this queue adds beside its rows. */
  readonly extraViews = input<readonly QueueExtraView[]>([]);
  readonly canLoadMore = input(false);
  readonly loadingMore = input(false);

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
  readonly loadMore = output<void>();
  /** A row the operator wants to look at. */
  readonly openRow = output<string>();

  /** What the switch calls the queue itself, for the template. */
  readonly review = REVIEW_VIEW;

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

  /**
   * The queue's own view that is on screen, or `null` for the rows.
   *
   * Anything the parameter holds that is no view of this queue is the rows,
   * which is what an old link with `view=list` now opens.
   */
  readonly extra = computed<QueueExtraView | null>(
    () => this.extraViews().find((option) => option.id === this._view()) ?? null
  );

  /**
   * Whether one at a time is drawn as a split: the queue beside the open row.
   * At 72 rem and above, which is the width the frame's third state starts at.
   */
  readonly split = inject(Viewport).split;

  /** How one line of the column of a split is drawn. */
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
}
