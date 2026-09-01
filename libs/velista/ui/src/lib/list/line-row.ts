import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LineAction, LineRowVm } from '@portfolio/velista/models';
import {
  CheckIcon,
  CommentIcon,
  EllipsisIcon,
  GripIcon,
  XCircleIcon,
} from '../icons/icons';
import { QuantityReel } from './quantity-reel';

/**
 * What the row emits: everything in {@link LineAction}, plus the three approval
 * decisions, which are drawn inline rather than in the overflow.
 */
export type LineRowAction = LineAction | 'approve' | 'reject' | 'restore';

/**
 * One line on the list. The row this whole screen is for.
 *
 * ## The row is a button, and the number beside it is the control
 *
 * It was a checkbox: `role="checkbox"`, `aria-checked`, and a tap that ticked it off.
 * Velista plan 0043 section 1.1 takes all of that back, and it is a rewrite rather than
 * an edit. There is no checked state left to report, because a tick is a fact about one
 * shopping trip written onto a record that outlives every trip. What a tap does now is
 * **open what the app knows about the thing**, which is a button's job, and what says
 * whether the household wants it is the quantity.
 *
 * So the row has two live parts and they follow two different permissions. The row
 * opens for anybody holding `READ`, because knowing is not deciding. The reel moves for
 * `DECIDE`. A reader gets a row that opens and a number that does not move, which is
 * honest in both directions.
 *
 * ## Three targets, and no more
 *
 * The row, the reel, and the overflow. A row with an edit button, a comment button and
 * a delete button on it is a row nobody can tap correctly while walking, and that was
 * true when there were two.
 *
 * The reel takes the row's full height rather than the width of its digits (section 7),
 * which is why it stops the pointer and the click from reaching the row underneath: a
 * drag that ended in a tap would otherwise open the sheet every time somebody adjusted
 * a number.
 *
 * ## A row with a write in flight stays live
 *
 * Drawn at 70% and `aria-busy`, and still usable. Blocking it would make the app feel
 * slow on exactly the connection it was designed for, and the next adjustment simply
 * supersedes the last (`0012`, section 3.3).
 *
 * ## Somebody else editing is drawn, and decides nothing
 *
 * Their initial and a subdued word, from `PresenceStore.editorOfLine` by way of the
 * container. It is advisory (plan 0022, section 3): no lock, no warning, no disabled
 * control, and no change to what a tap does. The one thing it must not become is a
 * guard, because presence under reports and a guard built on it would refuse an edit
 * nobody is making.
 *
 * ## In reorder mode it stops being a button
 *
 * The role is dropped rather than kept and dishonoured, a focusable grip appears that
 * moves the row with the up and down keys, and **the reel goes away entirely**: a
 * second gesture living inside a row being dragged would fight the first for the same
 * finger.
 */
@Component({
  selector: 'lib-line-row',
  imports: [
    RokuTranslatorPipe,
    CheckIcon,
    CommentIcon,
    EllipsisIcon,
    GripIcon,
    QuantityReel,
    XCircleIcon,
  ],
  templateUrl: './line-row.html',
  styleUrl: './line-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'closeMenu()',
    '(document:click)': 'closeOnOutsideClick($event.target)',
    // The open menu has to paint over the rows below it, and a parent stylesheet cannot
    // reach inside this component to arrange that. `MemberRow` solves it the same way
    // and for the same reason.
    '[class.menu-open]': 'menuOpen()',
    '[class.reordering]': 'reordering()',
  },
})
export class LineRow {
  readonly line = input.required<LineRowVm>();

  /** Whether the list is in reorder mode, which changes what the row is. */
  readonly reordering = input(false);

  /** Whether this row can be moved further in each direction, for the grip's buttons. */
  readonly canMoveUp = input(true);
  readonly canMoveDown = input(true);

  /** A tap on the row, which opens the detail sheet. */
  readonly opened = output<string>();

  /**
   * One settled adjustment of the quantity, as a signed delta.
   *
   * Emitted by the reel when its overlay closes, not per step of the drag, so a thumb
   * that went from two to five and back to four sends one delta of `+2` (section 4.1).
   */
  readonly quantityChanged = output<{ lineId: string; delta: number }>();

  /** Anything from the overflow, the decision buttons, or the grip. */
  readonly act = output<{ action: LineRowAction; lineId: string }>();

  /** A pointer went down on the grip. The list takes the drag from here. */
  readonly grab = output<{ event: PointerEvent; lineId: string }>();

  /** The inline failure notice was tapped, which retries. */
  readonly retry = output<string>();

