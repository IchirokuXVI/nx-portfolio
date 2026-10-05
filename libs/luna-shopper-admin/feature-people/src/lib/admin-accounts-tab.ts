import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  RESOURCE_GATEWAYS,
  SessionStore,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { ADMINS_SOURCE, type Admin } from './admins';
import { instant } from './people-format';
import { PEOPLE_STYLES } from './people-styles';

/** One account, as the table draws it. */
export interface AccountRow {
  readonly id: string;
  /** The display name, or the sign in name for an account that has none. */
  readonly name: string;
  readonly username: string;
  /** Whether this is the admin who is signed in. */
  readonly you: boolean;
  /** Whether the account can still sign in. */
  readonly active: boolean;
  /** When it last signed in, as words. Empty for an account that never has. */
  readonly lastSignIn: string;
}

/**
 * The accounts as rows. Pure, so that a spec reads the rows without a screen.
 *
 * The signed in admin is told by the account's id and never by its name: two
 * accounts may carry one display name, and the mark says "this is you".
 */
export function accountRows(
  admins: readonly Admin[],
  signedInId: string | null,
  locale: string
): AccountRow[] {
  return admins.map((admin) => ({
    id: admin.adminId,
    name: admin.displayName ?? admin.username,
    username: admin.username,
    you: signedInId !== null && admin.adminId === signedInId,
    active: admin.disabledAt === null,
    lastSignIn: instant(admin.lastLoginAt, locale),
  }));
}

/**
 * The Accounts tab of Admins (admin plan 0046, target 6): who can open this
 * back office.
 *
 * Name, sign in name, state and last sign in, with the signed in admin marked.
 * **A row does not open.** There is no route that reads, changes or removes
 * one admin, so a row that looked like a control would lead nowhere. The info
 * button of the page says how an account is made.
 */
@Component({
  selector: 'lib-admin-accounts-tab',
  imports: [RokuTranslatorPipe],
  template: `
    @switch (status()) {
      @case ('loading') {
        <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
      }
      @case ('failed') {
        <p class="state error" role="alert">
          <span>{{ errorKey() | rokuT }}</span>
          <button (click)="load()" class="button small" type="button">
            {{ 'people.admins.accounts.retry' | rokuT }}
          </button>
        </p>
      }
      @default {
        @if (rows().length === 0) {
          <p class="state">{{ 'people.admins.accounts.none' | rokuT }}</p>
        } @else if (compact()) {
          <ul class="panel">
            @for (row of rows(); track row.id) {
              <li [class.off]="!row.active" class="row" data-account>
                <span class="row-main">
                  <span class="row-title">
                    {{ row.name }}
                    @if (row.you) {
                      <span class="you">{{ 'people.admins.you' | rokuT }}</span>
                    }
                  </span>
                  <span class="row-line mono">{{ row.username }}</span>
                  <span class="row-line">
                    {{ 'people.admins.lastLoginAt' | rokuT }}:
                    {{ row.lastSignIn || ('people.admins.never' | rokuT) }}
                  </span>
                </span>
                <span [class.good]="row.active" class="chip">
                  {{
                    (row.active
                      ? 'people.admins.state.active'
                      : 'people.admins.state.off'
                    ) | rokuT
                  }}
                </span>
              </li>
            }
          </ul>
        } @else {
          <div class="panel table">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ 'people.admins.name' | rokuT }}</th>
                  <th scope="col">{{ 'people.admins.username' | rokuT }}</th>
                  <th scope="col">{{ 'people.admins.state.label' | rokuT }}</th>
                  <th scope="col">{{ 'people.admins.lastLoginAt' | rokuT }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.id) {
                  <tr [class.off]="!row.active" data-account>
                    <th class="name" scope="row">
                      {{ row.name }}
                      @if (row.you) {
                        <span class="you">{{
                          'people.admins.you' | rokuT
                        }}</span>
                      }
                    </th>
                    <td class="mono">{{ row.username }}</td>
                    <td>
                      <span [class.good]="row.active" class="chip">
                        {{
                          (row.active
                            ? 'people.admins.state.active'
                            : 'people.admins.state.off'
                          ) | rokuT
                        }}
                      </span>
                    </td>
                    <td class="muted">
                      {{ row.lastSignIn || ('people.admins.never' | rokuT) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  `,
  styles: [
    PEOPLE_STYLES,
    `
      /* The table reads as a list of people and not as a grid of numbers, so
         it is no wider than its four columns need. */
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

      .name {
        font-weight: 600;
      }

      /* An account that is turned off stays in the list and steps back. */
      .off .name,
      .off .row-title,
      .off .mono {
        color: var(--admin-ink-muted);
      }

      .you {
        font-weight: 400;
        color: var(--admin-ink-muted);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAccountsTab {
  private readonly _gateway = inject(RESOURCE_GATEWAYS).for(ADMINS_SOURCE);
  private readonly _sessions = inject(SessionStore);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _viewport = inject(Viewport);

  private readonly _admins = signal<readonly Admin[]>([]);
  private readonly _error = signal<GatewayError | null>(null);

  readonly compact = this._viewport.compact;
  readonly status = signal<'loading' | 'ready' | 'failed'>('loading');

  /**
   * Whose session this is, by the account's id.
   *
   * The identity is the server's answer and arrives a round trip after the
   * session, so the mark can appear a moment after the rows. It never names
   * the wrong account.
   */
  readonly rows = computed(() =>
    accountRows(
      this._admins(),
      this._sessions.identity()?.adminId ?? null,
      this._translate.locale()
    )
  );

  readonly errorKey = computed(
    () => gatewayErrorKey(this._error()) ?? 'resource.error.unknown'
  );

  constructor() {
    void this.load();
  }

  /** Read the accounts. The route answers all of them, so there is one read. */
  async load(): Promise<void> {
    this.status.set('loading');

    try {
      const page = await this._gateway.list({});
      this._admins.set(page.items);
      this.status.set('ready');
    } catch (error) {
      this._error.set(toGatewayError(error));
      this.status.set('failed');
    }
  }
}
