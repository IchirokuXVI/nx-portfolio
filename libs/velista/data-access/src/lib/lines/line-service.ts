import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  Line,
  LineApprovalStatus,
  LineOrder,
  LineSettlement,
  Page,
  SettlementOutcome,
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
   * `itemIds` is here now, and its absence used to be the note in this place: the
   * catalog was out of scope in `0012` and every line this screen wrote left it
   * null. The composer's suggestions are what fill it (velista plan 0043, section
   * 6), and choosing a group sends that group's products whole.
   */
  addLine(
    listId: string,
    content: string,
    quantity?: number,
    itemIds?: readonly string[]
  ): Promise<Line>;

  /**
   * Change what a line says, how many, or which products (`PATCH /v1/lines/:id`).
   * Version bumped.
   *
   * `itemIds` replaces the **whole** set, and an empty array clears it back to
   * free text. A whole set rather than an add or a remove, for the reason reorder
   * takes the whole order.
   *
   * Not the reel's path, deliberately. This is an absolute write, which is a last
   * writer wins race over a value somebody deliberately chose; a moving control
   * writes {@link addQuantity} instead.
   */
  updateLine(
    lineId: string,
    changes: {
      content?: string;
      quantity?: number;
      itemIds?: readonly string[];
    }
  ): Promise<Line>;

  /**
   * Move a line's quantity by a signed delta (`POST /v1/lines/:id/quantity`).
   *
   * **The reel's write, and the reason the reel is correct** (velista plan 0043,
   * section 4.1). Applied atomically under the row's lock, so two people adjusting
   * the same line both land where two absolute writes would have silently lost
   * one. Built by backend plan 0040 for the assistant and never called by anything
   * else until now.
   *
   * `DECIDE`, like settling, because both say what the household now has.
   */
  addQuantity(lineId: string, delta: number): Promise<Line>;

  /**
   * Say what happened to a line on a trip (`POST /v1/lines/:id/settle`).
   *
   * `DECIDE`. It is what `setStatus` was, and the replacement is not a rename:
   * that wrote a state onto the line and this appends a fact to its history, which
   * is what makes the whole model in section 1 work.
   *
   * Answers with both halves, and both are needed: the line carries its new
   * quantity and its moved indicators, and the settlement carries an id and a time
   * that nothing else can produce.
   *
   * Skipping is not a value here. Deciding not to buy something today leaves the
   * line alone and is the absence of this call.
   */
  settle(
    lineId: string,
    outcome: SettlementOutcome,
    options?: { quantity?: number; itemId?: string }
  ): Promise<{ line: Line; settlement: LineSettlement }>;

  /**
   * One line's own history, newest first (`GET /v1/lines/:id/settlements`).
   *
   * `READ`, because a settlement is a zone fact: what the flat bought and when is
   * exactly the shared knowledge a shared list exists to hold, and a history
   * visible only to whoever did the shopping is useless in a household (backend
   * plan 0047, section 3.1). What it never says is which basket a purchase came
   * out of.
   */
  listSettlements(
    lineId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>>;

  /**
   * One product's history across every list the caller can read
   * (`GET /v1/items/:id/settlements`).
   *
   * The second of the line page's two sections, and they are two rather than one
   * because they answer different questions: this is the reader's own consumption
   * across every household they shop for, where the first is one household's.
   * Filtered by read access **at request time**, so it can never widen with a
   * stale grant.
   */
  listItemSettlements(
    itemId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>>;

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
