import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListPermission, ShareRowVm } from '@portfolio/velista/models';
import { ChevronDownIcon } from '../icons/icons';

/** One checkbox: the permission it stands for, and the label it wears. */
interface Box {
  readonly permission: ListPermission;
  readonly key: string;
}

/** The one word each permission goes by when the row is closed (plan 0036, section 5). */
const SUMMARY_KEYS: Record<ListPermission, string> = {
  READ: 'list.settings.access.summary.read',
  WRITE: 'list.settings.access.summary.write',
  DECIDE: 'list.settings.access.summary.decide',
  MANAGE: 'list.settings.access.summary.manage',
};

/** Nothing left to number rows by, so the region ids only have to be unique. */
let nextRowId = 0;

/**
 * One member, and what they may do with this list.
 *
 * ## Closed, and saying what it is
 *
 * Every row starts collapsed (velista plan 0036, section 6). Four checkboxes say what a
 * row *can be changed to*, and twelve members is forty eight of them with no summary,
 * so the question people actually open this sheet with, who can do what here, had to be
 * answered by reading all of them. The header now answers it in one word from
 * `summary`, and the boxes are what opening the row reveals.
 *
 * **The whole header is the control**, not a chevron beside it, so the target is the
 * full width of the row, which is what a thumb needs, and the chevron becomes what it
 * should be: a state indicator rather than a hit area. It is a `button` with
 * `aria-expanded` naming the region it controls, because this is a disclosure and the
 * platform has a shape for a disclosure.
 *
 * The region stays in the DOM under `hidden` rather than being removed, so
 * `aria-controls` always names something real. `hidden` takes it out of the
 * accessibility tree and the tab order on its own, which is the whole of what closing
 * it has to mean.
 *
 * Collapsing never discards an edit: the edit lives in the sheet, which holds the set
 * this row emits, and the row holds only whether it is open.
 *
 * ## Four checkboxes, because this is a set
 *
 * A segmented control was right for three mutually exclusive states and cannot express
 * a set in which `WRITE` and `DECIDE` are independent (plan 0030, section 6.1). The
 * person who puts olive oil on the list on Tuesday and the person who decides in the
 * aisle on Saturday that it goes in the trolley are two people, and neither is a subset
 * of the other, so the control has to let both boxes stand alone.
 *
 * ## The visible label and the accessible name no longer differ
 *
 * The segmented control needed them to. Three segments had to fit side by side across a
 * 390 wide phone, "Can add and tick off" does not fit in a third of that, and so the
 * segment showed an abbreviation and was **named** by the whole phrase. It was the one
 * place in the app where the two diverged and it was written down twice so nobody tidied
 * the long keys away as duplicates.
 *
 * That tension is gone with the control that caused it. Checkboxes stack down the row
 * rather than competing for one line's width, so each one has the whole width for its
 * label and there is nothing to abbreviate. The short keys go with the segments, and
 * every box says the same thing to a reader and to a screen reader. Keeping the
 * mechanism would have been keeping a workaround after its constraint expired.
 *
 * The summary badges are the one place a short word survives, and they are not that
 * mechanism returning: a badge is not a control, nothing is named by it, and the whole
 * sentence is a tap away inside the row it heads.
 *
 * ## A locked box is drawn, and a fixed row is explained
 *
 * Deliberately the opposite of what `LineRowVm.actions` does for a row menu, and section
 * 6.1 argues the difference. An absent menu entry hides a capability that will never
 * exist for this person and there is nothing to explain. A List admin box is the answer
 * to "why can Marc change who uses this list?", it is visible in every other row of the
 * same table, and hiding it in some rows and not others would make the table unreadable.
 * So it is drawn in its current state, disabled, with the reason beside it.
 *
 * A `fixed` row is the same shape taken to the whole row: group staff hold all four
 * permissions on every list in the zone by derivation, with no stored row to rewrite
 * (backend plan 0036, section 2.4), so every box is ticked and none of them moves. Shown
 * and fixed rather than hidden, because a hidden row invites the question "why can Marc
 * still edit this?" and this sheet is the only place that answers it.
 */
