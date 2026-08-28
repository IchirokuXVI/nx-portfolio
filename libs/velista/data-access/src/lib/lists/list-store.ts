import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ShoppingListSummary } from '@portfolio/velista/models';
import { Mutations } from '../mutations';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { LIST_SERVICE, type ListServiceI } from './list-service';

/** How one zone's lists are loading. Per zone, since two can be open in a session. */
export type ListLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * The lists in each zone: the cache, and the realtime events `ZoneStore` declines.
 *
 * `ZoneStore._apply` has a branch that ignores eight list and line events with the
 * comment "`ListStore` owns these". This is that store.
 *
 * ## Why it is here and not in `feature-zones`
 *
 * The same reason `ZoneStore` gives, and it applies with more force: a store owned by
 * a feature library is destroyed on navigation, so opening a list and coming back
 * would leave the room, throw the cache away and refetch. Lists survive being
 * navigated away from, so the thing that holds them has to as well
 * (plan 0004, section 7.1).
 *
 * ## What it does not do
 *
 * It holds no lines and no comments. The shopping list plan extends this store rather
 * than replacing it, and writing the line cache before there is a screen that reads one
 * would be a design against a guess.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It resolves
// `LIST_SERVICE` in the injector where the app binds it, and at the root it would
// silently get the token's own default instead.
@Injectable()
export class ListStore {
  private readonly _lists = inject<ListServiceI>(LIST_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _mutations = inject(Mutations);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _byZone = signal<
    ReadonlyMap<string, readonly ShoppingListSummary[]>
  >(new Map());
  private readonly _state = signal<ReadonlyMap<string, ListLoadState>>(
    new Map()
  );
  private readonly _error = signal<ReadonlyMap<string, unknown>>(new Map());

  constructor() {
    this._realtime.events
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((event) => this._apply(event));
  }

  /** One zone's lists, as far as this caller may read them. Empty until loaded. */
  listsIn(zoneId: string): readonly ShoppingListSummary[] {
    return this._byZone().get(zoneId) ?? [];
  }

  /** How that zone's load is going. `idle` is the instant before one is started. */
  stateOf(zoneId: string): ListLoadState {
    return this._state().get(zoneId) ?? 'idle';
  }

  /** Why the last load for that zone failed, or null. */
  errorOf(zoneId: string): unknown {
    return this._error().get(zoneId) ?? null;
  }

  /** A signal view of one zone, for a container that wants to read it in a computed. */
  forZone(zoneId: string) {
    return computed(() => ({
      lists: this._byZone().get(zoneId) ?? [],
      state: this._state().get(zoneId) ?? ('idle' as ListLoadState),
      error: this._error().get(zoneId) ?? null,
    }));
  }

  /**
   * Load one zone's lists.
   *
   * Never called for a caller whose membership is still PENDING: core answers
   * `forbidden` to that, and firing a request in order to be refused is how somebody
   * ends up reading an error panel about a situation that is not an error
   * (plan 0010, section 3.3). The page decides that from `myStatus` before calling.
   */
  async load(zoneId: string): Promise<void> {
    this._setState(zoneId, 'loading');
    this._setError(zoneId, null);

    try {
      const page = await this._lists.listLists(zoneId);
      this._setLists(zoneId, page.items);
      this._setState(zoneId, 'loaded');
    } catch (error) {
      this._setError(zoneId, error);
      this._setState(zoneId, 'failed');
    }
  }

  /**
   * Reload without dropping the page back to a skeleton.
   *
   * `load` moves the state to `loading`, which is right on a cold open and wrong on a
   * refresh: the cache is already correct enough to render, and replacing it with a
   * spinner for the length of a request makes the page worse. A failure is swallowed
   * for the same reason. What is on screen is not made worse by a reload that did not
   * arrive.
   */
  async refresh(zoneId: string): Promise<void> {
    try {
      const page = await this._lists.listLists(zoneId);
      this._setLists(zoneId, page.items);
      this._setState(zoneId, 'loaded');
    } catch {
      // Deliberately quiet. See above.
    }
  }

  /**
   * Start a list, and show it before the reload confirms it.
   *
   * Through `Mutations.run` like every other write in this app (rule D2). No overlay:
   * an overlay describes a pending edit to a record that already exists, and this one
   * does not exist anywhere until the server answers.
   */
  async createList(
    zoneId: string,
    name: string,
    shareWithZone: boolean
  ): Promise<
    | { readonly state: 'created'; readonly list: ShoppingListSummary }
    | { readonly state: 'failed'; readonly error: unknown }
  > {
    const outcome = await this._mutations.run(null, () =>
      this._lists.createList(zoneId, name, shareWithZone)
    );

    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }

    this._upsert(outcome.value);
    return { state: 'created', list: outcome.value };
  }

