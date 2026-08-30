import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
import {
  appPath,
  listIdOf,
  SheetNavigation,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { ShareRow, SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';
import { selectShareSummary } from '../select-share-summary';

/**
 * Whether two permission sets say the same thing.
 *
 * Both sides arrive in the same fixed order, the row's own box order, so this compares
 * as sequences rather than sorting. It is what makes a row edited back to where it
 * started stop being an edit, which is the second of section 3's three rules.
 */
function samePermissions(
  a: readonly ListPermission[],
  b: readonly ListPermission[]
): boolean {
  return a.length === b.length && a.every((value, at) => value === b[at]);
}

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
 * ## It never saved, and the sheet owned half of why (plan 0036)
 *
 * Pressing Save under "Who can use this list" showed an error, for everybody whose
 * group has an owner, which is every group. The sheet seeded its state from
 * `GET /access` and sent **all of it** back, and that payload contained rows for the
 * group's owner and admins, which backend rule 2 refuses even from a caller who is
 * staff themselves. The server no longer returns those rows (backend plan 0042), and
 * this sheet no longer sends what it did not change: `PUT` replaces each named
 * membership's set outright and leaves unnamed memberships alone, so a payload of only
 * the edited rows is not an optimisation, it is the correct expression of the change.
 * Both halves ship, and each is correct on its own terms.
 *
 * ## One scroll, a footer, and rows that are closed
 *
 * The rest of the same report. The member list had its own `32vh` scroll inside a sheet
 * that also scrolls, so on a phone the thumb landed in one of them and the other was
 * unreachable; Save and Cancel were ordinary elements at the end of that scroll, so
 * past about four members the primary action of the sheet was off screen; and every
 * member was four checkboxes, expanded, always, so the question people open this sheet
 * with had to be answered by reading forty eight of them.
 *
 * So: the inner scroll is gone, the buttons moved into a footer stuck to the bottom of
 * the panel, and each row is a disclosure that says what somebody can do in one word
 * before it offers to let you change it. The two Saves became one, which commits
 * whatever the sheet is holding; the split into **requests** is untouched, because the
 * gateway validates with `forbidNonWhitelisted`.
 *
 * ## Two switches that save themselves
 *
 * `autoApprove` and `sharedWithZone` are both saved on the flip rather than gathered by
 * the footer, and deliberately so: each is a rule about what happens to the **next**
 * thing, a line or a person, rather than a preference somebody is proposing, and a
 * switch that waits for a Save button reads as the second.
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
  private readonly _sheet = inject(SheetNavigation);
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

  /**
   * What `GET /v1/lists/:id/access` returned, untouched.
   *
   * Kept separately from the edits, and that separation is the defect (plan 0036,
   * section 3). It is what the rows are drawn from and what an edit is compared
   * against; it is never sent.
   */
  private readonly _loadedAccess = signal<readonly ListAccessEntry[]>([]);

  /**
   * Only the rows somebody actually changed, by membership id.
   *
   * `PUT` replaces each named membership's set outright and leaves unnamed memberships
   * alone (backend plan 0036, section 5.2), so a payload of only the edited rows is not
   * an optimisation, it is the correct expression of the change. The complete resend
   * was always a larger claim than this sheet had any reason to make, and it is what
   * made every save fail: it echoed back rows for the group's owner and admins, which
   * rule 2 refuses, so nothing was ever written.
   */
  private readonly _edits = signal<
    ReadonlyMap<string, readonly ListPermission[]>
  >(new Map());

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

  /**
   * Whether everybody in the group may use this list, including people who join later
   * (plan 0036, section 7; backend plan 0042).
   *
   * Live position, saved on the flip like `autoApprove` and for the same reason: it
   * decides what happens to the next person who joins, and there is nothing to preview.
   * The create sheet's toggle is unchanged and now sets a value that persists rather
   * than performing a one time grant.
   */
  readonly sharedWithZone = signal(false);

  /** Whether deleting needs the name typed. Only when there is something to lose. */
  readonly needsTypedName = computed(
    () => this._lines.linesIn(this.listId()).length > 0
  );

  readonly canDelete = computed(
    () =>
      !this.needsTypedName() ||
      this.typedName().trim() === (this.list()?.name ?? '').trim()
  );

  /** Whether the name in the field is a change this sheet could send. */
  private readonly _nameChanged = computed(
    () => this.name().trim() !== '' && this.name().trim() !== this.list()?.name
  );

  /** Whether anybody's access was edited and not put back where it started. */
  readonly hasAccessEdits = computed(() => this._edits().size > 0);

  /**
   * One Save, which commits whatever the sheet is holding (plan 0036, section 4.1).
   *
   * There were two, one for the name and one for access, and the footer has room for
   * one. The split into **requests** survives untouched: a changes object carries only
   * what its own button owned, because the gateway validates with
   * `forbidNonWhitelisted` and a body carrying every field would let a rename overwrite
   * a setting somebody else had just changed.
   *
   * Nothing pending disables it, which is the honest answer to a sheet whose other two
   * controls save themselves.
   */
  readonly canSave = computed(
    () => (this._nameChanged() || this.hasAccessEdits()) && !this.submitting()
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
    const loaded = new Map(
      this._loadedAccess().map((entry) => [
        entry.membershipId,
        entry.permissions,
      ])
    );
    const edits = this._edits();
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

        // An edit shows over what was read, so a row somebody opened and changed keeps
        // showing the change while they work down the rest of the list.
        const permissions: readonly ListPermission[] = isStaff
          ? ['READ', 'WRITE', 'DECIDE', 'MANAGE']
          : (edits.get(member.id) ?? loaded.get(member.id) ?? []);

        return {
          membershipId: member.id,
          username: member.username,
          permissions,
          lockedPermissions: locked,
          fixed: isStaff,
          fixedReasonKey: isStaff
            ? 'list.settings.access.staffNote'
            : locked.length > 0
              ? 'list.settings.access.manageLocked'
              : null,
          // Group staff summarise to ADMIN like anybody else holding it: the summary is
          // about what somebody can do, not about where it came from (section 5).
          summary: selectShareSummary(permissions),
          edited: edits.has(member.id),
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
    this.sharedWithZone.set(this.list()?.sharedWithZone ?? false);

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
   * Open this list to the group, or stop opening it (plan 0036, section 7).
   *
   * Saved on the flip, like the switch above it: it is a rule about who arrives next
   * rather than a preference somebody is proposing, and a switch that waits for a Save
   * button reads as the second.
   *
   * **Turning it off does not revoke anybody**, which is what the hint under it says,
   * because the opposite reading is the natural one and it is the reading that loses
   * somebody their access. Removing one person is one row in the list below.
   *
   * Turning it **on** grants, so the access the sheet is showing is now stale: the
   * rows are reread rather than guessed at, since a guess here is somebody's access
   * drawn wrong in the one screen that exists to be right about it.
   */
  async setSharedWithZone(event: Event): Promise<void> {
    const next = (event.target as HTMLInputElement).checked;
    const previous = this.sharedWithZone();

    this.sharedWithZone.set(next);
    this.errorKey.set(null);

    try {
      await this._listService.updateList(this.listId(), {
        sharedWithZone: next,
      });
      await this._lists.refresh(this.zoneId());
      if (next) {
        await this._loadAccess();
      }
    } catch (error) {
      this.sharedWithZone.set(previous);
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
    const loaded =
      this._loadedAccess().find(
        (entry) => entry.membershipId === change.membershipId
      )?.permissions ?? [];

    this._edits.update((current) => {
      const next = new Map(current);
      if (samePermissions(loaded, change.permissions)) {
        // Back where it started, so there is nothing to send. Otherwise opening a row,
        // ticking a box and unticking it would send an entry that says nothing, and
        // against a staff row that nothing is a 403.
        next.delete(change.membershipId);
      } else {
        next.set(change.membershipId, change.permissions);
      }
      return next;
    });
  }

  /**
   * Commit whatever the sheet is holding: the name, the access, or both.
   *
   * Two requests when both changed, name first, each carrying only the fields its own
   * endpoint owns (section 4.1). One button, because the footer has room for one and
   * because two Saves in one sheet is two things to explain.
   *
   * The store is refreshed rather than patched, because a rename also changes the row
   * on the group page behind this sheet and one reread keeps both right.
   */
  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      if (this._nameChanged()) {
        await this._listService.updateList(this.listId(), {
          name: this.name().trim(),
        });
        await this._lists.refresh(this.zoneId());
      }
      if (this.hasAccessEdits()) {
        await this._listService.setListAccess(
          this.listId(),
          [...this._edits()].map(([membershipId, permissions]) => ({
            membershipId,
            permissions,
          }))
        );
      }
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
      // To the group, not back to a list that no longer exists, and replacing this
      // sheet's own entry so the back button cannot return to one either (plan 0031).
      await this._sheet.leaveTo(
        appPath(this._locale(), this._basePath, 'zones', this.zoneId())
      );
    } catch (error) {
      this.submitting.set(false);
      this.errorKey.set(listErrorKey(error, 'list.manage'));
    }
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
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
      this._loadedAccess.set(await read.call(this._listService, this.listId()));
    } catch {
      // Quiet, and the section stays empty rather than showing a guess. A wrong guess
      // here is not a worse screen, it is somebody losing access they had.
    }
  }
}
