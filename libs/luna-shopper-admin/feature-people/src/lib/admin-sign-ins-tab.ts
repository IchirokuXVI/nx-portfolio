import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { BlockNotice, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { instant } from './people-format';
import { PEOPLE_STYLES } from './people-styles';

/** One failed sign in, as the table draws it. */
export interface FailedSignInRow {
  readonly key: string;
  readonly when: string;
  readonly username: string;
  /** The address, or `null` for a request that carried none. */
  readonly ip: string | null;
}

/**
 * The most recent failed admin sign ins as rows. Pure, so that a spec reads
 * the rows without a screen.
 *
 * A proxy that did not pass the address through is a real row. The table says
 * "not recorded" there, and not an empty cell that reads as a bug.
 */
export function failedSignInRows(
  identity: Wire.AdminDashboardAdminIdentityDashboard,
  locale: string
): FailedSignInRow[] {
  return identity.loginFailures.recent.map((failure, index) => ({
    key: `${failure.at}-${index}`,
    when: instant(failure.at, locale),
    username: failure.username,
    ip: failure.ip,
  }));
}

/**
 * The "Failed sign ins" tab of Admins (admin plan 0046, targets 5 and 6): the
 * two counts, and the most recent attempts.
 *
 * It was a block of the Overview. The Overview keeps the tile that says how
 * many failed in the last 24 hours, and that tile opens this tab.
 *
 * **It reads nothing by itself.** The counts and the rows are the identity
 * block of the dashboard read, which the page above keeps current. So the tile,
 * the count on the tab and the table are one read and cannot disagree. When
 * auth did not answer that read, the tab says so and offers to ask again.
 */
@Component({
  selector: 'lib-admin-sign-ins-tab',
  imports: [RokuTranslatorPipe, BlockNotice],
  template: `
    @if (identity(); as block) {
      <dl class="counts">
        <div [class.waiting]="block.loginFailures.last24h > 0" class="count">
          <dt>{{ 'people.admins.failed.last24h' | rokuT }}</dt>
          <dd class="num" data-count="last24h">{{ last24h() }}</dd>
        </div>
        <div class="count">
          <dt>{{ 'people.admins.failed.last7d' | rokuT }}</dt>
          <dd class="num" data-count="last7d">{{ last7d() }}</dd>
        </div>
      </dl>

      @if (rows().length === 0) {
        <p class="state">{{ 'people.admins.failed.none' | rokuT }}</p>
      } @else if (compact()) {
        <ul class="panel">
          @for (row of rows(); track row.key) {
            <li class="row" data-failure>
              <span class="row-main">
                <span class="row-title mono">{{ row.username }}</span>
                <span class="row-line">{{ row.when }}</span>
                <span class="row-line">
                  {{ 'people.admins.failed.ip' | rokuT }}:
                  {{ row.ip ?? ('people.admins.failed.noIp' | rokuT) }}
                </span>
              </span>
            </li>
          }
        </ul>
      } @else {
        <div class="panel table">
          <table>
            <thead>
              <tr>
                <th scope="col">{{ 'people.admins.failed.when' | rokuT }}</th>
                <th scope="col">{{ 'people.admins.username' | rokuT }}</th>
                <th scope="col">{{ 'people.admins.failed.ip' | rokuT }}</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.key) {
                <tr data-failure>
                  <td>{{ row.when }}</td>
                  <td class="mono">{{ row.username }}</td>
                  <td [class.muted]="row.ip === null" class="mono">
                    {{ row.ip ?? ('people.admins.failed.noIp' | rokuT) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    } @else if (store.document() !== null || store.empty()) {
      <lib-block-notice (retry)="refresh()" heading="dashboard.down.identity" />
    } @else {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }
  `,
  styles: [
    PEOPLE_STYLES,
    `
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--admin-space-3);
      }

      /* The number first and what it counts under it, as on the Overview. The
         term comes first in the document, which is the order a definition
         list has, and the column is drawn from its end. */
      .count {
        display: flex;
        flex-direction: column-reverse;
        gap: 0.125rem;
        min-inline-size: 10rem;
        padding: var(--admin-space-3) var(--admin-space-4);
        border: 1px solid var(--admin-border);
        border-radius: var(--admin-radius);
        background: var(--admin-surface-raised);
      }

      .count dd {
        font-size: 1.625rem;
        font-weight: 600;
        line-height: 1.15;
      }

      .count dt {
        color: var(--admin-ink-muted);
      }

      .count.waiting {
        border-color: var(--admin-waiting-on-wash);
        background: var(--admin-waiting-wash);
      }

      .count.waiting dd,
      .count.waiting dt {
        color: var(--admin-waiting-on-wash);
      }

      .table {
        max-inline-size: 54rem;
        overflow-x: auto;
      }

      table {
        inline-size: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: var(--admin-space-3) var(--admin-space-4);
        text-align: start;
      }

      thead th {
        padding-block: var(--admin-space-2);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--admin-ink-muted);
      }

      tbody tr {
        border-block-start: 1px solid var(--admin-border);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSignInsTab {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _viewport = inject(Viewport);

  readonly store = inject(DashboardStore);
  readonly compact = this._viewport.compact;

  /** What auth said in the last read, or `null` when it said nothing. */
  readonly identity = computed(() => this.store.document()?.identity ?? null);

  readonly rows = computed(() => {
    const identity = this.identity();
    return identity === null
      ? []
      : failedSignInRows(identity, this._translate.locale());
  });

  readonly last24h = computed(() =>
    this._number(this.identity()?.loginFailures.last24h ?? 0)
  );

  readonly last7d = computed(() =>
    this._number(this.identity()?.loginFailures.last7d ?? 0)
  );

  /** Ask again, for a read that auth did not answer. */
  refresh(): void {
    void this.store.load();
  }

  private _number(value: number): string {
    return new Intl.NumberFormat(this._translate.locale()).format(value);
  }
}