@Component({
  selector: 'lib-share-row',
  imports: [ChevronDownIcon, RokuTranslatorPipe],
  template: `
    <div class="row">
      <button
        (click)="toggleOpen()"
        [attr.aria-controls]="regionId"
        [attr.aria-expanded]="expanded()"
        [class.open]="expanded()"
        class="header"
        type="button"
      >
        <span class="who">
          <span class="name">{{ member().username }}</span>

          <!--
            The creator's row is an ordinary row now: their power became a stored access
            row that a group admin can rewrite (backend plan 0036, section 2.5). What they
            keep is this label, so the row still reads as theirs (plan 0030, section 6.3).
          -->
          @if (creator()) {
            <span class="creator">{{
              'list.settings.access.creator' | rokuT
            }}</span>
          }
        </span>

        <span class="summary">
          @for (permission of member().summary; track permission) {
            <span class="badge">{{ summaryKey(permission) | rokuT }}</span>
          } @empty {
            <span class="badge none">{{
              'list.settings.access.summary.none' | rokuT
            }}</span>
          }

          <!--
            An edited row is marked rather than left open (section 6), so working down
            eight members does not grow the sheet under the thumb about to press Save.
          -->
          @if (member().edited) {
            <span class="edited">{{
              'list.settings.access.edited' | rokuT
            }}</span>
          }
        </span>

        <lib-chevron-down-icon aria-hidden="true" class="chevron" />
      </button>

      <fieldset [hidden]="!expanded()" [id]="regionId" class="boxes">
        <legend class="legend">
          {{ 'list.settings.accessFor' | rokuT: { name: member().username } }}
        </legend>

        @for (box of boxes; track box.permission) {
          <label class="box-label">
            <input
              (change)="toggle(box.permission, $event)"
              [checked]="holds(box.permission)"
              [disabled]="locked(box.permission)"
              class="checkbox"
              type="checkbox"
            />
            <span>{{ box.key | rokuT }}</span>
          </label>
        }

        @if (member().fixedReasonKey; as reason) {
          <p class="reason">{{ reason | rokuT }}</p>
        }
      </fieldset>
    </div>
  `,
  styleUrl: './share-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareRow {
  readonly member = input.required<ShareRowVm>();

  /** Whether this member made the list, which is a label and nothing more. */
  readonly creator = input(false);

  /**
   * The whole answer for this row, every time, and never a single box.
   *
   * `PUT /v1/lists/:id/access` replaces each named membership's set outright (backend
   * plan 0036, section 5.2), so the sheet holds complete sets and this emits one. An
   * event saying "WRITE went on" would make the sheet reassemble a set it is already
   * holding, and two ways to express one change is two ways to express it wrongly.
   */
  readonly changed = output<{
    membershipId: string;
    permissions: readonly ListPermission[];
  }>();

  /**
   * Whether the checkboxes are showing. Closed on first render, always.
   *
   * Local to the row, and the only thing that is: an edit belongs to the sheet, so
   * closing a row and reopening it shows the edit exactly as it was left.
   */
  readonly expanded = signal(false);

  /** What `aria-controls` points at. Unique per instance, and nothing more. */
  readonly regionId = `share-row-boxes-${nextRowId++}`;

  /**
   * Least access first, so the row reads as a ladder even though it is not one.
   *
   * `READ` leads because it is the one every other box implies, which makes the
   * behaviour in {@link toggle} look like what it is rather than like a surprise.
   */
  readonly boxes: readonly Box[] = [
    { permission: 'READ', key: 'list.settings.access.read' },
    { permission: 'WRITE', key: 'list.settings.access.write' },
    { permission: 'DECIDE', key: 'list.settings.access.decide' },
    { permission: 'MANAGE', key: 'list.settings.access.manage' },
  ];

  private readonly _held = computed(() => new Set(this.member().permissions));
  private readonly _locked = computed(
    () => new Set(this.member().lockedPermissions)
  );

  toggleOpen(): void {
    this.expanded.update((open) => !open);
  }

  /** The one word this permission goes by in the collapsed row. */
  summaryKey(permission: ListPermission): string {
    return SUMMARY_KEYS[permission];
  }

  /** A fixed row draws every box ticked, whatever the payload says. */
  holds(permission: ListPermission): boolean {
    return this.member().fixed || this._held().has(permission);
  }

  /**
   * Whether this box cannot be changed, in either direction.
   *
   * Three sources, and `fixedReasonKey` explains whichever applies. A fixed row
   * locks everything (group staff, whose access is derived and not stored). The
   * caller's own standing locks `MANAGE` on every other row unless they are group
   * staff, since only the group appoints list admins.
   *
   * The third follows from the first two rather than from the payload: a row that
   * already holds `MANAGE`, seen by a caller who may not change `MANAGE`, is
   * locked **entirely**. A list admin holds every other permission (backend plan
   * 0036, section 2), so taking `WRITE` or `DECIDE` off one describes somebody the
   * server will not store, and clearing the row outright is a `MANAGE` change too,
   * which backend section 5.1 refuses on purpose. All four boxes therefore draw in
   * their current state and none of them moves, which says so before the save
   * rather than after it.
   */
  locked(permission: ListPermission): boolean {
    if (this.member().fixed || this._locked().has(permission)) {
      return true;
    }
    return this.holds('MANAGE') && this._locked().has('MANAGE');
  }

  /**
   * One box moved, and the set that follows from it.
   *
   * Two rules, both applied here rather than only on the server (section 6.2). Ticking
   * anything ticks Can view, because the server adds `READ` to any non-empty set it is
   * given and the person should watch that happen as they tick rather than discover it
   * after a save. Unticking Can view clears the row, because that is the only thing
   * "cannot view" can mean.
   *
   * Doing it in both places is duplication of the **feedback**, not of the rule: the
   * server enforces, and the sheet explains before the save instead of after it.
   */
  toggle(permission: ListPermission, event: Event): void {
    if (this.locked(permission)) {
      return;
    }

    const on = (event.target as HTMLInputElement).checked;
    const next = new Set(this._held());

    if (!on && permission === 'READ') {
      // The only thing "cannot view" can mean is no access at all.
      next.clear();
    } else if (on) {
      next.add(permission);
      next.add('READ');
      if (permission === 'MANAGE') {
        // A list admin has all the other permissions (backend plan 0036, section
        // 2, and its `normalizeGrant`). Ticked here rather than only on the server
        // for the same reason Can view ticks itself: the sheet explains the rule
        // as the person works, and the server is what enforces it.
        next.add('WRITE');
        next.add('DECIDE');
      }
    } else {
      next.delete(permission);
      if (permission === 'WRITE' || permission === 'DECIDE') {
        // The other direction of the same rule. Taking away adding or ticking off
        // from a list admin describes somebody the server will not store, so the
        // box that made them one comes off with it rather than snapping back
        // unexplained after the save.
        next.delete('MANAGE');
      }
    }

    this.changed.emit({
      membershipId: this.member().membershipId,
      // In the order the boxes are drawn in, so a set is comparable to another set
      // without either side having to sort first.
      permissions: this.boxes
        .map((box) => box.permission)
        .filter((candidate) => next.has(candidate)),
    });
  }
}
