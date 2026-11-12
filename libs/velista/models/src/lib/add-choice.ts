import type { CatalogItem, Line } from './domain';
import type { LineApprovalStatus } from './enums';
import { LINE_QUANTITY_MAX } from './limits';
import { foldName, lineName } from './line-name';
import { addAmount, type LineUnit } from './line-unit';

/**
 * The most lines a `line_add_needs_choice` refusal names (backend `0228`, section 5).
 * The server's own cap, stated here so a mapper can hold a refusal to it.
 */
export const ADD_CHOICE_MAX = 10;

/**
 * What a free text add says about a name the list already holds (velista `0170`,
 * backend `0228`).
 *
 * At most one of the three, and none on an add that carries products:
 *
 * - `askIfAmbiguous`: the caller can draw a question, so two or more lines that hold
 *   a product under the typed name refuse the add and name them.
 * - `intoLineId`: the person chose that line. The server raises it when it is at
 *   zero and leaves it as it is when it holds an amount (backend `0260`). It never
 *   falls back to a new line.
 * - `newLine`: the person chose a new line.
 */
export interface AddLineOptions {
  readonly askIfAmbiguous?: true;
  readonly intoLineId?: string;
  readonly newLine?: true;
}

/**
 * What an add did (backend `0260`, R1; velista `0185`): it made a line, it raised a
 * line kept at zero, or it met a line the list already asks for and changed
 * nothing. velista's own union of the server's `outcome` (rule D4).
 */
export type AddOutcome = 'created' | 'raised' | 'alreadyOnList';

/** One line a `line_add_needs_choice` refusal names, as the server sent it. */
export interface AddChoiceLine {
  readonly lineId: string;
  readonly content: string;
  readonly named: boolean;
  readonly quantity: number;
  /** What {@link quantity} counts (backend `0246`, velista `0182`). */
  readonly unit: LineUnit;
  readonly itemIds: readonly string[];
  readonly productGroupId: string | null;
  readonly approvalStatus: LineApprovalStatus;
}

/**
 * The question a refused free text add asks: which of these lines, or a new one
 * (velista `0170`, target 5). The lines are in list position order.
 */
export interface AddChoice {
  readonly lines: readonly AddChoiceLine[];
}

/** One row of the popover that asks it, drawn. */
export interface AddChoiceRow {
  readonly lineId: string;
  /** The name the list row draws (velista `0144`). */
  readonly name: string;
  /** "Hacendado · 1 L", or null while the product is not loaded or has neither. */
  readonly product: string | null;
  readonly imageUrl: string | null;
  /**
   * The line's quantity now, and what the add takes it to: one step of the line's
   * own unit more (backend `0260`). The server asks only about lines at zero, so
   * `from` is 0 in every question it asks today.
   */
  readonly from: number;
  readonly to: number;
  /** What `from` and `to` count (velista `0182`). */
  readonly unit: LineUnit;
}

/** What {@link addChoiceRows} reads of the catalog and of the lines already held. */
export interface AddChoiceFacts {
  readonly itemOf: (itemId: string) => CatalogItem | null;
  /** The favourite of a line the screen holds, which decides the product it shows. */
  readonly favoriteOf: (lineId: string) => string | null;
  readonly locale: string;
  readonly brandSizeOf: (item: CatalogItem) => string | null;
}

/**
 * The rows of the question, one per line, in the order the refusal named them.
 *
 * Each row says what a choice of it does: the line goes up by one step of its own
 * unit ({@link addAmount}), the amount a raise of a kept line takes (backend
 * `0260`, R2 and R4). A raise is capped as the server caps it, so the arrow never
 * promises a number the line cannot reach.
 */
export function addChoiceRows(
  choice: AddChoice,
  facts: AddChoiceFacts
): readonly AddChoiceRow[] {
  return choice.lines.map((line) => {
    const name = lineName(
      {
        content: line.content,
        named: line.named,
        itemIds: line.itemIds,
        favoriteItemId: facts.favoriteOf(line.lineId),
      },
      (itemId) => facts.itemOf(itemId)?.name ?? null,
      facts.locale
    );
    const item = name.itemId === null ? null : facts.itemOf(name.itemId);
    return {
      lineId: line.lineId,
      name: name.text,
      product: item === null ? null : facts.brandSizeOf(item),
      imageUrl: item?.imageUrl ?? null,
      from: line.quantity,
      to: Math.min(LINE_QUANTITY_MAX, line.quantity + addAmount(line.unit)),
      unit: line.unit,
    };
  });
}

/**
 * The name the question's title says: the stored words of the first line the
 * refusal named, which is the row's own spelling, and not the words as typed
 * ("Leche entera", where somebody typed "leche entera"). The typed words only when
 * the line holds none.
 */
export function addChoiceName(choice: AddChoice, typed: string): string {
  const stored = choice.lines[0]?.content.trim() ?? '';
  return stored === '' ? typed : stored;
}

/**
 * Whether a free text add of `content` is likely to land on a line already held
 * (velista `0170`, target 3): a loaded line, not turned down, carries the same name
 * as the server folds it.
 *
 * A prediction and nothing more. It only decides whether a row is drawn before the
 * server answers, so that a row is not drawn and then taken away. The server's
 * answer always wins (D1).
 */
export function addMayMeetLine(
  lines: readonly Pick<Line, 'content' | 'approvalStatus'>[],
  content: string
): boolean {
  const typed = foldName(content);
  if (typed === '') {
    return false;
  }
  return lines.some(
    (line) =>
      line.approvalStatus !== 'REJECTED' && foldName(line.content) === typed
  );
}

/**
 * Whether a product add is likely to meet a line the list already asks for
 * (velista `0185`, decision I): a loaded line, not turned down, with an amount
 * above zero, holds every product of the add, alone or among others. The server
 * then adds nothing (backend `0260`, A1 and R5), so no row is drawn before it
 * answers. A line at zero is raised instead, which draws no new row either way.
 *
 * A prediction, as {@link addMayMeetLine} is. The server's answer always wins.
 */
export function addMayMeetProduct(
  lines: readonly Pick<Line, 'itemIds' | 'quantity' | 'approvalStatus'>[],
  itemIds: readonly string[]
): boolean {
  if (itemIds.length === 0) {
    return false;
  }
  return lines.some(
    (line) =>
      line.approvalStatus !== 'REJECTED' &&
      line.quantity > 0 &&
      itemIds.every((id) => line.itemIds.includes(id))
  );
}

/**
 * A product add the server refused because the list already counts that thing in
 * another unit (backend `0260`, section 3, `line_unit_differs`). Until a
 * conversion exists the person changes the amount on that line instead.
 *
 * Mapped from the refusal's `details.line`. `name` is the line's own spelling, or
 * the name of the product that was added when the refusal names none. `unit` is
 * the line's, null when it is missing or not one velista knows.
 */
export interface AddUnitRefusal {
  readonly lineId: string | null;
  readonly name: string;
  readonly unit: LineUnit | null;
}

/**
 * The key of the sentence that says a refusal (velista `0185`, section 4): the
 * unit the list counts the line in, or the one that names no unit when that is not
 * known. `list` reads "This list"; `basket` names the list, as `{{list}}`.
 */
export function addUnitRefusalKey(
  refusal: AddUnitRefusal,
  scope: 'list' | 'basket'
): string {
  return `${scope}.error.addUnitDiffers.${refusal.unit ?? 'unknown'}`;
}
