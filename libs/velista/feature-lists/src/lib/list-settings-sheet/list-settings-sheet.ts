import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  LineStore,
  LIST_ACCESS_READABLE,
  LIST_SERVICE,
  ListStore,
  MemberNames,
  ZoneStore,
  type ListServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LIST_NAME_MAX_LENGTH,
  type ListAccessEntry,
  type ListPermission,
  type ShareRowVm,
} from '@portfolio/velista/models';
import { appPath, listIdOf, zoneIdOf } from '@portfolio/velista/platform';
import { ShareRow, SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';

/**
 * Rename this list, configure it, decide who can use it, and delete it.
 *
 * All four are `MANAGE`, which is one permission the server sends rather than the old
 * creator-or-zone-staff rule (backend plan 0036, section 4). The overflow that opens this
 * sheet is drawn from `canManage` and the composer from `canWrite`, so neither offers a
 * control the server will refuse (rule G2). What that stopped being is a *different kind*
 * of rule from the one gating lines: a list admin who cannot add a line is still an odd
 * arrangement, and it is now an odd arrangement somebody chose in this sheet rather than
 * one the model imposed.
 *
 * ## The share section is offered at last
 *
 * `0012` section 5.5 built it and switched it off, because `PUT /v1/lists/:id/access`
 * replaces the set it is given and there was no `GET`: a sheet built from ignorance of
 * the current set would silently revoke everybody it did not happen to include, and the
 * person saving could not see what they took away. The endpoint lands with backend plan
 * 0036, `LIST_ACCESS_READABLE` is true, and the section is reachable.
 *
 * It grew three rules on the way in (plan 0030, section 6):
 *
 * - four checkboxes rather than three segments, because `WRITE` and `DECIDE` are
 *   independent and a segmented control cannot say so;
 * - group staff rows are drawn, fully ticked and fixed, because they hold everything on
 *   every list in the zone by derivation and a hidden row invites the question this
 *   sheet is the only place to answer;
 * - `MANAGE` is live only for a caller who is group staff, and drawn disabled with its
 *   reason for everybody else, because only the group appoints list admins (backend plan
 *   0036, section 5.1).
 *
 * The creator's row is no longer fixed. Their power became an ordinary access row
 * (backend plan 0036, section 2.5), so a group admin can rewrite it, `MANAGE` included,
 * and what the creator keeps here is a label beside their name.
 *
 * ## Deleting is friction proportional to what is lost
 *
 * A list with lines needs its name typed, which is `0010`'s rule for a group. An empty
 * list is a two tap delete, because an empty list loses nothing and making somebody
 * type a name to discard nothing is ceremony rather than safety.
 */
@Component({
  selector: 'lib-list-settings-sheet',
  imports: [RokuTranslatorPipe, ShareRow, SheetShell, SpinnerIcon],
  templateUrl: './list-settings-sheet.html',
  styleUrl: './list-settings-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListSettingsSheet {
  private readonly _lists = inject(ListStore);
  private readonly _listService = inject<ListServiceI>(LIST_SERVICE);
  private readonly _lines = inject(LineStore);
  private readonly _names = inject(MemberNames);
  private readonly _zones = inject(ZoneStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);

  readonly maxLength = LIST_NAME_MAX_LENGTH;

  /** Whether the share section is drawn at all. See the class comment. */
  readonly shareAvailable = LIST_ACCESS_READABLE;

  readonly name = signal('');
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** Which delete confirmation is showing, if any. */
  readonly confirmingDelete = signal(false);
  readonly typedName = signal('');

  private readonly _access = signal<readonly ListAccessEntry[]>([]);

  readonly list = computed(() =>
    this._lists.listsIn(this.zoneId()).find((l) => l.id === this.listId())
  );

  /**
   * Whether this caller is a group `OWNER` or `ADMIN`, which is the one thing on this
   * sheet that is not a list permission.
   *
   * From `MyZone.myRole` rather than from the member list, and it is worth saying why,
   * because plan 0030 section 6.1.1 names the membership store. Both hold the fact and
   * `myRole` is the copy that arrives with the zone itself, so it is answerable on the
   * frame the sheet opens; the member list is a second request whose absence would draw
   * every List admin box locked for a moment and then unlock them, which is the sheet
   * changing its mind in front of somebody. Null falls to not staff, and locked is the
   * safe direction: the server refuses the change either way, and a box that unlocks is
   * better than a box that appeared to work.
   */
  private readonly _callerIsGroupStaff = computed(() => {
    const role = this._zones.zoneById(this.zoneId())?.myRole;
    return role === 'OWNER' || role === 'ADMIN';
  });

  /** The switch's live position, seeded from the list and saved on its own. */
  readonly autoApprove = signal(false);

  /** Whether deleting needs the name typed. Only when there is something to lose. */
  readonly needsTypedName = computed(
    () => this._lines.linesIn(this.listId()).length > 0
  );

  readonly canDelete = computed(
    () =>
      !this.needsTypedName() ||
      this.typedName().trim() === (this.list()?.name ?? '').trim()
  );

  readonly canSave = computed(
    () =>
      this.name().trim() !== '' &&
      this.name().trim() !== this.list()?.name &&
      !this.submitting()
  );

  /**
   * Every approved member, and what they may do with this list (section 6.3).
   *
   * Two rules produce every row, and the row component renders from `lockedPermissions`
   * without knowing which one produced it, which is rule D1 doing its job.
   *
   * **Group staff are fixed.** They hold all four permissions on every list in the zone,
   * derived and not stored, so there is no row for them in the payload and nothing to
   * rewrite (backend plan 0036, section 2.4). They are drawn rather than hidden, and the
   * note beside them says what is true now: group admins always have full access to
   * every list in the group. It used to say staff can always open the list, which was
   * both weaker and, since `requireWrite` refused them, wrong.
   *
   * **Everybody else locks `MANAGE`, unless the caller is group staff.** Only a group
   * `OWNER` or `ADMIN` may move that bit in either direction (backend plan 0036, section
   * 5.1), so for a list admin who is not staff it draws in its current state, disabled,
   * with the reason. The other three boxes on the same row stay live.
   *
   * The creator is an **ordinary row** with `MANAGE` locked or not like any other. What
   * marks it is a label the sheet passes beside the name, not a `fixedReasonKey`: they
   * made the list, and that is a piece of history rather than a rule about the row.
   */
  readonly shareRows = computed<readonly ShareRowVm[]>(() => {
    const zoneId = this.zoneId();
    const access = new Map(
      this._access().map((entry) => [entry.membershipId, entry.permissions])
    );
    const callerIsStaff = this._callerIsGroupStaff();

    return this._names
      .membersOf(zoneId)
      .filter((member) => member.status === 'APPROVED')
      .map((member) => {
        const isStaff = member.role === 'OWNER' || member.role === 'ADMIN';
        const locked: readonly ListPermission[] = isStaff
          ? ['READ', 'WRITE', 'DECIDE', 'MANAGE']
          : callerIsStaff
            ? []
            : ['MANAGE'];

        return {
          membershipId: member.id,
          username: member.username,
          permissions: isStaff
            ? ['READ', 'WRITE', 'DECIDE', 'MANAGE']
            : (access.get(member.id) ?? []),
          lockedPermissions: locked,
          fixed: isStaff,
          fixedReasonKey: isStaff
            ? 'list.settings.access.staffNote'
            : locked.length > 0
              ? 'list.settings.access.manageLocked'
              : null,
        } satisfies ShareRowVm;
      });
  });

  /** Whether this row's member made the list. A label beside the name, and nothing more. */
  isCreator(membershipId: string): boolean {
    const list = this.list();
    return this._names
      .membersOf(this.zoneId())
      .some(
        (member) =>
          member.id === membershipId && member.userId === list?.createdByUserId
      );
  }

  constructor() {
    this.name.set(this.list()?.name ?? '');
    this.autoApprove.set(this.list()?.autoApproveLines ?? false);

    if (this.shareAvailable) {
      void this._loadAccess();
    }
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  onTypedNameInput(event: Event): void {
    this.typedName.set((event.target as HTMLInputElement).value);
  }

  async rename(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      // A changes object carrying only the field this button owns. The gateway
      // validates with `forbidNonWhitelisted` and a body carrying every field would let
      // a rename overwrite a setting somebody else had just changed.
      await this._listService.updateList(this.listId(), {
        name: this.name().trim(),
      });
      // The store is refreshed rather than patched, because the rename also changes
      // the row on the group page behind this sheet and one reread keeps both right.
      await this._lists.refresh(this.zoneId());
      await this.dismiss();
    } catch (error) {
      this.submitting.set(false);
      this.errorKey.set(listErrorKey(error, 'list.manage'));
    }
  }

  /**
   * Turn approving new lines on or off (backend plan 0037, section 3).
   *
   * Saved on the flip rather than on a Save button, and it is the one control in this
   * sheet that is. A switch that has to be confirmed reads as a preference somebody is
   * proposing, and this one is a rule about what happens to the next line anybody adds.
   * The optimistic position moves first so the switch does not stick under a thumb, and
   * it snaps back on a failure, because a switch showing the wrong answer here decides
   * what everybody else's lines arrive as.
   *
   * It changes **new** lines only. The ones already waiting keep waiting, which the
   * copy under it says, because those are somebody's outstanding question and a switch
   * is not an answer to one.
   */
  async setAutoApprove(event: Event): Promise<void> {
    const next = (event.target as HTMLInputElement).checked;
    const previous = this.autoApprove();

    this.autoApprove.set(next);
    this.errorKey.set(null);

    try {
      await this._listService.updateList(this.listId(), {
        autoApproveLines: next,
      });
      await this._lists.refresh(this.zoneId());
    } catch (error) {
      this.autoApprove.set(previous);
      this.errorKey.set(listErrorKey(error, 'list.manage'));
    }
  }

  /**
   * Change one person's access.
   *
   * The row hands over the whole set for that membership, so this stores it whole. Held
   * locally and sent on save, because `PUT` replaces each named membership's set
   * outright and the sheet is the thing holding the complete answer in front of the
   * person pressing the button (backend plan 0036, section 5.2).
   *
   * An **empty set is kept as an entry**, not dropped. It is how access is revoked: the
   * server deletes the row for it, and dropping it here would send nothing and leave the
   * person exactly as they were, which is the one failure mode this whole section was
   * switched off for.
   */
  changeAccess(change: {
    membershipId: string;
    permissions: readonly ListPermission[];
  }): void {
    this._access.update((current) => [
      ...current.filter((entry) => entry.membershipId !== change.membershipId),
      { membershipId: change.membershipId, permissions: change.permissions },
    ]);
  }

  async saveAccess(): Promise<void> {
    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      await this._listService.setListAccess(this.listId(), this._access());
      await this.dismiss();
    } catch (error) {
      this.submitting.set(false);
      this.errorKey.set(listErrorKey(error, 'list.manage'));
    }
  }

  startDelete(): void {
    this.confirmingDelete.set(true);
    this.typedName.set('');
  }

  async confirmDelete(): Promise<void> {
    if (!this.canDelete() || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      await this._listService.deleteList(this.listId());
      this._lines.forget(this.listId());
      await this._lists.refresh(this.zoneId());
      // To the group, not back to a list that no longer exists.
      await this._router.navigateByUrl(
        appPath(this._locale(), this._basePath, 'zones', this.zoneId())
      );
    } catch (error) {
      this.submitting.set(false);
      this.errorKey.set(listErrorKey(error, 'list.manage'));
    }
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId()
      )
    );
  }

  private async _loadAccess(): Promise<void> {
    const read = this._listService.getListAccess;
    if (read === undefined) {
      return;
    }

    try {
      this._access.set(await read.call(this._listService, this.listId()));
    } catch {
      // Quiet, and the section stays empty rather than showing a guess. A wrong guess
      // here is not a worse screen, it is somebody losing access they had.
    }
  }
}
