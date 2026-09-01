import { inject, Injectable, signal } from '@angular/core';
import {
  ALSO_ON_MAX_LISTS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  type AlsoOnPlaceVm,
  type AlsoOnVm,
  type Line,
  type LineApprovalStatus,
  type LineOrder,
  type LineSettlement,
  type ListPermission,
  type Page,
  type SettlementOutcome,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { ListMemory } from '../lists/list-memory';
import { ZoneMemory } from '../zones/zone-memory';
import type { LineServiceI } from './line-service';
import { SEED_LINES } from './static-line-data';

/**
 * Lines, in memory. Asked for by name, never a default.
 *
 * This is the fake the whole list screen is built and tested against, and it exists
 * because section 3 has fourteen states that cannot all be produced against a live
 * gateway without several accounts, a second browser and a deliberately broken
 * network. Every one of them is reachable here in one call.
 *
 * It models the two things that make this screen unlike the others:
 *
 * - **`version` really increments**, on every write, so the overwritten branch of
 *   `Mutations.run` can be provoked deterministically rather than raced for.
 * - **Positions are integers with gaps**, exactly as deletes leave them on the server,
 *   so a reorder that renumbers only part of a list produces the collision rule L4
 *   exists to prevent rather than quietly working.
 *
 * ## It refuses what the server would refuse
 *
 * Since plan 0030 section 9. Every write asks `ListMemory.permissionsFor` and throws the
 * same `GatewayError` the gateway's refusal arrives as, because the states worth
 * exercising, a `WRITE`-only caller and a `DECIDE`-only caller, are exactly the ones
 * that cost four accounts and a share sheet to reach for real. `ListMemory` owns the
 * answer rather than this class recomputing it, so a line write and a list write cannot
 * disagree about who the caller is.
 *
 * It also creates a line with the approval the server would give it (backend plan 0037,
 * section 2), which is what lets the optimistic placeholder be checked against something
 * rather than against a guess.
 *
 * One thing it cannot do: this fake emits no events, so the remainder line a quantity
 * reduction splits off (backend plan 0037, section 4) appears on the next read rather
 * than arriving as `line.added`. That is a limit of the fake and not of the rule, and it
 * is worth knowing before reading a spec that reloads to see it.
 */
@Injectable()
export class LineMemory implements LineServiceI {
  private readonly _lists = inject(ListMemory);
  // For the one read that names a zone as well as a list (plan 0053, section 3). The
  // real gateway composes both names itself; here they live in two fakes.
  private readonly _zones = inject(ZoneMemory);

  private readonly _byList = signal<ReadonlyMap<string, readonly Line[]>>(
    new Map(Object.entries(SEED_LINES))
  );

  /**
   * Every settlement anybody has written in this session, newest first.
   *
   * **Seeded empty, on purpose.** The seeded lines carry a `boughtCount` and a last
   * outcome, which is what draws their indicators, but no rows behind those numbers,
   * so a line page opened cold shows its indicator and an empty history. That is not
   * an oversight, it is exactly what the real migration did: backend plan 0047
   * section 8 backfills no settlements, because there is nobody to attribute them to
   * and no date to give them. A fixture that invented a plausible history would be
   * the one thing the migration deliberately refused to do.
   */
  private _settlements: readonly LineSettlement[] = [];

  /**
   * Set to refuse the next write with this code, so a spec can drive the failed and
   * read only paths without a network. Cleared once it has fired, because a failure
   * that stays armed makes the next assertion in the same spec fail for the wrong
   * reason.
   */
  private _nextWriteFails: GatewayError['code'] | null = null;

  async listLines(
    listId: string,
    options?: { cursor?: string; limit?: number; order?: LineOrder }
  ): Promise<Page<Line>> {
    // READ is genuinely everything a reader gets, lines included (backend plan 0036,
    // section 4.3), so this is the only gate on the read path.
    this._require(listId, 'READ');

    const ordered = order(this._lines(listId), options?.order ?? 'position');
    const limit = options?.limit ?? 100;
    const start =
      options?.cursor === undefined ? 0 : Number(options.cursor) || 0;
    const slice = ordered.slice(start, start + limit);
    const end = start + slice.length;

    return {
      items: slice,
      nextCursor: end < ordered.length ? String(end) : null,
    };
  }

  /**
   * Put something on the list. `WRITE`, and the approval is decided here.
   *
   * The three rules of backend plan 0037 section 2, in their order. The adder holding
   * `DECIDE` is the one that matters most, because it is the fix for the approve button
   * that used to flash on the adder's own line: they are the person the approval would
   * have been asked of, and adding the line is them giving it. Auto-approve is second and
   * leaves the approver **null**, which is the honest record that nobody decided.
   *
   * Nothing here has ever been bought, in all three, because a line cannot acquire a
   * history in the same breath as being created.
   */
  async addLine(
    listId: string,
    content: string,
    quantity?: number,
    itemIds?: readonly string[]
  ): Promise<Line> {
    const permissions = this._require(listId, 'WRITE');
    this._maybeFail();

    const caller = this._lists.callerUserId();
    const decides = permissions.includes('DECIDE');
    const auto = this._lists.listById(listId)?.autoApproveLines === true;

    const existing = this._lines(listId);
    const line: Line = {
      id: newId(),
      listId,
      content,
      quantity: quantity ?? 1,
      itemIds: [...(itemIds ?? [])],
      // One past the highest, never `length`. Deletes leave gaps and a list whose
      // positions collide is the bug rule L4 is about.
      position: existing.reduce((top, l) => Math.max(top, l.position), 0) + 1,
      approvalStatus: decides || auto ? 'APPROVED' : 'PENDING',
      boughtCount: 0,
      lastSettlementOutcome: null,
      // Nothing can be in a basket a moment after it was typed, and the seed puts
      // nothing in one either (backend plan 0052).
      claimed: false,
      claimedByUserId: null,
      createdByUserId: caller,
      approvedByUserId: decides ? caller : null,
      version: 1,
    };

    this._write(listId, [...existing, line]);
    return line;
  }

  /**
   * Change what a line says, or how many.
   *
   * Three different answers on an approved line, and the whole shape of the permission
   * model is in them (backend plan 0036, section 4.1). `WRITE` may not touch it at all,
   * because a writer whose line has been agreed to cannot quietly change what was agreed
   * to. `DECIDE` may change the quantity and nothing else, which is the one thing a
   * person in the aisle learns that the list did not know. `MANAGE` may change any field
   * of any line, because a governed thing needs somebody who can fix it.
   *
   * One further rule rides on the same call: editing a `REJECTED` line puts it back to
   * `PENDING` and clears the approver, on any edit and on any list, which is what makes a
   * rejection a conversation rather than a dead end.
   *
   * **Lowering the quantity no longer splits off a remainder.** Plan 0037 wrote the
   * shortfall to a second `NOT_AVAILABLE` line; with no trip status that row would be an
   * ordinary approved line at the shortfall quantity, which the list would immediately
   * count as wanted again. What a shopper found is a settlement now, and lowering a
   * quantity is the primary gesture on this page rather than a report from a shop.
   */
  async updateLine(
    lineId: string,
    changes: {
      content?: string;
      quantity?: number;
      itemIds?: readonly string[];
    }
  ): Promise<Line> {
    const line = this._lineOrThrow(lineId);
    const permissions = this._permissionsFor(line.listId);
    const approved = line.approvalStatus === 'APPROVED';

    if (!permissions.includes('MANAGE')) {
      if (approved) {
        if (!permissions.includes('DECIDE') || changes.content !== undefined) {
          throw memoryFailure('forbidden', 403);
        }
      } else if (!permissions.includes('WRITE')) {
        throw memoryFailure('forbidden', 403);
      }
    }

    // A floor of **zero**, which moved there with the trip status (backend plan
    // 0047). Zero is the household saying it is stocked rather than an empty line
    // waiting to be deleted, so it is the ordinary end of the reel and not a refusal.
    if (
      changes.quantity !== undefined &&
      (changes.quantity < LINE_QUANTITY_MIN ||
        changes.quantity > LINE_QUANTITY_MAX)
    ) {
      throw memoryFailure('validation_failed', 400);
    }

    this._maybeFail();

    return this._patch(lineId, (current) => ({
      ...current,
      content: changes.content ?? current.content,
      quantity: changes.quantity ?? current.quantity,
      // Undefined leaves the set alone; an empty array clears it to free text.
      itemIds:
        changes.itemIds === undefined ? current.itemIds : [...changes.itemIds],
      ...(current.approvalStatus === 'REJECTED'
        ? {
            approvalStatus: 'PENDING' as LineApprovalStatus,
            approvedByUserId: null,
          }
        : {}),
    }));
  }

  /**
   * Move the quantity by a signed delta. `DECIDE`.
   *
   * The reel's write. Applied to whatever the line currently holds rather than to a
   * number the caller read a moment ago, which is the whole reason the route takes a
   * delta: two adjustments in flight at once both land, where two absolute writes
   * would have silently lost one.
   */
  async addQuantity(lineId: string, delta: number): Promise<Line> {
    const line = this._lineOrThrow(lineId);
    this._require(line.listId, 'DECIDE');

    // Never zero, which the server refuses too. A gesture that ended where it
    // started is not an adjustment to send.
    if (delta === 0 || !Number.isInteger(delta)) {
      throw memoryFailure('validation_failed', 400);
    }

    const next = line.quantity + delta;
    if (next < LINE_QUANTITY_MIN || next > LINE_QUANTITY_MAX) {
      throw memoryFailure('validation_failed', 400);
    }

    this._maybeFail();
    return this._patch(lineId, (current) => ({
      ...current,
      quantity: current.quantity + delta,
      version: current.version + 1,
    }));
  }

  /**
   * Say what happened to a line on a trip. `DECIDE`.
   *
   * Three properties worth reproducing faithfully, because every screen built on this
   * fixture depends on them (backend plan 0047, section 4):
   *
   * - `BOUGHT` decrements by what was bought, **floored at zero**, and records what
   *   was really bought even when that exceeds what was asked for.
   * - `NOT_AVAILABLE` moves nothing and records a settlement of zero.
   * - Nothing is terminal: a partial settle leaves the remainder wanted, and a second
   *   settle finishes it.
   */
  async settle(
    lineId: string,
    outcome: SettlementOutcome,
    options?: { quantity?: number; itemId?: string }
  ): Promise<{ line: Line; settlement: LineSettlement }> {
    const line = this._lineOrThrow(lineId);
    this._require(line.listId, 'DECIDE');

    if (outcome === 'NOT_AVAILABLE' && options?.quantity !== undefined) {
      throw memoryFailure('validation_failed', 400);
    }

    const bought = outcome === 'BOUGHT' ? (options?.quantity ?? 1) : 0;
    if (outcome === 'BOUGHT' && (bought < 1 || !Number.isInteger(bought))) {
      throw memoryFailure('validation_failed', 400);
    }

    this._maybeFail();

    const settlement: LineSettlement = {
      id: newId(),
      lineId,
      listId: line.listId,
      // The exact product, copied at settle time: the one named, or the line's only
      // one, or none at all on a free text line.
      itemId:
        options?.itemId ?? (line.itemIds.length === 1 ? line.itemIds[0] : null),
      outcome,
      quantity: bought,
      settledByUserId: this._lists.callerUserId(),
      settledAt: new Date(),
      // A settle that has just happened has not been taken back. Reopening is a
      // basket act (luna `0054`, section 3) and this fake is the zone list surface,
      // which has no route that would set this.
      revertedAt: null,
    };
    this._settlements = [settlement, ...this._settlements];

    const updated = this._patch(lineId, (current) => ({
      ...current,
      quantity:
        outcome === 'BOUGHT'
          ? Math.max(0, current.quantity - bought)
          : current.quantity,
      boughtCount: current.boughtCount + (outcome === 'BOUGHT' ? 1 : 0),
      lastSettlementOutcome: outcome,
      version: current.version + 1,
    }));

    return { line: updated, settlement };
  }

  /** One line's own history, newest first. `READ`, because it is a zone fact. */
  async listSettlements(
    lineId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>> {
    const line = this._lineOrThrow(lineId);
    this._require(line.listId, 'READ');
    return this._pageOf(
      this._settlements.filter((row) => row.lineId === lineId),
      options
    );
  }

  /**
   * One product's history across every list this caller can read. `READ`.
   *
   * The access filter is the point of this read rather than a detail of it, so the
   * fixture applies one: settlements on lists the caller cannot read are dropped,
   * exactly as the server's `EXISTS` does it. A fixture that returned everything
   * would make the one property worth testing here untestable.
   */
  async listItemSettlements(
    itemId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>> {
    const readable = this._settlements.filter(
      (row) =>
        row.itemId === itemId &&
        this._permissionsFor(row.listId).includes('READ')
    );
    return this._pageOf(readable, options);
  }

  /**
   * Which other lists still want a product (backend plan 0053, section 3).
   *
   * The fake reproduces the three rules the screen depends on, because each of them is
   * a distinction the screen draws and a fake that blurred one would make the wrong
   * branch unreachable in development:
   *
   * - **A line with no product is refused**, not answered empty. "There was nothing to
   *   look for" and "no other list has this" are different answers.
   * - **Only lists this caller may read**, the same filter the settlement history
   *   applies, and applied on every call rather than remembered.
   * - **Only lines still wanted.** A line settled down to zero has stopped asking for
   *   the product, and reporting it would make the indicator say a household wants
   *   something it has just bought.
   */
  async listsHoldingItem(
    itemId: string,
    options?: { excludeListId?: string }
  ): Promise<AlsoOnVm> {
    if (itemId === '') {
      throw memoryFailure('validation_failed', 400);
    }

    const places: AlsoOnPlaceVm[] = [];

    for (const [listId, lines] of this._allLines()) {
      if (listId === options?.excludeListId) {
        continue;
      }
      if (!this._permissionsFor(listId).includes('READ')) {
        continue;
      }
      const wants = lines.some(
        (line) => line.quantity > 0 && line.itemIds.includes(itemId)
      );
      if (!wants) {
        continue;
      }

      const list = this._lists.listById(listId);
      const zone =
        list === null
          ? undefined
          : this._zones.zones().find((entry) => entry.id === list.zoneId);
      if (list === undefined || list === null || zone === undefined) {
        continue;
      }

      places.push({ listId, listName: list.name, zoneName: zone.name });
    }

    // Capped exactly as the server caps it, so a development run can reach the "and
    // more" caption rather than only ever seeing the short answer.
    return {
      places: places.slice(0, ALSO_ON_MAX_LISTS),
      hasMore: places.length > ALSO_ON_MAX_LISTS,
    };
  }

  /**
   * A page of settlements, newest first, cursored on the boundary row's own id.
   *
   * An id rather than a timestamp, for the reason the server's cursor is one: two
   * settlements written in the same millisecond are separated by id, and a token
   * carrying the time would repeat one of them or skip it.
   */
  private _pageOf(
    rows: readonly LineSettlement[],
    options?: { cursor?: string; limit?: number }
  ): Page<LineSettlement> {
    const sorted = [...rows].sort(
      (a, b) => b.settledAt.getTime() - a.settledAt.getTime()
    );
    const from =
      options?.cursor === undefined
        ? 0
        : sorted.findIndex((row) => row.id === options.cursor) + 1;
    const limit = options?.limit ?? 20;
    const page = sorted.slice(from, from + limit);
    const last = page[page.length - 1];

    return {
      items: page,
      nextCursor:
        last !== undefined && from + limit < sorted.length ? last.id : null,
    };
  }

  /** Approve, turn down, or put a turned down line back. `DECIDE`. */
  async setApproval(
    lineId: string,
    approvalStatus: LineApprovalStatus
  ): Promise<Line> {
    const line = this._lineOrThrow(lineId);
    this._require(line.listId, 'DECIDE');
    this._maybeFail();

    const caller = this._lists.callerUserId();
    return this._patch(lineId, (current) => ({
      ...current,
      approvalStatus,
      approvedByUserId:
        approvalStatus === 'APPROVED' ? caller : current.approvedByUserId,
    }));
  }

  /**
   * Rewrite the order.
   *
   * Renumbers **only** the lines named, which is what core does, so a caller that
   * sends one page of a two page list gets the collision rather than a tidy result.
   * A named line the list does not have is a `validation_failed`, which is the mid
   * drag delete section 5.7 handles by rereading and saying nothing.
   */
  async reorder(
    listId: string,
    orderedLineIds: readonly string[]
  ): Promise<void> {
    this._require(listId, 'WRITE');
    this._maybeFail();

    const lines = this._lines(listId);
    for (const id of orderedLineIds) {
      if (!lines.some((line) => line.id === id)) {
        throw memoryFailure('validation_failed', 400);
      }
    }

    const positions = new Map(
      orderedLineIds.map((id, index) => [id, index + 1])
    );
    this._write(
      listId,
      lines.map((line) => {
        const position = positions.get(line.id);
        return position === undefined
          ? line
          : { ...line, position, version: line.version + 1 };
      })
    );
  }

  /**
   * Take it off the list, for everybody.
   *
   * `WRITE` reaches a `PENDING` or `REJECTED` line and stops there; deleting an approved
   * line is `MANAGE`, and not `DECIDE`, because un-approving it first is the path a
   * decider already has and it leaves the line's history saying what happened.
   */
  async deleteLine(lineId: string): Promise<string> {
    const line = this._lineOrThrow(lineId);
    this._require(
      line.listId,
      line.approvalStatus === 'APPROVED' ? 'MANAGE' : 'WRITE'
    );
    this._maybeFail();

    this._write(
      line.listId,
      this._lines(line.listId).filter((current) => current.id !== lineId)
    );
    return lineId;
  }

  /** Test and development seam: replace one list's lines outright. */
  setLines(listId: string, lines: readonly Line[]): void {
    this._write(listId, lines);
  }

  /** Test seam: the next write throws this code, once. */
  failNextWrite(code: GatewayError['code']): void {
    this._nextWriteFails = code;
  }

  /**
   * The check every write goes through, answering the set it just validated.
   *
   * `not_found` before `forbidden`, matching core, so a list the caller cannot see never
   * leaks its existence through the difference between the two. Returning the set saves
   * the one caller that needs a second membership test from asking twice.
   */
  private _require(
    listId: string,
    permission: ListPermission
  ): readonly ListPermission[] {
    const permissions = this._permissionsFor(listId);
    if (!permissions.includes(permission)) {
      throw memoryFailure(
        permissions.length === 0 ? 'not_found' : 'forbidden',
        permissions.length === 0 ? 404 : 403
      );
    }

    return permissions;
  }

  private _permissionsFor(listId: string): readonly ListPermission[] {
    return this._lists.permissionsFor(listId);
  }

  private _lineOrThrow(lineId: string): Line {
    const listId = this._listOf(lineId);
    const line =
      listId === null
        ? undefined
        : this._lines(listId).find((candidate) => candidate.id === lineId);

    if (line === undefined) {
      throw memoryFailure('not_found', 404);
    }

    return line;
  }

  private _maybeFail(): void {
    const code = this._nextWriteFails;
    if (code === null) {
      return;
    }

    this._nextWriteFails = null;
    throw memoryFailure(code, statusFor(code));
  }

  private _patch(lineId: string, change: (line: Line) => Line): Line {
    const listId = this._listOf(lineId);
    if (listId === null) {
      throw memoryFailure('not_found', 404);
    }

    const lines = this._lines(listId);
    const current = lines.find((line) => line.id === lineId);
    if (current === undefined) {
      throw memoryFailure('not_found', 404);
    }

    // The version moves on every write, which is what makes the overwritten branch of
    // `Mutations.run` reachable in a spec: bump it twice and the second answer is
    // further ahead than the caller's own write alone would have taken it.
    const updated: Line = { ...change(current), version: current.version + 1 };
    this._write(
      listId,
      lines.map((line) => (line.id === lineId ? updated : line))
    );
    return updated;
  }

  private _lines(listId: string): readonly Line[] {
    return this._byList().get(listId) ?? [];
  }

  /** Every list this fake holds lines for, for the reads that span lists. */
  private _allLines(): ReadonlyMap<string, readonly Line[]> {
    return this._byList();
  }

  private _listOf(lineId: string): string | null {
    for (const [listId, lines] of this._byList()) {
      if (lines.some((line) => line.id === lineId)) {
        return listId;
      }
    }

    return null;
  }

  private _write(listId: string, lines: readonly Line[]): void {
    this._byList.update((current) => new Map(current).set(listId, lines));
  }
}

function order(lines: readonly Line[], by: LineOrder): readonly Line[] {
  if (by === 'position') {
    return [...lines].sort((a, b) => a.position - b.position);
  }

  // `created` and `updated` need timestamps the client's model of a line does not
  // carry, and no screen asks for either (section 9). The seeded order stands in.
  return lines;
}

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `line-${Math.random().toString(36).slice(2, 10)}`;
}

function statusFor(code: GatewayError['code']): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'forbidden':
      return 403;
    case 'unauthorized':
      return 401;
    case 'validation_failed':
      return 400;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    default:
      return 500;
  }
}

function memoryFailure(
  code: GatewayError['code'],
  status: number
): GatewayError {
  return new GatewayError({
    code,
    status,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by LineMemory, no request was sent',
  });
}
