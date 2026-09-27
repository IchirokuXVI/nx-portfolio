import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import type { WalkFile } from '@portfolio/luna-shopper/shop-map/recorder';
import {
  assembleWalk,
  type WalkChunk,
  type WalkHeader,
} from '../capture/walk-builder';

/** One row of the list: what the list shows without loading megabytes. */
export interface WalkSummary {
  id: string;
  name?: string;
  startedAt: string;
  durationMs: number;
  platform: WalkFile['source']['platform'];
  /** True while a recording is being written, or when one never finished. */
  partial: boolean;
  /** Kept on a partial walk, so its chunks can be put back together. */
  header?: WalkHeader;
}

const DB_NAME = 'velista-walk-lab';
const DB_VERSION = 1;
const WALKS = 'walks';
const SUMMARIES = 'summaries';
const CHUNKS = 'chunks';

/**
 * The walks saved on this device (recorder plan 0002, section 7.1).
 *
 * IndexedDB, because a walk is several megabytes and `localStorage` holds five. Three
 * object stores: `walks`, the whole files keyed by id; `summaries`, the small index
 * the list reads; and `chunks`, the rows a recording saves every few seconds, keyed
 * by walk and sequence number, so a closed tab loses one chunk rather than a walk.
 *
 * **Every call is wrapped and none of them throws.** A private window, a full disk or
 * a browser that refuses IndexedDB falls back to a map in memory for the rest of the
 * page's life, and `error` says why, so a recording in a shop is never stopped by
 * storage. The walk is then lost on reload, and the screen says so.
 */
@Injectable()
export class WalkDb {
  private readonly _window = inject(DOCUMENT).defaultView;
  private _db: Promise<IDBDatabase | null> | null = null;

  private readonly _memory = {
    walks: new Map<string, WalkFile>(),
    summaries: new Map<string, WalkSummary>(),
    chunks: new Map<string, WalkChunk[]>(),
  };

  private readonly _error = signal<string | null>(null);

  /** The last storage failure, or null. Shown on the list and the recording screen. */
  readonly error = this._error.asReadonly();

  /** True when walks are only kept in memory. */
  readonly memoryOnly = signal(false);

