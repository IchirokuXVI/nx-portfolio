import { computed, type Signal } from '@angular/core';
import type { ActivatedRoute } from '@angular/router';
import type { BasketStore } from '@portfolio/velista/data-access';
import { selectBasketSurface } from '@portfolio/velista/models';
import { sheetSegments } from '@portfolio/velista/platform';

/**
 * What a reader may reach from the basket, decided in **one** place (velista
 * `0130`, section 6.1).
 *
 * These were computeds on the basket page, read by the buttons in its header. The
 * header now holds three actions and the rest sit in the menu sheet, which is a child
 * route with its own component. Two components asking the same question from two
 * copies of the answer is how a row comes to be drawn for somebody the button was
 * never drawn for, so both build their answer here from the store they share.
 */
export interface BasketDoors {
  /**
   * The history: the owner, and a registered member of a shared basket (velista
   * `0111`). A guest has none, because it needs an account, and they arrived on a
   * link that makes this screen the whole app.
   */
  readonly canOpenHistory: Signal<boolean>;
  /**
   * Composing a new shopping list, which needs an account for the same reason the
   * history does. Asked separately because it is a different question that happens
   * to have the same answer today.
   */
  readonly canCreate: Signal<boolean>;
  /** Ending the trip: the owner's alone, on a basket that has an end (`0057`). */
  readonly canFinish: Signal<boolean>;
  /**
   * Whether somebody is holding the basket open **right now**, on a basket that
   * keeps a presence room. What the faces are drawn from.
   */
  readonly anybodyHere: Signal<boolean>;
  /**
   * Whether there is anybody to read about in the people sheet (velista `0094`,
   * section 7). Not presence: everybody who *can* open this basket.
   */
  readonly hasPeople: Signal<boolean>;
  /** Whether a way into the people sheet is drawn at all. */
  readonly canOpenPeople: Signal<boolean>;
}

export function basketDoors(store: BasketStore): BasketDoors {
  const surface = computed(() => {
    const basket = store.basket();
    return basket === null ? null : selectBasketSurface(basket, basket.me);
  });

  const canOpenHistory = computed(() => {
    const kind = store.me()?.kind;
    return kind === 'OWNER' || kind === 'REGISTERED';
  });

  const anybodyHere = computed(
    () => surface()?.presence === true && store.present().length > 0
  );

  const hasPeople = computed(() => store.participants().length > 0);

  return {
    canOpenHistory,
    canCreate: canOpenHistory,
    canFinish: computed(() => surface()?.finish === true),
    anybodyHere,
    hasPeople,
    canOpenPeople: computed(() => anybodyHere() || hasPeople()),
  };
}

/** The menu's rows, by what each one is about. */
export type BasketMenuEntry = 'people' | 'history' | 'create' | 'finish';

/**
 * The rows of the menu, **in the order they are drawn**, and only the ones this
 * reader may use. An entry that is not allowed is absent, and a menu with no entry
 * is a menu button that is not drawn.
 *
 * @param finishSheet whether the page's route declares the finish sheet. See
 *   {@link hasFinishSheet}.
 */
export function basketMenuEntries(
  doors: BasketDoors,
  finishSheet: boolean
): readonly BasketMenuEntry[] {
  const offered: readonly (readonly [BasketMenuEntry, boolean])[] = [
    ['people', doors.canOpenPeople()],
    ['history', doors.canOpenHistory()],
    ['create', doors.canCreate()],
    ['finish', doors.canFinish() && finishSheet],
  ];

  return offered.filter(([, allowed]) => allowed).map(([entry]) => entry);
}

/**
 * Whether the basket **page's** route declares the finish sheet.
 *
 * A `LIVE` basket is never finished, so `shopping-lists/live` has no such child and
 * a row that led to it would lead nowhere. Read from the route table itself rather
 * than from a flag beside it: the table is the one thing that cannot disagree with
 * which URLs exist.
 *
 * @param page the basket page's own route, which is the menu sheet's parent.
 */
export function hasFinishSheet(page: ActivatedRoute | null): boolean {
  const finish = sheetSegments('finish').join('/');

  return (
    page?.routeConfig?.children?.some((route) => route.path === finish) === true
  );
}
