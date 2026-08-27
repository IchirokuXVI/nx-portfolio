import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { MemberAction, MemberRowVm } from '@portfolio/velista/models';
import { EllipsisIcon } from '../icons/icons';
import { RoleChip } from './role-chip';

/**
 * One approved member, with the menu of things this caller may do to them.
 *
 * ## The menu is a menu
 *
 * `role="menu"` with `role="menuitem"` children, opened from a button carrying
 * `aria-haspopup="menu"` and `aria-expanded`, closed on Escape, and focus handed back
 * to the button that opened it (plan 0010, section 7). A `<div>` of buttons that looks
 * like a menu is announced as a group of unrelated controls, which on a screen full of
 * near-identical rows is the difference between usable and not.
 *
 * ## An empty action list means no button
 *
 * Not a disabled one. `0010` section 5.4 is explicit about the owner's row seen by an
 * admin: **an absent menu, not a disabled menu**, because a disabled control says "you
 * could do this, later" about something that will never be permitted. The container
 * computes the list; this component only refuses to draw a trigger for an empty one.
 *
 * ## What it does not decide
 *
 * Nothing. Rule D1: it injects no store and no service token, takes a view model, and
 * emits the action that was chosen. Whether an action is *allowed* is core's decision
 * on every request regardless of what is drawn here (rule G2).
 */
@Component({
  selector: 'lib-member-row',
  imports: [RokuTranslatorPipe, EllipsisIcon, RoleChip],
  templateUrl: './member-row.html',
  styleUrl: './member-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'close()',
    // The open menu has to paint over the rows below it, and a parent stylesheet
    // cannot reach inside this component to arrange that: style encapsulation scopes
    // the parent's selectors to the parent's own template. So the stacking context is
    // raised here, on the host, which is the one element both sides can see.
    '[class.menu-open]': 'menuOpen()',
  },
})
export class MemberRow {
  readonly member = input.required<MemberRowVm>();

  readonly act = output<{ action: MemberAction; membershipId: string }>();

  readonly menuOpen = signal(false);

  private readonly _trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');

  /**
   * The label each action reads, keyed per case rather than assembled.
   *
   * "Remove and block" says what banning does in its own text, so the meaning survives
   * a colourblind reader and a screen reader alike; the coral styling is a second
   * signal and never the only one (section 7).
   */
  labelKey(action: MemberAction): string {
    switch (action) {
      case 'makeAdmin':
        return 'zone.members.makeAdmin';
      case 'makeMember':
        return 'zone.members.makeMember';
      case 'transfer':
        return 'zone.members.transfer';
      case 'remove':
        return 'zone.members.remove';
      case 'ban':
        return 'zone.members.ban';
      case 'rename':
        return 'zone.members.rename';
    }
  }

  /** Whether an item is styled as destructive. Styling only; the text says it too. */
  isDestructive(action: MemberAction): boolean {
    return action === 'remove' || action === 'ban';
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** Escape, and choosing an item. Focus goes back where it came from. */
  close(): void {
    if (!this.menuOpen()) {
      return;
    }

    this.menuOpen.set(false);
    this._trigger()?.nativeElement.focus();
  }

  choose(action: MemberAction): void {
    this.close();
    this.act.emit({ action, membershipId: this.member().membershipId });
  }
}
