import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DIRECTORY_SERVICE } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import { idOf } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { DetailFacts, DetailFrame, type DetailFact } from './detail-frame';
import { DetailPage } from './detail-page';
import { instant } from './people-format';
import type { UserRow } from './people-seed';

/** One zone this person is in, as this screen links to it. */
interface UserZone {
  readonly id: string;
  readonly name: string;
}

/** How many zones one person's card lists before it stops asking for more. */
const ZONE_LIMIT = 50;

/**
 * One account (plan 0007, section 2).
 *
 * The account, the zones it is in, the two named actions, and a way through to
 * the form. `0074` put editing a user permanently out of scope on the grounds
 * that the invariants live in `account-deletion.service` and its neighbours
 * rather than in constraints; backend plan 0077 reversed that for exactly the
 * two columns it could put a service behind, and the form is where they are
 * changed.
 *
 * **`displayName` is shown here and not in the list.** It is whatever an
 * identity provider supplied, which for a Google sign in is somebody's real
 * full name. An operator opening one account has a reason to see it; a list
 * anybody might screenshot does not.
 *
 * **The zones are a second query, not a join.** Users are in auth's database
 * and zones are in core's, with no foreign key between them, so this asks the
 * zone listing for the ones this person is in, by the same `userId` filter the
 * zones screen offers. It goes through the registry rather than importing the
 * zones descriptor, so the two screens stay independent of each other.
 */
@Component({
  selector: 'lib-user-detail-page',
  imports: [DetailFrame, DetailFacts, ConfirmDialog, RokuTranslatorPipe],
  template: `
    <lib-detail-frame
      (back)="back()"
      (retry)="reload()"
      [errorKey]="errorKey()"
      [heading]="heading()"
      [kindKey]="descriptor.labels.one"
      [loading]="loading()"
    >
      @if (row(); as user) {
        <lib-detail-facts [facts]="facts()" />

        <section>
          <h2>{{ 'people.users.zones' | rokuT }}</h2>
          @if (zonesFailed()) {
            <p class="muted" role="status">
              {{ 'people.users.zonesUnavailable' | rokuT }}
            </p>
          } @else if (zones().length === 0) {
            <p class="muted">{{ 'people.users.noZones' | rokuT }}</p>
          } @else {
            <ul>
              @for (zone of zones(); track zone.id) {
                <li>
                  <button (click)="openZone(zone)" type="button">
                    {{ zone.name }}
                  </button>
                </li>
              }
            </ul>
          }
        </section>

        <section>
          <h2>{{ 'people.detail.actions' | rokuT }}</h2>
          @if (actionErrorKey(); as key) {
            <p class="failed" role="alert">{{ key | rokuT }}</p>
          }
          <div class="actions">
            @if (canEdit) {
              <button (click)="edit()" [disabled]="busy()" type="button">
                {{ 'resource.action.edit' | rokuT }}
              </button>
            }
            @if (canResend()) {
              <button
                (click)="askToResend(user)"
                [disabled]="busy()"
                type="button"
              >
                {{ 'people.users.action.resendVerification' | rokuT }}
              </button>
            }
            <button
              (click)="askToDelete(user)"
              [disabled]="busy()"
              class="danger"
              type="button"
            >
              {{ 'people.users.action.deleteAccount' | rokuT }}
            </button>
          </div>
        </section>
      }
    </lib-detail-frame>

    @if (asking(); as pending) {
      <lib-confirm-dialog
        (confirm)="confirm()"
        (dismiss)="asking.set(null)"
        [bodyArgs]="pending.args"
        [bodyKey]="pending.body"
        [busy]="busy()"
        [confirmKey]="pending.confirm"
        [headingKey]="pending.heading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-block-start: var(--admin-space-4);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    ul {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .failed {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
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
export class UserDetailPage extends DetailPage<UserRow> {
  private readonly _directory = inject(DIRECTORY_SERVICE);
  private readonly _registry = inject(ResourceRegistry);

  readonly zones = signal<readonly UserZone[]>([]);
  /**
   * Whether the zone query failed.
   *
   * Its own state rather than an empty list, because "this person is in no
   * zones" and "we could not find out" are different answers and only one of
   * them is worth acting on.
   */
  readonly zonesFailed = signal(false);

  readonly heading = computed(() => this.row()?.username ?? this.id);

  readonly canResend = computed(() => {
    const user = this.row();
    return (
      user !== null && user.email !== null && user.emailVerifiedAt === null
    );
  });

  readonly facts = computed<readonly DetailFact[]>(() => {
    const user = this.row();
    if (user === null) {
      return [];
    }

    return [
      { label: 'people.users.userId', text: user.userId },
      { label: 'people.users.username', text: user.username },
      { label: 'people.users.displayName', text: user.displayName ?? '' },
      { label: 'people.users.email', text: user.email ?? '' },
      {
        label: 'people.users.kind.label',
        text: this.translator.t(`people.users.kind.${user.kind}`),
      },
      {
        label: 'people.users.emailVerifiedAt',
        text: instant(user.emailVerifiedAt, this.locale),
      },
      {
        label: 'people.users.hasPassword',
        text: this.translator.t(
          user.hasPassword ? 'resource.value.yes' : 'resource.value.no'
        ),
      },
      {
        label: 'people.users.providers',
        text: user.providers.join(', '),
      },
      {
        label: 'people.users.createdAt',
        text: instant(user.createdAt, this.locale),
      },
      {
        label: 'people.users.updatedAt',
        text: instant(user.updatedAt, this.locale),
      },
    ];
  });

  constructor() {
    super();
    void this.reload();
  }

  /** The account and its zones, both from the top. */
  async reload(): Promise<void> {
    await this.load();
    await this._loadZones();
  }

  openZone(zone: UserZone): void {
    this.go(['/zones', zone.id]);
  }

  askToResend(user: UserRow): void {
    this.ask({
      heading: 'people.users.confirm.resendVerification.heading',
      body: 'people.users.confirm.resendVerification.body',
      confirm: 'people.users.confirm.resendVerification.confirm',
      args: { name: user.username, email: user.email ?? '' },
      run: () => this._directory.resendVerification(user.userId),
    });
  }

  askToDelete(user: UserRow): void {
    this.ask({
      heading: 'people.users.confirm.deleteAccount.heading',
      body: 'people.users.confirm.deleteAccount.body',
      confirm: 'people.users.confirm.deleteAccount.confirm',
      args: { name: user.username },
      run: async () => {
        await this._directory.deleteUser(user.userId);
        // Nothing left to read. Going back to the list is the only honest
        // next screen, and it happens before `load` would answer 404.
        this.back();
      },
    });
  }

  private async _loadZones(): Promise<void> {
    this.zones.set([]);
    this.zonesFailed.set(false);

    const zones = this._registry.byName('zones');
    if (zones === undefined || this.row() === null) {
      return;
    }

    try {
      const page = await this._registry
        .gatewayFor(zones)
        .list({ filters: { userId: this.id }, limit: ZONE_LIMIT });

      this.zones.set(
        page.items.map((row) => ({
          id: idOf(zones, row),
          name: zones.title(row),
        }))
      );
    } catch {
      this.zonesFailed.set(true);
    }
  }
}
