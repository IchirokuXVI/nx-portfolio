import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { PAGE_HEADING_LEVEL, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { ResourceListPage } from './resource-list-page';
import { SPLIT_UNDER_HEADER } from './resource-route-data';

/**
 * Route `data` key: how wide the list is beside the open row, as a CSS length.
 * A chain's name needs less than a shop's address does.
 */
export const SPLIT_LIST_WIDTH = 'splitListWidth';

/**
 * Route `data` key: a translation key for what the pane beside the list says
 * while no row is open, which only a wide screen ever shows.
 */
export const SPLIT_EMPTY_KEY = 'splitEmptyKey';

/**
 * A list and the row that is open, side by side (admin plan 0042).
 *
 * The list is the same {@link ResourceListPage} every list is, told through
 * route `data` that it is a column. What is open is whatever child route
 * matched, drawn in the outlet beside it.
 *
 * Three states, as the frame has (admin plan 0041):
 *
 * - **72 rem and above**: the list is a column that stays in view, and the
 *   open row sits beside it.
 * - **48 rem to 72 rem**, and **below 48 rem**: one pane at a time. The list
 *   is the page until a row is opened, and then the row is.
 *
 * **The list is never destroyed while a row is open.** On a narrow screen it
 * is hidden and not removed, so that going back finds its filter, its loaded
 * pages and its place. The place is the one thing hiding does lose, since the
 * page is as long as the pane that shows, so it is noted when a row opens and
 * put back when the row closes.
 */
@Component({
  selector: 'lib-resource-split-page',
  imports: [ResourceListPage, RouterOutlet, RokuTranslatorPipe],
  template: `
    <div
      [class.open]="open()"
      [class.under]="underHeader"
      [style.--split-list]="listWidth"
      class="split"
    >
      <div class="list"><lib-resource-list-page /></div>
      <div class="detail">
        @if (!open() && emptyKey !== null) {
          <!-- Only a wide screen shows this pane with nothing open in it. -->
          <p class="hint">{{ emptyKey | rokuT }}</p>
        }
        <router-outlet (activate)="opened()" (deactivate)="closed()" />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    /* The split reaches the edges of whatever holds it, and each pane takes
       the page's own padding back, so that a header drawn inside a pane meets
       the edges of the pane the way a page header meets the page. */
    .split {
      display: flex;
      flex: 1;
      flex-direction: column;
      margin-inline: calc(-1 * var(--admin-page-inline));
      margin-block-end: calc(-1 * var(--admin-page-block));
    }

    .split:not(.under) {
      margin-block-start: calc(-1 * var(--admin-page-block));
    }

    .list,
    .detail {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
      padding: var(--admin-page-block) var(--admin-page-inline);
    }

    /* One pane at a time below 72 rem. Hidden and not removed: see above. */
    .split.open > .list,
    .split:not(.open) > .detail {
      display: none;
    }

    @media (min-width: 72rem) {
      .split {
        display: grid;
        grid-template-columns: var(--split-list, 20rem) minmax(0, 1fr);
        align-items: start;
      }

      .split.open > .list,
      .split:not(.open) > .detail {
        display: flex;
      }

      /* The column stays beside the open row while that row's page scrolls,
         and scrolls by itself when it is longer than the window. */
      .list {
        position: sticky;
        inset-block-start: 0;
        max-block-size: 100dvh;
        overflow-y: auto;
        border-inline-end: 1px solid var(--admin-border);
        background: var(--admin-surface-raised);
        --admin-page-inline: var(--admin-space-3);
      }

      .split:not(.under) > .list {
        min-block-size: 100dvh;
      }

      /* A split under a header starts lower than the window does, so it has
         no height of its own to state. Its column takes the height of the
         row it is in, and the row is as tall as the pane that holds this
         split, which the rule below stretches to the bottom of the page
         (admin plan 0049, target 2). The column was as tall as its rows, so
         a chain with two shops drew a white panel two rows high. */
      .split.under > .list {
        align-self: stretch;
      }

      /* The open row fills its pane to the bottom, so that a split drawn
         inside it has the whole height to give to its own column. */
      .detail {
        align-self: stretch;
      }
    }

    .hint {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }
  `,
  providers: [
    {
      provide: PAGE_HEADING_LEVEL,
      useFactory: () => {
        const viewport = inject(Viewport);
        const under =
          inject(ActivatedRoute).snapshot.data[SPLIT_UNDER_HEADER] === true;
        // Under a header and beside the list, the open row titles a pane. On a
        // narrow screen the header above is hidden while a row is open, so the
        // row titles the page.
        return computed<1 | 2>(() => (under && viewport.split() ? 2 : 1));
      },
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceSplitPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _viewport = inject(Viewport);

  readonly underHeader = this._route.snapshot.data[SPLIT_UNDER_HEADER] === true;

  readonly listWidth: string | null =
    this._route.snapshot.data[SPLIT_LIST_WIDTH] ?? null;

  /** What the empty pane says, as a key, or `null` to say nothing. */
  readonly emptyKey: string | null =
    this._route.snapshot.data[SPLIT_EMPTY_KEY] ?? null;

  /** Whether a row is open in the outlet. */
  readonly open = signal(false);

  /** Where the list was scrolled to when a row opened over it. */
  private _listScroll = 0;

  opened(): void {
    if (!this.open() && !this._viewport.split()) {
      this._listScroll = window.scrollY;
      window.scrollTo({ top: 0 });
    }
    this.open.set(true);
  }

  closed(): void {
    this.open.set(false);

    if (!this._viewport.split()) {
      const top = this._listScroll;
      // After the list is shown again, which is the next frame: until then the
      // page is as short as the pane that just closed.
      requestAnimationFrame(() => window.scrollTo({ top }));
    }
  }
}
