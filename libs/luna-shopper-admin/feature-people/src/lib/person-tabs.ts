import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  DIRECTORY_SERVICE,
  orderedRoles,
  type AccountRole,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { FactList, type Fact } from './fact-list';
import { instant } from './people-format';
import type { UserRow, ZoneRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';
import { ActionConfirm, ActionRunner } from './row-actions';
import { PersonContext } from './shopper-contexts';
import { USER_ROLE_OPTIONS } from './user-roles';

/**
 * The Details tab of a person (admin plan 0045, target 3): the facts of the
 * account, and its roles.
 *
 * **A role is one switch, and each change is confirmed** (admin plan 0038).
 * What is sent is the whole set with one role changed, which is what the route
 * takes. The switch does not move until the operator says yes and the account
 * is read again. A guest holds no roles, so its switches are off and say why.
 *
 * "Edit" in the header opens the form, which is where the handle and the
 * display name change.
 */
@Component({
  selector: 'lib-person-details-tab',
  imports: [FactList, ActionConfirm, RokuTranslatorPipe],
  template: `
    @if (person.row(); as user) {
      <lib-fact-list [facts]="facts()" />

      <section aria-labelledby="person-roles-heading" class="roles-section">
        <h3 id="person-roles-heading">
          {{ 'people.users.roles.label' | rokuT }}
        </h3>
        @if (isGuest()) {
          <p class="muted">{{ 'people.users.roles.guest' | rokuT }}</p>
        }
        @if (actions.errorKey(); as key) {
          <p class="refusal" role="alert">{{ key | rokuT }}</p>
        }
        <ul class="panel">
          @for (role of roleOptions; track role.value) {
            <li class="row">
              <button
                (click)="askToSwitch(user, role.value)"
                [attr.aria-checked]="holds(user, role.value)"
                [disabled]="actions.busy() || isGuest()"
                class="role"
                role="switch"
                type="button"
              >
                <span aria-hidden="true" class="track"></span>
                <span class="row-main">
                  <span class="row-title">{{ role.label | rokuT }}</span>
                  <span class="row-line">{{
                    grantsKey(role.value) | rokuT
                  }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
        @if (rolesSaved()) {
          <p class="saved" role="status">
            {{ 'people.users.roles.saved' | rokuT }}
          </p>
        }
      </section>
    } @else if (person.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }

    <lib-action-confirm [runner]="actions" />
  `,
  styles: [
    PEOPLE_STYLES,
    `
      .roles-section {
        display: flex;
        flex-direction: column;
        gap: var(--admin-space-2);
      }

      .row {
        padding: 0;
      }

      button.role {
        display: flex;
        flex: 1;
        gap: var(--admin-space-3);
        align-items: center;
        min-block-size: 3rem;
        padding: var(--admin-space-2) var(--admin-space-4);
        border: none;
        border-radius: 0;
        background: none;
        font: inherit;
        text-align: start;
        color: var(--admin-ink);
        cursor: pointer;
      }

      button.role:disabled {
        opacity: 0.55;
        cursor: default;
      }

      button.role:focus-visible {
        outline: 2px solid var(--admin-accent);
        outline-offset: -2px;
      }

      .track {
        position: relative;
        flex: none;
        inline-size: 2.5rem;
        block-size: 1.5rem;
        border-radius: 999px;
        background: var(--admin-border-strong);
      }

      .track::after {
        content: '';
        position: absolute;
        inset-block-start: 0.1875rem;
        inset-inline-start: 0.1875rem;
        inline-size: 1.125rem;
        block-size: 1.125rem;
        border-radius: 50%;
        background: var(--admin-surface-raised);
      }

      button.role[aria-checked='true'] .track {
        background: var(--admin-accent);
      }

      button.role[aria-checked='true'] .track::after {
        transform: translateX(1rem);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonDetailsTab {
  private readonly _directory = inject(DIRECTORY_SERVICE);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _changes = inject(ResourceChanges);

  readonly person = inject(PersonContext);
  readonly actions = new ActionRunner();

  /** Every role, in the order the server lists them (backend plan 0175). */
  readonly roleOptions = USER_ROLE_OPTIONS;

  /**
   * Whether a role change went through on this visit.
   *
   * It stays up after the read that follows, because what it says is still
   * true then: the account itself sees the change only at its next token
   * refresh, which is up to 15 minutes away.
   */
  readonly rolesSaved = signal(false);

  /** A guest holds no roles, and the server refuses to give it any. */
  readonly isGuest = computed(() => this.person.row()?.kind === 'TEMPORARY');

  readonly facts = computed<readonly Fact[]>(() => {
    const user = this.person.row();
    if (user === null) {
      return [];
    }
    const locale = this._translator.locale();

    return [
      { label: 'people.users.username', text: user.username },
      { label: 'people.users.displayName', text: user.displayName ?? '' },
      { label: 'people.users.email', text: user.email ?? '' },
      {
        label: 'people.users.kind.label',
        text: this._translator.t(`people.users.kind.${user.kind}`),
      },
      {
        label: 'people.users.emailVerifiedAt',
        text: instant(user.emailVerifiedAt, locale),
      },
      {
        label: 'people.users.hasPassword',
        text: this._translator.t(
          user.hasPassword ? 'resource.value.yes' : 'resource.value.no'
        ),
      },
      { label: 'people.users.providers', text: user.providers.join(', ') },
      {
        label: 'people.users.createdAt',
        text: instant(user.createdAt, locale),
      },
      {
        label: 'people.users.updatedAt',
        text: instant(user.updatedAt, locale),
      },
      { label: 'people.users.userId', text: user.userId, id: true },
    ];
  });

  holds(user: UserRow, role: AccountRole): boolean {
    return user.roles.includes(role);
  }

  /** The line under a role's name saying what it grants. */
  grantsKey(role: AccountRole): string {
    return `people.users.roles.${role}.grants`;
  }

  /** One switch pressed, confirmed before anything is sent. */
  askToSwitch(user: UserRow, role: AccountRole): void {
    const granting = !this.holds(user, role);
    const next = granting
      ? orderedRoles([...user.roles, role])
      : user.roles.filter((held) => held !== role);
    const verb = granting ? 'grantRole' : 'removeRole';

    this.rolesSaved.set(false);
    this.actions.ask(
      {
        heading: `people.users.confirm.${verb}.heading`,
        body: `people.users.confirm.${verb}.body`,
        confirm: `people.users.confirm.${verb}.confirm`,
      },
      async () => {
        await this._directory.setUserRoles(user.userId, next);
        this.rolesSaved.set(true);
        // The list beside this page shows the roles as a column.
        this._changes.wrote('users');
        await this.person.reload();
      },
      {
        args: {
          name: user.username,
          role: this._translator.t(`people.users.roles.${role}.name`),
          grants: this._translator.t(this.grantsKey(role)),
        },
        refusals: { guest_has_no_roles: 'people.users.roles.guestRefused' },
        // A role is given back or taken away with the same switch.
        tone: 'primary',
      }
    );
  }
}

/** One zone a person is in, as a row of the tab. */
export interface PersonZone {
  readonly id: string;
  readonly name: string;
  readonly path: readonly string[] | null;
  /**
   * The person's role there, as a key, or `null` when the zone's members could
   * not be read or do not name this person.
   */
  readonly roleKey: string | null;
  /** The person's state there, as a key, or `null` for the same reason. */
  readonly statusKey: string | null;
  /** Whether the person is in the zone today: let in, and not removed. */
  readonly inside: boolean;
}

/** How many zones the tab reads before it stops asking for more. */
const ZONE_LIMIT = 50;

/**
 * The Zones tab of a person (admin plan 0045, target 3): the zones this person
 * is in, each with their role and state there. A row opens the zone.
 *
 * **Two reads, and neither is a join.** People are in one database and zones
 * in another. The zones a person is in come from the zone listing, narrowed to
 * that person. A listing row does not say what the person is in the zone, so
 * each zone is then read for its members. A person is in a handful of zones,
 * and the reads are capped at the first {@link ZONE_LIMIT}.
 *
 * A zone whose members could not be read is still listed, with no role beside
 * it: which zones somebody is in is the answer this tab exists for.
 */
@Component({
  selector: 'lib-person-zones-tab',
  imports: [RouterLink, RokuTranslatorPipe],
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
      }
      @case ('error') {
        <p class="state error" role="alert">
          {{ 'people.users.zonesUnavailable' | rokuT }}
          <button (click)="load()" class="button small" type="button">
            {{ 'resource.action.retry' | rokuT }}
          </button>
        </p>
      }
      @default {
        @if (zones().length === 0) {
          <p class="state">{{ 'people.users.noZones' | rokuT }}</p>
        } @else {
          <ul class="panel" data-zones>
            @for (zone of zones(); track zone.id) {
              <li class="row">
                <span class="row-main">
                  @if (zone.path; as path) {
                    <a [routerLink]="path" class="row-title">{{ zone.name }}</a>
                  } @else {
                    <span class="row-title">{{ zone.name }}</span>
                  }
                </span>
                @if (zone.roleKey; as key) {
                  <span class="chip">{{ key | rokuT }}</span>
                }
                @if (zone.statusKey; as key) {
                  <span
                    [class.danger]="!zone.inside && key !== pendingKey"
                    [class.good]="zone.inside"
                    [class.waiting]="key === pendingKey"
                    class="chip"
                    >{{ key | rokuT }}</span
                  >
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styles: [PEOPLE_STYLES],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonZonesTab {
  private readonly _registry = inject(ResourceRegistry);

  readonly person = inject(PersonContext);

  readonly pendingKey = 'people.zones.membership.PENDING';

  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly zones = signal<readonly PersonZone[]>([]);

  /** So that an answer for a person the page has left is dropped. */
  private _generation = 0;

  constructor() {
    effect(() => {
      const id = this.person.id();
      untracked(() => void this._read(id));
    });
  }

  load(): void {
    void this._read(this.person.id());
  }

  private async _read(userId: string | null): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    const descriptor = this._registry.byName('zones');

    this.state.set('loading');
    this.zones.set([]);
    if (userId === null || descriptor === undefined) {
      return;
    }
    const gateway = this._registry.gatewayFor(descriptor);

    try {
      const page = await gateway.list({
        filters: { userId },
        limit: ZONE_LIMIT,
      });
      const rows = await Promise.all(
        page.items.map(async (row): Promise<PersonZone> => {
          const zone = row as ZoneRow;
          // What the person is there is on the zone's own read.
          const member = await gateway
            .read(zone.id)
            .then((detail) =>
              (detail as ZoneRow).members?.find(
                (entry) => entry.userId === userId
              )
            )
            .catch(() => undefined);

          return {
            id: zone.id,
            name: zone.name,
            path: this._registry.rowPath('zones', zone.id),
            roleKey:
              member === undefined ? null : `people.zones.role.${member.role}`,
            statusKey:
              member === undefined
                ? null
                : `people.zones.membership.${member.status}`,
            inside: member?.status === 'APPROVED',
          };
        })
      );

      if (generation === this._generation) {
        this.zones.set(rows);
        this.state.set('ready');
      }
    } catch {
      if (generation === this._generation) {
        this.state.set('error');
      }
    }
  }
}