  /**
   * Apply one event.
   *
   * `list.accessChanged` is the awkward one and it deserves naming rather than
   * hiding. It carries only a `listId`, and its meaning for the caller is "your access
   * to this list may have changed, **including to none**". Nothing in the event says
   * whether the list should now appear or disappear, so the zone's lists are refetched.
   *
   * That is a whole request for a rare event, and it is still cheaper than either
   * alternative: dropping the list would flicker it off screen for somebody whose
   * access only widened, and keeping it would leave a list on screen that they can no
   * longer open (plan 0010, section 5.2).
   */
  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'list.created':
      case 'list.updated': {
        const { list } = event;
        if (!this._byZone().has(list.zoneId)) {
          // A zone this store has never loaded. Inventing a partial cache from an
          // event would make the next `load` look like a refresh of data that was
          // never there.
          break;
        }

        this._upsertPartial(list.zoneId, list.id, (existing) => ({
          ...(existing ?? { lineCount: 0, readyCount: 0 }),
          id: list.id,
          zoneId: list.zoneId,
          name: list.name,
          createdByUserId: list.createdByUserId,
        }));
        break;
      }

      case 'list.deleted': {
        this._removeList(event.listId);
        break;
      }

      case 'list.accessChanged': {
        const zoneId = this._zoneOf(event.listId);
        if (zoneId !== null) {
          void this.refresh(zoneId);
          break;
        }

        // The list is not in the cache, so either the caller has just been granted
        // access to one in a zone they are looking at, or it is somewhere they are
        // not. Every loaded zone is refreshed, which is the only correct answer
        // available: the event does not say which zone it was about.
        for (const loaded of this._byZone().keys()) {
          void this.refresh(loaded);
        }
        break;
      }

      case 'line.added':
      case 'line.updated':
      case 'line.deleted':
      case 'line.reordered':
      case 'comment.added':
        // The line counts on a row would move for these, and the events do not carry
        // enough to recompute one: `line.updated` fires for status changes too, so
        // `readyCount` cannot be derived from it without knowing the line's previous
        // status. The counts refresh with the zone rather than being guessed at, and
        // the shopping list plan owns lines properly.
        break;

      default:
        // Zone, member, merge and presence traffic. `ZoneStore` owns all of it.
        break;
    }
  }

  private _zoneOf(listId: string): string | null {
    for (const [zoneId, lists] of this._byZone()) {
      if (lists.some((list) => list.id === listId)) {
        return zoneId;
      }
    }

    return null;
  }

  private _upsert(list: ShoppingListSummary): void {
    this._upsertPartial(list.zoneId, list.id, () => list);
  }

  private _upsertPartial(
    zoneId: string,
    listId: string,
    update: (existing: ShoppingListSummary | undefined) => ShoppingListSummary
  ): void {
    this._byZone.update((current) => {
      const lists = current.get(zoneId) ?? [];
      const existing = lists.find((list) => list.id === listId);
      const updated = update(existing);

      const next = new Map(current);
      next.set(
        zoneId,
        existing === undefined
          ? [updated, ...lists]
          : lists.map((list) => (list.id === listId ? updated : list))
      );
      return next;
    });
  }

  private _removeList(listId: string): void {
    this._byZone.update((current) => {
      const next = new Map(current);
      for (const [zoneId, lists] of current) {
        if (lists.some((list) => list.id === listId)) {
          next.set(
            zoneId,
            lists.filter((list) => list.id !== listId)
          );
        }
      }
      return next;
    });
  }

  private _setLists(
    zoneId: string,
    lists: readonly ShoppingListSummary[]
  ): void {
    this._byZone.update((current) => new Map(current).set(zoneId, lists));
  }

  private _setState(zoneId: string, state: ListLoadState): void {
    this._state.update((current) => new Map(current).set(zoneId, state));
  }

  private _setError(zoneId: string, error: unknown): void {
    this._error.update((current) => new Map(current).set(zoneId, error));
  }
}
