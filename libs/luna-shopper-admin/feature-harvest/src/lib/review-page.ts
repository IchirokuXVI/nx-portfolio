import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  harvestReviewPath,
  REVIEW_QUEUES,
  type InfoContent,
  type ReviewQueue,
} from '@portfolio/luna-shopper-admin/models';
import { ChainSelect } from './chain-select';
import { HarvestHeader } from './harvest-header';
import { HarvestStatus } from './harvest-status';
import { waitingIn } from './harvest-waiting';
import { ReviewChain } from './review-chain';

/** What the info button of Review says (admin plan 0044, target 9). */
export const REVIEW_INFO: InfoContent = {
  title: 'harvest.review.info.title',
  points: ['harvest.review.info.holds', 'harvest.review.info.decide'],
};

/** One entry of the switch between the four queues. */
interface QueueEntry {
  readonly queue: ReviewQueue;
  readonly labelKey: string;
  readonly path: readonly string[];
}

/**
 * Review: the four queues where a person decides something, on one page
 * (admin plan 0044, target 4).
 *
 * Source products, source shops, discovered places and suggested brands were
 * four screens in a row of ten. They are one kind of work, so they share a
 * page: a switch of four entries picks the queue and shows how many wait in
 * each, and one chain filter narrows all four.
 *
 * Each queue is a child route, so each has an address and the browser's back
 * button walks them. This page draws the header, the switch and the filter,
 * and the queue draws the rest.
 */
@Component({
  selector: 'lib-harvest-review-page',
  imports: [
    HarvestHeader,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    RokuTranslatorPipe,
    ChainSelect,
  ],
  template: `
    <lib-harvest-header [info]="info" />

    <div class="bar">
      <nav [attr.aria-label]="'harvest.review.queues' | rokuT" class="queues">
        @for (entry of entries; track entry.queue) {
          <a
            [attr.data-queue]="entry.queue"
            [queryParams]="chain.params()"
            [routerLink]="entry.path"
            ariaCurrentWhenActive="page"
            routerLinkActive="on"
          >
            {{ entry.labelKey | rokuT }}
            @if (countOf(entry.queue); as count) {
              <span
                [attr.aria-label]="'shell.waiting' | rokuT: { count }"
                class="count"
                >{{ count }}</span
              >
            }
          </a>
        }
      </nav>

      <div class="chain">
        <label for="review-chain">{{ 'harvest.review.chain' | rokuT }}</label>
        <lib-chain-select
          (valueChange)="chain.choose($event)"
          [value]="chain.chain()"
          controlId="review-chain"
          label="harvest.review.chain"
          noneKey="harvest.review.anyChain"
        />
      </div>
    </div>

    <router-outlet />
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
    }

    /* A row that does not fit scrolls sideways and never wraps, like the
       tabs above it. */
    .queues {
      display: flex;
      overflow-x: auto;
      max-inline-size: 100%;
      scrollbar-width: none;
    }

    .queues::-webkit-scrollbar {
      display: none;
    }

    .queues a {
      display: flex;
      flex: none;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      background: var(--admin-surface-raised);
      font-size: 0.875rem;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink-muted);
    }

    .queues a + a {
      margin-inline-start: -1px;
    }

    .queues a:first-child {
      border-start-start-radius: var(--admin-radius-control);
      border-end-start-radius: var(--admin-radius-control);
    }

    .queues a:last-child {
      border-start-end-radius: var(--admin-radius-control);
      border-end-end-radius: var(--admin-radius-control);
    }

    .queues a.on {
      z-index: 1;
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .queues a:focus-visible {
      z-index: 2;
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .count {
      padding: 0.0625rem 0.375rem;
      border-radius: 0.5625rem;
      background: var(--admin-waiting-wash);
      font-size: 0.75rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--admin-waiting-on-wash);
    }

    .chain {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-inline-size: 0;
    }

    .chain label {
      flex: none;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .chain lib-chain-select {
      flex: 1;
      inline-size: 14rem;
      max-inline-size: 100%;
    }

    @media (max-width: 47.99rem) {
      .queues a {
        min-block-size: 2.75rem;
      }

      .chain {
        flex: 1 1 100%;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HarvestReviewPage {
  private readonly _status = inject(HarvestStatus);

  readonly chain = inject(ReviewChain);

  readonly info = REVIEW_INFO;

  readonly entries: readonly QueueEntry[] = REVIEW_QUEUES.map((queue) => ({
    queue,
    labelKey: `harvest.review.queue.${queue}`,
    path: harvestReviewPath(queue),
  }));

  private readonly _waiting = computed(() => this._status.waiting());

  /** How many wait in one queue. Nothing is drawn for none, or for unknown. */
  countOf(queue: ReviewQueue): number | null {
    return waitingIn(this._waiting(), queue);
  }
}
