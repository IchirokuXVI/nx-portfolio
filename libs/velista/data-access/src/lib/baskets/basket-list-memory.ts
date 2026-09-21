import { Injectable } from '@angular/core';
import type {
  CreateBasketRequest,
  BasketRun,
  BasketSummary,
  Page,
  SharedBasketSummary,
  WritableBasketStatus,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { BasketListServiceI } from './basket-list-service';

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
export class BasketListMemory implements BasketListServiceI {
  /** Newest first, which is the order the real listing answers in. */
  private _lists: BasketSummary[] = [];

  /** What each idempotency key already produced, for the replay. */
  private readonly _byKey = new Map<string, BasketRun>();

  private _nextId = 1;

  /** Baskets other people shared with the caller. Empty, like the history. */
  shared: SharedBasketSummary[] = [];

  /** What the last create asked to share with, for specs to read back. */
  lastMemberUserIds: readonly string[] | undefined;

  async listMine(cursor?: string): Promise<Page<BasketSummary>> {
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

  async listShared(cursor?: string): Promise<Page<SharedBasketSummary>> {
    const from = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    const start = Number.isNaN(from) ? 0 : from;
    const next = start + PAGE_SIZE;

    return {
      items: this.shared.slice(start, next),
      nextCursor: next < this.shared.length ? String(next) : null,
    };
  }

  async create(request: CreateBasketRequest): Promise<BasketRun> {
    this.lastMemberUserIds = request.memberUserIds;
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

    const summary: BasketSummary = {
      id: `gl-${this._nextId++}`,
      // A run composes a trip, always. The permanent basket of backend `0136` is
      // not made by anything here.
      kind: 'GENERATED',
      name: request.name ?? null,
      // `OPEN`, because that is what core composes. This double used to say
      // `ACTIVE`, agreeing with the dashboard's old filter instead of with the
      // server, which is precisely how a card that worked in demo mode drew for
      // nobody on a real account. Backend `0133` folded the two spellings of this
      // state into one, so there is one value for both to agree on now.
      status: 'OPEN',
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

    const run: BasketRun = { list: summary };
    if (key !== undefined) {
      this._byKey.set(key, run);
    }

    return run;
  }

  /**
   * Finish a trip, or take it back to being one (velista `0057`).
   *
   * **A basket this fake has never heard of is a `not_found`**, as the gateway
   * answers one, rather than a quiet success. That is the same rule the refused
   * empty run above follows: a fake that accepted a write against nothing would
   * let a screen pass here that draws a banner over a basket the server never
   * moved.
   */
  async setStatus(
    basketId: string,
    status: WritableBasketStatus
  ): Promise<void> {
    const at = this._lists.findIndex((list) => list.id === basketId);
    if (at < 0) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'no such shopping list',
      });
    }

    this._lists = this._lists.map((list, index) =>
      index === at ? { ...list, status } : list
    );
  }
}
