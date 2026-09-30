import { DOCUMENT } from '@angular/common';
import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import type { WalkEvent } from '@portfolio/luna-shopper/shop-map/model';
import type {
  AppendShopWalkEntryRequest,
  ShopWalkEntryKind,
  ShopWalkStopReason,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { Mutations } from '../mutations';
import { SHOP_WALK_SERVICE, type ShopWalkServiceI } from './shop-walk-service';

/** A save every 20 s while something is unsent (velista `0123`, target 5). */
export const WALK_SAVE_EVERY_MS = 20_000;

/**
 * Where a saver stands.
 *
 * - `idle`: nothing sent yet and nothing to send.
 * - `unsent`: something waits for the next save.
 * - `sending`: a save is out.
 * - `saved`: everything this page made is on the server.
 * - `failed`: the last save did not arrive (no connection, a server error). What
 *   it held is kept and tried again.
 * - `changed`: another phone saved to the walk first (`walk_changed`). What was
 *   unsent is dropped, because it was built on a map that is not there any more.
 * - `refused`: the server refused the entry itself (the map it folds to breaks a
 *   rule, or it is too large). Dropped too.
 */
export type WalkSaveStatus =
  | 'idle'
  | 'unsent'
  | 'sending'
  | 'saved'
  | 'failed'
  | 'changed'
  | 'refused';

/** What one `save()` came to. `nothing` means there was nothing to send. */
export type WalkSaveOutcome =
  | 'saved'
  | 'nothing'
  | 'failed'
  | 'changed'
  | 'refused';

/** What `begin` needs: the walk, as it was read. */
export interface WalkEntrySaverStart {
  readonly walkId: string;
  /** The `lastSeq` the walk was read with: the first append's base. */
  readonly baseSeq: number;
  /** Where the log stands: the `logTo` of the walk's last entry, 0 for none. */
  readonly logTo: number;
  /** The kind of the first entry this page opens. `edited` for editing by hand. */
  readonly kind: ShopWalkEntryKind;
  /**
   * The kind of every entry opened after the first. The same as `kind` when left
   * out; velista `0126` opens `started` and then `continued`.
   */
  readonly thenKind?: ShopWalkEntryKind;
  /** How often a save goes out while something is unsent. */
  readonly everyMs?: number;
  /** How soon a failed save is tried again. `everyMs` when left out. */
  readonly retryMs?: number;
}

/** A whole entry queued as it is, for a recording's `stopped` and its kin. */
export interface WalkEntryDraft {
  readonly kind: ShopWalkEntryKind;
  readonly events?: readonly WalkEvent[];
  /** Where the entry ends in the log. The log's end when left out. */
  readonly logTo?: number;
  readonly reason?: ShopWalkStopReason;
  readonly rewoundTo?: number;
}

/** An entry built but not yet answered. Its id and content never change again. */
interface Sealed {
  readonly id: string;
  readonly kind: ShopWalkEntryKind;
  readonly at: string;
  readonly logFrom: number;
  readonly logTo: number;
  readonly events: readonly WalkEvent[];
  readonly reason?: ShopWalkStopReason;
  readonly rewoundTo?: number;
}

/** The entry edits are collecting into. */
interface Open {
  readonly id: string;
  readonly kind: ShopWalkEntryKind;
  readonly logFrom: number;
  logTo: number;
  readonly events: WalkEvent[];
}

/**
 * Saves what a page does to a walk as appended entries (velista `0123`, target 5;
 * backend `0168`, the next base). One instance per page: provide it in the
 * page's `providers`, so it is made with the page and its timers and listeners
 * end with it.
 *
 * ## One entry at a time, each one frozen once it is sent
 *
 * Edits collect into one open entry with a client made id. A save seals it: from
 * then its id and its events never change, because the server answers a second
 * append with a known id with the first answer (`replayed`), so anything added
 * to a retried entry would be silently lost. Edits made while a save is out go
 * into the next entry. Entries go out in order, and each one's base is the
 * `entry.seq` the one before it was answered with, never `walk.lastSeq`.
 *
 * ## When it saves
 *
 * On `save()` (Done, leaving), every `everyMs` while something is unsent, and
 * with `keepalive` when the page is hidden or closed. A failed save keeps what
 * it held and is tried again after `retryMs`.
 *
 * Written by hand, with no `@angular/core/rxjs-interop`.
 */
@Injectable()
export class WalkEntrySaver {
  private readonly _service = inject<ShopWalkServiceI>(SHOP_WALK_SERVICE);
  private readonly _mutations = inject(Mutations);
  private readonly _document = inject(DOCUMENT);

  private _walkId: string | null = null;
  private _kind: ShopWalkEntryKind = 'edited';
  private _thenKind: ShopWalkEntryKind = 'edited';
  private _opened = 0;
  private _nextKind: ShopWalkEntryKind | null = null;
  private _logEnd = 0;
  private _everyMs = WALK_SAVE_EVERY_MS;
  private _retryMs = WALK_SAVE_EVERY_MS;
  private _open: Open | null = null;
  private _queue: Sealed[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _running: Promise<WalkSaveOutcome> | null = null;
  private _unwatch: (() => void) | null = null;

  private readonly _status = signal<WalkSaveStatus>('idle');
  private readonly _base = signal(0);
  private readonly _unsentCount = signal(0);
  private readonly _nextTryAt = signal<number | null>(null);
  private readonly _savedAt = signal<Date | null>(null);

  /** Where the saver stands. */
  readonly status: Signal<WalkSaveStatus> = this._status.asReadonly();
  /** The base the next append builds on: the last answered `entry.seq`. */
  readonly baseSeq: Signal<number> = this._base.asReadonly();
  /** How many events wait to reach the server, sent or not. */
  readonly unsentCount: Signal<number> = this._unsentCount.asReadonly();
  /** True while anything this page made is not on the server. */
  readonly unsent = computed(() => this._unsentCount() > 0);
  /** When a failed save is tried again, as epoch milliseconds. Null when none waits. */
  readonly nextTryAt: Signal<number | null> = this._nextTryAt.asReadonly();
  /** When a save last arrived. */
  readonly savedAt: Signal<Date | null> = this._savedAt.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.end());
  }

  /**
   * Start saving to a walk as it was read. Drops anything held from before, so a
   * page that read the walk again after `changed` calls this once more.
   */
  begin(start: WalkEntrySaverStart): void {
    this._clearTimer();
    this._walkId = start.walkId;
    this._base.set(start.baseSeq);
    this._logEnd = start.logTo;
    this._kind = start.kind;
    this._thenKind = start.thenKind ?? start.kind;
    this._opened = 0;
    this._nextKind = null;
    this._everyMs = start.everyMs ?? WALK_SAVE_EVERY_MS;
    this._retryMs = start.retryMs ?? this._everyMs;
    this._open = null;
    this._queue = [];
    this._nextTryAt.set(null);
    this._status.set('idle');
    this._count();
    this._watchPage();
  }

  /**
   * Add events to the open entry, opening one when none is. `logTo` moves the
   * entry's end forward, which a recording does and an edit never does.
   */
  add(events: readonly WalkEvent[], logTo?: number): void {
    if (this._walkId === null || (events.length === 0 && logTo === undefined)) {
      return;
    }
    const open = this._ensureOpen();
    open.events.push(...events);
    if (logTo !== undefined && logTo > open.logTo) {
      open.logTo = logTo;
      this._logEnd = logTo;
    }
    this._afterChange();
  }

  /**
   * Queue a whole entry after whatever is open, which is sealed first. For the
   * entries a recording sends as they are (`stopped`, `confirmed`, `discarded`).
   */
  push(draft: WalkEntryDraft): void {
    if (this._walkId === null) {
      return;
    }
    this._seal();
    const logTo = Math.max(this._logEnd, draft.logTo ?? this._logEnd);
    this._queue.push({
      id: newEntryId(),
      kind: draft.kind,
      at: new Date().toISOString(),
      logFrom: this._logEnd,
      logTo,
      events: [...(draft.events ?? [])],
      ...(draft.reason !== undefined ? { reason: draft.reason } : {}),
      ...(draft.rewoundTo !== undefined ? { rewoundTo: draft.rewoundTo } : {}),
    });
    this._logEnd = logTo;
    this._afterChange();
  }

  /**
   * Seal what is open, and give the next entry opened this kind; every entry
   * after that takes `thenKind` again. A recording calls it with `resumed` when a
   * new session starts in the same page (velista `0126`, target 7).
   */
  openNext(kind: ShopWalkEntryKind): void {
    if (this._walkId === null) {
      return;
    }
    const sealing = this._open !== null;
    this._seal();
    this._nextKind = kind;
    if (sealing) {
      this._afterChange();
    }
  }

  /** Where the log ends: the `logTo` of the last entry held or answered. */
  logEnd(): number {
    return this._logEnd;
  }

  /**
   * Send everything unsent, in order. A save already out is waited for, and
   * whatever arrived meanwhile goes out after it.
   */
  save(
    options: { readonly keepalive?: boolean } = {}
  ): Promise<WalkSaveOutcome> {
    const running = this._running;
    if (running !== null) {
      return running.then((outcome) =>
        outcome === 'saved' || outcome === 'nothing'
          ? this.save(options)
          : outcome
      );
    }
    const run = this._drain(options.keepalive === true).finally(() => {
      this._running = null;
    });
    this._running = run;
    return run;
  }

  /** Forget everything unsent. The page says so before calling this. */
  discard(): void {
    this._open = null;
    this._queue = [];
    this._clearTimer();
    this._count();
    if (this._status() !== 'changed' && this._status() !== 'refused') {
      this._status.set('idle');
    }
  }

  /** Stop the timer and the page listeners. Unsent entries stay held. */
  end(): void {
    this._clearTimer();
    this._unwatch?.();
    this._unwatch = null;
  }

  private async _drain(keepalive: boolean): Promise<WalkSaveOutcome> {
    const walkId = this._walkId;
    this._seal();
    if (walkId === null || this._queue.length === 0) {
      return 'nothing';
    }
    this._clearTimer();
    this._status.set('sending');
    while (this._queue.length > 0) {
      const entry = this._queue[0];
      const request: AppendShopWalkEntryRequest = {
        ...entry,
        baseSeq: this._base(),
        events: entry.events,
      };
      const outcome = await this._mutations.run(null, () =>
        this._service.append(
          walkId,
          request,
          keepalive ? { keepalive: true } : {}
        )
      );
      if (this._walkId !== walkId) {
        // `begin` ran for a walk read again while this was out.
        return 'nothing';
      }
      if (outcome.state === 'failed') {
        return this._failed(outcome.error);
      }
      this._base.set(outcome.value.entry.seq);
      this._queue.shift();
      this._count();
    }
    this._savedAt.set(new Date());
    this._nextTryAt.set(null);
    this._status.set(this._open === null ? 'saved' : 'unsent');
    if (this._open !== null) {
      this._schedule(this._everyMs);
    }
    return 'saved';
  }

  private _failed(error: unknown): WalkSaveOutcome {
    const code = error instanceof GatewayError ? error.code : null;
    const status = error instanceof GatewayError ? error.status : 0;
    if (code === 'walk_changed') {
      this._drop('changed');
      return 'changed';
    }
    // A request the server read and refused will be refused again: anything in
    // the 400s but a timeout, the rate limit and a lost session.
    const refused =
      status >= 400 &&
      status < 500 &&
      status !== 401 &&
      status !== 408 &&
      status !== 429;
    if (refused) {
      this._drop('refused');
      return 'refused';
    }
    this._status.set('failed');
    this._schedule(this._retryMs);
    return 'failed';
  }

  private _drop(status: 'changed' | 'refused'): void {
    this._open = null;
    this._queue = [];
    this._clearTimer();
    this._nextTryAt.set(null);
    this._count();
    this._status.set(status);
  }

  private _ensureOpen(): Open {
    if (this._open === null) {
      this._open = {
        id: newEntryId(),
        kind:
          this._nextKind ??
          (this._opened === 0 ? this._kind : this._thenKind),
        logFrom: this._logEnd,
        logTo: this._logEnd,
        events: [],
      };
      this._opened += 1;
      this._nextKind = null;
    }
    return this._open;
  }

  private _seal(): void {
    const open = this._open;
    if (open === null) {
      return;
    }
    this._open = null;
    this._queue.push({
      id: open.id,
      kind: open.kind,
      at: new Date().toISOString(),
      logFrom: open.logFrom,
      logTo: open.logTo,
      events: [...open.events],
    });
  }

  private _afterChange(): void {
    this._count();
    const status = this._status();
    if (status !== 'sending' && status !== 'failed') {
      this._status.set('unsent');
    }
    if (this._timer === null && status !== 'sending') {
      this._schedule(this._everyMs);
    }
  }

  private _count(): void {
    const queued = this._queue.reduce(
      (sum, entry) => sum + Math.max(1, entry.events.length),
      0
    );
    this._unsentCount.set(queued + (this._open?.events.length ?? 0));
  }

  private _schedule(ms: number): void {
    this._clearTimer();
    this._nextTryAt.set(this._status() === 'failed' ? Date.now() + ms : null);
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._unsentCount() > 0) {
        void this.save();
      }
    }, ms);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** A hidden or closing page sends what it holds with `keepalive`. */
  private _watchPage(): void {
    if (this._unwatch !== null) {
      return;
    }
    const document = this._document;
    const view = document.defaultView;
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && this._unsentCount() > 0) {
        void this.save({ keepalive: true });
      }
    };
    const onPageHide = () => {
      if (this._unsentCount() > 0) {
        void this.save({ keepalive: true });
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    view?.addEventListener('pagehide', onPageHide);
    this._unwatch = () => {
      document.removeEventListener('visibilitychange', onHidden);
      view?.removeEventListener('pagehide', onPageHide);
    };
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
