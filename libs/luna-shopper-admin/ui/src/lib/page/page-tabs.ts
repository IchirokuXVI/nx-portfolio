import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InjectionToken,
  input,
  viewChild,
  type Signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One tab under a page header. */
export interface PageTab {
  /** Where it goes: a URL from the app root, or router commands. */
  readonly path: string | readonly unknown[];
  /** A translation key. */
  readonly label: string;
  /** Whether the tab is current only on exactly its own path. */
  readonly exact?: boolean;
  /**
   * The number beside the label, when the tab has one.
   *
   * A function, so that a signal read inside it keeps the count current. `null`
   * and `0` both draw nothing: a tab with nothing behind it does not need a
   * zero beside its name.
   */
  count?(): number | null;
  /**
   * Whether the count is work that waits for a person.
   *
   * It is then drawn on the waiting wash and announced as waiting. A plain
   * count, such as how many shops a chain has, is drawn in grey.
   */
  readonly waiting?: boolean;
}

/**
 * The tabs that the frame gives every page of the current section.
 *
 * Until each section has a page of its own with its own tabs (admin plans 0042
 * to 0044), the screens of the current section are the tabs of every page in
 * it. The frame provides them here, and `PageHeader` draws them under itself, so
 * that a page does not have to know which section it is in.
 *
 * Absent outside the frame, which is the sign in page and every spec that
 * mounts a page alone.
 */
export const PAGE_FRAME_TABS = new InjectionToken<Signal<readonly PageTab[]>>(
  'PAGE_FRAME_TABS'
);

/**
 * Tabs under a page header (admin plan 0041, section 4).
 *
 * Links in one row, each with an optional count. A row that does not fit
 * scrolls sideways and never wraps: a second line of tabs moves the page down
 * by its own height on some screens and not on others.
 *
 * They are links and not buttons, because each one is an address. The current
 * one is marked for a screen reader as the current page, which is what it is.
 */
@Component({
  selector: 'lib-page-tabs',
  imports: [RouterLink, RouterLinkActive, RokuTranslatorPipe],
  template: `
    <nav [attr.aria-label]="label()" #row>
      <ul>
        @for (tab of tabs(); track tab.label) {
          <li>
            <a
              (isActiveChange)="$event && reveal(link)"
              [routerLink]="tab.path"
              [routerLinkActiveOptions]="{ exact: tab.exact === true }"
              #link
              ariaCurrentWhenActive="page"
              routerLinkActive="current"
            >
              {{ tab.label | rokuT }}
              @if (tab.count?.(); as count) {
                <span
                  [attr.aria-label]="
                    tab.waiting ? ('shell.waiting' | rokuT: { count }) : null
                  "
                  [class.waiting]="tab.waiting === true"
                  class="count"
                  >{{ count }}</span
                >
              }
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
      margin-inline: calc(-1 * var(--admin-page-inline));
      border-block-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    nav {
      overflow-x: auto;
      scrollbar-width: none;
      /* So that a tab's offset is measured from the row it scrolls in. */
      position: relative;
    }

    nav::-webkit-scrollbar {
      display: none;
    }

    ul {
      display: flex;
      gap: var(--admin-space-1);
      inline-size: max-content;
      padding-inline: calc(var(--admin-page-inline) - var(--admin-space-3));
      list-style: none;
    }

    a {
      display: flex;
      gap: 0.375rem;
      align-items: center;
      block-size: 2.5rem;
      padding-inline: var(--admin-space-3);
      border-block-end: 2px solid transparent;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink-muted);
    }

    a.current {
      border-block-end-color: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-ink);
    }

    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    .count {
      padding: 0.0625rem 0.375rem;
      border-radius: 0.5625rem;
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--admin-neutral-on-wash);
    }

    .count.waiting {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    @media (max-width: 47.99rem) {
      a {
        block-size: 2.75rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageTabs {
  readonly tabs = input.required<readonly PageTab[]>();
  /** What the row of tabs is, already translated, for a screen reader. */
  readonly label = input('');

  private readonly _row = viewChild.required<ElementRef<HTMLElement>>('row');

  /**
   * Bring the current tab into the row's own view.
   *
   * A row that scrolls sideways can open with its current tab off the edge,
   * which on a phone is most tabs of a section with ten screens. The row is
   * moved and never the page: `scrollIntoView` would also scroll the document
   * to the tabs, away from whatever the operator was reading.
   */
  reveal(link: HTMLElement): void {
    const row = this._row().nativeElement;
    const hidden =
      link.offsetLeft < row.scrollLeft ||
      link.offsetLeft + link.offsetWidth > row.scrollLeft + row.clientWidth;

    if (hidden) {
      row.scrollLeft =
        link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
    }
  }
}
