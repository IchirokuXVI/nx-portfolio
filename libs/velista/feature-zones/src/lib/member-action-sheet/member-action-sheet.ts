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
  MEMBERSHIP_SERVICE,
  ZoneStore,
  type MembershipServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { ConfirmSheet, SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { membershipIdOf, zoneIdOf } from '../route-params';
import { shouldRefetch, zoneErrorKey } from '../zone-error-copy';

/** The four actions that need something in front of them before they happen. */
export type MemberSheetAction = 'remove' | 'ban' | 'transfer' | 'rename';

/**
 * One decision about one member: remove them, block them, hand them the group, or
 * change what they are called here.
 *
 * **The action arrives in route `data`**, one route entry per action, all four
 * rendering this component (section 4.2). One component and four entries rather than
 * four components, because everything except the copy and the request is identical,
 * and rather than one entry reading the action from the URL, because a route's `data`
 * is checkable in `routes.spec.ts` while a parsed segment is not.
 *
 * Three of the four are confirms and share `ConfirmSheet`. Renaming is not a confirm at
 * all: it needs a field, so it is a small form in a `SheetShell`, and it is the one
 * action here an ordinary member may take, on their own row (section 5.4).
 */
@Component({
  selector: 'lib-member-action-sheet',
  imports: [RokuTranslatorPipe, ConfirmSheet, SheetShell, SpinnerIcon],
  templateUrl: './member-action-sheet.html',
  styleUrl: './member-action-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberActionSheet {
  private readonly _members = inject<MembershipServiceI>(MEMBERSHIP_SERVICE);
  private readonly _zones = inject(ZoneStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly membershipId = membershipIdOf(this._route);

  readonly minLength = USERNAME_MIN_LENGTH;
  readonly maxLength = USERNAME_MAX_LENGTH;

  /** Declared per route entry, so `routes.spec.ts` can assert all four exist. */
  readonly action = (this._route.snapshot.data['action'] ??
    'remove') as MemberSheetAction;

  /**
   * The name in the title, handed over by the screen that opened this sheet.
   *
   * From the router's navigation state rather than refetched: the members screen has
   * the row on screen and already knows the name, and a second request to learn
   * something already displayed would put a spinner in front of a confirm.
   *
   * Read through the `Router` rather than off `history.state`, which is a browser
   * global and therefore not available on the server (plan 0001, D2). Both the current
   * and the last successful navigation are consulted because which one holds the state
   * depends on whether the component is constructed during the navigation or after it.
   *
   * Falls back to an empty string on a cold deep link. That reads as a slightly bare
   * title rather than a broken one, and no confirm sentence depends on the name to
   * make sense: "They lose this group and its lists" stands on its own.
   */
  readonly memberName = signal(
    nameFromNavigation(
      this._router.getCurrentNavigation()?.extras.state ??
        this._router.lastSuccessfulNavigation()?.extras.state
    )
  );

  readonly typedName = signal('');
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);

  readonly canRename = computed(() => {
    const next = this.typedName().trim();
    return (
      next.length >= this.minLength &&
      next.length <= this.maxLength &&
      !this.busy()
    );
  });

  /** The copy for the three confirms, keyed off the action so nothing is assembled. */
  readonly titleKey = computed(() => `zone.confirm.${this.action}.title`);
  readonly bodyKey = computed(() => `zone.confirm.${this.action}.body`);
  readonly actionKey = computed(() => `zone.confirm.${this.action}.action`);

  /** Remove and block are destructive; handing the group over is not. */
  readonly destructive = computed(
    () => this.action === 'remove' || this.action === 'ban'
  );

  async confirm(): Promise<void> {
    const zoneId = this.zoneId();
    const membershipId = this.membershipId();

    await this._run(async () => {
      switch (this.action) {
        case 'remove':
          await this._members.kick(zoneId, membershipId);
          this._zones.recordMembershipChange(zoneId, 'removed');
          return;
        case 'ban':
          await this._members.ban(zoneId, membershipId);
          this._zones.recordMembershipChange(zoneId, 'removed');
          return;
        case 'transfer':
          await this._members.transferOwnership(zoneId, membershipId);
          // The caller was demoted to ADMIN by the same call, so the zone has to be
          // re-read: every control on the group page is drawn from `myRole`, and the
          // one that just changed is theirs.
          await this._zones.loadZone(zoneId);
          return;
        case 'rename':
          await this._members.setUsername(
            zoneId,
            membershipId,
            this.typedName().trim()
          );
          return;
      }
    });
  }

  async dismiss(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'zones', this.zoneId(), 'members')
    );
  }

  onTypedName(event: Event): void {
    this.typedName.set((event.target as HTMLInputElement).value);
  }

  private async _run(send: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.errorKey.set(null);

    const operation =
      this.action === 'rename' ? 'member.rename' : 'member.govern';

    try {
      await send();
      // Back to the members screen, which re-reads on arrival, so the row this was
      // about is gone or renamed by the time it is on screen.
      await this.dismiss();
    } catch (error) {
      this.errorKey.set(zoneErrorKey(error, operation));

      if (shouldRefetch(error, operation)) {
        void this._zones.loadZone(this.zoneId());
      }
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * The member's name out of router state, narrowed rather than asserted.
 *
 * Navigation state is `unknown` as far as this component is concerned: it is set by
 * another screen, and a deep link sets nothing at all. Rule D4's habit applies even
 * though nothing here came off the wire.
 */
function nameFromNavigation(state: unknown): string {
  if (typeof state !== 'object' || state === null) {
    return '';
  }

  const name = (state as Record<string, unknown>)['name'];
  return typeof name === 'string' ? name : '';
}
