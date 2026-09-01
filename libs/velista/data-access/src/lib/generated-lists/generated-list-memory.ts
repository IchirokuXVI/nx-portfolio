import { Injectable } from '@angular/core';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  GeneratedListSummary,
  Page,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { GeneratedListServiceI } from './generated-list-service';

/** A page of the fake history, matching the real one so pagination is exercised. */
const PAGE_SIZE = 20;

/**
 * The caller's generated shopping lists, in memory. Asked for by name, never a default.
 *
 * It exists for `ShoppingProfileMemory`'s reasons, and it models the server rules the
 * two screens actually rest on, because a fake that is kinder than the real thing is a
 * fake that lets a bug through:
 *
 * - **A run with no sources is refused**, as the gateway refuses it. That is what the
 *   sheet's empty source list means, and a fake that cheerfully composed an empty
 *   basket would hide the one failure the sheet has to explain.
 * - **`idempotencyKey` returns the first run**, so a double tap in a spec produces one
 *   basket here exactly as it does against the gateway (backend `0050` section 4).
 * - **The history starts empty.** There is no seeded trip, because the empty state is a
 *   real screen this app draws and a fake that was never empty would leave it untested
 *   by every backend-less run.
 */
@Injectable()
export class GeneratedListMemory implements GeneratedListServiceI {
  /** Newest first, which is the order the real listing answers in. */
  private _lists: GeneratedListSummary[] = [];

  /** What each idempotency key already produced, for the replay. */
  private readonly _byKey = new Map<string, GeneratedListRun>();

  private _nextId = 1;

  async listMine(cursor?: string): Promise<Page<GeneratedListSummary>> {
    // The cursor is the index, which is all a fake needs: the real one is opaque and
    // the client never reads into it, so anything the client round trips unchanged
    // exercises the same code path.
    const from = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    const start = Number.isNaN(from) ? 0 : from;
    const items = this._lists.slice(start, start + PAGE_SIZE);
    const next = start + PAGE_SIZE;

    return {
      items,
      nextCursor: next < this._lists.length ? String(next) : null,
    };
  }

  async create(request: CreateGeneratedListRequest): Promise<GeneratedListRun> {
    const key = request.idempotencyKey;
    if (key !== undefined) {
      const already = this._byKey.get(key);
      if (already !== undefined) {
        return already;
      }
    }

    // The gateway refuses a run that would draw from nothing. Stating `sources` as an
    // empty array is a different thing from omitting it, which falls back to the
    // profile's stored scope, so only the explicit empty is refused here.
    if (request.sources !== undefined && request.sources.length === 0) {
      throw new GatewayError({
        code: 'validation_failed',
        status: 422,
        correlationId: 'memory',
        detail: 'a run needs at least one list to draw from',
      });
    }

    const summary: GeneratedListSummary = {
      id: `gl-${this._nextId++}`,
      name: request.name ?? null,
      status: 'ACTIVE',
      generatedAt: new Date(),
      // A plausible basket rather than an empty one, so a card and a row have counts
      // to draw and the progress bar has a fraction to be.
      lineCount: 8,
      settledLineCount: 0,
      // Nothing settled, so both halves of the breakdown are zero and they add up to
      // the settled count, which is what makes the row draw "0 of 8 got" rather than
      // falling back to "finished". That is the truthful sentence for a fresh basket.
      boughtLineCount: 0,
      notAvailableLineCount: 0,
      // Nobody is holding a basket that has just been composed.
      presentCount: 0,
    };

    this._lists = [summary, ...this._lists];

    const run: GeneratedListRun = { list: summary, skipped: [] };
    if (key !== undefined) {
      this._byKey.set(key, run);
    }

    return run;
  }
}
