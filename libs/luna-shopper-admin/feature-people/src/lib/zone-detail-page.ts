import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DIRECTORY_SERVICE } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { DetailFacts, DetailFrame, type DetailFact } from './detail-frame';
import { DetailPage, nameOrId } from './detail-page';
import { instant } from './people-format';
import type { ZoneRow } from './people-seed';

type Member = Wire.AdminCoreAdminZoneMemberView;

/**
 * One household (plan 0007, section 2).
 *
 * Its membership with roles and states, its lists **by name and count**, and
 * the five named actions that touch it. Not its lists' contents: reading what a
 * household wrote down is a deliberate click on the list itself, and browsing
 * zones must not be a way to end up having read one by accident.
 *
 * The three membership actions and the two zone actions all delegate to the
 * service the zone's own admins reach, which is the whole reason they are named
 * actions and not a row editor: a kick and a ban are membership state plus the
 * broadcasts other clients have already applied, and transferring ownership is
 * two role changes and the zone's owner in one transaction.
 *
 * An **ownerless** zone is an ordinary state here rather than an error. The
 * owner deleted their account, the zone outlived them, and transferring
 * ownership to a remaining member is exactly what rescues it.
 */
@Component({
  selector: 'lib-zone-detail-page',
  imports: [DetailFrame, DetailFacts, ConfirmDialog, RokuTranslatorPipe],
  template: `
    <lib-detail-frame
      (back)="back()"
      (retry)="load()"
      [errorKey]="errorKey()"
      [heading]="heading()"
      [kindKey]="descriptor.labels.one"
      [loading]="loading()"
    >
      @if (row(); as zone) {
        <lib-detail-facts [facts]="facts()" />

        @if (actionErrorKey(); as key) {
          <p class="failed" role="alert">{{ key | rokuT }}</p>
        }

        <section>
          <h2>{{ 'people.zones.members' | rokuT }}</h2>
          @if (zone.members.length === 0) {
            <p class="muted">{{ 'people.zones.noMembers' | rokuT }}</p>
          } @else {
            <ul class="rows">
              @for (member of zone.members; track member.membershipId) {
                <li>
                  <div class="who">
                    <span class="name">{{ member.username }}</span>
                    <span class="muted">
                      {{ 'people.zones.role.' + member.role | rokuT }} ·
                      {{ 'people.zones.membership.' + member.status | rokuT }}
                    </span>
                  </div>
                  <div class="actions">
                    @if (canTransfer(member)) {
                      <button
                        (click)="askToTransfer(zone, member)"
                        [disabled]="busy()"
                        type="button"
                      >
                        {{ 'people.zones.action.transferOwnership' | rokuT }}
                      </button>
                    }
                    @if (canKick(member)) {
                      <button
                        (click)="askToKick(zone, member)"
                        [disabled]="busy()"
                        type="button"
                      >
                        {{ 'people.zones.action.kickMember' | rokuT }}
                      </button>
                    }
                    @if (canBan(member)) {
                      <button
                        (click)="askToBan(zone, member)"
                        [disabled]="busy()"
                        class="danger"
                        type="button"
                      >
                        {{ 'people.zones.action.banMember' | rokuT }}
                      </button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <section>
          <h2>{{ 'people.zones.lists' | rokuT }}</h2>
          @if (zone.lists.length === 0) {
            <p class="muted">{{ 'people.zones.noLists' | rokuT }}</p>
          } @else {
            <ul class="rows">
              @for (list of zone.lists; track list.id) {
                <li>
                  <button
                    (click)="openList(list.id)"
                    class="link"
                    type="button"
                  >
                    {{ list.name }}
                  </button>
                  <span class="muted">
                    {{
                      'people.zones.lineCount'
                        | rokuT: { count: list.lineCount }
                    }}
                  </span>
                </li>
              }
            </ul>
          }
        </section>

        <section>
          <h2>{{ 'people.detail.actions' | rokuT }}</h2>
          <div class="actions">
            <button
              (click)="askToRegenerate(zone)"
              [disabled]="busy()"
              type="button"
            >
              {{ 'people.zones.action.regenerateJoinCode' | rokuT }}
            </button>
            <button
              (click)="askToDelete(zone)"
              [disabled]="busy()"
              class="danger"
              type="button"
            >
              {{ 'people.zones.action.deleteZone' | rokuT }}
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

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .rows li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .who {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .name {
      font-weight: 600;
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
      gap: var(--admin-space-2);
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

    button.link {
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
      font-weight: 600;
      color: var(--admin-accent);
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
export class ZoneDetailPage extends DetailPage<ZoneRow> {
  private readonly _directory = inject(DIRECTORY_SERVICE);

  readonly heading = computed(() => this.row()?.name ?? this.id);

  readonly facts = computed<readonly DetailFact[]>(() => {
    const zone = this.row();
    if (zone === null) {
      return [];
    }

    return [
      { label: 'people.zones.id', text: zone.id },
      { label: 'people.zones.name', text: zone.name },
      {
        label: 'people.zones.status.label',
        text: this.translator.t(`people.zones.status.${zone.status}`),
      },
      {
        label: 'people.zones.owner',
        text: nameOrId(zone.ownerName ?? null, zone.ownerUserId),
      },
      { label: 'people.zones.joinCode', text: zone.joinCode },
      {
        label: 'people.zones.memberCount',
        text: String(zone.memberCount),
      },
      { label: 'people.zones.listCount', text: String(zone.listCount) },
      {
        label: 'people.zones.markedForDeletionAt',
        text: instant(zone.markedForDeletionAt, this.locale),
      },
      {
        label: 'people.zones.createdAt',
        text: instant(zone.createdAt, this.locale),
      },
      {
        label: 'people.zones.updatedAt',
        text: instant(zone.updatedAt, this.locale),
      },
    ];
  });

  constructor() {
    super();
    void this.load();
  }

  openList(listId: string): void {
    this.go(['/lists', listId]);
  }

  /** The owner is already the owner. Everybody else can be handed the zone. */
  canTransfer(member: Member): boolean {
    return member.role !== 'OWNER';
  }

  /**
   * Kicking and banning the owner is refused by core, so neither is offered.
   *
   * An owner leaves by handing the zone on first, which is the action beside
   * these two and the reason it exists.
   */
  canKick(member: Member): boolean {
    return member.role !== 'OWNER' && member.status !== 'KICKED';
  }

  canBan(member: Member): boolean {
    return member.role !== 'OWNER' && member.status !== 'BANNED';
  }

  askToTransfer(zone: ZoneRow, member: Member): void {
    this.ask({
      heading: 'people.zones.confirm.transferOwnership.heading',
      body: 'people.zones.confirm.transferOwnership.body',
      confirm: 'people.zones.confirm.transferOwnership.confirm',
      args: { name: zone.name, member: member.username },
      run: () =>
        this._directory.transferOwnership(zone.id, member.membershipId),
    });
  }

  askToKick(zone: ZoneRow, member: Member): void {
    this.ask({
      heading: 'people.zones.confirm.kickMember.heading',
      body: 'people.zones.confirm.kickMember.body',
      confirm: 'people.zones.confirm.kickMember.confirm',
      args: { name: zone.name, member: member.username },
      run: () => this._directory.kickMember(zone.id, member.membershipId),
    });
  }

  askToBan(zone: ZoneRow, member: Member): void {
    this.ask({
      heading: 'people.zones.confirm.banMember.heading',
      body: 'people.zones.confirm.banMember.body',
      confirm: 'people.zones.confirm.banMember.confirm',
      args: { name: zone.name, member: member.username },
      run: () => this._directory.banMember(zone.id, member.membershipId),
    });
  }

  askToRegenerate(zone: ZoneRow): void {
    this.ask({
      heading: 'people.zones.confirm.regenerateJoinCode.heading',
      body: 'people.zones.confirm.regenerateJoinCode.body',
      confirm: 'people.zones.confirm.regenerateJoinCode.confirm',
      args: { name: zone.name },
      run: async () => {
        await this._directory.regenerateJoinCode(zone.id);
      },
    });
  }

  askToDelete(zone: ZoneRow): void {
    this.ask({
      heading: 'people.zones.confirm.deleteZone.heading',
      body: 'people.zones.confirm.deleteZone.body',
      confirm: 'people.zones.confirm.deleteZone.confirm',
      args: { name: zone.name },
      run: async () => {
        await this._directory.deleteZone(zone.id);
        this.back();
      },
    });
  }
}
