import { inject, Injectable, signal, type Signal } from '@angular/core';
import {
  sortShopWalks,
  walkLogEnd,
  type ShopWalkSummary,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { Mutations } from '../mutations';
import { ShopDetailStore } from './shop-detail-store';
import {
  SHOP_WALK_SERVICE,
  type ShopWalkListRead,
  type ShopWalkLogRead,
  type ShopWalkRead,
  type ShopWalkServiceI,
} from './shop-walk-service';

type Loading = { readonly kind: 'loading' };

/** A shop's walks as the list draws them, the shown one first. */
export type ShopWalkListState = ShopWalkListRead | Loading;
export type ShopWalkState = ShopWalkRead | Loading;
export type ShopWalkLogState = ShopWalkLogRead | Loading;

/** What a write came to. */
export type ShopWalkWrite<T = void> =
  | { readonly state: 'done'; readonly value: T }
  | { readonly state: 'failed'; readonly error: unknown };

/** What "Continue from here" came to. */
export type ShopWalkRewind =
  | { readonly state: 'rewound' }
  /** Another phone saved first. The walk and its log were read again. */
  | { readonly state: 'changed' }
  | { readonly state: 'failed'; readonly error: unknown };

/** Reads keyed by id, each held until read again, and never blanked by a re-read. */
class Held<T> {
  private readonly _held = signal<ReadonlyMap<string, T | Loading>>(new Map());
  private readonly _pending = new Map<string, Promise<void>>();

  readonly all: Signal<ReadonlyMap<string, T | Loading>> =
    this._held.asReadonly();

  get(id: string): T | Loading {
    return this._held().get(id) ?? { kind: 'loading' };
  }

  set(id: string, value: T): void {
    this._held.update((held) => new Map(held).set(id, value));
  }

  update(update: (id: string, value: T) => T): void {
    this._held.update((held) => {
      const next = new Map<string, T | Loading>();
      for (const [id, value] of held) {
        next.set(
          id,
          (value as Loading).kind === 'loading' ? value : update(id, value as T)
        );
      }
      return next;
    });
  }

  /** Read one id. A read already out for it is joined rather than repeated. */
  load(id: string, read: () => Promise<T>): Promise<void> {
    const pending = this._pending.get(id);
    if (pending !== undefined) {
      return pending;
    }
    const running = read()
      .then((value) => this.set(id, value))
      .finally(() => this._pending.delete(id));
    this._pending.set(id, running);
    return running;
  }
}

/**
 * The walks of a shop, one walk with its timeline, and one walk's log (velista
 * `0122`; backend `0168`). Everything here takes `shopMap.record`.
 *
 * App scoped, because the list, the history, the rewind and the settings are
 * four routes over the same walks, and a page scoped store would read the same
 * walk four times on the way from the list to a rewind and back.
 *
 * ## A rewind is an appended entry
 *
 * "Continue from here" never edits the log: it appends a `rewound` entry built on
 * the `lastSeq` the log was read with. If another phone saved first the server
 * answers `walk_changed`, and the store reads the walk and its log again, so the
 * screen shows what is there now before anybody continues again.
 *
 * Written by hand, with no `@angular/core/rxjs-interop`.
 */
// Provided by the app layer, never root: rule D5.
@Injectable()
export class ShopWalksStore {
  private readonly _service = inject<ShopWalkServiceI>(SHOP_WALK_SERVICE);
  private readonly _mutations = inject(Mutations);
  private readonly _shops = inject(ShopDetailStore);

  private readonly _lists = new Held<ShopWalkListRead>();
  private readonly _walks = new Held<ShopWalkRead>();
  private readonly _logs = new Held<ShopWalkLogRead>();

  /** A shop's walks, the shown one first, then the newest change first. */
  walksAt(locationId: string): ShopWalkListState {
    const read = this._lists.get(locationId);
    return read.kind === 'walks'
      ? { kind: 'walks', walks: sortShopWalks(read.walks) }
      : read;
  }

  /** One walk with its document and timeline. */
  walk(walkId: string): ShopWalkState {
    return this._walks.get(walkId);
  }

  /** One walk's whole log, for the history's counts and the rewind preview. */
  log(walkId: string): ShopWalkLogState {
    return this._logs.get(walkId);
  }

  /** A walk's summary from whatever has been read: its own read, else a list. */
  summary(walkId: string): ShopWalkSummary | null {
    const read = this._walks.get(walkId);
    if (read.kind === 'walk') {
      return read.detail.walk;
    }
    for (const list of this._lists.all().values()) {
      if (list.kind === 'walks') {
        const found = list.walks.find((walk) => walk.id === walkId);
        if (found !== undefined) {
          return found;
        }
      }
    }
    return null;
  }

  /** Read a shop's walks. What is held stays drawn while it is read again. */
  loadWalks(locationId: string): Promise<void> {
    return this._lists.load(locationId, () =>
      this._service.list(locationId).catch(() => ({ kind: 'failed' }) as const)
    );
  }

  /** Read one walk. */
  loadWalk(walkId: string): Promise<void> {
    return this._walks.load(walkId, () =>
      this._service.walk(walkId).catch(() => ({ kind: 'failed' }) as const)
    );
  }

  /** Read one walk's log from its start (backend `0168`: `stateAt` takes no snapshot). */
  loadLog(walkId: string): Promise<void> {
    return this._logs.load(walkId, () =>
      this._service.log(walkId, 0).catch(() => ({ kind: 'failed' }) as const)
    );
  }

  /** Start a new walk, with an empty map, not shown to shoppers. */
  async create(
    locationId: string,
    name: string
  ): Promise<ShopWalkWrite<ShopWalkSummary>> {
    const outcome = await this._mutations.run(null, () =>
      this._service.create(locationId, name.trim())
    );
    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }
    const walk = outcome.value;
    this._lists.update((id, read) =>
      id === walk.locationId && read.kind === 'walks'
        ? { kind: 'walks', walks: [...read.walks, walk] }
        : read
    );
    return { state: 'done', value: walk };
  }

  rename(walkId: string, name: string): Promise<ShopWalkWrite> {
    return this._update(walkId, { name: name.trim() });
  }

  /**
   * Show a walk to shoppers, or stop showing it. Showing one hides the shop's
   * other walk, which the server does in the same write; the list follows.
   */
  async setShown(walkId: string, shown: boolean): Promise<ShopWalkWrite> {
    const outcome = await this._update(walkId, { shown });
    if (outcome.state === 'done') {
      const walk = this.summary(walkId);
      if (walk !== null) {
        // The shop page's "See the map" follows whether a walk is shown.
        this._shops.forget(walk.locationId);
      }
    }
    return outcome;
  }

  /** Delete a walk. Its entries stay on the server; it is gone from every list. */
  async remove(walkId: string): Promise<ShopWalkWrite> {
    const walk = this.summary(walkId);
    const outcome = await this._mutations.run(null, () =>
      this._service.remove(walkId)
    );
    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }
    this._lists.update((_id, read) =>
      read.kind === 'walks'
        ? {
            kind: 'walks',
            walks: read.walks.filter((one) => one.id !== walkId),
          }
        : read
    );
    this._walks.set(walkId, { kind: 'missing' });
    this._logs.set(walkId, { kind: 'missing' });
    if (walk?.shown) {
      this._shops.forget(walk.locationId);
    }
    return { state: 'done', value: undefined };
  }

  /**
   * "Continue from here": append a `rewound` entry to the log as it was read.
   *
   * The base is the log's `lastSeq` and the entry sits at the log's end, since a
   * rewind advances no log time. The walk and its log are read again whatever
   * the answer, so the history shows the new entry and a refusal shows what
   * somebody else saved.
   */
  async rewind(walkId: string, rewoundTo: number): Promise<ShopWalkRewind> {
    const read = this._logs.get(walkId);
    if (read.kind !== 'log') {
      return { state: 'failed', error: new Error('The log is not read') };
    }
    const end = walkLogEnd(read.log.entries);
    const outcome = await this._mutations.run(null, () =>
      this._service.append(walkId, {
        id: newEntryId(),
        baseSeq: read.log.lastSeq,
        kind: 'rewound',
        at: new Date().toISOString(),
        logFrom: end,
        logTo: end,
        events: [],
        rewoundTo: Math.max(0, Math.min(end, Math.round(rewoundTo))),
      })
    );
    if (outcome.state === 'failed') {
      const changed =
        outcome.error instanceof GatewayError &&
        outcome.error.code === 'walk_changed';
      if (changed) {
        await Promise.all([this.loadWalk(walkId), this.loadLog(walkId)]);
        return { state: 'changed' };
      }
      return { state: 'failed', error: outcome.error };
    }
    this._adopt(outcome.value.walk);
    await Promise.all([this.loadWalk(walkId), this.loadLog(walkId)]);
    return { state: 'rewound' };
  }

  private async _update(
    walkId: string,
    change: { name?: string; shown?: boolean }
  ): Promise<ShopWalkWrite> {
    const outcome = await this._mutations.run(null, () =>
      this._service.update(walkId, change)
    );
    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }
    this._adopt(outcome.value);
    return { state: 'done', value: undefined };
  }

  /** A walk's new summary, wherever it is held. A shown walk hides its shop's others. */
  private _adopt(walk: ShopWalkSummary): void {
    this._lists.update((id, read) =>
      read.kind !== 'walks' || id !== walk.locationId
        ? read
        : {
            kind: 'walks',
            walks: read.walks.map((one) =>
              one.id === walk.id
                ? walk
                : walk.shown && one.shown
                  ? { ...one, shown: false }
                  : one
            ),
          }
    );
    this._walks.update((id, read) =>
      read.kind === 'walk'
        ? id === walk.id
          ? { kind: 'walk', detail: { ...read.detail, walk } }
          : walk.shown &&
              read.detail.walk.shown &&
              read.detail.walk.locationId === walk.locationId
            ? {
                kind: 'walk',
                detail: {
                  ...read.detail,
                  walk: { ...read.detail.walk, shown: false },
                },
              }
            : read
        : read
    );
  }
}

/** A uuid for an entry, so a retried append is the same entry. */
function newEntryId(): string {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
