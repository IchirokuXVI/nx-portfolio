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
  type ListServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LIST_NAME_MAX_LENGTH,
  type ListAccessEntry,
  type ListRole,
  type ShareRowVm,
} from '@portfolio/velista/models';
import { appPath, listIdOf, zoneIdOf } from '@portfolio/velista/platform';
import { ShareRow, SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';

/**
 * Rename this list, decide who can use it, and delete it.
 *
 * All three are `requireManage`, which is the list's creator, a zone admin, or the
 * owner. That is a **different rule** from the write access that gates lines, and the
 * difference is not academic: a WRITER who did not create the list can add to it all
 * day and cannot rename it, and a zone OWNER can rename and delete a list they cannot
 * add a single line to. The overflow that opens this sheet reflects the manage rule and
 * the composer reflects the write rule, from the caller's own facts (rule G2).
 *
 * ## The share section is built and not offered
 *
 * Section 5.5 at length, and it is the one part of plan 0012 that cannot be correctly
 * shipped today. `PUT /v1/lists/:id/access` **replaces the whole set** and there is no
 * `GET`, so a sheet built from ignorance of the current set would silently revoke
 * everybody it did not happen to include, and the person saving could not see what they
 * took away. There is nothing to infer it from either: a list carries no access rows.
 *
 * So the rows, the three choices, the fixed creator and the staff note are all here and
 * all tested against `ListMemory`, behind `LIST_ACCESS_READABLE`. Flipping that constant
 * when the endpoint lands is the whole of the remaining work.
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
   * Every approved member, and what they may do with this list.
   *
   * The creator is a writer who cannot be demoted, and zone staff always have access
   * and are **not in the payload at all**, so both render as fixed rows with a sentence
   * saying why rather than as three greyed out buttons.
   */
  readonly shareRows = computed<readonly ShareRowVm[]>(() => {
    const zoneId = this.zoneId();
    const list = this.list();
    const access = new Map(
      this._access().map((entry) => [entry.membershipId, entry.role])
    );

    return this._names
      .membersOf(zoneId)
      .filter((member) => member.status === 'APPROVED')
      .map((member) => {
        const isCreator = member.userId === list?.createdByUserId;
        const isStaff = member.role === 'OWNER' || member.role === 'ADMIN';

        return {
          membershipId: member.id,
          username: member.username,
          role: isCreator
            ? 'WRITER'
            : (access.get(member.id) ?? null),
          fixed: isCreator || isStaff,
          fixedReasonKey: isCreator
            ? 'list.settings.access.creator'
            : isStaff
              ? 'list.settings.access.staffNote'
              : null,
        } satisfies ShareRowVm;
      });
  });

  constructor() {
    this.name.set(this.list()?.name ?? '');

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
      await this._listService.updateList(this.listId(), this.name().trim());
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
   * Change one person's access.
   *
   * Held locally and sent as a **complete set** on save, because that is what `PUT`
   * means. It can only do that safely once it can read the set it is replacing, which
   * is the whole of section 5.5.
   */
  changeAccess(change: { membershipId: string; role: ListRole | null }): void {
    this._access.update((current) => {
      const without = current.filter(
        (entry) => entry.membershipId !== change.membershipId
      );
      return change.role === null
        ? without
        : [...without, { membershipId: change.membershipId, role: change.role }];
    });
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