  async list(): Promise<WalkSummary[]> {
    const db = await this._open();
    const rows = db
      ? await this._try(() => all<WalkSummary>(db, SUMMARIES), [])
      : [...this._memory.summaries.values()];

    return [...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * One walk, or null.
   *
   * A partial walk is put back together from its chunks, saved whole, and its chunks
   * dropped, so recovering a walk happens once.
   */
  async get(id: string): Promise<WalkFile | null> {
    const db = await this._open();

    if (!db) {
      const walk = this._memory.walks.get(id);
      if (walk) {
        return walk;
      }
      const summary = this._memory.summaries.get(id);
      if (summary?.header) {
        const recovered = assembleWalk(
          summary.header,
          this._memory.chunks.get(id) ?? []
        );
        await this.save(recovered);
        return recovered;
      }
      return null;
    }

    const walk = await this._try(() => getOne<WalkFile>(db, WALKS, id), null);
    if (walk) {
      return walk;
    }

    const summary = await this._try(
      () => getOne<WalkSummary>(db, SUMMARIES, id),
      null
    );
    if (!summary?.header) {
      return null;
    }

    const chunks = await this._try(() => chunksOf(db, id), []);
    const recovered = assembleWalk(summary.header, chunks);
    await this.save(recovered);
    return recovered;
  }

  /** A finished walk, or an imported one. Replaces a walk with the same id. */
  async save(walk: WalkFile): Promise<boolean> {
    const summary = summarize(walk);
    const db = await this._open();

    if (!db) {
      this._memory.walks.set(walk.id, walk);
      this._memory.summaries.set(walk.id, summary);
      this._memory.chunks.delete(walk.id);
      return true;
    }

    return this._try(async () => {
      await write(db, [WALKS, SUMMARIES, CHUNKS], (tx) => {
        tx.objectStore(WALKS).put(walk);
        tx.objectStore(SUMMARIES).put(summary);
        tx.objectStore(CHUNKS).delete(chunkRange(walk.id));
      });
      return true;
    }, false);
  }

  /** A recording has started: list it at once, as partial. */
  async begin(header: WalkHeader): Promise<boolean> {
    const summary: WalkSummary = {
      id: header.id,
      name: header.name,
      startedAt: header.startedAt,
      durationMs: 0,
      platform: header.source.platform,
      partial: true,
      header,
    };
    const db = await this._open();

    if (!db) {
      this._memory.summaries.set(header.id, summary);
      return true;
    }

    return this._try(async () => {
      await write(db, [SUMMARIES], (tx) => tx.objectStore(SUMMARIES).put(summary));
      return true;
    }, false);
  }

  /** The rows of the last few seconds of a recording. */
  async append(chunk: WalkChunk, header: WalkHeader): Promise<boolean> {
    const summary: WalkSummary = {
      id: header.id,
      name: header.name,
      startedAt: header.startedAt,
      durationMs: chunk.durationMs,
      platform: header.source.platform,
      partial: true,
      header,
    };
    const db = await this._open();

    if (!db) {
      const list = this._memory.chunks.get(chunk.walkId) ?? [];
      list.push(chunk);
      this._memory.chunks.set(chunk.walkId, list);
      this._memory.summaries.set(header.id, summary);
      return true;
    }

    return this._try(async () => {
      await write(db, [CHUNKS, SUMMARIES], (tx) => {
        tx.objectStore(CHUNKS).put(chunk);
        tx.objectStore(SUMMARIES).put(summary);
      });
      return true;
    }, false);
  }

  async delete(id: string): Promise<boolean> {
    const db = await this._open();

    if (!db) {
      this._memory.walks.delete(id);
      this._memory.summaries.delete(id);
      this._memory.chunks.delete(id);
      return true;
    }

    return this._try(async () => {
      await write(db, [WALKS, SUMMARIES, CHUNKS], (tx) => {
        tx.objectStore(WALKS).delete(id);
        tx.objectStore(SUMMARIES).delete(id);
        tx.objectStore(CHUNKS).delete(chunkRange(id));
      });
      return true;
    }, false);
  }

  private _open(): Promise<IDBDatabase | null> {
    this._db ??= this._openOnce();
    return this._db;
  }

  private async _openOnce(): Promise<IDBDatabase | null> {
    try {
      const factory = this._window?.indexedDB;
      if (!factory) {
        throw new Error('IndexedDB is not available');
      }

      return await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(WALKS)) {
            db.createObjectStore(WALKS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(SUMMARIES)) {
            db.createObjectStore(SUMMARIES, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(CHUNKS)) {
            db.createObjectStore(CHUNKS, { keyPath: ['walkId', 'seq'] });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB is blocked'));
      });
    } catch (error) {
      this._fail(error);
      this.memoryOnly.set(true);
      return null;
    }
  }

  private async _try<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this._fail(error);
      return fallback;
    }
  }

  private _fail(error: unknown): void {
    this._error.set(error instanceof Error ? error.message : String(error));
  }
}

export function summarize(walk: WalkFile): WalkSummary {
  return {
    id: walk.id,
    name: walk.name,
    startedAt: walk.startedAt,
    durationMs: walk.durationMs,
    platform: walk.source?.platform ?? 'web',
    partial: false,
  };
}

function chunkRange(walkId: string): IDBKeyRange {
  return IDBKeyRange.bound([walkId, 0], [walkId, Number.MAX_SAFE_INTEGER]);
}

function all<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return request<T[]>(
    db.transaction(store, 'readonly').objectStore(store).getAll()
  );
}

function getOne<T>(db: IDBDatabase, store: string, id: string): Promise<T | null> {
  return request<T | undefined>(
    db.transaction(store, 'readonly').objectStore(store).get(id)
  ).then((value) => value ?? null);
}

function chunksOf(db: IDBDatabase, walkId: string): Promise<WalkChunk[]> {
  return request<WalkChunk[]>(
    db.transaction(CHUNKS, 'readonly').objectStore(CHUNKS).getAll(chunkRange(walkId))
  );
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function write(
  db: IDBDatabase,
  stores: string[],
  body: (tx: IDBTransaction) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    body(tx);
  });
}
