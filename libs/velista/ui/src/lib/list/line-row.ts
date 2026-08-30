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
import { CommentIcon, EllipsisIcon, GripIcon } from '../icons/icons';
import { LineStateControl } from './line-state-control';

/**
 * What the row emits: everything in {@link LineAction}, plus the three approval
 * decisions, which are drawn inline rather than in the overflow.
 */
export type LineRowAction = LineAction | 'approve' | 'reject' | 'restore';

/**
 * One line on the list. The row this whole screen is for.
 *
 * ## The whole row is the checkbox
 *
 * `role="checkbox"` with `aria-checked`, not a button, because that is what it is. Its
 * accessible name is the content plus the quantity, so "Sourdough loaf, 2" is what gets
 * read, and the captions go in `aria-describedby` rather than into the name: a name
 * that grew "Waiting for approval" on the end would be read out every time focus
 * touched the row (section 7).
 *
 * The one separate target inside it is the overflow, 44 square, which holds everything
 * that is not ticking off. Two targets and no more: a row with an edit button, a
 * comment button and a delete button on it is a row nobody can tap correctly while
 * walking.
 *
 * ## A row with a write in flight stays tappable
 *
 * Drawn at 70% and `aria-busy`, and still live. Blocking it would make the app feel
 * slow on exactly the connection it was designed for, and the second tap simply
 * supersedes the first (section 3.3).
 *
 * ## Somebody else editing is drawn, and decides nothing
 *
 * Their initial and a subdued word, from `PresenceStore.editorOfLine` by way of the
 * container. It is advisory (plan 0022, section 3): no lock, no warning, no disabled
 * control, and no change to what a tap does. The one thing it must not become is a
 * guard, because presence under reports and a guard built on it would refuse an edit
 * nobody is making.
 *
 * ## In reorder mode it stops being a checkbox
 *
 * The role is dropped rather than kept and dishonoured, and a focusable grip appears
 * that moves the row with the up and down keys. A grip that only answered a pointer
 * would put the manual order out of reach of anybody without a working one.
 */
@Component({
  selector: 'lib-line-row',
  imports: [
    RokuTranslatorPipe,
    CommentIcon,
    EllipsisIcon,
    GripIcon,
    LineStateControl,
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

  /** A tap on the row: tick it off, or put it back. */
  readonly ticked = output<string>();

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
   */
  accessibleName(): string {
    const line = this.line();
    return line.quantity > 1
      ? `${line.content}, ${line.quantity}`
      : line.content;
  }

  /**
   * `aria-checked`.
   *
   * NOT_AVAILABLE is **false**, not a third state, because there is no third state in
   * the checkbox role and mixed means something else entirely. The caption carries the
   * distinction, in the description, which is where a screen reader user can act on it.
   */
  checked(): boolean {
    return this.line().status === 'READY';
  }

  onRowClick(): void {
    if (this.reordering() || !this.line().interactive) {
      return;
    }

    this.ticked.emit(this.line().id);
  }

  /**
   * Space and Enter, because a `div` with `role="checkbox"` gets neither for free.
   *
   * Both, and not only Space. The checkbox role calls for Space, and every person who
   * has ever used a list of rows will try Enter, so refusing it would be correct by the
   * specification and wrong for the person holding the keyboard.
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
      case 'markNotAvailable':
        return 'list.line.markNotAvailable';
      case 'markPending':
        return 'list.line.markPending';
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
