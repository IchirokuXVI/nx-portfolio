import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  compositeId,
  type NamedAction,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  CautionLine,
  PopoverSheet,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { MoreIcon } from '@portfolio/shared/ui';
import { day } from './people-format';
import type { MembershipRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';
import { ActionConfirm, ActionRunner, isDangerAction } from './row-actions';
import { ZoneContext } from './shopper-contexts';
import { ZONE_CAUTION } from './shopper-params';
import { ShoppersStatus } from './shoppers-status';

/** One entry of a member's menu: somewhere to go, or something to do. */
export interface MemberMenuItem {
  readonly key: string;
  /** A translation key. */
  readonly label: string;
  /** Where the entry goes, for one that is a link. */
  readonly path: readonly string[] | null;
  /** What the entry does, for one that is an action. */
  readonly action: NamedAction<ResourceRow> | null;
}

/** One member of the zone, as a row of the tab. */
export interface MemberRow {
  readonly member: MembershipRow;
  /** Whether the person asked to join and nobody has answered. */
  readonly waiting: boolean;
  /** The line under the name, already translated. */
  readonly line: string;
  /** The person's own page, or `null` when the app did not mount people. */
  readonly personPath: readonly string[] | null;
  /** What can be done to this member right now. */
  readonly actions: readonly NamedAction<ResourceRow>[];
  /**
   * The menu of a member who is not waiting: the person, then the form that
   * changes the role and the name, among the actions that apply.
   */
  readonly menu: readonly MemberMenuItem[];
}

/** The actions that take a person out of the zone, which the menu puts last. */
const LEAVING: readonly string[] = ['kick-member', 'ban-member'];

/** The two answers to a request, which a row that waits draws beside it. */
const ANSWERS: readonly string[] = ['approve-member', 'reject-member'];

/**
 * The Members tab of a zone (admin plan 0045, target 5).
 *
 * The requests that wait come first, on the waiting wash, each with the two
 * answers beside it. Then everybody else, oldest first as the gateway sends
 * them, with their role and whether they are still in the zone. A name is a
 * link to that person.
 *
 * **Every action is the membership descriptor's.** Let in, refuse, make owner,
 * remove and ban are declared once, on `MEMBERSHIPS`, with the rule for when
 * each applies. This tab asks the descriptor which ones a row may have and
 * draws those. So the owner's row has no menu because nothing applies to an
 * owner, and not because the tab says so a second time. A row that waits
 * draws its two answers and nothing else.
 *
 * The members come with the zone's own read, so the tab makes no request of
 * its own and cannot disagree with the count on its tab.
 */
@Component({
  selector: 'lib-zone-members-tab',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    CautionLine,
    PopoverSheet,
    MoreIcon,
    ActionConfirm,
  ],
  template: `
    @if (actions.errorKey(); as key) {
      <p class="refusal" role="alert">{{ key | rokuT }}</p>
    }

    @if (zone.row(); as row) {
      @if (rows().length === 0) {
        <p class="state">{{ 'people.zones.noMembers' | rokuT }}</p>
      } @else {
        <ul class="panel" data-members>
          @for (entry of rows(); track entry.member.membershipId) {
            <li
              [attr.data-member]="entry.member.membershipId"
              [class.waiting]="entry.waiting"
              class="row"
            >
              <span class="row-main">
                @if (entry.personPath; as path) {
                  <a [routerLink]="path" class="row-title">{{
                    entry.member.username
                  }}</a>
                } @else {
                  <span class="row-title">{{ entry.member.username }}</span>
                }
                <span class="row-line">{{ entry.line }}</span>
              </span>

              @if (entry.waiting) {
                <!-- The two answers to a request, said where the request is. -->
                <span class="row-actions">
                  @for (action of entry.actions; track action.name) {
                    <button
                      (click)="run(action, entry.member)"
                      [attr.data-action]="action.name"
                      [class.primary]="action.name === 'approve-member'"
                      [disabled]="actions.busy()"
                      class="button small"
                      type="button"
                    >
                      {{ action.label | rokuT }}
                    </button>
                  }
                </span>
              } @else {
                <span
                  [class.danger]="entry.member.status !== 'APPROVED'"
                  [class.good]="
                    entry.member.status === 'APPROVED' &&
                    entry.member.role === 'OWNER'
                  "
                  class="chip"
                  >{{
                    (entry.member.status === 'APPROVED'
                      ? 'people.zones.role.' + entry.member.role
                      : 'people.zones.membership.' + entry.member.status
                    ) | rokuT
                  }}</span
                >
                @if (entry.actions.length === 0) {
                  <!-- No action applies, which is the owner: the zone is
                       handed on first. The space keeps the states in one
                       column. -->
                  <span class="no-menu"></span>
                } @else {
                  <button
                    (click)="toggleMenu(entry.member.membershipId)"
                    [attr.aria-expanded]="
                      menuFor() === entry.member.membershipId
                    "
                    [attr.aria-label]="
                      'people.memberships.menu'
                        | rokuT: { name: entry.member.username }
                    "
                    #anchor
                    class="button small icon"
                    type="button"
                    data-member-menu
                  >
                    <lib-more-icon />
                  </button>
                  @if (menuFor() === entry.member.membershipId) {
                    <lib-popover-sheet
                      (closed)="closeMenu()"
                      [anchor]="anchor"
                      [heading]="
                        'people.memberships.menu'
                          | rokuT: { name: entry.member.username }
                      "
                      [sheet]="compact()"
                      align="end"
                      width="15rem"
                    >
                      <div class="menu">
                        @for (item of entry.menu; track item.key) {
                          @if (item.action; as action) {
                            <button
                              (click)="run(action, entry.member)"
                              [attr.data-action]="action.name"
                              [class.danger]="isDanger(action)"
                              class="menu-item"
                              type="button"
                            >
                              {{ item.label | rokuT }}
                            </button>
                          } @else {
                            <a
                              (click)="closeMenu()"
                              [attr.data-link]="item.key"
                              [routerLink]="item.path"
                              class="menu-item"
                              >{{ item.label | rokuT }}</a
                            >
                          }
                        }
                      </div>
                    </lib-popover-sheet>
                  }
                }
              }
            </li>
          }
        </ul>
      }

      <lib-caution-line [text]="caution | rokuT" />
    } @else if (zone.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }

    <lib-action-confirm [runner]="actions" />
  `,
  styles: [
    PEOPLE_STYLES,
    `
      /* The answer that lets the person in is the last of the two, where the
         main action of a row sits. */
      .row-actions > .primary {
        order: 1;
      }

      .no-menu {
        flex: none;
        inline-size: var(--admin-control);
      }

      .menu {
        display: flex;
        flex-direction: column;
      }

      .menu-item {
        display: flex;
        align-items: center;
        min-block-size: 2.75rem;
        padding: var(--admin-space-2) var(--admin-space-4);
        border: none;
        border-block-start: 1px solid var(--admin-border);
        border-radius: 0;
        background: none;
        font: inherit;
        text-align: start;
        text-decoration: none;
        color: var(--admin-ink);
        cursor: pointer;
      }

      .menu-item:first-child {
        border-block-start: none;
      }

      .menu-item.danger {
        color: var(--admin-danger);
      }

      .menu-item:hover {
        background: var(--admin-surface);
      }

      .menu-item:focus-visible {
        outline: 2px solid var(--admin-accent);
        outline-offset: -2px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneMembersTab {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _status = inject(ShoppersStatus);

  readonly zone = inject(ZoneContext);
  readonly actions = new ActionRunner();
  readonly compact = inject(Viewport).compact;

  readonly caution = ZONE_CAUTION;

  /** The membership actions, built once in this injection context. */
  private readonly _named: readonly NamedAction<ResourceRow>[] =
    this._registry.byName('memberships')?.actions?.named?.() ?? [];

  /** The member whose menu is open, by membership id, or `null`. */
  readonly menuFor = signal<string | null>(null);

  /** The requests that wait, then everybody else in the order they joined. */
  readonly rows = computed<readonly MemberRow[]>(() => {
    const zone = this.zone.row();
    if (zone === null) {
      return [];
    }
    const locale = this._translator.locale();

    const rows = zone.members.map((member): MemberRow => {
      const waiting = member.status === 'PENDING';
      const personPath = this._registry.rowPath('users', member.userId);
      const formPath = this._registry.rowPath(
        'memberships',
        compositeId([zone.id, member.membershipId]),
        { zoneId: zone.id }
      );
      const available = this._named.filter(
        (action) => action.available?.(member) ?? true
      );
      // A request is answered where it is: let in, or refused. Everything
      // else waits until the person is in the zone.
      const actions = waiting
        ? available.filter((action) => ANSWERS.includes(action.name))
        : available;
      const entry = (action: NamedAction<ResourceRow>): MemberMenuItem => ({
        key: action.name,
        label: action.label,
        path: null,
        action,
      });

      return {
        member,
        waiting,
        line: this._translator.t(
          waiting
            ? 'people.memberships.asked'
            : member.status === 'APPROVED'
              ? 'people.memberships.since'
              : 'people.memberships.joined',
          undefined,
          undefined,
          { when: day(member.createdAt, locale) }
        ),
        personPath,
        actions,
        menu: [
          ...(personPath === null
            ? []
            : [
                {
                  key: 'person',
                  label: 'people.memberships.openPerson',
                  path: personPath,
                  action: null,
                },
              ]),
          ...actions
            .filter((action) => !LEAVING.includes(action.name))
            .map(entry),
          ...(formPath === null
            ? []
            : [
                {
                  key: 'change',
                  label: 'people.memberships.change',
                  path: formPath,
                  action: null,
                },
              ]),
          ...actions
            .filter((action) => LEAVING.includes(action.name))
            .map(entry),
        ],
      };
    });

    return [
      ...rows.filter((row) => row.waiting),
      ...rows.filter((row) => !row.waiting),
    ];
  });

  isDanger(action: NamedAction<ResourceRow>): boolean {
    return isDangerAction(action);
  }

  toggleMenu(membershipId: string): void {
    this.menuFor.update((open) =>
      open === membershipId ? null : membershipId
    );
  }

  closeMenu(): void {
    this.menuFor.set(null);
  }

  /** Run one of the membership's actions, asking first where it says to ask. */
  run(action: NamedAction<ResourceRow>, member: MembershipRow): void {
    this.closeMenu();
    this.actions.start(action, member, {
      args: { name: member.username, zone: member.zoneName },
      // Letting somebody in is undone by removing them. The others are not.
      tone: action.name === 'approve-member' ? 'primary' : 'danger',
      after: () => this._changed(),
    });
  }

  /**
   * A membership moved. The zone is read again, the column of zones reads its
   * count of requests again, and so does the rail.
   */
  private async _changed(): Promise<void> {
    this._changes.wrote('memberships');
    this._changes.wrote('zones');
    this._status.refresh();
    await this.zone.reload();
  }
}