  /** The overwritten notice was dismissed. */
  readonly dismiss = output<string>();

  readonly menuOpen = signal(false);

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');

  /**
   * The accessible name: what it is, and how many.
   *
   * Assembled here rather than in the template so the quantity is present in the name
   * exactly when it is present on screen, and so the two cannot drift.
   *
   * **The number is always in it now**, where it used to appear only above one. The
   * quantity is the line's state rather than an annotation on it, and a name that said
   * "Olive oil" for a line at zero and "Olive oil, 2" for the same line a moment later
   * would hide the only thing that changed.
   */
  accessibleName(): string {
    const line = this.line();
    return `${line.content}, ${line.quantity}`;
  }

  /**
   * What `aria-describedby` points at: the indicators, the caption, or both.
   *
   * They are descriptions rather than part of the name, which is section 7's rule and
   * the reason it exists: a name that grew "bought" and "Ana is buying this" would read
   * both out every time focus touched the row, ahead of the thing itself.
   *
   * Assembled here rather than in the template because it is a list of ids that exist
   * conditionally, and a template expression producing `"ind-x cap-x"` from two `@if`
   * blocks is the kind of string that ends up pointing at an element nobody rendered.
   */
  describedBy(): string | null {
    const line = this.line();
    const ids = [
      line.indicators.length > 0 ? `ind-${line.id}` : null,
      line.captionKey !== null ? `cap-${line.id}` : null,
    ].filter((id): id is string => id !== null);

    return ids.length === 0 ? null : ids.join(' ');
  }

  onRowClick(): void {
    if (this.reordering() || !this.line().interactive) {
      return;
    }

    this.opened.emit(this.line().id);
  }

  /**
   * Space and Enter, because a `div` with `role="button"` gets neither for free.
   *
   * Both, which the button role calls for and which everybody expects anyway.
   */
  onRowKeydown(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    this.onRowClick();
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  closeMenu(): void {
    if (!this.menuOpen()) {
      return;
    }

    this.menuOpen.set(false);
    this._trigger()?.nativeElement.focus();
  }

  /**
   * A click elsewhere closes the menu and leaves focus where it landed.
   *
   * Separate from `closeMenu`, which hands focus back to the trigger. `MemberRow` makes
   * the same distinction for the same reason: pulling focus back to a row somebody has
   * finished with makes the page feel like it is arguing.
   */
  protected closeOnOutsideClick(target: EventTarget | null): void {
    if (!this.menuOpen()) {
      return;
    }

    const host = this._host.nativeElement;
    if (target === null || !host.contains(target as Node)) {
      this.menuOpen.set(false);
    }
  }

  choose(action: LineRowAction): void {
    this.closeMenu();
    this.act.emit({ action, lineId: this.line().id });
  }

  /**
   * The label each overflow entry reads.
   *
   * Keyed per case rather than assembled, so each one says what it does in its own
   * words: "Take off the list" is a sentence somebody can act on, where a shared
   * "Delete" beside an icon is a guess about what will be deleted.
   */
  labelKey(action: LineAction): string {
    switch (action) {
      case 'edit':
        return 'list.line.edit';
      case 'comments':
        return 'list.line.comments';
      case 'delete':
        return 'list.line.delete';
      case 'moveUp':
      case 'moveDown':
        return 'list.line.move';
    }
  }

  /** Whether an entry is styled as destructive. Styling only; the text says it too. */
  isDestructive(action: LineAction): boolean {
    return action === 'delete';
  }

  /** The grip's keyboard equivalent. Emitted straight through, menu untouched. */
  move(action: 'moveUp' | 'moveDown'): void {
    this.act.emit({ action, lineId: this.line().id });
  }

  /**
   * A pointer takes hold of the grip.
   *
   * The row hands the gesture straight up rather than running it, because a drag is
   * about where this row sits among the others and this row knows nothing about the
   * others. `LineList` owns the order, so it owns the geometry, and it is the only
   * thing that can say which row a finger is currently over.
   */
  startDrag(event: PointerEvent): void {
    this.grab.emit({ event, lineId: this.line().id });
  }

  /**
   * The editor's initial, or an empty string when nobody is editing.
   *
   * Code points rather than a slice, for the reason every other initial in this app is:
   * slicing a string cuts a surrogate pair in half, and a name that starts with an emoji
   * would render the replacement character.
   */
  readonly editorInitial = computed(() => {
    const name = this.line().editor?.trim() ?? '';
    return name === '' ? '' : (Array.from(name)[0] ?? '').toLocaleUpperCase();
  });
}
