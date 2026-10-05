import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import { Viewport } from '../viewport';
import { RecordSection } from './record-section';

/** One row of a collection, already formatted. */
export interface RecordCollectionRow {
  readonly id: string;
  readonly title: string;
  /** A short second value at the end of the row: "41 products". */
  readonly trailing: string | null;
  /** Router commands to the row's own page, or `null` for a row that does not open. */
  readonly link: readonly string[] | null;
}

/** Where "See all" and the link shape lead. */
export interface CollectionLink {
  readonly commands: readonly string[];
  readonly queryParams?: Readonly<Record<string, string>>;
}

/**
 * A collection of the record, as a panel or as one link (admin plan 0052,
 * section 3.9).
 *
 * A panel is a heading with a count, a few rows that are links, and "See all"
 * when the list holds more. A link is one row with a count, for a collection
 * that is too long to show any of. It looks the same while the page reads and
 * while it changes, because it is never part of the form.
 *
 * **It draws the rows it is handed and reads nothing.** Plan 0054 reads them.
 *
 * On a phone a panel is drawn as the link shape: one row that opens the list.
 * A short list under every section would push the next section off the
 * screen.
 */
@Component({
  selector: 'lib-record-collection',
  imports: [RokuTranslatorPipe, RouterLink, ChevronLeftIcon, RecordSection],
  template: `
    @if (asLink()) {
      @if (all(); as target) {
        @if (!nothing()) {
          <a
            [queryParams]="target.queryParams ?? null"
            [routerLink]="target.commands"
            class="row one"
            data-collection-link
          >
            <span class="title">{{ heading() }}</span>
            @if (count() !== null) {
              <span class="count" data-count>{{ count() }}</span>
            }
            <span class="chevron"><lib-chevron-left-icon /></span>
          </a>
        } @else {
          <p class="row one" data-collection-empty>
            <span class="title">{{ heading() }}</span>
            <span class="quiet">{{ 'record.collection.none' | rokuT }}</span>
          </p>
        }
      } @else {
        <!-- Nowhere to go, so not a link. A link that leads nowhere is worse
             than a line of text. -->
        <p class="row one" data-collection-empty>
          <span class="title">{{ heading() }}</span>
          @if (nothing()) {
            <span class="quiet">{{ 'record.collection.none' | rokuT }}</span>
          } @else if (count() !== null) {
            <span class="count" data-count>{{ count() }}</span>
          }
        </p>
      }
    } @else {
      <lib-record-section [count]="count()" [heading]="heading()">
        <ng-content ngProjectAs="[sectionAction]" select="[sectionAction]" />

        @switch (status()) {
          @case ('loading') {
            <p aria-busy="true" class="row state" data-collection-loading>
              <span class="bar"></span>
              <span class="sr-only">{{
                'record.collection.loading' | rokuT
              }}</span>
            </p>
          }

          @case ('error') {
            <p class="row state" role="alert" data-collection-error>
              <span class="grow">{{ 'record.collection.failed' | rokuT }}</span>
              <button (click)="retry.emit()" type="button">
                {{ 'resource.action.retry' | rokuT }}
              </button>
            </p>
          }

          @default {
            @if (rows().length === 0) {
              <p class="row state quiet" data-collection-empty>
                {{ emptyKey() ?? 'record.collection.none' | rokuT }}
              </p>
            } @else {
              <ul>
                @for (row of rows(); track row.id) {
                  <li>
                    @if (row.link; as link) {
                      <a [routerLink]="link" class="row">
                        <span class="title">{{ row.title }}</span>
                        @if (row.trailing; as trailing) {
                          <span class="quiet num">{{ trailing }}</span>
                        }
                        <span class="chevron"><lib-chevron-left-icon /></span>
                      </a>
                    } @else {
                      <span class="row">
                        <span class="title">{{ row.title }}</span>
                        @if (row.trailing; as trailing) {
                          <span class="quiet num">{{ trailing }}</span>
                        }
                      </span>
                    }
                  </li>
                }
              </ul>
            }

            @if (seeAll(); as target) {
              <a
                [queryParams]="target.queryParams ?? null"
                [routerLink]="target.commands"
                class="row all"
                data-see-all
              >
                @if (count(); as total) {
                  {{
                    'record.collection.seeAllCount' | rokuT: { count: total }
                  }}
                } @else {
                  {{ 'record.collection.seeAll' | rokuT }}
                }
              </a>
            }
          }
        }
      </lib-record-section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    ul {
      list-style: none;
    }

    .row {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
      color: var(--admin-ink);
      text-decoration: none;
    }

    /* The link shape is a panel of one row, so it carries the edge itself. */
    .row.one {
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .row.one .title {
      font-weight: 600;
    }

    .title,
    .grow {
      flex: 1;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .quiet {
      color: var(--admin-ink-muted);
    }

    .num {
      flex: none;
      font-variant-numeric: tabular-nums;
    }

    .count {
      flex: none;
      padding: 0.0625rem var(--admin-space-2);
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--admin-neutral-on-wash);
    }

    /* The shared chevron points back. Half a turn points it on. */
    .chevron {
      flex: none;
      inline-size: 1.125rem;
      block-size: 1.125rem;
      rotate: 180deg;
      color: var(--admin-ink-muted);
    }

    .all {
      font-weight: 500;
      color: var(--admin-accent);
    }

    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    .bar {
      display: block;
      inline-size: min(12rem, 100%);
      block-size: 0.75rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (max-width: 47.99rem) {
      .row {
        min-block-size: 3rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordCollection {
  /** The heading, already translated. */
  readonly heading = input.required<string>();
  /** A short list, or one row with a count. */
  readonly shape = input.required<'panel' | 'link'>();
  /** The count. `null` draws none. */
  readonly count = input<number | null>(null);
  /** The rows of a panel. */
  readonly rows = input<readonly RecordCollectionRow[]>([]);
  /** Whether the list holds more rows than were handed. */
  readonly more = input(false);
  /** Where "See all" and the link shape lead. */
  readonly all = input<CollectionLink | null>(null);
  /** A translation key for what an empty panel says. */
  readonly emptyKey = input<string | null>(null);
  readonly status = input<'loading' | 'ready' | 'error'>('ready');

  /** The read failed, and the operator asks again. */
  readonly retry = output<void>();

  private readonly _viewport = inject(Viewport);

  /** One row that opens the list: the link shape, and every shape on a phone. */
  readonly asLink = computed(
    () => this.shape() === 'link' || this._viewport.compact()
  );

  /**
   * Whether the collection is known to hold nothing. A count says so when
   * there is one. Without a count, a panel that was read and came back empty
   * says so.
   */
  readonly nothing = computed(() => {
    const count = this.count();
    if (count !== null) {
      return count === 0;
    }
    return (
      this.shape() === 'panel' &&
      this.status() === 'ready' &&
      this.rows().length === 0 &&
      !this.more()
    );
  });

  /** Where "See all" leads, when the list holds more than the rows drawn. */
  readonly seeAll = computed<CollectionLink | null>(() => {
    const count = this.count();
    const holdsMore =
      this.more() || (count !== null && count > this.rows().length);
    return holdsMore ? this.all() : null;
  });
}
