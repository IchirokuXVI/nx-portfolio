import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  Line,
  LineApprovalStatus,
  LineOrder,
  LineStatus,
  Page,
} from '@portfolio/velista/models';
import { LineApi } from './line-api';

/**
 * The lines on a list, and every write the list screen makes to one.
 *
 * Split from `ListServiceI` on the same line that separates memberships from zones:
 * that interface is operations on **a list**, this is operations on **a line**. The
 * split is not cosmetic here, because the routes are on two different controllers and
 * two different permission rules: reading and reordering are addressed through the
 * list, while editing, ticking, deciding and deleting are addressed by line id alone.
 *
 * Every method returns a promise. The live half arrives through `REALTIME_CLIENT`, and
 * `LineStore` is the only thing that joins the two (plan 0012, section 5.2).
 */
export interface LineServiceI {
  /**
   * One list's lines (`GET /v1/lists/:id/lines`).
   *
   * Defaults to `position` order, which is the only order any screen asks for: a
   * shopping list has a manual order because that is the order of the aisles.
   *
   * The **cursor matters beyond pagination**. Rule L4 turns dragging on only once
   * `nextCursor` is null, because `line.reorder` renumbers exactly the lines it names
   * and leaves the rest on positions that deletes have already made non contiguous.
   */
  listLines(
    listId: string,
    options?: { cursor?: string; limit?: number; order?: LineOrder }
  ): Promise<Page<Line>>;

  /**
   * Put something on the list (`POST /v1/lists/:id/lines`).
   *
   * Requires WRITER on the list, which `requireWrite` grants from a `ListAccess` row
   * and **not** from being a zone admin: there is no manager bypass on that check.
   *
   * `itemId` is deliberately absent from this signature. The catalog is out of scope
   * (section 9) and every line this screen writes leaves it null, so offering the
   * parameter would be an interface written against a screen that does not exist.
   */
  addLine(listId: string, content: string, quantity?: number): Promise<Line>;

  /** Change what a line says, or how many (`PATCH /v1/lines/:id`). Version bumped. */
  updateLine(
    lineId: string,
    changes: { content?: string; quantity?: number }
  ): Promise<Line>;

  /**
   * Tick it off, or mark it as not in the shop (`POST /v1/lines/:id/status`).
   *
   * WRITER and nothing more, which is why a line still waiting for approval can be
   * ticked off: the backend permits it, and a rule invented in the client that the
   * backend does not enforce is a lie the next client exposes (section 3.4).
   */
  setStatus(lineId: string, status: LineStatus): Promise<Line>;

  /**
   * Decide a suggested line (`POST /v1/lines/:id/approval`).
   *
   * Zone OWNER or ADMIN. Takes the status rather than a boolean, because putting a
   * turned down line back is a third outcome and not the negation of a second.
   */
  setApproval(lineId: string, status: LineApprovalStatus): Promise<Line>;

  /**
   * Rewrite the whole order (`POST /v1/lists/:id/lines/reorder`).
   *
   * Answers the list id and nothing else, so the caller either trusts its own optimistic
   * order or rereads. `validation_failed` here means the order named a line the server
   * no longer has, which is somebody deleting one mid drag: the list rereads and says
   * nothing, per section 5.7.
   */
  reorder(listId: string, orderedLineIds: readonly string[]): Promise<void>;

  /** Take it off the list, for everybody (`DELETE /v1/lines/:id`). */
  deleteLine(lineId: string): Promise<string>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching every other service token in this library
 * and for the reason `ZONE_SERVICE` gives at length: a token that quietly falls back to
 * fixtures serves invented data while looking like a backend. The fake is asked for by
 * name with `{ provide: LINE_SERVICE, useExisting: LineMemory }`.
 */
export const LINE_SERVICE = serviceToken<LineServiceI>('LINE_SERVICE', () =>
  inject(LineApi)
);
