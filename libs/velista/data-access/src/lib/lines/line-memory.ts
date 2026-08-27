import { Injectable, signal } from '@angular/core';
import type {
  Line,
  LineApprovalStatus,
  LineOrder,
  LineStatus,
  Page,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { SEED_USER_ID } from '../zones/static-zone-data';
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
 */
@Injectable()
export class LineMemory implements LineServiceI {
  private readonly _byList = signal<ReadonlyMap<string, readonly Line[]>>(
    new Map(Object.entries(SEED_LINES))
  );

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

  async addLine(
    listId: string,
    content: string,
    quantity?: number
  ): Promise<Line> {
    this._maybeFail();

    const existing = this._lines(listId);
    const line: Line = {
      id: newId(),
      listId,
      content,
      quantity: quantity ?? 1,
      itemId: null,
      // One past the highest, never `length`. Deletes leave gaps and a list whose
      // positions collide is the bug rule L4 is about.
      position: existing.reduce((top, l) => Math.max(top, l.position), 0) + 1,
      // Core starts every line here, whoever added it. Rule L3 is the client following
      // that with an approval of its own, and this fake is what proves it happens.
      approvalStatus: 'PENDING',
      status: 'PENDING',
      createdByUserId: SEED_CALLER,
      approvedByUserId: null,
      version: 1,
    };

    this._write(listId, [...existing, line]);
    return line;
  }

  async updateLine(
    lineId: string,
    changes: { content?: string; quantity?: number }
  ): Promise<Line> {
    this._maybeFail();
    return this._patch(lineId, (line) => ({
      ...line,
      content: changes.content ?? line.content,
      quantity: changes.quantity ?? line.quantity,
    }));
  }

  async setStatus(lineId: string, status: LineStatus): Promise<Line> {
    this._maybeFail();
    return this._patch(lineId, (line) => ({ ...line, status }));
  }

  async setApproval(
    lineId: string,
    approvalStatus: LineApprovalStatus
  ): Promise<Line> {
    this._maybeFail();
    return this._patch(lineId, (line) => ({
      ...line,
      approvalStatus,
      approvedByUserId:
        approvalStatus === 'APPROVED' ? SEED_CALLER : line.approvedByUserId,
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
    this._maybeFail();

    const lines = this._lines(listId);
    for (const id of orderedLineIds) {
      if (!lines.some((line) => line.id === id)) {
        throw memoryFailure('validation_failed', 400);
      }
    }

    const positions = new Map(orderedLineIds.map((id, index) => [id, index + 1]));
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

  async deleteLine(lineId: string): Promise<string> {
    this._maybeFail();

    const listId = this._listOf(lineId);
    if (listId === null) {
      throw memoryFailure('not_found', 404);
    }

    this._write(
      listId,
      this._lines(listId).filter((line) => line.id !== lineId)
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

/** Who this fake answers as. The seeded caller every other fake in this library uses. */
const SEED_CALLER = SEED_USER_ID;

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
