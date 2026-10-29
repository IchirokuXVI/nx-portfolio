import type { CatalogItem, Line } from './domain';
import type { LineApprovalStatus } from './enums';
import { LINE_QUANTITY_MAX } from './limits';
import { foldName, lineName } from './line-name';

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
 * - `intoLineId`: the person chose that line, and the add raises it. It never falls
 *   back to a new line.
 * - `newLine`: the person chose a new line.
 */
export interface AddLineOptions {
  readonly askIfAmbiguous?: true;
  readonly intoLineId?: string;
  readonly newLine?: true;
}

/** One line a `line_add_needs_choice` refusal names, as the server sent it. */
export interface AddChoiceLine {
  readonly lineId: string;
  readonly content: string;
  readonly named: boolean;
  readonly quantity: number;
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
  /** The line's quantity now, and what the add takes it to. */
  readonly from: number;
  readonly to: number;
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
 * `added` is the composer's quantity. A raise is capped as the server caps it, so the
 * arrow never promises a number the line cannot reach.
 */
export function addChoiceRows(
  choice: AddChoice,
  added: number,
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
      to: Math.min(LINE_QUANTITY_MAX, line.quantity + added),
    };
  });
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
